/**
 * 倪海厦知识图谱 — 用户反馈 → 飞书（应用私聊优先，Webhook 备用）
 * CloudBase HTTP 函数入口
 */

const VERSION = '1.1.1';
const MAX_CONTENT_LENGTH = 2000;
const ALLOWED_CATEGORIES = ['功能建议', 'Bug 报错', '知识补充', '知识点补充', '其他'];
const DEFAULT_NOTIFY_OPEN_ID = 'ou_1527d3dbbeae3c13a25cb0159a6bff94';
const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const FEISHU_IM_URL = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id';

function parseAllowedOrigins(env) {
  const raw = (env.ALLOWED_ORIGINS
    || 'https://zenoyang-ai.github.io,https://zeno-d9g0gdvw4a57635c0-1452182285.tcloudbaseapp.com,http://localhost:8765,http://127.0.0.1:8765');
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function buildResponse(statusCode, body, origin, allowedOrigins) {
  const allowOrigin = allowedOrigins.includes(origin) ? origin : '';
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
    body: JSON.stringify(body),
  };
}

class RateLimiter {
  constructor(windowMs = 60000) {
    this._window = new Map();
    this._windowMs = windowMs;
  }

  check(key) {
    const now = Date.now();
    const last = this._window.get(key);
    if (last && now - last < this._windowMs) return false;
    this._window.set(key, now);
    return true;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, ts] of this._window) {
      if (now - ts > this._windowMs * 2) this._window.delete(key);
    }
  }
}

function normalizeCategory(raw) {
  const category = typeof raw === 'string' ? raw.trim() : '';
  if (ALLOWED_CATEGORIES.includes(category)) return category;
  if (!category) return '其他';
  return category.slice(0, 20);
}

function validateFeedback(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'invalid_body' };
  }

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) return { error: 'content_required' };
  if (content.length > MAX_CONTENT_LENGTH) return { error: 'content_too_long' };

  return {
    valid: {
      category: normalizeCategory(body.category),
      content,
      contact: typeof body.contact === 'string' ? body.contact.trim().slice(0, 200) : '',
      page: typeof body.page === 'string' ? body.page.trim().slice(0, 500) : '',
      time: typeof body.time === 'string' ? body.time.trim().slice(0, 50) : new Date().toISOString(),
      userAgent: typeof body.userAgent === 'string' ? body.userAgent.trim().slice(0, 200) : '',
    },
  };
}

