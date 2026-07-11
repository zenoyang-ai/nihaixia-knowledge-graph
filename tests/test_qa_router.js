const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildYuanqiPayload,
  createRouter,
  normalizeRequest,
} = require('../cloudbase/functions/nihaixia-qa-router');

const ENV = {
  YUANQI_APP_ID: 'assistant-123',
  YUANQI_APP_KEY: 'test-key',
  CLOUDBASE_BOT_ID: 'bot-456',
  PRIMARY_PROVIDER: 'yuanqi',
  ALLOWED_ORIGINS: 'https://zenoyang-ai.github.io',
};

const ENV_NO_CB = {
  YUANQI_APP_ID: 'assistant-123',
  YUANQI_APP_KEY: 'test-key',
  PRIMARY_PROVIDER: 'yuanqi',
  ALLOWED_ORIGINS: 'https://zenoyang-ai.github.io',
};

function event(body, origin = 'https://zenoyang-ai.github.io') {
  return {
    httpMethod: 'POST',
    headers: { origin, 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify(body),
  };
}

// --- Mock SDK factories ---

function mockSdk({ text, runError, noFinish, emptyStream }) {
  return {
    SYMBOL_DEFAULT_ENV: '__default_env__',
    init() {
      return {
        ai() {
          return {
            bot: {
              async sendMessage() {
                return {
                  dataStream: (async function* stream() {
                    if (emptyStream) {
                      // no events at all
                      return;
                    }
                    if (text) {
                      yield { type: 'TEXT_MESSAGE_CONTENT', delta: text.slice(0, 2) };
                      yield { type: 'TEXT_MESSAGE_CONTENT', delta: text.slice(2) };
                    }
                    if (runError) {
                      yield { type: 'RUN_ERROR', message: 'agent failed' };
                    }
                    if (!noFinish) {
                      yield { type: 'RUN_FINISHED' };
                    }
                  })(),
                };
              },
            },
          };
        },
      };
    },
  };
}

function cloudbaseWithText(text) {
  return mockSdk({ text });
}

// --- Tests ---

test('normalizes legacy question and caps history at 12 alternating messages', () => {
  const legacy = normalizeRequest({ message: '  人纪和天纪的关系？  ' });
  assert.equal(legacy.messages.length, 1);
  assert.equal(legacy.messages[0].content, '人纪和天纪的关系？');

  const messages = Array.from({ length: 13 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `m${index}`,
  }));
  const normalized = normalizeRequest({ session_id: 's-1', messages });
  assert.equal(normalized.messages.length, 12);
  assert.equal(normalized.messages[0].content, 'm1');
  assert.equal(normalized.messages.at(-1).role, 'user');
  assert.throws(() => normalizeRequest({ messages: [{ role: 'assistant', content: 'wrong' }] }));
});

test('builds Yuanqi payload with documented content array shape', () => {
  const payload = buildYuanqiPayload({
    assistantId: 'assistant-123',
    userId: 'anon-1',
    messages: [{ role: 'user', content: '你好' }],
  });
  assert.deepEqual(payload, {
    assistant_id: 'assistant-123',
    user_id: 'anon-1',
    stream: false,
    messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
  });
});

// Phase 2 Test 1: Yuanqi fails → CloudBase Agent succeeds with ai.bot.sendMessage()
test('uses CloudBase Agent as fallback after Yuanqi failure', async () => {
  let fetchCalls = 0;
  const router = createRouter({
    env: ENV,
    fetchImpl: async () => {
      fetchCalls += 1;
      return { ok: false, status: 503, json: async () => ({}) };
    },
    cloudbaseSdk: cloudbaseWithText('来自 CloudBase 知识库'),
    randomUUID: () => 'request-1',
  });
  const response = await router.main(event({ message: '天纪是什么？' }));
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(fetchCalls, 1);
  assert.equal(body.provider, 'cloudbase');
  assert.equal(body.degraded, true);
  assert.equal(body.reply, '来自 CloudBase 知识库');
});

