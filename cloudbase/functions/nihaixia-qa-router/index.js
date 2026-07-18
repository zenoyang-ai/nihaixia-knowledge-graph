/**
 * 倪海厦知识库 AI 问答 — 统一问答路由
 * CloudBase HTTP 函数入口
 *
 * 混合 RAG v2 架构（方案 B）：
 *   主线路：BM25 检索 knowledge-base.json（4837 个分块，11 组语料）+ generateText() 生成
 *   备用线路：CloudBase Agent（ai.bot.sendMessage，需切换计费后可用）
 *   第三线路：腾讯元器（已停用，代码保留供回切）
 *
 * 改进（v3.1.0）：
 *   - 语料从 4 部经典扩展到完整 11 组上传包（11.4MB）
 *   - 检索器使用 BM25 + 最低分阈值，完全无关问题返回零结果
 *   - knowledge_sources 返回真正达阈值的片段 + 证据片段
 *   - 上下文按分块（600-2000 字符）而非整篇，总量限制 30000 字符
 *   - 医疗拦截扩充（覆盖"适合吃吗""能不能用""配个方"等自然问法）
 *   - 生成结果二次安全检查
 */

const cloudbase = require('@cloudbase/node-sdk');
const { searchDocuments } = require('./knowledge-search');

const VERSION = '3.1.0';
const MAX_CONTEXT_CHARS = 30000; // 上下文总量上限

// ---------------------------------------------------------------------------
// 医疗可执行请求检测 — 仅拦截可执行医疗意图，放行学习问法
//
// 拦截标准：处方、剂量、服法、个体化诊疗、医疗程序、急救、疾病用药咨询
// 放行标准：经典讲什么病、方剂治什么、概念解释、组成与禁忌
// ---------------------------------------------------------------------------
const MEDICAL_PATTERNS = [
  // 1. 剂量/用量/服法 — 请求具体用药信息
  /(?:剂量|用量|服法|用法|怎么吃|怎么服用|吃多少|吃几[片粒颗毫升克]|每日.{0,4}[片粒颗毫升克]|每天.{0,4}[片粒颗毫升克]|每次.{0,4}[片粒颗毫升克])/,
  // 2. 处方/开药请求（含简短表达"配个方/开个方/抓个方"）
  /(?:开(?:什么|个)?药|给我.{0,5}(?:药|方)|推荐.{0,5}(?:药|方)|建议.{0,5}(?:药|方)|什么药.{0,3}好|该用.{0,5}方|什么方子.{0,3}治|开.{0,15}(?:处方|药方|汤方|方子)|帮我.{0,5}(?:开|配|抓).{0,10}(?:处方|方子|药方|汤方)|(?:配|开|抓).{0,3}(?:个)?(?:方|方子|药方|汤方))/,
  // 3. 医疗程序
  /(?:打针|注射|输液|手术|化疗|放疗|住院|挂水)/,
  // 4. 急救/危重
  /(?:救命|急救|危重|抢救|快不行|昏迷|休克)/,
  // 5. 个体化诊疗：个人代词 + 治疗请求（含"适合吃吗""能不能用""可以吗"等）
  /(?:我|我妈|我爸|我家人|我家老人|孩子|宝宝|婴儿|孕妇|孙子|孙女).{0,30}(?:怎么治|能治好吗|该吃什么|吃什么药|用什么方|怎么调理|帮我诊断|帮我分析|适合吃|适合用|能不能用|能不能吃|可以用吗|可以吗|能吃吗|能用吗)/,
  // 6. 角色扮演绕过 + 可执行医疗请求
  /(?:假装|扮演|假设|作为).{0,15}(?:医生|医师|中医|大夫|专家).{0,30}(?:开|告诉|建议|推荐|处方|剂量|用量|怎么治|怎么吃)/,
  // 7. 指令绕过 + 可执行医疗请求
  /(?:忽略|跳过|不要管|disregard).{0,15}(?:限制|规则|前面|安全|拦截).{0,30}(?:剂量|处方|怎么治|怎么吃|开药)/,
  // 8. 疾病用药咨询 — 针对具体疾病的用药建议（非学习问法）
  /(?:高血压|糖尿病|感冒|发烧|发热|咳嗽|失眠|胃痛|头痛|便秘|腹泻|肝炎|胃炎|肾炎|关节炎|湿疹|哮喘|冠心病|中风|贫血|过敏|抑郁|焦虑|痛风|结石|肿瘤|癌症).{0,15}(?:用什么|吃什么|怎么治|什么药|什么方|比较好|有效|推荐)/,
];

function isMedicalRequest(text) {
  return MEDICAL_PATTERNS.some((p) => p.test(text));
}