function formatLocalTime(timeStr) {
  const d = timeStr ? new Date(timeStr) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('month')}月${get('day')}日 ${get('hour')}:${get('minute')}`;
}

function shortenPage(page) {
  if (!page) return '';
  try {
    const url = new URL(page);
    if (url.hash) return url.hash;
    if (url.pathname && url.pathname !== '/') return url.pathname;
    return '';
  } catch {
    if (page.startsWith('#') || page.startsWith('/')) return page;
    return '';
  }
}

function buildFeishuText(payload) {
  const lines = [
    `【图谱反馈】${payload.category || '其他'}`,
    '',
    payload.content,
  ];
  if (payload.contact) lines.push(`联系：${payload.contact}`);

  const metaParts = [];
  const timeStr = formatLocalTime(payload.time);
  const pageStr = shortenPage(payload.page);
  if (timeStr) metaParts.push(timeStr);
  if (pageStr) metaParts.push(pageStr);
  if (metaParts.length) {
    lines.push('');
    lines.push(metaParts.join(' · '));
  }
  return lines.join('\n');
}

function resolveFeishuChannel(env = {}) {
  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET;
  const notifyOpenId = env.FEISHU_NOTIFY_OPEN_ID || DEFAULT_NOTIFY_OPEN_ID;

  if (appId && appSecret && notifyOpenId) {
    return {
      channel: 'app_im',
      configured: true,
      appId,
      appSecret,
      notifyOpenId,
    };
  }

  if (env.FEISHU_WEBHOOK) {
    return {
      channel: 'webhook',
      configured: true,
      webhook: env.FEISHU_WEBHOOK,
    };
  }

  return { channel: 'none', configured: false };
}

async function parseFeishuResponse(res) {
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok || data.code !== 0) {
    const err = new Error(data.msg || `feishu_http_${res.status}`);
    err.status = res.status;
    err.feishuCode = data.code;
    throw err;
  }

  return data;
}

async function getTenantAccessToken(appId, appSecret, fetchImpl) {
  const res = await fetchImpl(FEISHU_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await parseFeishuResponse(res);
  return data.tenant_access_token;
}

async function sendToFeishuApp(appId, appSecret, receiveId, text, fetchImpl) {
  const token = await getTenantAccessToken(appId, appSecret, fetchImpl);
  const res = await fetchImpl(FEISHU_IM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });
  return parseFeishuResponse(res);
}

async function sendToFeishu(webhookUrl, text, fetchImpl) {
  const res = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: { text } }),
  });
  return parseFeishuResponse(res);
}

async function deliverToFeishu(channelConfig, text, fetchImpl) {
  if (channelConfig.channel === 'app_im') {
    return sendToFeishuApp(
      channelConfig.appId,
      channelConfig.appSecret,
      channelConfig.notifyOpenId,
      text,
      fetchImpl,
    );
  }

  if (channelConfig.channel === 'webhook') {
    return sendToFeishu(channelConfig.webhook, text, fetchImpl);
  }

  const err = new Error('feishu_not_configured');
  err.code = 'feishu_not_configured';
  throw err;
}

function createFeedbackHandler({ env, fetchImpl } = {}) {
  const _fetch = fetchImpl || fetch;
  const allowedOrigins = parseAllowedOrigins(env || {});
  const rateLimiter = new RateLimiter(60000);

  const cleanupInterval = setInterval(() => rateLimiter.cleanup(), 300000);
  if (cleanupInterval.unref) cleanupInterval.unref();

  async function main(event) {
    const origin = (event.headers && event.headers.origin) || '';
    const feishuChannel = resolveFeishuChannel(env || {});

    if (event.httpMethod === 'OPTIONS') {
      return buildResponse(204, {}, origin, allowedOrigins);
    }

    if (origin && !allowedOrigins.includes(origin) && event.httpMethod !== 'GET') {
      return buildResponse(403, { ok: false, error: 'origin_not_allowed' }, origin, allowedOrigins);
    }

    if (event.httpMethod === 'GET') {
      return buildResponse(200, {
        ok: true,
        version: VERSION,
        feishu_configured: feishuChannel.configured,
        channel: feishuChannel.channel,
      }, origin, allowedOrigins);
    }

    if (event.httpMethod !== 'POST') {
      return buildResponse(405, { ok: false, error: 'method_not_allowed' }, origin, allowedOrigins);
    }

    const ip = (event.headers && (event.headers['x-forwarded-for'] || event.headers['x-real-ip'])) || 'unknown';
    const rateKey = `${ip}:${origin || 'no-origin'}`;
    if (!rateLimiter.check(rateKey)) {
      return buildResponse(429, { ok: false, error: 'rate_limited' }, origin, allowedOrigins);
    }

    let rawBody = event.body || '{}';
    if (event.isBase64Encoded) {
      rawBody = Buffer.from(rawBody, 'base64').toString('utf-8');
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return buildResponse(400, { ok: false, error: 'invalid_json' }, origin, allowedOrigins);
    }

    const validation = validateFeedback(body);
    if (validation.error) {
      return buildResponse(400, { ok: false, error: validation.error }, origin, allowedOrigins);
    }

    if (!feishuChannel.configured) {
      return buildResponse(503, { ok: false, error: 'feishu_not_configured' }, origin, allowedOrigins);
    }

    const text = buildFeishuText(validation.valid);
    if (validation.valid.userAgent) {
      console.log(JSON.stringify({ status: 'feedback_ua', ua: validation.valid.userAgent }));
    }

    try {
      await deliverToFeishu(feishuChannel, text, _fetch);
      return buildResponse(200, { ok: true }, origin, allowedOrigins);
    } catch (err) {
      console.log(JSON.stringify({
        status: 'feishu_error',
        channel: feishuChannel.channel,
        message: err.message,
        http_status: err.status,
        feishu_code: err.feishuCode,
      }));
      return buildResponse(502, {
        ok: false,
        error: 'feishu_delivery_failed',
        detail: err.message,
      }, origin, allowedOrigins);
    }
  }

  return { main };
}

const defaultHandler = createFeedbackHandler({
  env: {
    FEISHU_APP_ID: process.env.FEISHU_APP_ID,
    FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET,
    FEISHU_NOTIFY_OPEN_ID: process.env.FEISHU_NOTIFY_OPEN_ID,
    FEISHU_WEBHOOK: process.env.FEISHU_WEBHOOK,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  },
});

exports.main = defaultHandler.main;
exports.VERSION = VERSION;
exports.DEFAULT_NOTIFY_OPEN_ID = DEFAULT_NOTIFY_OPEN_ID;
exports.validateFeedback = validateFeedback;
exports.buildFeishuText = buildFeishuText;
exports.formatLocalTime = formatLocalTime;
exports.shortenPage = shortenPage;
exports.resolveFeishuChannel = resolveFeishuChannel;
exports.getTenantAccessToken = getTenantAccessToken;
exports.sendToFeishuApp = sendToFeishuApp;
exports.sendToFeishu = sendToFeishu;
exports.deliverToFeishu = deliverToFeishu;
exports.createFeedbackHandler = createFeedbackHandler;