// Phase 2 Test 2: CloudBase must use ai.bot.sendMessage, not generateText
test('CloudBase mock uses bot.sendMessage with streaming dataStream', async () => {
  let sendMessageCalled = false;
  const sdk = {
    SYMBOL_DEFAULT_ENV: '__default_env__',
    init() {
      return {
        ai() {
          return {
            bot: {
              async sendMessage(args) {
                sendMessageCalled = true;
                assert.equal(args.botId, 'bot-456');
                assert.ok(args.threadId);
                assert.ok(args.runId);
                assert.ok(Array.isArray(args.messages));
                assert.ok(args.messages[0].id);
                return {
                  dataStream: (async function* () {
                    yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'OK' };
                    yield { type: 'RUN_FINISHED' };
                  })(),
                };
              },
            },
          };
        },
      };
    },
  };
  const router = createRouter({
    env: ENV,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    cloudbaseSdk: sdk,
  });
  await router.main(event({ message: '伤寒论' }));
  assert.equal(sendMessageCalled, true);
});

// Phase 2 Test 5: Missing CLOUDBASE_BOT_ID → skip CloudBase, health shows cloudbase: false
test('missing CLOUDBASE_BOT_ID skips CloudBase and health shows false', async () => {
  const router = createRouter({
    env: ENV_NO_CB,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    cloudbaseSdk: cloudbaseWithText('should not reach here'),
  });

  // Health check
  const healthRes = await router.main({ httpMethod: 'GET', headers: { origin: 'https://zenoyang-ai.github.io' } });
  const healthBody = JSON.parse(healthRes.body);
  assert.equal(healthBody.providers.cloudbase, false);

  // POST → both fail → 502
  const postRes = await router.main(event({ message: '伤寒论' }));
  assert.equal(postRes.statusCode, 502);
});

// Phase 2 Test 6: Yuanqi sensitive → return safe prompt, do NOT switch to backup
test('Yuanqi finish_reason sensitive returns safe prompt without fallback', async () => {
  let cbCalled = false;
  const router = createRouter({
    env: ENV,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: { content: '' },
          finish_reason: 'sensitive',
        }],
      }),
    }),
    cloudbaseSdk: {
      SYMBOL_DEFAULT_ENV: '__env__',
      init() {
        return {
          ai() {
            return {
              bot: {
                async sendMessage() {
                  cbCalled = true;
                  return { dataStream: (async function* () { yield { type: 'RUN_FINISHED' }; })() };
                },
              },
            };
          },
        };
      },
    },
  });
  const response = await router.main(event({ message: '某些敏感问题' }));
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.provider, 'yuanqi');
  assert.equal(body.degraded, false);
  assert.match(body.reply, /敏感/);
  assert.equal(cbCalled, false);
});

// Phase 2 Test 6b: Yuanqi 400 → return controlled error, do NOT switch to backup
test('Yuanqi 400 returns controlled error without fallback', async () => {
  let cbCalled = false;
  const router = createRouter({
    env: ENV,
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'bad request' }),
    }),
    cloudbaseSdk: {
      SYMBOL_DEFAULT_ENV: '__env__',
      init() {
        return {
          ai() {
            return {
              bot: {
                async sendMessage() {
                  cbCalled = true;
                  return { dataStream: (async function* () { yield { type: 'RUN_FINISHED' }; })() };
                },
              },
            };
          },
        };
      },
    },
  });
  const response = await router.main(event({ message: '伤寒论' }));
  assert.equal(response.statusCode, 400);
  const body = JSON.parse(response.body);
  assert.match(body.error, /请求格式错误/);
  assert.equal(cbCalled, false);
});

// Phase 2 Test 4: RUN_ERROR → CloudBase fails
test('CloudBase RUN_ERROR causes fallback to fail', async () => {
  const router = createRouter({
    env: ENV,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    cloudbaseSdk: mockSdk({ runError: true }),
  });
  const response = await router.main(event({ message: '伤寒论' }));
  assert.equal(response.statusCode, 502);
});

