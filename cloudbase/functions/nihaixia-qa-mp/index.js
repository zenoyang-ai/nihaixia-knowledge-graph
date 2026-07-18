/**
 * 经典中医学习问答 — 小程序专用云函数
 *
 * 直接调用 CloudBase LLM（ai.createModel("cloudbase").generateText），
 * 不通过 TCBR Agent（云托管）—— 成长计划赠送的 AI 资源仅限小程序 SDK 与云函数消耗，
 * 经 Agent 调用会被计费层拒绝。
 *
 * 官方 API 参考：
 *   https://docs.cloudbase.net/ai/sdk-reference/api#generatetext
 *
 * 调用形式：
 *   const model = ai.createModel("cloudbase");
 *   const res = await model.generateText({ model: "hy3-preview", messages });
 *   // 返回 { text, rawResponses, messages, usage, error }
 *
 * 入参：msg（必填）、history（可选，Array<{role, content}>）、session_id（可选）
 * 返回：{ reply, provider, request_id, ... } 或 { error, request_id, ... }
 *
 * 安全：
 *   - 微信自动透传 OpenID，通过 context.OPENID 获取
 *   - 以 OpenID 的 SHA-256 哈希为键，在 CloudBase 数据库实现限流
 *   - 服务端执行医疗安全拦截（客户端正则仅用于即时提示）
 *   - 不记录问题全文到日志
 */

const cloudbase = require('@cloudbase/node-sdk');
const crypto = require('crypto');

const VERSION = '3.0.0';

const MAX_MESSAGE_LENGTH = 1000;
const RATE_LIMIT_PER_MINUTE = 6;
const RATE_LIMIT_PER_DAY = 20;
const RATE_COLLECTION = 'qa_rate_limit';

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
// OpenID 哈希 — 不可逆，不保存原始 OpenID
// ---------------------------------------------------------------------------
function hashOpenId(openId) {
  if (!openId) return null;
  return crypto.createHash('sha256').update(openId).digest('hex');
}