// ---------------------------------------------------------------------------
// 生成结果二次安全检查 — 拦截 LLM 输出中的具体剂量/处方建议
//
// 注意：引用原文（如"桂枝三两"）不应被拦截，只拦截明确的处方建议格式
// ---------------------------------------------------------------------------
const MEDICAL_OUTPUT_PATTERNS = [
  /(?:建议(?:服用|用量|剂量)|推荐(?:服用|用量|剂量)|处方[:：]|我的建议是).{0,30}\d/,
  /(?:每日|每天|每次).{0,5}\d+(?:\.\d+)?.{0,5}(?:克|g|mg|毫升|ml|片|粒|颗)/,
  /(?:你应该|你需要|你可以服用|建议你).{0,20}\d+(?:\.\d+)?.{0,5}(?:克|g|mg|毫升|ml|片|粒|颗)/,
];

function isMedicalOutput(text) {
  if (!text) return false;
  return MEDICAL_OUTPUT_PATTERNS.some((p) => p.test(text));
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
  // 默认 cloudbase-hybrid：混合 RAG（关键词检索 + generateText）
  // 切换计费后可改为 'cloudbase'（sendMessage 直接生成）
  const primaryProvider = (env && env.PRIMARY_PROVIDER) || 'cloudbase-hybrid';
  const rateLimiter = new RateLimiter();

  // provider 运行时健康状态：跟踪每个 provider 最近一次成功/失败时间戳。
  const providerHealth = {
    hybrid: { last_success: null, last_failure: null },
    cloudbase: { last_success: null, last_failure: null },
    yuanqi: { last_success: null, last_failure: null },
  };

  let lastCloudBaseError = null;

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
  // 主线路：混合 RAG v2（BM25 检索 + generateText 生成）
  //
  // 改进（v3.1.0）：
  //   - 使用 v2 检索器（BM25 + 阈值），无关问题返回零结果
  //   - 上下文按分块（600-2000 字符）而非整篇，总量限制 30000 字符
  //   - knowledge_sources 返回带证据片段的结构
  //   - 生成结果二次安全检查
  // -----------------------------------------------------------------------
  async function tryHybridRAG(normalized, requestId, startTime) {
    try {
      const query = normalized.messages[normalized.messages.length - 1].content;

      // 1. BM25 检索相关文档（已带阈值过滤）
      const docs = searchDocuments(query, 5);
      if (!docs.length) {
        console.log(JSON.stringify({ request_id: requestId, provider: 'hybrid', status: 'skipped', reason: 'no_docs', elapsed: Date.now() - startTime }));
        return null;
      }

      // 2. 构建上下文（按分块，总量限制 MAX_CONTEXT_CHARS）
      let usedChars = 0;
      const contextParts = [];
      for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        const header = `### 文档${i + 1}：${d.chunk_title}（来源：${d.source_group}）\n\n`;
        const remaining = MAX_CONTEXT_CHARS - usedChars - header.length;
        if (remaining <= 0) break;
        const content = d.content.length > remaining
          ? d.content.slice(0, remaining) + '\n...(内容过长，已截断)'
          : d.content;
        contextParts.push(header + content);
        usedChars += header.length + content.length;
      }
      const context = contextParts.join('\n\n---\n\n');

      // 3. 构建系统提示
      const systemPrompt = `你是「中医经典研习助手」，专注于回答关于经典中医理论的问题。

请基于以下知识库内容回答用户的问题。引用原文时请注明出处（如《伤寒论》第X章、知识卡片等）。
如果知识库中没有足够信息回答问题，请诚实告知"知识库中暂无相关内容"。
回答应保持学术严谨，用通俗语言解释复杂概念。
本系统仅供学习研究，不提供诊断、处方、剂量或治疗建议。

知识库内容：
${context}`;

      // 4. 构建消息（系统提示 + 历史 + 当前问题）
      const messages = [
        { role: 'system', content: systemPrompt },
        ...normalized.messages,
      ];

      // 5. 调用 generateText（云函数可使用免费 AI 资源）
      const envId = process.env.SCF_NAMESPACE || 'zeno-d9g0gdvw4a57635c0';
      const app = _cloudbase.init({ env: envId });
      const ai = app.ai();
      const model = ai.createModel('hunyuan-v3');

      const result = await model.generateText({
        model: 'hy3-preview',
        messages,
        temperature: 0.3,
      });

      const elapsed = Date.now() - startTime;

      if (!result || !result.text) {
        providerHealth.hybrid.last_failure = new Date().toISOString();
        console.log(JSON.stringify({ request_id: requestId, provider: 'hybrid', status: 'no_reply', elapsed, docs_found: docs.length }));
        return null;
      }

      // 6. 生成结果二次安全检查
      if (isMedicalOutput(result.text)) {
        providerHealth.hybrid.last_success = new Date().toISOString();
        console.log(JSON.stringify({ request_id: requestId, provider: 'hybrid', status: 200, reason: 'output_blocked', elapsed }));
        return buildResponse(200, {
          reply: '本系统仅供学习研究，不提供诊断、处方、剂量或治疗建议。如有健康问题，请咨询专业中医师。',
          provider: 'system',
          blocked: true,
          knowledge_sources: [],
          request_id: requestId,
        }, '', allowedOrigins);
      }

      providerHealth.hybrid.last_success = new Date().toISOString();
      console.log(JSON.stringify({ request_id: requestId, provider: 'hybrid', status: 200, elapsed, docs_found: docs.length, reply_length: result.text.length, context_chars: usedChars }));

      // 7. 构建知识库来源信息（只返回真正达阈值的文档 + 证据片段）
      return buildResponse(200, {
        reply: result.text,
        provider: 'cloudbase-hybrid',
        degraded: primaryProvider !== 'cloudbase-hybrid',
        knowledge_sources: docs.map((d) => ({
          source_group: d.source_group,
          source_quality: d.source_quality,
          chunk_title: d.chunk_title,
          score: d.score,
          matched_terms: d.matched_terms,
          evidence: d.evidence,
        })),
        request_id: requestId,
      }, '', allowedOrigins);
    } catch (err) {
      const elapsed = Date.now() - startTime;
      providerHealth.hybrid.last_failure = new Date().toISOString();
      const errType = err && err.constructor ? err.constructor.name : 'Error';
      const errMsg = err && err.message ? err.message.slice(0, 300) : 'no_message';
      lastCloudBaseError = { reason: 'hybrid_error', error_type: errType, error_message: errMsg, elapsed };
      console.log(JSON.stringify({ request_id: requestId, provider: 'hybrid', status: 'error', error_type: errType, error_message: errMsg, elapsed }));
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // 备用线路：CloudBase Agent（ai.bot.sendMessage 文本流 API）
  //
  // 需要 CLOUDBASE_BOT_ID 环境变量，缺少时跳过。
  // 注意：Agent 运行为云托管，免费 AI 资源不可用，需切换计费模式后才能使用。
  // -----------------------------------------------------------------------
  async function tryCloudBase(normalized, requestId, startTime) {
    const botId = env.CLOUDBASE_BOT_ID;
    if (!botId) {
      console.log(JSON.stringify({ request_id: requestId, provider: 'cloudbase', status: 'skipped', reason: 'not_configured' }));
      return null;
    }

    try {
      const envId = process.env.SCF_NAMESPACE || 'zeno-d9g0gdvw4a57635c0';
      const app = _cloudbase.init({ env: envId });
      const ai = app.ai();

      const latestMessage = normalized.messages.at(-1);
      const history = normalized.messages.slice(0, -1);
      const res = await ai.bot.sendMessage({
        botId,
        msg: latestMessage.content,
        history,
      });

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
      streamPromise.catch(() => {});

      const elapsed = Date.now() - startTime;
      text = text.trim();

      if (timedOut || !text) {
        providerHealth.cloudbase.last_failure = new Date().toISOString();
        console.log(JSON.stringify({ request_id: requestId, provider: 'cloudbase', status: timedOut ? 'timeout' : 'no_reply', elapsed }));
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
      console.log(JSON.stringify({ request_id: requestId, provider: 'cloudbase', status: 'error', error_type: err && err.constructor ? err.constructor.name : 'Error', elapsed }));
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
          hybrid: true,
          cloudbase: !!env.CLOUDBASE_BOT_ID,
          yuanqi: !!(env.YUANQI_APP_ID && env.YUANQI_APP_KEY),
        },
        last_success: {
          hybrid: providerHealth.hybrid.last_success,
          cloudbase: providerHealth.cloudbase.last_success,
          yuanqi: providerHealth.yuanqi.last_success,
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
      const providers = primaryProvider === 'cloudbase'
        ? [tryCloudBase, tryHybridRAG, tryYuanqi]
        : primaryProvider === 'yuanqi'
        ? [tryYuanqi, tryHybridRAG, tryCloudBase]
        : [tryHybridRAG, tryCloudBase, tryYuanqi];

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
    PRIMARY_PROVIDER: process.env.PRIMARY_PROVIDER || 'cloudbase-hybrid',
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'https://zenoyang-ai.github.io,http://localhost:8765,http://127.0.0.1:8765',
  },
});

exports.main = defaultRouter.main;

// 导出供测试使用
exports.buildYuanqiPayload = buildYuanqiPayload;
exports.createRouter = createRouter;
exports.normalizeRequest = normalizeRequest;
