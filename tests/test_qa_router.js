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

function event(body, origin = 'https://zenoyang-ai.github.io') {
  return {
    httpMethod: 'POST',
    headers: { origin, 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify(body),
  };
}

function cloudbaseWithText(text) {
  return {
    init() {
      return {
        ai() {
          return {
            bot: {
              async sendMessage() {
                return {
                  dataStream: (async function* stream() {
                    yield { type: 'TEXT_MESSAGE_CONTENT', delta: text.slice(0, 2) };
                    yield { type: 'TEXT_MESSAGE_CONTENT', delta: text.slice(2) };
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
}

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

test('returns 502 when both RAG providers fail', async () => {
  const router = createRouter({
    env: ENV,
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }),
    cloudbaseSdk: { init() { throw new Error('cloudbase unavailable'); } },
  });
  const response = await router.main(event({ message: '伤寒论重点？' }));
  assert.equal(response.statusCode, 502);
});

test('health exposes configuration flags but never values', async () => {
  const router = createRouter({ env: ENV });
  const response = await router.main({ httpMethod: 'GET', headers: { origin: 'https://zenoyang-ai.github.io' } });
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(body.providers, { yuanqi: true, cloudbase: true });
  assert.equal(response.body.includes('test-key'), false);
});

test('rejects unapproved browser origins', async () => {
  const router = createRouter({ env: ENV });
  const response = await router.main(event({ message: '你好' }, 'https://not-allowed.example'));
  assert.equal(response.statusCode, 403);
});