// ---------------------------------------------------------------------------
// 限流检查 — 基于 CloudBase 数据库共享计数器
//
// 每用户每分钟最多 6 次，每用户每日最多 20 次。
// 仅保存哈希、日期、计数和 TTL，不保存聊天内容。
// ---------------------------------------------------------------------------
async function checkRateLimit(db, userHash) {
  if (!userHash) {
    // 无法获取 OpenID 时，允许通过（小程序环境必然有 OpenID）
    return { allowed: true, reason: null };
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const nowTimestamp = now.getTime();
  const oneMinuteAgo = new Date(nowTimestamp - 60000);

  const collection = db.collection(RATE_COLLECTION);
  const docId = `${userHash}_${today}`;

  try {
    // 原子性地获取或创建当日记录
    const result = await collection.doc(docId).get();
    let record = result.data && result.data[0];

    if (!record) {
      // 创建新记录
      await collection.add({
        _id: docId,
        user_hash: userHash,
        date: today,
        minute_requests: [{ ts: nowTimestamp }],
        daily_count: 1,
        created_at: now.toISOString(),
        ttl: new Date(nowTimestamp + 86400000 * 2), // 2 天后自动过期（Date 类型，配合 TTL 索引）
      });
      return { allowed: true, reason: null };
    }

    // 检查日限额
    if (record.daily_count >= RATE_LIMIT_PER_DAY) {
      return {
        allowed: false,
        reason: 'daily_exceeded',
        remaining: 0,
        reset_at: '次日 00:00',
      };
    }

    // 检查分钟限额：清除一分钟前的记录，统计当前分钟内请求数
    const recentRequests = (record.minute_requests || []).filter(
      (r) => r.ts > oneMinuteAgo.getTime()
    );

    if (recentRequests.length >= RATE_LIMIT_PER_MINUTE) {
      return {
        allowed: false,
        reason: 'minute_exceeded',
        remaining: 0,
        reset_at: '60 秒后',
      };
    }

    // 更新记录
    recentRequests.push({ ts: nowTimestamp });
    await collection.doc(docId).update({
      minute_requests: recentRequests,
      daily_count: record.daily_count + 1,
    });

    return {
      allowed: true,
      reason: null,
      remaining_daily: RATE_LIMIT_PER_DAY - record.daily_count - 1,
    };
  } catch (err) {
    // 数据库错误时允许通过（fail-open），避免阻塞正常用户
    console.log(JSON.stringify({
      event: 'rate_limit_db_error',
      error: err.message ? 'db_error' : 'unknown',
    }));
    return { allowed: true, reason: 'db_error_fallback' };
  }
}

// ---------------------------------------------------------------------------
// 系统提示词 — 中性化、安全化
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `你是「中医经典研习助手」，专注于回答关于经典中医理论（人纪、天纪）的问题。你的回答应基于经典中医理论，准确、专业地解释相关学术观点和理论体系。

回答规则：
1. 基于经典中医理论进行回答，准确引用相关学术观点
2. 如果不确定相关信息，请诚实告知
3. 不提供具体的医疗诊断、处方或剂量建议，涉及此类问题时引导用户咨询专业医师
4. 回答时请注明内容来源（如：人纪/天纪/具体课程）
5. 保持客观中立，不添加个人观点
6. 回答使用中文，语言简洁明了`;

// ---------------------------------------------------------------------------
// 直接调用 LLM（不通过 TCBR Agent）
//
// 官方文档：https://docs.cloudbase.net/ai/sdk-reference/api#generatetext
// 参数：{ model, messages }
// 返回：{ text, rawResponses, messages, usage, error }
//
// 使用 ai.createModel("cloudbase").generateText() 直接从云函数调用 LLM，
// 避免通过 TCBR Agent（云托管）调用导致 AI 资源消耗被拒绝。
// ---------------------------------------------------------------------------
async function callLLMDirectly(ai, msg, history) {
  const model = ai.createModel('cloudbase');

  // 构建 messages 数组：system + history + user
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // 添加历史对话（history 已被过滤为最近 6 条）
  if (Array.isArray(history) && history.length > 0) {
    for (const h of history) {
      messages.push({
        role: h.role === 'bot' ? 'assistant' : h.role,
        content: h.content,
      });
    }
  }

  // 添加当前用户消息
  messages.push({ role: 'user', content: msg });

  console.log(JSON.stringify({
    event: 'llm_call_start',
    model: 'hy3-preview',
    message_count: messages.length,
    history_count: history ? history.length : 0,
  }));

  const res = await model.generateText({
    model: 'hy3-preview',
    messages,
  });

  // 检查错误
  let hasError = false;
  let errorMsg = '';
  if (res.error) {
    hasError = true;
    try {
      errorMsg = typeof res.error === 'string'
        ? res.error.slice(0, 500)
        : JSON.stringify(res.error).slice(0, 500);
    } catch {
      errorMsg = String(res.error).slice(0, 500);
    }
    console.log(JSON.stringify({
      event: 'llm_error',
      error: errorMsg,
    }));
  }

  const text = res.text || '';

  console.log(JSON.stringify({
    event: 'llm_call_end',
    has_text: text.length > 0,
    text_length: text.length,
    has_error: hasError,
  }));

  return {
    text: text.trim(),
    knowledgeBase: [],
    recordId: '',
    hasError,
    errorMsg,
  };
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------
exports.main = async (event, context) => {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();

  // 获取 OpenID（微信自动透传）
  const openId = context && context.OPENID;
  const userHash = hashOpenId(openId);

  // 解析入参
  const msg = event && event.msg;
  const sessionId = event && event.session_id;

  if (!msg || typeof msg !== 'string' || !msg.trim()) {
    return {
      error: '请输入问题',
      request_id: requestId,
    };
  }

  const trimmedMsg = msg.trim();
  if (trimmedMsg.length > MAX_MESSAGE_LENGTH) {
    return {
      error: `问题长度不能超过 ${MAX_MESSAGE_LENGTH} 字`,
      request_id: requestId,
    };
  }

  // 医疗安全拦截（服务端是最终边界）
  if (isMedicalRequest(trimmedMsg)) {
    const elapsed = Date.now() - startTime;
    console.log(JSON.stringify({
      request_id: requestId,
      status: 400,
      reason: 'medical_blocked',
      elapsed,
    }));
    return {
      reply: '本系统仅供学习研究，不提供诊断、处方、剂量或治疗建议。如有健康问题，请咨询专业中医师。',
      provider: 'system',
      blocked: true,
      request_id: requestId,
    };
  }

  // 初始化 CloudBase
  let app, ai, db;
  try {
    // 云函数环境中，优先用环境变量 SCF_NAMESPACE，否则显式指定
    const envId = process.env.SCF_NAMESPACE || 'zeno-d9g0gdvw4a57635c0';
    app = cloudbase.init({ env: envId });
    ai = app.ai();
    db = app.database();
  } catch (err) {
    console.log(JSON.stringify({
      request_id: requestId,
      status: 500,
      reason: 'init_error',
      elapsed: Date.now() - startTime,
    }));
    return {
      error: '服务暂时不可用，请稍后重试',
      request_id: requestId,
    };
  }

  // 限流检查
  const rateLimit = await checkRateLimit(db, userHash);
  if (!rateLimit.allowed) {
    const elapsed = Date.now() - startTime;
    console.log(JSON.stringify({
      request_id: requestId,
      status: 429,
      reason: rateLimit.reason,
      elapsed,
    }));
    return {
      error: rateLimit.reason === 'daily_exceeded'
        ? `今日提问次数已达上限（${RATE_LIMIT_PER_DAY} 次），${rateLimit.reset_at}重置。`
        : `提问过于频繁，请${rateLimit.reset_at}再试。`,
      provider: 'system',
      rate_limited: true,
      request_id: requestId,
    };
  }

  // 构建 history（从 event.history 传入，或为空）
  // 直接调用 LLM 时，history 保持原始 role（assistant/user），
  // callLLMDirectly 会自行处理角色映射。
  let history = [];
  if (Array.isArray(event.history)) {
    // 只保留最近 6 条（3 轮对话），过滤无效项
    history = event.history
      .filter((h) => h && h.role && h.content)
      .slice(-6)
      .map((h) => ({ role: h.role, content: h.content }));
  }

  // 直接调用 LLM（不经过 TCBR Agent）
  try {
    const result = await callLLMDirectly(ai, trimmedMsg, history);
    const elapsed = Date.now() - startTime;

    // LLM 返回错误（如模型不可用、超限等）
    if (result.hasError && !result.text) {
      console.log(JSON.stringify({
        request_id: requestId,
        status: 502,
        reason: 'llm_error_chunk',
        error: result.errorMsg,
        elapsed,
      }));
      return {
        error: '问答服务暂时不可用，请稍后重试',
        request_id: requestId,
        retry: true,
      };
    }

    if (!result.text) {
      console.log(JSON.stringify({
        request_id: requestId,
        status: 502,
        reason: 'empty_reply',
        elapsed,
      }));
      return {
        error: '知识库暂时无法回答，请稍后重试或换个问题',
        request_id: requestId,
        retry: true,
      };
    }

    console.log(JSON.stringify({
      request_id: requestId,
      status: 200,
      provider: 'cloudbase-llm',
      elapsed,
      has_knowledge: result.knowledgeBase.length > 0,
    }));

    return {
      reply: result.text,
      provider: 'cloudbase-llm',
      thread_id: sessionId || requestId,
      request_id: requestId,
      knowledge_sources: result.knowledgeBase,
    };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    // 记录错误类型和消息（不记录用户问题全文）
    const errType = err && err.constructor ? err.constructor.name : 'Error';
    const errMsg = err && err.message ? err.message.slice(0, 200) : 'unknown';
    console.log(JSON.stringify({
      request_id: requestId,
      status: 500,
      reason: 'llm_error',
      error_type: errType,
      error_message: errMsg,
      elapsed,
    }));
    return {
      error: '问答服务暂时不可用，请稍后重试',
      request_id: requestId,
      retry: true,
    };
  }
};

// 导出供测试使用
exports.VERSION = VERSION;
exports.isMedicalRequest = isMedicalRequest;
exports.MEDICAL_PATTERNS = MEDICAL_PATTERNS;
exports.hashOpenId = hashOpenId;
exports.MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH;
exports.RATE_LIMIT_PER_MINUTE = RATE_LIMIT_PER_MINUTE;
exports.RATE_LIMIT_PER_DAY = RATE_LIMIT_PER_DAY;
