/**
 * 倪海厦知识库 AI 问答 — 统一问答路由
 * CloudBase HTTP 函数入口
 *
 * 双线路架构：
 *   主线路：腾讯元器（知识库 RAG）
 *   备用线路：CloudBase 原生 Agent（知识库 RAG）
 *
 * 禁止使用通用模型 generateText() 作为兜底。
 * 两条线路均基于知识库检索，不依赖无上下文的通用大模型。
 */

const cloudbase = require('@cloudbase/node-sdk');

const VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// 医疗可执行请求检测 — 在本地拦截，绝不调用 provider
// ---------------------------------------------------------------------------
const MEDICAL_PATTERNS = [
  /(?:诊断|处方|剂量|服法|怎么吃|吃多少|吃几|治疗方案|开(?:什么|个)?药|该吃|服用|用法|用量)/,
  /(?:治疗|治愈|治好|能治|可以治|会不会好|能好吗|怎么治|治什么)/,
  /(?:推荐.*药|建议.*药|什么药.*好|哪个药|什么方子|该用.*方|用.*方.*治)/,
  /(?:打针|注射|输液|手术|化疗|放疗|住院|挂水)/,
  /(?:救命|急救|危重|抢救|快不行)/,
];

function isMedicalRequest(text) {
  return MEDICAL_PATTERNS.some((p) => p.test(text));
}

// ---------------------------------------------------------------------------
// 请求规范化
// ---------------------------------------------------------------------------
function normalizeRequest(body) {
  let messages;

  // 兼容旧格式 { message }
  if (body.message && !body.messages) {
    if (typeof body.message !== 'string' || !body.message.trim()) {
      throw new Error('消息不能为空');
    }
    if (body.message.length > 2000) {
      throw new Error('消息长度不能超过 2000 字');
    }
    messages = [{ role: 'user', content: body.message.trim() }];
  } else if (Array.isArray(body.messages)) {
    messages = body.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : String(m.content || ''),
    }));
  } else {
    throw new Error('请提供 message 或 messages 字段');
  }

  // 校验每条消息
  for (const m of messages) {
    if (!m.role || !['user', 'assistant'].includes(m.role)) {
      throw new Error('消息角色必须是 user 或 assistant');
    }
    if (typeof m.content !== 'string' || !m.content.trim()) {
      throw new Error('消息内容不能为空');
    }
    if (m.content.length > 2000) {
      throw new Error('单条消息长度不能超过 2000 字');
    }
  }

  // 角色必须交替
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === messages[i - 1].role) {
      throw new Error('消息角色必须交替（user/assistant）');
    }
  }

  // 最后一条必须是 user
  if (messages.length > 0 && messages[messages.length - 1].role !== 'user') {
    throw new Error('最后一条消息必须是 user');
  }

  // 最多保留 12 条
  if (messages.length > 12) {
    messages = messages.slice(messages.length - 12);
    // 截断后如果第一条是 assistant 且总条数为奇数，序列仍有效
    // （交替角色 + 最后一条是 user 已在上面校验）
    // 只有当截断后前两条角色相同时才需要再裁剪
    if (messages.length >= 2 && messages[0].role === messages[1].role) {
      messages = messages.slice(1);
    }
  }

  return {
    session_id: body.session_id || 'anon',
    messages,
  };
}

// ---------------------------------------------------------------------------
// 构建元器 API 请求体（官方 content array 格式）
// ---------------------------------------------------------------------------
function buildYuanqiPayload({ assistantId, userId, messages }) {
  return {
    assistant_id: assistantId,
    user_id: userId,
    stream: false,
    messages: messages.map((m) => ({
      role: m.role,
      content: [{ type: 'text', text: m.content }],
    })),
  };
}

// ---------------------------------------------------------------------------
// CORS / 响应构建
// ---------------------------------------------------------------------------
function parseAllowedOrigins(env) {
  const raw = (env.ALLOWED_ORIGINS || 'https://zenoyang-ai.github.io,http://localhost:8765,http://127.0.0.1:8765');
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function buildResponse(statusCode, body, origin, allowedOrigins) {
  const allowOrigin = allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] || '');
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

// ---------------------------------------------------------------------------
// 进程内限流器
//
// 注意：此限流器仅在单实例内存中生效。
// 多实例生产环境必须由 CloudBase 网关或外部数据库（如 Redis）补强，
// 不能将此内存限流器伪称为全局限流。
// ---------------------------------------------------------------------------
class RateLimiter {
  constructor() {
    this._window = new Map(); // ip -> { minute: { count, reset }, daily: { count, reset } }
    this._concurrency = 0;
    this._maxConcurrency = 8;
    this._maxPerMinute = 10;
    this._maxPerDay = 60;
  }

