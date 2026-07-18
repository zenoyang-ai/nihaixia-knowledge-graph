/**
 * 经典中医学习问答 — 小程序专用云函数
 *
 * 直接调用 CloudBase Agent（ai.bot.sendMessage），不转发 nihaixia-qa-router。
 *
 * 官方 API 参考：
 *   https://docs.cloudbase.net/ai/sdk-reference/api#sendmessage
 *
 * 调用形式（经官方文档核实，2026-07-18）：
 *   const res = await ai.bot.sendMessage({ botId, msg, history });
 *   for await (const str of res.textStream) { ... }
 *   for await (const data of res.dataStream) { ... }  // AgentStreamChunk
 *
 * 参数：botId（必填）、msg（必填）、history（必填，Array<{role, content}>）
 * 返回：StreamResult { textStream, dataStream }
 *
 * 不使用 threadId/runId/messages — 这些参数不在官方 SDK 中。
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
        ttl: new Date(nowTimestamp + 86400000 * 2).toISOString(), // 2 天后自动过期
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
// 调用 CloudBase Agent
//
// 官方文档：https://docs.cloudbase.net/ai/sdk-reference/api#sendmessage
// 参数：{ botId, msg, history }
// 返回：{ textStream, dataStream }
//
// dataStream 中的 AgentStreamChunk 包含：
//   type: "text" | "thinking" | "search" | "knowledge"
//   content: 文本内容
//   knowledge_base: 使用的知识库名称列表
// ---------------------------------------------------------------------------
async function callCloudBaseAgent(ai, botId, msg, history) {
  const res = await ai.bot.sendMessage({
    botId,
    msg,
    history,
  });

  let text = '';
  let knowledgeBase = [];
  let recordId = '';

  // 从 textStream 聚合文本
  for await (const chunk of res.textStream) {
    if (typeof chunk === 'string') text += chunk;
  }

  // 从 dataStream 获取知识库等元数据
  try {
    for await (const data of res.dataStream) {
      if (data && data.type === 'knowledge' && data.knowledge_base) {
        knowledgeBase = data.knowledge_base;
      }
      if (data && data.record_id) {
        recordId = data.record_id;
      }
    }
  } catch {
    // dataStream 读取失败不影响文本结果
  }

  return { text: text.trim(), knowledgeBase, recordId };
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
    app = cloudbase.init({ env: cloudbase.SYMBOL_DEFAULT_ENV });
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

  // 获取 Bot ID
  const botId = process.env.CLOUDBASE_BOT_ID;
  if (!botId) {
    console.log(JSON.stringify({
      request_id: requestId,
      status: 500,
      reason: 'bot_id_not_configured',
      elapsed: Date.now() - startTime,
    }));
    return {
      error: '问答服务未配置，请联系管理员',
      request_id: requestId,
    };
  }

  // 构建 history（从 event.history 传入，或为空）
  let history = [];
  if (Array.isArray(event.history)) {
    // 只保留最近 6 条（3 轮对话），过滤无效项
    history = event.history
      .filter((h) => h && h.role && h.content)
      .slice(-6)
      .map((h) => ({
        role: h.role === 'assistant' ? 'bot' : h.role,
        content: h.content,
      }));
  }

  // 调用 Agent
  try {
    const result = await callCloudBaseAgent(ai, botId, trimmedMsg, history);
    const elapsed = Date.now() - startTime;

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
      provider: 'cloudbase-agent',
      elapsed,
      has_knowledge: result.knowledgeBase.length > 0,
    }));

    return {
      reply: result.text,
      provider: 'cloudbase-agent',
      thread_id: sessionId || requestId,
      request_id: requestId,
      knowledge_sources: result.knowledgeBase,
    };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.log(JSON.stringify({
      request_id: requestId,
      status: 500,
      reason: 'agent_error',
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
