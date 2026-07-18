/**
 * 倪海厦知识库 AI 问答 — 统一问答路由
 * CloudBase HTTP 函数入口
 *
 * 双线路架构：
 *   主线路：腾讯元器（知识库 RAG）
 *   备用线路：CloudBase Agent（知识库 RAG，ai.bot.sendMessage）
 *
 * 禁止使用通用模型 generateText() 作为兜底。
 * 两条线路均基于知识库检索，不依赖无上下文的通用大模型。
 */

const cloudbase = require('@cloudbase/node-sdk');

const VERSION = '2.0.1';

// ---------------------------------------------------------------------------
// 医疗可执行请求检测 — 仅拦截可执行医疗意图，放行学习问法
//
// 拦截标准：处方、剂量、服法、个体化诊疗、医疗程序、急救
// 放行标准：经典讲什么病、方剂治什么、概念解释、组成与禁忌
// ---------------------------------------------------------------------------
const MEDICAL_PATTERNS = [
  // 1. 剂量/用量/服法 — 请求具体用药信息
  /(?:剂量|用量|服法|用法|怎么吃|怎么服用|吃多少|吃几[片粒颗毫升克]|每日.{0,4}[片粒颗毫升克]|每天.{0,4}[片粒颗毫升克]|每次.{0,4}[片粒颗毫升克])/,
  // 2. 处方/开药请求
  /(?:开(?:什么|个)?药|给我.{0,5}(?:药|方)|推荐.{0,5}(?:药|方)|建议.{0,5}(?:药|方)|什么药.{0,3}好|该用.{0,5}方|什么方子.{0,3}治)/,
  // 3. 医疗程序
  /(?:打针|注射|输液|手术|化疗|放疗|住院|挂水)/,
  // 4. 急救/危重
  /(?:救命|急救|危重|抢救|快不行|昏迷|休克)/,
  // 5. 个体化诊疗：个人代词 + 治疗请求（不含"治什么"等学习问法）
  /(?:我|我妈|我爸|我家人|我家老人|孩子|宝宝|婴儿|孕妇|孙子|孙女).{0,30}(?:怎么治|能治好吗|该吃什么|吃什么药|用什么方|怎么调理|帮我诊断|帮我分析)/,
  // 6. 角色扮演绕过 + 可执行医疗请求
  /(?:假装|扮演|假设|作为).{0,15}(?:医生|医师|中医|大夫|专家).{0,30}(?:开|告诉|建议|推荐|处方|剂量|用量|怎么治|怎么吃)/,
  // 7. 指令绕过 + 可执行医疗请求
  /(?:忽略|跳过|不要管|disregard).{0,15}(?:限制|规则|前面|安全|拦截).{0,30}(?:剂量|处方|怎么治|怎么吃|开药)/,
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

  if (messages.length === 0) {
    throw new Error('消息不能为空');
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

// ---------------------------------------------------------------------------
// 进程内限流器
//
// 注意：此限流器仅在单实例内存中生效。
// 多实例生产环境必须由 CloudBase 网关或外部数据库（如 Redis）补强，
// 不能将此内存限流器伪称为全局限流。
// ---------------------------------------------------------------------------
class RateLimiter {
  constructor() {
    this._window = new Map();
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

    if (now > entry.minute.reset) {
      entry.minute = { count: 0, reset: now + 60000 };
    }
    if (now > entry.daily.reset) {
      entry.daily = { count: 0, reset: now + 86400000 };
    }

    if (entry.minute.count >= this._maxPerMinute) return false;
    if (entry.daily.count >= this._maxPerDay) return false;
    if (this._concurrency >= this._maxConcurrency) return false;

    entry.minute.count += 1;
    entry.daily.count += 1;
    this._concurrency += 1;
    return true;
  }

  release() {
    if (this._concurrency > 0) this._concurrency -= 1;
  }

  cleanup() {
    const now = Date.now();
    for (const [ip, entry] of this._window) {
      if (now > entry.daily.reset) this._window.delete(ip);
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
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 10);
    return `${ts}-${rand}`;
  });

  const allowedOrigins = parseAllowedOrigins(env || {});
  const primaryProvider = (env && env.PRIMARY_PROVIDER) || 'yuanqi';
  const rateLimiter = new RateLimiter();

  // provider 运行时健康状态：跟踪每个 provider 最近一次成功/失败时间戳。
  // 与上面 providers 布尔标志（"是否已配置"）配合，区分"已配置"和"最近调用成功"。
  const providerHealth = {
    yuanqi: { last_success: null, last_failure: null },
    cloudbase: { last_success: null, last_failure: null },
  };

  const cleanupInterval = setInterval(() => rateLimiter.cleanup(), 300000);
  if (cleanupInterval.unref) cleanupInterval.unref();

  // -----------------------------------------------------------------------
  // 主线路：腾讯元器
  // -----------------------------------------------------------------------
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
        const choice = data.choices && data.choices[0];
        const reply = (choice && choice.message && choice.message.content) || '';
        const finishReason = (choice && choice.finish_reason) || '';

        // finish_reason: "sensitive" → 返回安全提示，不切换备用
        if (finishReason === 'sensitive') {
          providerHealth.yuanqi.last_success = new Date().toISOString();
          console.log(JSON.stringify({ request_id: requestId, provider: 'yuanqi', status: res.status, reason: 'sensitive', elapsed }));
          return buildResponse(200, {
            reply: '您的问题涉及敏感内容，请调整后重试。',
            provider: 'yuanqi',
            degraded: false,
            request_id: requestId,
          }, '', allowedOrigins);
        }

        if (reply) {
          providerHealth.yuanqi.last_success = new Date().toISOString();
          console.log(JSON.stringify({ request_id: requestId, provider: 'yuanqi', status: res.status, elapsed }));
          return buildResponse(200, {
            reply,
            provider: 'yuanqi',
            degraded: false,
            request_id: requestId,
          }, '', allowedOrigins);
        }
      }

      // 400 请求格式错误 → 返回受控错误，不切换备用
      if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        providerHealth.yuanqi.last_failure = new Date().toISOString();
        console.log(JSON.stringify({ request_id: requestId, provider: 'yuanqi', status: 400, reason: 'bad_request', elapsed }));
        return buildResponse(400, {
          error: '请求格式错误，请检查输入后重试',
          request_id: requestId,
        }, '', allowedOrigins);
      }

      // 401、403、429、5xx、空答、超时 → 切换备用
      providerHealth.yuanqi.last_failure = new Date().toISOString();
      if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) {
        console.log(JSON.stringify({ request_id: requestId, provider: 'yuanqi', status: res.status, elapsed }));
      } else {
        console.log(JSON.stringify({ request_id: requestId, provider: 'yuanqi', status: res.status, reason: 'no_reply', elapsed }));
      }
      return null;
    } catch (err) {
      clearTimeout(timeout);
      const elapsed = Date.now() - startTime;
      providerHealth.yuanqi.last_failure = new Date().toISOString();
      console.log(JSON.stringify({ request_id: requestId, provider: 'yuanqi', status: 'error', reason: err.name === 'AbortError' ? 'timeout' : 'fetch_error', elapsed }));
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // 备用线路：CloudBase Agent（ai.bot.sendMessage 文本流 API）
  //
  // 使用 cloudbase.SYMBOL_DEFAULT_ENV 避免硬编码环境 ID。
  // 需要 CLOUDBASE_BOT_ID 环境变量，缺少时跳过。
  // -----------------------------------------------------------------------
  async function tryCloudBase(normalized, requestId, startTime) {
    const botId = env.CLOUDBASE_BOT_ID;
    if (!botId) {
      console.log(JSON.stringify({ request_id: requestId, provider: 'cloudbase', status: 'skipped', reason: 'not_configured' }));
      return null;
    }

    try {
      const app = _cloudbase.init({ env: _cloudbase.SYMBOL_DEFAULT_ENV });
      const ai = app.ai();

      // 当前 @cloudbase/ai SDK 接收最新问题 + 历史消息，不接收 threadId/runId。
      const latestMessage = normalized.messages.at(-1);
      const history = normalized.messages.slice(0, -1);
      const res = await ai.bot.sendMessage({
        botId,
        msg: latestMessage.content,
        history,
      });

      // SDK 的 textStream 只暴露模型文本片段；流结束即视为完成。
      let text = '';
      let timedOut = false;

      const streamPromise = (async () => {
        for await (const chunk of res.textStream) {
          if (typeof chunk === 'string') text += chunk;
        }
      })();

      let timeoutId;
      const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          resolve();
        }, 25000);
      });

      try {
        await Promise.race([streamPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeoutId);
      }
      // 防止 streamPromise 在后台产生未捕获异常
      streamPromise.catch(() => {});

      const elapsed = Date.now() - startTime;
      text = text.trim();

      // 超时或空答 → 判定失败
      if (timedOut || !text) {
        const failReason = timedOut ? 'timeout' : 'no_reply';
        providerHealth.cloudbase.last_failure = new Date().toISOString();
        console.log(JSON.stringify({ request_id: requestId, provider: 'cloudbase', status: failReason, elapsed }));
        return null;
      }

      providerHealth.cloudbase.last_success = new Date().toISOString();
      console.log(JSON.stringify({ request_id: requestId, provider: 'cloudbase', status: 200, elapsed }));
      return buildResponse(200, {
        reply: text,
        provider: 'cloudbase',
        degraded: primaryProvider !== 'cloudbase',
        request_id: requestId,
      }, '', allowedOrigins);
    } catch (err) {
      const elapsed = Date.now() - startTime;
      providerHealth.cloudbase.last_failure = new Date().toISOString();
      console.log(JSON.stringify({ request_id: requestId, provider: 'cloudbase', status: 'error', reason: 'sdk_error', elapsed }));
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // 主入口
  // -----------------------------------------------------------------------
  async function main(event) {
    const origin = (event.headers && event.headers.origin) || '';

    // OPTIONS 预检
    if (event.httpMethod === 'OPTIONS') {
      return buildResponse(204, {}, origin, allowedOrigins);
    }

    // CORS 校验
    if (origin && !allowedOrigins.includes(origin) && event.httpMethod !== 'GET') {
      return buildResponse(403, { error: '来源不被允许' }, origin, allowedOrigins);
    }

    // GET 健康检查
    if (event.httpMethod === 'GET') {
      return buildResponse(200, {
        status: 'ok',
        version: VERSION,
        providers: {
          yuanqi: !!(env.YUANQI_APP_ID && env.YUANQI_APP_KEY),
          cloudbase: !!env.CLOUDBASE_BOT_ID,
        },
        // providers.* 仅表示"是否已配置"；last_success 表示"最近一次调用是否成功"，区分二者
        last_success: {
          yuanqi: providerHealth.yuanqi.last_success,
          cloudbase: providerHealth.cloudbase.last_success,
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
          // provider 内部用空 origin 构建，这里修正为实际 origin
          const allowOrigin = allowedOrigins.includes(origin) ? origin : '';
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
    CLOUDBASE_BOT_ID: process.env.CLOUDBASE_BOT_ID,
    PRIMARY_PROVIDER: process.env.PRIMARY_PROVIDER || 'yuanqi',
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'https://zenoyang-ai.github.io,http://localhost:8765,http://127.0.0.1:8765',
  },
});

exports.main = defaultRouter.main;

// 导出供测试使用
exports.buildYuanqiPayload = buildYuanqiPayload;
exports.createRouter = createRouter;
exports.normalizeRequest = normalizeRequest;