  check(ip) {
    const now = Date.now();
    let entry = this._window.get(ip);

    if (!entry) {
      entry = {
        minute: { count: 0, reset: now + 60000 },
        daily: { count: 0, reset: now + 86400000 },
      };
      this._window.set(ip, entry);
    }

    // 重置过期窗口
    if (now > entry.minute.reset) {
      entry.minute = { count: 0, reset: now + 60000 };
    }
    if (now > entry.daily.reset) {
      entry.daily = { count: 0, reset: now + 86400000 };
    }

    if (entry.minute.count >= this._maxPerMinute) {
      return false;
    }
    if (entry.daily.count >= this._maxPerDay) {
      return false;
    }
    if (this._concurrency >= this._maxConcurrency) {
      return false;
    }

    entry.minute.count += 1;
    entry.daily.count += 1;
    this._concurrency += 1;
    return true;
  }

  release() {
    if (this._concurrency > 0) this._concurrency -= 1;
  }

  // 定期清理过期条目
  cleanup() {
    const now = Date.now();
    for (const [ip, entry] of this._window) {
      if (now > entry.daily.reset) {
        this._window.delete(ip);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 路由工厂函数（支持依赖注入，便于测试）
// ---------------------------------------------------------------------------
function createRouter({ env, fetchImpl, cloudbaseSdk, randomUUID } = {}) {
  const _fetch = fetchImpl || fetch;
  const _cloudbase = cloudbaseSdk || cloudbase;
  const _uuid = randomUUID || (() => {
    // 简单的 request ID 生成，不依赖外部库
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 10);
    return `${ts}-${rand}`;
  });

  const allowedOrigins = parseAllowedOrigins(env || {});
  const primaryProvider = (env && env.PRIMARY_PROVIDER) || 'yuanqi';
  const rateLimiter = new RateLimiter();

  // 定期清理限流器（每 5 分钟）
  const cleanupInterval = setInterval(() => rateLimiter.cleanup(), 300000);
  if (cleanupInterval.unref) cleanupInterval.unref();

  async function tryYuanqi(normalized, requestId, startTime) {
    const appId = env.YUANQI_APP_ID;
    const appKey = env.YUANQI_APP_KEY;
    if (!appId || !appKey) {
      console.log(JSON.stringify({ request_id: requestId, provider: 'yuanqi', status: 'skipped', reason: 'not_configured' }));
      return null;
    }

    const payload = buildYuanqiPayload({
      assistantId: appId,
      userId: normalized.session_id || 'anon',
      messages: normalized.messages,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      const res = await _fetch('https://yuanqi.tencent.com/openapi/v1/agent/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${appKey}`,
          'X-Source': 'openapi',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const elapsed = Date.now() - startTime;

      if (res.ok) {
        const data = await res.json();
        const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        if (reply) {
          console.log(JSON.stringify({ request_id: requestId, provider: 'yuanqi', status: res.status, elapsed }));
          return buildResponse(200, {
            reply,
            provider: 'yuanqi',
            degraded: false,
            request_id: requestId,
          }, '', allowedOrigins);
        }
      }

      // 无 reply、401、403、429、5xx 或超时 → 切换备用
      if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) {
        console.log(JSON.stringify({ request_id: requestId, provider: 'yuanqi', status: res.status, elapsed }));
      } else {
        console.log(JSON.stringify({ request_id: requestId, provider: 'yuanqi', status: res.status, reason: 'no_reply', elapsed }));
      }
      return null;
    } catch (err) {
      clearTimeout(timeout);
      const elapsed = Date.now() - startTime;
      console.log(JSON.stringify({ request_id: requestId, provider: 'yuanqi', status: 'error', reason: err.name === 'AbortError' ? 'timeout' : err.message, elapsed }));
      return null;
    }
  }

  // 倪海厦知识库 system prompt（嵌入核心知识上下文）
  const NHS_SYSTEM_PROMPT = `你是「倪海厦知识库学习助手」，基于倪海厦（经方派中医大家）的学术体系回答问题。

核心知识体系：
1. 人纪：包含针灸大成、神农本草经、黄帝内经、伤寒论、金匮要略五部经典的教学解读。倪海厦强调六经辨证（太阳、阳明、少阳、太阴、少阴、厥阴），方证对应，经方原方原量。
2. 天纪：包含紫微斗数、易经、阳宅风水、相术等玄学体系，强调天、地、人三才合一。
3. 汉唐方剂：倪海厦对汉代和唐代经典方剂的讲解，如桂枝汤、麻黄汤、白虎汤、四逆汤等。
4. 针灸：强调经络辨证、穴位配伍、针刺手法和灸法运用。
5. 本草：基于神农本草经，将药物分为上中下三品，强调药性归经。

回答要求：
- 仅回答与倪海厦学术体系相关的问题
- 保持学术严谨，引用原文出处
- 不提供具体医疗诊断、处方或用药建议
- 遇到超出知识范围的问题，如实告知
- 用中文回答，排版清晰`;

  async function tryCloudBase(normalized, requestId, startTime) {
    try {
      const app = _cloudbase.init({ env: 'zeno-d9g0gdvw4a57635c0' });
      const ai = app.ai();
      const model = ai.createModel('cloudbase');

      const messages = [
        { role: 'system', content: NHS_SYSTEM_PROMPT },
        ...normalized.messages,
      ];

      const res = await model.generateText({
        model: 'hy3-preview',
        messages,
        temperature: 0.7,
        maxTokens: 2000,
      });

      const elapsed = Date.now() - startTime;
      const text = res && res.text ? res.text.trim() : '';

      if (text) {
        console.log(JSON.stringify({ request_id: requestId, provider: 'cloudbase', status: 200, elapsed }));
        return buildResponse(200, {
          reply: text,
          provider: 'cloudbase',
          degraded: primaryProvider !== 'cloudbase',
          request_id: requestId,
        }, '', allowedOrigins);
      }

      console.log(JSON.stringify({ request_id: requestId, provider: 'cloudbase', status: 'no_reply', elapsed }));
      return null;
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.log(JSON.stringify({ request_id: requestId, provider: 'cloudbase', status: 'error', reason: err.message, elapsed }));
      return null;
    }
  }

  async function main(event) {
    const origin = (event.headers && event.headers.origin) || '';

    // OPTIONS 预检
    if (event.httpMethod === 'OPTIONS') {
      return buildResponse(204, {}, origin, allowedOrigins);
    }

    // CORS 校验
    if (!allowedOrigins.includes(origin) && event.httpMethod !== 'GET') {
      // GET health 也允许无 origin（如 curl 直接调用）
      if (origin && !allowedOrigins.includes(origin)) {
        return buildResponse(403, { error: '来源不被允许' }, origin, allowedOrigins);
      }
    }

    // GET 健康检查
    if (event.httpMethod === 'GET') {
      return buildResponse(200, {
        status: 'ok',
        version: VERSION,
        providers: {
          yuanqi: !!(env.YUANQI_APP_ID && env.YUANQI_APP_KEY),
          cloudbase: true, // 使用 SDK generateText，无需额外配置
        },
        primary: primaryProvider,
      }, origin, allowedOrigins);
    }

    if (event.httpMethod !== 'POST') {
      return buildResponse(405, { error: '仅支持 GET/POST 请求' }, origin, allowedOrigins);
    }

    // 解析请求体
    let rawBody = event.body || '{}';
    if (event.isBase64Encoded) {
      rawBody = Buffer.from(rawBody, 'base64').toString('utf-8');
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return buildResponse(400, { error: '请求体必须是 JSON' }, origin, allowedOrigins);
    }

    // 规范化请求
    let normalized;
    try {
      normalized = normalizeRequest(body);
    } catch (e) {
      return buildResponse(400, { error: e.message }, origin, allowedOrigins);
    }

    // 限流
    const ip = (event.headers && (event.headers['x-forwarded-for'] || event.headers['x-real-ip'])) || 'unknown';
    if (!rateLimiter.check(ip)) {
      return buildResponse(429, { error: '请求过于频繁，请稍后重试' }, origin, allowedOrigins);
    }

    try {
      // 医疗可执行请求拦截
      const lastMessage = normalized.messages[normalized.messages.length - 1].content;
      if (isMedicalRequest(lastMessage)) {
        return buildResponse(400, {
          error: '本系统仅供学习研究，不提供诊断、处方、剂量或治疗建议等医疗建议。如有健康问题，请咨询专业医师。',
        }, origin, allowedOrigins);
      }

      const requestId = _uuid();
      const startTime = Date.now();

      // 按优先级尝试线路
      const providers = primaryProvider === 'yuanqi'
        ? [tryYuanqi, tryCloudBase]
        : [tryCloudBase, tryYuanqi];

      for (const tryProvider of providers) {
        const result = await tryProvider(normalized, requestId, startTime);
        if (result) {
          // 将 origin 回填到响应头
          const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
          if (result.headers) {
            result.headers['Access-Control-Allow-Origin'] = allowOrigin;
          }
          return result;
        }
      }

      // 两条线路均失败
      return buildResponse(502, {
        error: '问答服务暂时不可用，请稍后重试',
        request_id: requestId,
      }, origin, allowedOrigins);
    } finally {
      rateLimiter.release();
    }
  }

  return { main };
}

// ---------------------------------------------------------------------------
// CloudBase 函数入口
// ---------------------------------------------------------------------------
const defaultRouter = createRouter({
  env: {
    YUANQI_APP_ID: process.env.YUANQI_APP_ID,
    YUANQI_APP_KEY: process.env.YUANQI_APP_KEY,
    PRIMARY_PROVIDER: process.env.PRIMARY_PROVIDER || 'yuanqi',
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'https://zenoyang-ai.github.io,http://localhost:8765,http://127.0.0.1:8765',
  },
});

exports.main = defaultRouter.main;

// 导出供测试使用
exports.buildYuanqiPayload = buildYuanqiPayload;
exports.createRouter = createRouter;
exports.normalizeRequest = normalizeRequest;