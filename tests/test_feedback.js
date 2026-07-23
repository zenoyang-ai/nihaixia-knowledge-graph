const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateFeedback,
  buildFeishuText,
  createFeedbackHandler,
  resolveFeishuChannel,
  sendToFeishu,
  sendToFeishuApp,
  DEFAULT_NOTIFY_OPEN_ID,
} = require('../cloudbase/functions/nihaixia-feedback');

const ALLOWED_ORIGIN = 'https://zenoyang-ai.github.io';

const APP_ENV = {
  FEISHU_APP_ID: 'cli_aa9059f5d038dcd4',
  FEISHU_APP_SECRET: 'test-secret',
  FEISHU_NOTIFY_OPEN_ID: 'ou_1527d3dbbeae3c13a25cb0159a6bff94',
  ALLOWED_ORIGINS: ALLOWED_ORIGIN,
};

function event(method, body, origin = ALLOWED_ORIGIN) {
  return {
    httpMethod: method,
    headers: { origin, 'x-forwarded-for': '203.0.113.7' },
    body: body ? JSON.stringify(body) : undefined,
  };
}

function createAppImFetchMock({ tokenCode = 0, messageCode = 0 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('tenant_access_token')) {
      return {
        ok: tokenCode === 0,
        status: tokenCode === 0 ? 200 : 400,
        json: async () => (tokenCode === 0
          ? { code: 0, tenant_access_token: 't-token-abc' }
          : { code: tokenCode, msg: 'invalid app secret' }),
      };
    }
    if (url.includes('/im/v1/messages')) {
      return {
        ok: messageCode === 0,
        status: messageCode === 0 ? 200 : 400,
        json: async () => (messageCode === 0
          ? { code: 0, data: { message_id: 'om_test' } }
          : { code: messageCode, msg: 'send failed' }),
      };
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };
  return { fetchImpl, calls };
}

test('validateFeedback rejects empty content', () => {
  const result = validateFeedback({ category: '其他', content: '   ' });
  assert.equal(result.error, 'content_required');
});

test('validateFeedback rejects content over 2000 chars', () => {
  const result = validateFeedback({ category: '其他', content: 'x'.repeat(2001) });
  assert.equal(result.error, 'content_too_long');
});

test('validateFeedback normalizes category and trims fields', () => {
  const result = validateFeedback({
    category: '未知类型很长很长很长很长很长',
    content: '你好',
    contact: '  test@example.com  ',
    page: 'https://example.com',
    userAgent: 'Mozilla',
  });
  assert.ok(result.valid);
  assert.equal(result.valid.category, '未知类型很长很长很长很长很长'.slice(0, 20));
  assert.equal(result.valid.content, '你好');
  assert.equal(result.valid.contact, 'test@example.com');
});

test('validateFeedback keeps whitelisted category', () => {
  const result = validateFeedback({ category: 'Bug 报错', content: '按钮点不动' });
  assert.equal(result.valid.category, 'Bug 报错');
});

test('buildFeishuText includes key fields', () => {
  const text = buildFeishuText({
    category: '功能建议',
    content: '希望增加搜索',
    contact: 'wx123',
    time: '2026-07-23T12:00:00.000Z',
    page: 'https://example.com',
    userAgent: 'TestAgent',
  });
  assert.match(text, /【倪海厦图谱反馈】功能建议/);
  assert.match(text, /希望增加搜索/);
  assert.match(text, /联系：wx123/);
  assert.match(text, /页面：https:\/\/example\.com/);
});

test('resolveFeishuChannel prefers app_im when app credentials present', () => {
  const channel = resolveFeishuChannel({
    FEISHU_APP_ID: 'cli_test',
    FEISHU_APP_SECRET: 'secret',
    FEISHU_WEBHOOK: 'https://open.feishu.cn/hook/test',
  });
  assert.equal(channel.channel, 'app_im');
  assert.equal(channel.configured, true);
  assert.equal(channel.notifyOpenId, DEFAULT_NOTIFY_OPEN_ID);
});

test('resolveFeishuChannel falls back to webhook', () => {
  const channel = resolveFeishuChannel({
    FEISHU_WEBHOOK: 'https://open.feishu.cn/hook/test',
  });
  assert.equal(channel.channel, 'webhook');
  assert.equal(channel.configured, true);
});

