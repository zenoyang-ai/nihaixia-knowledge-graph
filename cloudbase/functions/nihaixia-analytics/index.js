/**
 * 倪海厦知识图谱 — 网页访问统计（埋点 + 飞书日报）
 *
 * HTTP：
 *   POST { type:'pageview', site, path, vid }  记录一次浏览
 *   GET  /  健康检查
 *   GET  ?action=report&day=YYYY-MM-DD  手动补发某日日报（默认昨天）
 *
 * Timer：每天北京时间 00:15 汇总「昨天」并飞书私聊推送
 *
 * 环境变量（控制台配置 Secret，勿写入 git）：
 *   FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_NOTIFY_OPEN_ID / ALLOWED_ORIGINS
 */

const crypto = require('crypto');
const cloudbase = require('@cloudbase/node-sdk');

const VERSION = '0.1.1';
const COLLECTION = 'site_daily_stats';
const DEFAULT_NOTIFY_OPEN_ID = 'ou_1527d3dbbeae3c13a25cb0159a6bff94';
const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const FEISHU_IM_URL = 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id';
const SITES = new Set(['cn', 'overseas', 'local']);

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
  constructor(windowMs = 60000, max = 40) {
    this._windowMs = windowMs;
    this._max = max;
    this._hits = new Map();
  }

  check(key) {
    const now = Date.now();
    let bucket = this._hits.get(key);
    if (!bucket || now - bucket.start >= this._windowMs) {
      bucket = { start: now, count: 0 };
      this._hits.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= this._max;
  }
}

const rateLimiter = new RateLimiter();

function shanghaiDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function yesterdayShanghai() {
  const now = new Date();
  // 取上海当前日历日的正午，再减 24h，避免 DST/边界抖动
  const today = shanghaiDay(now);
  const noonUtc = new Date(`${today}T04:00:00.000Z`); // 上海约中午
  const y = new Date(noonUtc.getTime() - 24 * 60 * 60 * 1000);
  return shanghaiDay(y);
}

function hashVid(vid) {
  return crypto.createHash('sha256').update(String(vid)).digest('hex').slice(0, 16);
}

function normalizeSite(raw) {
  const site = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return SITES.has(site) ? site : '';
}

function normalizePath(raw) {
  if (typeof raw !== 'string') return '/';
  let p = raw.trim().slice(0, 200);
  if (!p) return '/';
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}

function getDb() {
  const envId = process.env.SCF_NAMESPACE || 'zeno-d9g0gdvw4a57635c0';
  const app = cloudbase.init({
    env: envId,
    secretId: process.env.TENCENTCLOUD_SECRETID,
    secretKey: process.env.TENCENTCLOUD_SECRETKEY,
    sessionToken: process.env.TENCENTCLOUD_SESSIONTOKEN,
  });
  return app.database();
}