// Phase 2 Test 4b: Missing RUN_FINISHED → CloudBase fails
test('CloudBase missing RUN_FINISHED causes fallback to fail', async () => {
  const router = createRouter({
    env: ENV,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    cloudbaseSdk: mockSdk({ text: 'partial answer', noFinish: true }),
  });
  const response = await router.main(event({ message: '伤寒论' }));
  assert.equal(response.statusCode, 502);
});

// Phase 2 Test 4c: Empty stream → CloudBase fails
test('CloudBase empty stream causes fallback to fail', async () => {
  const router = createRouter({
    env: ENV,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    cloudbaseSdk: mockSdk({ emptyStream: true }),
  });
  const response = await router.main(event({ message: '伤寒论' }));
  assert.equal(response.statusCode, 502);
});

// Phase 2 Test 8: Medical interception blocks before any provider
test('blocks executable medical requests before calling either provider', async () => {
  const router = createRouter({
    env: ENV,
    fetchImpl: async () => { throw new Error('must not call provider'); },
    cloudbaseSdk: cloudbaseWithText('must not call provider'),
  });
  const response = await router.main(event({ message: '小柴胡汤怎么吃，剂量多少？' }));
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 400);
  assert.match(body.error, /医疗建议/);
});

// Phase 2 Test: Both providers fail → 502
test('returns 502 when both RAG providers fail', async () => {
  const router = createRouter({
    env: ENV,
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }),
    cloudbaseSdk: { SYMBOL_DEFAULT_ENV: '__env__', init() { throw new Error('cloudbase unavailable'); } },
  });
  const response = await router.main(event({ message: '伤寒论重点？' }));
  assert.equal(response.statusCode, 502);
});

// Phase 4: Health check exposes flags, never values
test('health exposes configuration flags but never values', async () => {
  const router = createRouter({ env: ENV });
  const response = await router.main({ httpMethod: 'GET', headers: { origin: 'https://zenoyang-ai.github.io' } });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(body.providers, { yuanqi: true, cloudbase: true });
  assert.equal(response.body.includes('test-key'), false);
  assert.equal(response.body.includes('bot-456'), false);
});

// Phase 4: Health with no CLOUDBASE_BOT_ID
test('health shows cloudbase false when CLOUDBASE_BOT_ID missing', async () => {
  const router = createRouter({ env: ENV_NO_CB });
  const response = await router.main({ httpMethod: 'GET', headers: { origin: 'https://zenoyang-ai.github.io' } });
  const body = JSON.parse(response.body);
  assert.equal(body.providers.cloudbase, false);
});

// Phase 4: CORS rejection
test('rejects unapproved browser origins', async () => {
  const router = createRouter({ env: ENV });
  const response = await router.main(event({ message: '你好' }, 'https://not-allowed.example'));
  assert.equal(response.statusCode, 403);
});

// Phase 2: Yuanqi success on first try
test('Yuanqi success returns immediately without calling CloudBase', async () => {
  let cbCalled = false;
  const router = createRouter({
    env: ENV,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: { content: '伤寒论是中医经典' },
          finish_reason: 'stop',
        }],
      }),
    }),
    cloudbaseSdk: {
      SYMBOL_DEFAULT_ENV: '__env__',
      init() {
        return {
          ai() {
            return {
              bot: {
                async sendMessage() {
                  cbCalled = true;
                  return { dataStream: (async function* () { yield { type: 'RUN_FINISHED' }; })() };
                },
              },
            };
          },
        };
      },
    },
  });
  const response = await router.main(event({ message: '伤寒论是什么？' }));
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.provider, 'yuanqi');
  assert.equal(body.degraded, false);
  assert.equal(body.reply, '伤寒论是中医经典');
  assert.equal(cbCalled, false);
});