test('resolveFeishuChannel returns none when unconfigured', () => {
  const channel = resolveFeishuChannel({});
  assert.equal(channel.channel, 'none');
  assert.equal(channel.configured, false);
});

test('GET health check reports app_im without leaking secrets', async () => {
  const { main } = createFeedbackHandler({ env: APP_ENV });
  const res = await main(event('GET'));
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.feishu_configured, true);
  assert.equal(body.channel, 'app_im');
  assert.equal(body.version, '1.1.0');
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('test-secret'), false);
  assert.equal(serialized.includes('ou_1527d3dbbeae3c13a25cb0159a6bff94'), false);
});

test('GET health check reports webhook channel', async () => {
  const { main } = createFeedbackHandler({
    env: { FEISHU_WEBHOOK: 'https://open.feishu.cn/hook/secret', ALLOWED_ORIGINS: ALLOWED_ORIGIN },
  });
  const res = await main(event('GET'));
  const body = JSON.parse(res.body);
  assert.equal(body.channel, 'webhook');
  assert.equal(body.feishu_configured, true);
  assert.equal(JSON.stringify(body).includes('hook/secret'), false);
});

test('POST without feishu config returns 503', async () => {
  const { main } = createFeedbackHandler({
    env: { ALLOWED_ORIGINS: ALLOWED_ORIGIN },
  });
  const res = await main(event('POST', { category: '其他', content: '测试' }));
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 503);
  assert.equal(body.error, 'feishu_not_configured');
});

test('POST success via app_im channel', async () => {
  const { fetchImpl, calls } = createAppImFetchMock();
  const { main } = createFeedbackHandler({ env: APP_ENV, fetchImpl });
  const res = await main(event('POST', { category: '其他', content: '测试反馈' }));
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /tenant_access_token/);
  assert.match(calls[1].url, /\/im\/v1\/messages/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer t-token-abc');
  const messageBody = JSON.parse(calls[1].options.body);
  assert.equal(messageBody.receive_id, APP_ENV.FEISHU_NOTIFY_OPEN_ID);
  assert.equal(messageBody.msg_type, 'text');
  assert.match(JSON.parse(messageBody.content).text, /测试反馈/);
});

test('POST app_im fails when message send returns non-zero code', async () => {
  const { fetchImpl } = createAppImFetchMock({ messageCode: 230001 });
  const { main } = createFeedbackHandler({ env: APP_ENV, fetchImpl });
  const res = await main(event('POST', { category: '其他', content: '测试反馈' }));
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 502);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'feishu_delivery_failed');
});

test('POST success via webhook fallback', async () => {
  const { main } = createFeedbackHandler({
    env: { FEISHU_WEBHOOK: 'https://open.feishu.cn/hook/test', ALLOWED_ORIGINS: ALLOWED_ORIGIN },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, msg: 'success' }),
    }),
  });
  const res = await main(event('POST', { category: '其他', content: '测试反馈' }));
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.ok, true);
});

test('POST webhook fails when feishu returns non-zero code', async () => {
  const { main } = createFeedbackHandler({
    env: { FEISHU_WEBHOOK: 'https://open.feishu.cn/hook/test', ALLOWED_ORIGINS: ALLOWED_ORIGIN },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ code: 19001, msg: 'invalid webhook' }),
    }),
  });
  const res = await main(event('POST', { category: '其他', content: '测试反馈' }));
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 502);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'feishu_delivery_failed');
});

test('sendToFeishu throws on non-200', async () => {
  await assert.rejects(
    () => sendToFeishu('https://example.com', 'hi', async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })),
  );
});

test('sendToFeishuApp requests token then sends IM message', async () => {
  const { fetchImpl, calls } = createAppImFetchMock();
  await sendToFeishuApp(
    APP_ENV.FEISHU_APP_ID,
    APP_ENV.FEISHU_APP_SECRET,
    APP_ENV.FEISHU_NOTIFY_OPEN_ID,
    'hello',
    fetchImpl,
  );
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /tenant_access_token/);
  assert.match(calls[1].url, /\/im\/v1\/messages/);
});