async function recordPageview(db, { site, path, vid }) {
  const day = shanghaiDay();
  const docId = `${day}_${site}`;
  const vidHash = hashVid(vid);
  const col = db.collection(COLLECTION);
  const _ = db.command;

  let row = null;
  try {
    const existing = await col.doc(docId).get();
    const data = existing && existing.data;
    if (Array.isArray(data)) row = data[0] || null;
    else if (data && typeof data === 'object') row = data;
  } catch (_) {
    row = null;
  }

  if (row && (row.pv != null || Array.isArray(row.uvids))) {
    const uvids = Array.isArray(row.uvids) ? row.uvids.slice() : [];
    if (!uvids.includes(vidHash)) uvids.push(vidHash);
    // 防止单日 UV 数组无限膨胀（Demo 上限）
    const trimmed = uvids.slice(0, 5000);
    await col.doc(docId).update({
      pv: _.inc(1),
      uvids: trimmed,
      lastPath: path,
      updatedAt: Date.now(),
    });
  } else {
    await col.doc(docId).set({
      day,
      site,
      pv: 1,
      uvids: [vidHash],
      lastPath: path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  return { day, site, docId };
}

async function loadDayStats(db, day) {
  const res = await db.collection(COLLECTION).where({ day }).limit(20).get();
  const rows = res.data || [];
  const bySite = { cn: { pv: 0, uv: 0 }, overseas: { pv: 0, uv: 0 }, local: { pv: 0, uv: 0 } };
  for (const row of rows) {
    const site = normalizeSite(row.site);
    if (!site) continue;
    bySite[site] = {
      pv: Number(row.pv) || 0,
      uv: Array.isArray(row.uvids) ? row.uvids.length : 0,
    };
  }
  return bySite;
}

function buildDailyReportText(day, bySite) {
  const cn = bySite.cn || { pv: 0, uv: 0 };
  const ov = bySite.overseas || { pv: 0, uv: 0 };
  const loc = bySite.local || { pv: 0, uv: 0 };
  const totalPv = cn.pv + ov.pv;
  const totalUv = cn.uv + ov.uv;
  const lines = [
    '【图谱访问日报】',
    `日期：${day}`,
    '',
    `合计（不含本地）：UV ${totalUv} · PV ${totalPv}`,
    `国内站：UV ${cn.uv} · PV ${cn.pv}`,
    `海外站：UV ${ov.uv} · PV ${ov.pv}`,
  ];
  if (loc.pv > 0) {
    lines.push(`本地调试：UV ${loc.uv} · PV ${loc.pv}`);
  }
  lines.push('', '说明：UV≈独立访客（匿名 ID），PV=页面打开次数');
  return lines.join('\n');
}

function resolveFeishu(env = {}) {
  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET;
  const notifyOpenId = env.FEISHU_NOTIFY_OPEN_ID || DEFAULT_NOTIFY_OPEN_ID;
  if (appId && appSecret && notifyOpenId) {
    return { configured: true, appId, appSecret, notifyOpenId };
  }
  return { configured: false };
}

async function sendToFeishuApp(appId, appSecret, receiveId, text, fetchImpl = fetch) {
  const tokenRes = await fetchImpl(FEISHU_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const tokenBody = await tokenRes.json();
  if (!tokenRes.ok || tokenBody.code !== 0 || !tokenBody.tenant_access_token) {
    throw new Error(`feishu_token_failed:${tokenBody.code || tokenRes.status}`);
  }
  const msgRes = await fetchImpl(FEISHU_IM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenBody.tenant_access_token}`,
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });
  const msgBody = await msgRes.json();
  if (!msgRes.ok || msgBody.code !== 0) {
    throw new Error(`feishu_send_failed:${msgBody.code || msgRes.status}`);
  }
  return msgBody;
}

async function sendDailyReport({ day, env, db, fetchImpl = fetch, force = false }) {
  const targetDay = day || yesterdayShanghai();
  const bySite = await loadDayStats(db, targetDay);
  const text = buildDailyReportText(targetDay, bySite);

  // 防重复：同一天只自动发一次（手动 force 可重发）
  const metaId = `report_${targetDay}`;
  if (!force) {
    try {
      const existed = await db.collection(COLLECTION).doc(metaId).get();
      if (existed.data && existed.data.length > 0 && existed.data[0].sent) {
        return { skipped: true, day: targetDay, reason: 'already_sent', text };
      }
    } catch (_) {
      // ignore
    }
  }

  const feishu = resolveFeishu(env);
  if (!feishu.configured) {
    return { ok: false, error: 'feishu_not_configured', day: targetDay, text };
  }

  await sendToFeishuApp(feishu.appId, feishu.appSecret, feishu.notifyOpenId, text, fetchImpl);

  try {
    await db.collection(COLLECTION).doc(metaId).set({
      day: targetDay,
      type: 'report_meta',
      sent: true,
      sentAt: Date.now(),
      text,
    });
  } catch (_) {
    try {
      await db.collection(COLLECTION).add({
        _id: metaId,
        day: targetDay,
        type: 'report_meta',
        sent: true,
        sentAt: Date.now(),
      });
    } catch (__) {
      // ignore meta write failure after successful send
    }
  }

  return { ok: true, day: targetDay, text };
}

function isTimerEvent(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.Type === 'Timer' || event.type === 'Timer') return true;
  if (event.TriggerName || event.triggerName) return true;
  if (typeof event.Time === 'string' && !event.httpMethod && !event.requestContext) return true;
  return false;
}

function parseBody(event) {
  if (!event) return {};
  if (typeof event.body === 'string' && event.body) {
    try {
      return JSON.parse(event.body);
    } catch (_) {
      return {};
    }
  }
  if (event.body && typeof event.body === 'object') return event.body;
  if (event.type === 'pageview' || event.action) return event;
  return {};
}

function createAnalyticsHandler({ env = process.env, fetchImpl = fetch, dbFactory = getDb } = {}) {
  async function main(event = {}, context) {
    try {
      return await handleEvent(event, context);
    } catch (err) {
      console.log(JSON.stringify({
        event: 'unhandled_error',
        error: err && err.message ? err.message.slice(0, 200) : 'unknown',
      }));
      const headers = (event && event.headers) || {};
      const origin = headers.origin || headers.Origin || '';
      return buildResponse(500, {
        ok: false,
        error: 'unhandled',
        reason: err && err.message ? String(err.message).slice(0, 120) : 'unknown',
        version: VERSION,
      }, origin, parseAllowedOrigins(env));
    }
  }

  async function handleEvent(event = {}, context) {
    // 定时触发：发昨天日报
    if (isTimerEvent(event)) {
      try {
        const db = dbFactory();
        const result = await sendDailyReport({ env, db, fetchImpl, force: false });
        console.log(JSON.stringify({ event: 'daily_report', ...result, version: VERSION }));
        return result;
      } catch (err) {
        console.log(JSON.stringify({
          event: 'daily_report_error',
          error: err && err.message ? err.message.slice(0, 200) : 'unknown',
        }));
        return { ok: false, error: 'report_failed' };
      }
    }

    const headers = event.headers || {};
    const origin = headers.origin || headers.Origin || '';
    const allowedOrigins = parseAllowedOrigins(env);
    const method = (event.httpMethod || event.requestContext?.httpMethod || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      return buildResponse(204, {}, origin, allowedOrigins);
    }

    if (method === 'GET') {
      const qs = event.queryStringParameters || event.queryString || {};
      if (qs.action === 'report') {
        try {
          const db = dbFactory();
          const result = await sendDailyReport({
            day: qs.day || undefined,
            env,
            db,
            fetchImpl,
            force: qs.force === '1' || qs.force === 'true',
          });
          const status = result.ok ? 200 : (result.error === 'feishu_not_configured' ? 503 : 200);
          return buildResponse(status, { ...result, version: VERSION }, origin, allowedOrigins);
        } catch (err) {
          return buildResponse(500, {
            ok: false,
            error: 'report_failed',
            message: err && err.message ? err.message.slice(0, 120) : 'unknown',
            version: VERSION,
          }, origin, allowedOrigins);
        }
      }

      const feishu = resolveFeishu(env);
      return buildResponse(200, {
        ok: true,
        version: VERSION,
        feishu_configured: feishu.configured,
        today: shanghaiDay(),
        yesterday: yesterdayShanghai(),
      }, origin, allowedOrigins);
    }

    if (method !== 'POST') {
      return buildResponse(405, { error: 'method_not_allowed' }, origin, allowedOrigins);
    }

    const clientIp = headers['x-forwarded-for']
      || headers['X-Forwarded-For']
      || (event.requestContext && event.requestContext.identity && event.requestContext.identity.sourceIp)
      || 'unknown';
    const ipKey = String(clientIp).split(',')[0].trim();
    if (!rateLimiter.check(ipKey)) {
      return buildResponse(429, { error: 'rate_limited' }, origin, allowedOrigins);
    }

    const body = parseBody(event);
    if (body.action === 'report') {
      try {
        const db = dbFactory();
        const result = await sendDailyReport({
          day: body.day || undefined,
          env,
          db,
          fetchImpl,
          force: !!body.force,
        });
        const status = result.ok ? 200 : (result.error === 'feishu_not_configured' ? 503 : 200);
        return buildResponse(status, { ...result, version: VERSION }, origin, allowedOrigins);
      } catch (err) {
        return buildResponse(500, { ok: false, error: 'report_failed', version: VERSION }, origin, allowedOrigins);
      }
    }

    const site = normalizeSite(body.site);
    const path = normalizePath(body.path);
    const vid = typeof body.vid === 'string' ? body.vid.trim().slice(0, 80) : '';
    if (!site || !vid || vid.length < 8) {
      return buildResponse(400, { error: 'invalid_pageview' }, origin, allowedOrigins);
    }

    try {
      const db = dbFactory();
      const recorded = await recordPageview(db, { site, path, vid });
      return buildResponse(200, { ok: true, ...recorded, version: VERSION }, origin, allowedOrigins);
    } catch (err) {
      console.log(JSON.stringify({
        event: 'pageview_error',
        error: err && err.message ? err.message.slice(0, 200) : 'unknown',
      }));
      return buildResponse(500, {
        ok: false,
        error: 'pageview_failed',
        reason: err && err.message ? String(err.message).slice(0, 120) : 'unknown',
        version: VERSION,
      }, origin, allowedOrigins);
    }
  }

  return { main };
}

const { main } = createAnalyticsHandler();

exports.main = main;
exports.VERSION = VERSION;
exports.shanghaiDay = shanghaiDay;
exports.yesterdayShanghai = yesterdayShanghai;
exports.buildDailyReportText = buildDailyReportText;
exports.hashVid = hashVid;
exports.normalizeSite = normalizeSite;
exports.createAnalyticsHandler = createAnalyticsHandler;
exports.resolveFeishu = resolveFeishu;
exports.isTimerEvent = isTimerEvent;
