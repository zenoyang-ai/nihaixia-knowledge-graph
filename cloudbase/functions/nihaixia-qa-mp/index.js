/**
 * 经典中医学习问答 — 小程序专用云函数
 *
 * 混合 RAG v2 架构：
 *   主线路：BM25 检索 knowledge-base.json（4837 个分块）+ generateText() 生成
 *   备用线路：CloudBase Agent（ai.bot.sendMessage，需切换计费后可用）
 *
 * 改进（v5.1.0）：
 *   - 语料从 4 部经典扩展到完整 11 组上传包（11.4MB）
 *   - 检索器使用 BM25 + 最低分阈值，完全无关问题返回零结果
 *   - knowledge_sources 返回真正达阈值的片段 + 证据片段
 *   - 上下文按分块（600-2000 字符）而非整篇，总量限制 30000 字符
 *   - 医疗拦截扩充（覆盖"适合吃吗""能不能用""配个方"等自然问法）
 *   - 生成结果二次安全检查
 *   - history 严格限制 role 为 user/assistant + 单条长度 + 角色交替
 *   - 限流使用原子操作 + UTC+8 时区 + fail-closed 熔断
 *
 * 官方 API 参考：
 *   https://docs.cloudbase.net/ai/sdk-reference/api#generatetext
 *
 * 入参：msg（必填）、history（可选，Array<{role, content}>）、session_id（可选）
 * 返回：{ reply, provider, request_id, ... } 或 { error, request_id, ... }
 *
 * 安全：
 *   - 微信自动透传 OpenID，优先用 wx-server-sdk 的 getWXContext() 获取，
 *     回退到 context.OPENID（原生云开发环境）
 *   - 以 OpenID 的 SHA-256 哈希为键，在 CloudBase 数据库实现限流
 *   - 服务端执行医疗安全拦截（输入侧 + 输出侧）
 *   - history 严格校验 role/content/长度/交替
 *   - 不记录问题全文到日志
 */

const cloudbase = require('@cloudbase/node-sdk');
const crypto = require('crypto');
const { searchDocuments } = require('./knowledge-search');

// wx-server-sdk 用于获取微信调用上下文（OPENID 等身份信息）
// 这是微信官方推荐的做法，@cloudbase/node-sdk 不会从 context 注入 OPENID
let wxCloud = null;
try {
  wxCloud = require('wx-server-sdk');
  // wx-server-sdk 需要初始化才能调用 getWXContext
  wxCloud.init({ env: process.env.SCF_NAMESPACE || 'zeno-d9g0gdvw4a57635c0' });
} catch (err) {
  console.log('Note: wx-server-sdk not available, will fall back to context.OPENID:', err.message);
}

// 获取微信用户 OPENID — 优先用 wx-server-sdk 的 getWXContext()，
// 回退到 context.OPENID（兼容原生云开发环境）
function getOpenId(event, context) {
  // 优先：wx-server-sdk 的 getWXContext() — 微信官方推荐做法
  if (wxCloud && typeof wxCloud.getWXContext === 'function') {
    try {
      const wxCtx = wxCloud.getWXContext();
      if (wxCtx && wxCtx.OPENID) {
        console.log(JSON.stringify({
          event: 'openid_acquired',
          source: 'wx-server-sdk',
          has_openid: true,
          has_appid: !!(wxCtx && wxCtx.APPID),
          has_unionid: !!(wxCtx && wxCtx.UNIONID),
        }));
        return wxCtx.OPENID;
      }
      // 调试：仅记录字段存在性与脱敏状态，不写 APPID/UNIONID/OPENID 原文
      console.log(JSON.stringify({
        event: 'openid_missing',
        source: 'wx-server-sdk',
        wxctx_key_count: wxCtx ? Object.keys(wxCtx).length : 0,
        fields: {
          OPENID: { present: !!(wxCtx && wxCtx.OPENID), masked: '***' },
          APPID: { present: !!(wxCtx && wxCtx.APPID), masked: '***' },
          UNIONID: { present: !!(wxCtx && wxCtx.UNIONID), masked: '***' },
        },
      }));
    } catch (err) {
      console.log(JSON.stringify({
        event: 'getwxcontext_error',
        error: err.message,
      }));
    }
  } else {
    console.log(JSON.stringify({
      event: 'wx-server-sdk-unavailable',
      has_wxcloud: !!wxCloud,
    }));
  }
  // 回退：原生云开发环境的 context.OPENID
  if (context && context.OPENID) {
    console.log(JSON.stringify({
      event: 'openid_acquired',
      source: 'context.OPENID',
    }));
    return context.OPENID;
  }
  // 兜底：某些场景下 OPENID 可能放在 event 上
  if (event && event.userInfo && event.userInfo.openId) {
    console.log(JSON.stringify({
      event: 'openid_acquired',
      source: 'event.userInfo.openId',
    }));
    return event.userInfo.openId;
  }
  console.log(JSON.stringify({
    event: 'openid_totally_missing',
    has_context: !!context,
    context_keys: context ? Object.keys(context) : [],
    has_userInfo: !!(event && event.userInfo),
    event_keys: event ? Object.keys(event).slice(0, 20) : [],
  }));
  return null;
}

const VERSION = '5.5.0';

const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY_LENGTH = 2000; // 单条 history 消息长度
const MAX_HISTORY_ITEMS = 6; // 最多保留 6 条（3 轮对话）
const RATE_LIMIT_PER_MINUTE = 6;
const RATE_LIMIT_PER_DAY = 20;
const RATE_COLLECTION = 'qa_rate_limit';
const MAX_CONTEXT_CHARS = 30000; // 上下文总量上限

// ---------------------------------------------------------------------------
// 医疗可执行请求检测 — 意图结构优先，学习语境豁免
//
// 拦截：人称+症状+求助 / 怎么治怎么办 / 能吃吗 / 开方剂量 / 急救
// 放行：原文/归经/原则/学习/伤寒论 等教学语境
// ---------------------------------------------------------------------------
const LEARNING_CONTEXT_PATTERN = /(?:学习|原文|归经|原则|意义|类型|有哪些|是什么|如何理解|讲解|论述|在学习|经方学习|配伍原则|穴位归经|承担什么作用|经典|古籍|定位|伤寒论|金匮|内经|神农|治什么病|组成是什么|对应什么)/;

const PERSON_PATTERN = /(?:我|我妈|我爸|我家人|我家老人|孩子|宝宝|婴儿|孕妇|孙子|孙女|本人|老公|老婆|妻子|丈夫|先生|太太|爱人|老伴|父亲|母亲|爷爷|奶奶|外公|外婆|他|她)/;

const SYMPTOM_PATTERN = /(?:高血压|糖尿病|感冒|发烧|发热|咳嗽|失眠|胃痛|头痛|便秘|腹泻|肝炎|胃炎|肾炎|关节炎|湿疹|哮喘|冠心病|中风|贫血|过敏|抑郁|焦虑|痛风|结石|肿瘤|癌症)/;

// 药物/穴位 + 能否服用/施灸 等可执行问法（学习语境在上游豁免）
const HERB_SUBSTANCE_PATTERN = /(?:酸枣仁|川贝|当归|黄芪|党参|枸杞|茯苓|白术|甘草|附子|桂枝|白芍|生姜|大枣|半夏|陈皮|天麻|人参|熟地|川芎|柴胡|黄芩|黄连|黄柏|山药|麦冬|五味子|丹参|红花|桃仁|麻黄|细辛|独活|防风|连翘|金银花|薄荷|菊花|桑叶|杏仁|桔梗|厚朴|枳实|香附|远志|龙骨|牡蛎|阿胶|肉桂|吴茱萸|干姜|薏苡仁|车前子|泽泻|猪苓|石膏|知母|栀子|大黄|蜂蜜)/;
const ACUPOINT_NAME_PATTERN = /(?:涌泉|足三里|三阴交|合谷|关元|神阙|百会|太冲|内关|风池|肩井|曲池|天枢|膻中|命门|肾俞|脾俞|肺俞|太溪|照海|申脉|阳陵泉|阴陵泉|承山|委中|丰隆|公孙|厉兑|迎香|印堂|风门|大椎|身柱|曲泽|地机|血海|睛明|攒竹)/;
const SUBSTANCE_EXECUTABLE_PATTERN = new RegExp(
  HERB_SUBSTANCE_PATTERN.source + '.{0,10}(?:能吃|能吃吗|可以吃|可以吃吗|能服用|服用吗|能用|能用吗|泡水喝|天天吃|一起吃|适合我吗|适合吃|适合吃吗)'
);
const ACUPOINT_EXECUTABLE_PATTERN = new RegExp(
  ACUPOINT_NAME_PATTERN.source + '.{0,12}(?:可以灸|能灸|灸吗|可以针|能针|针吗|可以按|能按|可以吗)'
);
const MOXIBUSTION_ACUPOINT_PATTERN = new RegExp(
  '(?:灸|针刺|针|按压).{0,8}' + ACUPOINT_NAME_PATTERN.source + '.{0,10}(?:可以吗|能不能|行吗|吗)'
);

const STRONG_TREATMENT_INTENT_PATTERN = /(?:怎么办|怎么治|能治好吗|该吃什么|吃什么药|用什么方|用什么药|怎么调理|帮我诊断|帮我分析|适合吃|适合用|能不能用|能不能吃|能吃吗|能用吗|什么药|什么方)/;
const WEAK_TREATMENT_INTENT_PATTERN = /(?:比较好|有效|推荐|可以吗|可以用吗)/;
const LEARNING_RECOMMENDATION_PATTERN = /(?:他|她).{0,8}推荐.{0,12}学习|(?:学习|经方学习).{0,24}(?:顺序|路径|从哪里|如何入手|怎么学|入手)|学习顺序|从哪里入手比较有效/;

const EMERGENCY_PATTERN = /(?:救命|急救|危重|抢救|快不行|昏迷|休克)/;
const MEDICAL_BLOCK_REPLY = '本系统仅供学习研究，不提供诊断、处方、剂量或治疗建议。如有健康问题，请咨询专业中医师或前往线下医疗机构就诊。';
const EMERGENCY_BLOCK_REPLY = '如遇紧急医疗情况，请立即拨打 120 急救电话，并尽快前往线下医院就诊。本系统不能提供急救或诊疗服务。';

// 始终拦截（不受学习语境豁免）
const ALWAYS_BLOCK_PATTERNS = [
  /(?:打针|注射|输液|手术|化疗|放疗|住院|挂水)/,
  EMERGENCY_PATTERN,
  /(?:假装|扮演|假设|作为).{0,15}(?:医生|医师|中医|大夫|专家).{0,30}(?:开|告诉|建议|推荐|处方|剂量|用量|怎么治|怎么吃)/,
  /(?:忽略|跳过|不要管|disregard).{0,15}(?:限制|规则|前面|安全|拦截).{0,30}(?:剂量|处方|怎么治|怎么吃|开药)/,
  /(?:开(?:什么|个)?药|给我.{0,5}(?:药|方)|推荐(?!经方).{0,5}(?:药|方)|建议(?!经方).{0,5}(?:药|方)|什么药.{0,3}好|该用.{0,5}方|什么方子.{0,3}治|开.{0,15}(?:处方|药方|汤方|方子)|帮我.{0,5}(?:开|配|抓).{0,10}(?:处方|方子|药方|汤方)|(?:开|抓).{0,3}(?:个)?(?:方|方子|药方|汤方)(?!剂)|配(?!伍).{0,3}(?:个)?(?:方|方子|药方|汤方)(?!剂))/,
  /(?:根据|按照|针对).{0,12}(?:我的|他的|她的|症状|体质|情况).{0,20}(?:开|配|用|吃|服|方|药|汤)/,
];

// 仅在没有学习语境时拦截（学习语境下若仍有诊疗意图则在上游已拦截）
const CONTEXT_SENSITIVE_PATTERNS = [
  /(?:剂量|用量|怎么吃|怎么服用|吃多少|吃几[片粒颗毫升克]|每日.{0,4}[片粒颗毫升克]|每天.{0,4}[片粒颗毫升克]|每次.{0,4}[片粒颗毫升克])/,
  /(?:三两|二两|一两|半斤|一钱|二钱|三钱|四钱|五钱|六钱|七钱|八钱|九钱|几钱|几两).{0,15}(?:怎么|如何|多少|换算|服用|用)/,
  new RegExp(SYMPTOM_PATTERN.source + '.{0,15}(?:用什么|吃什么|怎么治|什么药|什么方|比较好|有效|推荐|怎么办|能吃吗|能吃)'),
  /(?:针灸|艾灸|针刺|拔罐|刮痧).{0,20}(?:怎么|如何|能不能|可以吗|适合|灸哪|针哪)/,
  /(?:艾灸|针刺|拔罐|刮痧).{0,20}(?:穴位|部位).{0,10}(?:可以吗|能不能|怎么|如何)/,
  /(?:足三里|三阴交|合谷|关元|神阙|百会|太冲|穴位).{0,10}(?:可以灸|能灸|灸吗|可以针|能针|针吗)/,
  /(?:怎么配|如何配|配在一起|合用|药对|(?:和|与).{0,20}(?:怎么|如何)配伍)/,
  /(?:先煎|后下|包煎|烊化).{0,8}(?:吗|？|\?)/,
  /(?:同用|合用|一起用|可以同用).{0,8}(?:吗|？|\?)/,
];

function hasSubstanceOrAcupointExecutableQuery(text) {
  return SUBSTANCE_EXECUTABLE_PATTERN.test(text)
    || ACUPOINT_EXECUTABLE_PATTERN.test(text)
    || MOXIBUSTION_ACUPOINT_PATTERN.test(text);
}

function hasLearningContext(text) {
  return LEARNING_CONTEXT_PATTERN.test(text);
}

function isLearningRecommendationStructure(text) {
  return LEARNING_RECOMMENDATION_PATTERN.test(text);
}

function hasSymptomTreatmentQuery(text) {
  return new RegExp(SYMPTOM_PATTERN.source + '.{0,15}(?:怎么办|怎么治|能吃吗|能吃|可以吃吗|可以吃)').test(text)
    || new RegExp(SYMPTOM_PATTERN.source + '.{0,15}(?:用什么|吃什么|什么药|什么方|用什么药|用什么方)').test(text);
}

function hasFeverTreatmentQuery(text) {
  return /(?:发烧|发热).{0,20}(?:\d+[\.\d]*\s*度|38|39|40).{0,20}(?:怎么办|怎么治)/.test(text)
    || /(?:\d+[\.\d]*\s*度).{0,15}(?:发烧|发热).{0,15}(?:怎么办|怎么治)/.test(text)
    || (/(?:发烧|发热)/.test(text) && /(?:怎么办|怎么治)/.test(text));
}

function hasTreatmentIntentInLearning(text) {
  if (/怎么治/.test(text)) return true;
  if (/用什么药|用什么方|吃什么药/.test(text)) return true;
  if (/用什么方比较好|什么方比较好|用什么药比较好|什么药比较好/.test(text)) return true;
  if (hasSymptomTreatmentQuery(text)) return true;
  return false;
}

function hasPersonTreatmentQuery(text) {
  if (!PERSON_PATTERN.test(text)) return false;
  if (isLearningRecommendationStructure(text)) return false;

  if (STRONG_TREATMENT_INTENT_PATTERN.test(text)) return true;

  if (WEAK_TREATMENT_INTENT_PATTERN.test(text) && SYMPTOM_PATTERN.test(text)) return true;

  if (SYMPTOM_PATTERN.test(text) && /(?:怎么办|怎么治|能吃|可以吃|能用|可以用)/.test(text)) return true;
  if (/(?:发烧|发热)/.test(text) && /(?:怎么办|怎么治)/.test(text)) return true;

  return false;
}

function isMedicalRequest(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();

  if (ALWAYS_BLOCK_PATTERNS.some((p) => p.test(t))) return true;

  if (hasPersonTreatmentQuery(t)) return true;
  if (hasFeverTreatmentQuery(t)) return true;
  if (hasSymptomTreatmentQuery(t)) return true;

  if (hasLearningContext(t)) {
    if (hasTreatmentIntentInLearning(t)) return true;
    if (hasSubstanceOrAcupointExecutableQuery(t)) return true;
    return false;
  }

  if (hasSubstanceOrAcupointExecutableQuery(t)) return true;

  return CONTEXT_SENSITIVE_PATTERNS.some((p) => p.test(t));
}

function getMedicalBlockReply(text) {
  if (EMERGENCY_PATTERN.test(text)) return EMERGENCY_BLOCK_REPLY;
  return MEDICAL_BLOCK_REPLY;
}

function getMedicalBlockReplyFromContext(history, currentMsg) {
  const parts = [];
  if (Array.isArray(history)) {
    for (const h of history) {
      if (h && h.role === 'user' && typeof h.content === 'string') parts.push(h.content);
    }
  }
  if (typeof currentMsg === 'string') parts.push(currentMsg);
  return getMedicalBlockReply(parts.join('\n'));
}

// ---------------------------------------------------------------------------
// 生成结果二次安全检查 — 拦截 LLM 输出中的具体剂量/处方建议
//
// 注意：引用原文（如"桂枝三两"）不应被拦截，只拦截明确的处方建议格式
// ---------------------------------------------------------------------------
const MEDICAL_OUTPUT_PATTERNS = [
  // 明确的处方建议格式
  /(?:建议(?:服用|用量|剂量)|推荐(?:服用|用量|剂量)|处方[:：]|我的建议是).{0,30}\d/,
  // 明确的每日/每次剂量
  /(?:每日|每天|每次).{0,5}\d+(?:\.\d+)?.{0,5}(?:克|g|mg|毫升|ml|片|粒|颗)/,
  // 明确的"你应该服用"类建议
  /(?:你应该|你需要|你可以服用|建议你).{0,20}\d+(?:\.\d+)?.{0,5}(?:克|g|mg|毫升|ml|片|粒|颗)/,
  // 个体化可执行服法建议（排除经典讲解/学习语境中的"温服"等术语）
  /(?:建议|推荐|应该|需要)(?:你|您).{0,15}(?:服法|服用方法|饭前服|饭后服|温服|分.{0,3}次服)/,
  /(?:建议|推荐|应该|需要)(?:你|您).{0,12}(?:服用方法|饭前服|饭后服|分.{0,3}次服)/,
  /(?:你|您).{0,8}(?:饭前服|饭后服|分.{0,3}次服).{0,12}(?:即可|为宜|较好)/,
  // 穴位/针灸操作建议（区分"针灸"教学表述）
  /(?:建议|推荐|可以).{0,10}(?:艾灸|针刺|按压|刺激).{0,15}(?:穴|处|部位)/,
  /(?:建议|推荐|可以)针(?!灸).{0,15}(?:穴|处|部位)/,
  // 个体化开方（不因"经方"误伤）
  /(?:根据你的|针对你的|适合你|为你).{0,20}(?:处方|药方|汤方|配.{0,8}(?:药|方|汤)|用.{0,4}药)/,
];

function isMedicalOutput(text) {
  if (!text) return false;
  return MEDICAL_OUTPUT_PATTERNS.some((p) => p.test(text));
}

// ---------------------------------------------------------------------------
// history 校验 — 严格限制 role/content/长度/交替
//
// 安全要求：
//   - role 只能是 user/assistant（拒绝 system/developer/tool 等）
//   - content 必须是字符串
//   - 单条长度 ≤ 2000 字符
//   - 角色必须交替（user/assistant/user/assistant...）
//   - 最后一条必须是 assistant（因为当前 msg 是 user）
//   - 每条 user 消息也要经过医疗拦截
// ---------------------------------------------------------------------------
function validateHistory(history, requestId) {
  if (!Array.isArray(history)) return { valid: [], error: null };
  if (history.length === 0) return { valid: [], error: null };

  // 第一阶段：严格校验每条消息（非法即拒绝整段 history，不静默过滤）
  const filtered = [];
  for (const h of history) {
    if (!h || typeof h !== 'object') {
      return { valid: [], error: 'invalid_history_format' };
    }
    if (typeof h.role !== 'string') {
      return { valid: [], error: 'invalid_role' };
    }
    const role = h.role === 'bot' ? 'assistant' : h.role;
    // 严格限制 role：system/developer 等一律拒绝
    if (role !== 'user' && role !== 'assistant') {
      return { valid: [], error: 'illegal_role:' + h.role };
    }
    if (typeof h.content !== 'string') {
      return { valid: [], error: 'invalid_content_type' };
    }
    if (!h.content.trim()) {
      return { valid: [], error: 'empty_content' };
    }
    // 超长内容拒绝整段（不裁剪、不保留孤立 assistant）
    if (h.content.length > MAX_HISTORY_LENGTH) {
      return { valid: [], error: 'content_too_long' };
    }
    filtered.push({ role, content: h.content.trim() });
  }

  if (filtered.length === 0) return { valid: [], error: null };

  // 第二阶段：角色交替校验（非交替也拒绝）
  for (let i = 1; i < filtered.length; i++) {
    if (filtered[i].role === filtered[i - 1].role) {
      return { valid: [], error: 'non_alternating' };
    }
  }

  // 第三阶段：确保最后一条是 assistant（因为当前 msg 是 user）
  // 如果最后一条是 user，移除它（避免 user-user 连续）— 这是合法变换
  let result = filtered;
  if (result.length > 0 && result[result.length - 1].role === 'user') {
    result = result.slice(0, -1);
  }

  // 最多保留 MAX_HISTORY_ITEMS 条
  if (result.length > MAX_HISTORY_ITEMS) {
    result = result.slice(result.length - MAX_HISTORY_ITEMS);
  }

  // 第四阶段：对 history 中的 user 消息做医疗拦截
  for (const h of result) {
    if (h.role === 'user' && isMedicalRequest(h.content)) {
      return { valid: [], error: 'medical_in_history' };
    }
  }

  return { valid: result, error: null };
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
// 改进（v5.2.0）：
//   - 使用原子操作（db.command.inc + push）避免竞态
//   - 时区改为 UTC+8（北京时间）
//   - 连续 DB 错误时 fail-closed（熔断后直接拒服，不做内存降级）
//   - TTL 自动过期（文档 7 天后自动删除）
//   - 缺 OpenID 时拒绝（不绕过限流）
//   - 熔断后冷却恢复（60 秒后半开探测）
//
// 每用户每分钟最多 6 次，每用户每日最多 20 次。
// 仅保存哈希、日期、计数和 TTL，不保存聊天内容。
// ---------------------------------------------------------------------------
let _dbErrorCount = 0;
let _circuitBreakUntil = 0;
const DB_ERROR_THRESHOLD = 5; // 连续 5 次 DB 错误后熔断拒服
const CIRCUIT_BREAK_COOLDOWN_MS = 60000; // 熔断冷却 60 秒
const DOC_TTL_SECONDS = 7 * 24 * 3600; // 文档 7 天后自动过期

function resetRateLimitState() {
  _dbErrorCount = 0;
  _circuitBreakUntil = 0;
}

async function checkRateLimit(db, userHash) {
  // 缺 OpenID 时拒绝（不绕过限流）
  if (!userHash) {
    return { allowed: false, reason: 'missing_user_id' };
  }

  // 熔断检查：DB 不可用时 fail-closed，直接拒服
  const nowMs = Date.now();
  if (_dbErrorCount >= DB_ERROR_THRESHOLD) {
    if (nowMs < _circuitBreakUntil) {
      console.log(JSON.stringify({
        event: 'rate_limit_circuit_open',
        error_count: _dbErrorCount,
        cooldown_remaining: Math.round((_circuitBreakUntil - nowMs) / 1000) + 's',
      }));
      return {
        allowed: false,
        reason: 'rate_limit_unavailable',
        remaining: 0,
        reset_at: '稍后',
      };
    }
    // 冷却期已过：进入半开探测，允许一次请求试探 DB
    console.log(JSON.stringify({ event: 'rate_limit_half_open_probe' }));
  }

  // 使用 UTC+8（北京时间）
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 3600 * 1000);
  const today = beijingTime.toISOString().slice(0, 10); // YYYY-MM-DD (北京时间)
  const nowTimestamp = now.getTime();
  const oneMinuteAgoTs = nowTimestamp - 60000;

  const collection = db.collection(RATE_COLLECTION);
  const docId = `${userHash}_${today}`;
  const _ = db.command;

  try {
    // 原子操作：自增 daily_count + 推送当前时间戳到 minute_requests + 设置 TTL
    // 注意：必须同时写 ttl 字段（匹配数据库 ttl_idx 索引），否则记录不会自动过期
    //
    // 兼容性：@cloudbase/node-sdk 不支持 doc().upsert()，
    // 需要先 get 判断存在性，再用 set（新建）或 update（已存在）+ 原子操作符
    const expireDate = new Date(nowTimestamp + DOC_TTL_SECONDS * 1000);
    const docRef = collection.doc(docId);

    // 先尝试读取现有记录
    let existingRecord = null;
    try {
      const getResult = await docRef.get();
      existingRecord = getResult.data && getResult.data[0];
    } catch (getErr) {
      // 文档不存在时 node-sdk 会抛错，忽略即可
    }

    if (existingRecord) {
      // 已存在记录：用 update + 原子操作符
      // 注意：update 不能包含 _id 字段（doc(docId) 已隐式指定）
      await docRef.update({
        daily_count: _.inc(1),
        minute_requests: _.push({ ts: nowTimestamp }),
        last_updated: now.toISOString(),
        expires_at: expireDate,
        ttl: expireDate, // 匹配数据库 ttl_idx 索引（expireAfterSeconds=0）
      });
    } else {
      // 新记录：用 set 创建
      // 注意：set 不能包含 _id 字段（doc(docId) 已隐式指定，传 _id 会报"不能更新_id的值"）
      await docRef.set({
        user_hash: userHash,
        date: today,
        daily_count: 1,
        minute_requests: [{ ts: nowTimestamp }],
        last_updated: now.toISOString(),
        expires_at: expireDate,
        ttl: expireDate, // 匹配数据库 ttl_idx 索引（expireAfterSeconds=0）
      });
    }

    // 读取最新记录判断是否超限
    const result = await docRef.get();
    const record = result.data && result.data[0];

    if (!record) {
      _dbErrorCount++;
      if (_dbErrorCount >= DB_ERROR_THRESHOLD) {
        _circuitBreakUntil = nowMs + CIRCUIT_BREAK_COOLDOWN_MS;
      }
      console.log(JSON.stringify({ event: 'rate_limit_db_create_failed' }));
      // DB 可能已自增但读取为空，不再回落内存计数，避免双重放行
      return {
        allowed: false,
        reason: 'rate_limit_unavailable',
        remaining: 0,
        reset_at: '稍后',
      };
    }

    // 重置错误计数和熔断状态（成功恢复）
    _dbErrorCount = 0;
    _circuitBreakUntil = 0;

    // 检查日限额（已自增，所以检查是否超过）
    if (record.daily_count > RATE_LIMIT_PER_DAY) {
      return {
        allowed: false,
        reason: 'daily_exceeded',
        remaining: 0,
        reset_at: '次日北京时间 00:00',
      };
    }

    // 检查分钟限额：过滤一分钟内的请求
    const recentRequests = (record.minute_requests || []).filter(
      (r) => r && typeof r.ts === 'number' && r.ts > oneMinuteAgoTs
    );

    if (recentRequests.length > RATE_LIMIT_PER_MINUTE) {
      return {
        allowed: false,
        reason: 'minute_exceeded',
        remaining: 0,
        reset_at: '60 秒后',
      };
    }

    return {
      allowed: true,
      reason: null,
      remaining_daily: Math.max(0, RATE_LIMIT_PER_DAY - record.daily_count),
    };
  } catch (err) {
    _dbErrorCount++;
    if (_dbErrorCount >= DB_ERROR_THRESHOLD) {
      _circuitBreakUntil = nowMs + CIRCUIT_BREAK_COOLDOWN_MS;
    }
    console.log(JSON.stringify({
      event: 'rate_limit_db_error',
      error: err.message ? err.message.slice(0, 100) : 'unknown',
      error_count: _dbErrorCount,
    }));
    // 写入阶段失败时宁可短暂拒服，避免与可能已成功的 DB 自增叠加内存计数
    return {
      allowed: false,
      reason: 'rate_limit_unavailable',
      remaining: 0,
      reset_at: '稍后',
    };
  }
}

// ---------------------------------------------------------------------------
// 混合 RAG 调用 — BM25 检索 + generateText 生成
//
// 改进（v5.1.0）：
//   - 使用 v2 检索器（BM25 + 阈值），无关问题返回零结果
//   - 上下文按分块（600-2000 字符）而非整篇，总量限制 30000 字符
//   - knowledge_sources 返回带证据片段的结构
//   - 生成结果二次安全检查
//
// 官方文档：https://docs.cloudbase.net/ai/sdk-reference/api#generatetext
// ---------------------------------------------------------------------------
async function callHybridRAG(ai, msg, history) {
  // 1. BM25 检索相关文档（已带阈值过滤）
  const docs = searchDocuments(msg, 12);

  console.log(JSON.stringify({
    event: 'hybrid_rag_start',
    docs_found: docs.length,
    message_length: msg.length,
    history_count: (history || []).length,
  }));

  if (!docs.length) {
    // 没有找到相关文档 — 无关问题，直接返回
    return {
      text: '',
      knowledgeBase: [],
      hasError: false,
      errorMsg: 'no_docs_found',
    };
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
  const systemPrompt = `你是「经典中医学习研习助手」，专注于回答关于经典中医理论、天纪、紫微斗数、针灸、方剂等方面的问题。

请基于以下知识库内容回答用户的问题。
如果知识库内容不足以完整回答问题，请基于已有内容给出部分回答，并简要说明哪些方面知识库暂未覆盖。

重要规则：
- 不要建议用户去查阅外部资料、原稿或完整版资料。
- 不要在回复中提及"天机道终稿""天机道·地脉道·人间道""天机道笔记"等原始资料文件名。
- 不要提及任何作者、整理者的人名。
- 不要引用排盘表格名称（如"安紫微诸星表""定天府表""安天府诸星表""起紫微表"等），这些只是技术工具，用户想了解的是星曜的象征意义、性格特征、命理作用。
- 回答星曜问题时，请专注于：星曜的身份定位（如帝星、南斗星君）、五行属性、性格特征、核心作用（如领导、守成）、关键功能（如解厄制化、官运）、组合意义（如府相会命、左辅右弼配合）、注意事项等。
- 回答结构建议：按星曜分点说明，每颗星包含"身份/核心作用/关键特性/注意事项"四个维度。
- 当问题一次点名多颗星曜时，先逐一回答每颗星，再补充上下文中与它们直接相关的辅星或组合关系；不要用目录、表格或资料清单替代正文解释。
- 引用时使用知识卡片的章节名，而非原始资料文件名或排盘表格名。
回答应保持学术严谨，用通俗语言解释复杂概念。
本系统仅供学习研究，不提供诊断、处方、剂量或治疗建议。

知识库内容：
${context}`;

  // 4. 构建消息（系统提示 + 历史 + 当前问题）
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(history || []).map((h) => ({
      role: h.role === 'bot' ? 'assistant' : h.role,
      content: h.content,
    })),
    { role: 'user', content: msg },
  ];

  // 5. 调用 generateText（云函数可使用免费 AI 资源）
  const model = ai.createModel('hunyuan-v3');

  const result = await model.generateText({
    model: 'hy3-preview',
    messages,
    temperature: 0.3,
  });

  const text = (result && result.text) || '';

  // 6. 生成结果二次安全检查
  if (isMedicalOutput(text)) {
    console.log(JSON.stringify({
      event: 'hybrid_rag_output_blocked',
      text_length: text.length,
    }));
    return {
      text: MEDICAL_BLOCK_REPLY,
      knowledgeBase: [],
      hasError: false,
      errorMsg: 'output_blocked',
    };
  }

  // 7. 构建知识库来源信息（只返回真正达阈值的文档 + 证据片段）
  const knowledgeBase = docs.map((d) => ({
    source_group: d.source_group,
    source_quality: d.source_quality,
    chunk_title: d.chunk_title,
    score: d.score,
    matched_terms: d.matched_terms,
    evidence: d.evidence,
  }));

  console.log(JSON.stringify({
    event: 'hybrid_rag_end',
    has_text: text.length > 0,
    text_length: text.length,
    knowledge_base_count: knowledgeBase.length,
    context_chars: usedChars,
  }));

  return {
    text: text.trim(),
    knowledgeBase,
    hasError: false,
    errorMsg: '',
  };
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------
exports.main = async (event, context) => {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();

  // 获取 OpenID（微信自动透传）— 优先 wx-server-sdk，回退 context.OPENID
  const openId = getOpenId(event, context);
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
      reply: getMedicalBlockReply(trimmedMsg),
      provider: 'system',
      blocked: true,
      request_id: requestId,
    };
  }

  // 初始化 CloudBase
  let app, ai, db;
  try {
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
        : rateLimit.reason === 'circuit_break'
        ? '服务暂时繁忙，请稍后再试。'
        : rateLimit.reason === 'missing_user_id'
        ? '无法验证用户身份，请关闭小程序后重新打开；若仍失败，请检查微信登录状态。'
        : rateLimit.reason === 'rate_limit_unavailable'
        ? '服务暂时繁忙，请稍后再试。'
        : `提问过于频繁，请${rateLimit.reset_at || '稍后'}再试。`,
      provider: 'system',
      rate_limited: true,
      request_id: requestId,
    };
  }

  // history 校验（严格限制 role/content/长度/交替 + 医疗拦截）
  let history = [];
  if (Array.isArray(event.history)) {
    const result = validateHistory(event.history, requestId);
    if (result.error) {
      if (result.error === 'medical_in_history') {
        const elapsed = Date.now() - startTime;
        console.log(JSON.stringify({
          request_id: requestId,
          status: 400,
          reason: 'medical_in_history',
          elapsed,
        }));
        return {
          reply: getMedicalBlockReplyFromContext(result.valid, trimmedMsg),
          provider: 'system',
          blocked: true,
          request_id: requestId,
        };
      }
      const elapsed = Date.now() - startTime;
      console.log(JSON.stringify({
        request_id: requestId,
        status: 400,
        reason: 'invalid_history',
        detail: result.error,
        elapsed,
      }));
      return {
        error: '对话历史格式无效，请开始新对话',
        invalid_history: true,
        request_id: requestId,
      };
    }
    history = result.valid;
  }

  // 调用混合 RAG（BM25 检索 + generateText 生成）
  try {
    const result = await callHybridRAG(ai, trimmedMsg, history);
    const elapsed = Date.now() - startTime;

    // 未找到相关文档（无关问题）
    if (result.errorMsg === 'no_docs_found' && !result.text) {
      console.log(JSON.stringify({
        request_id: requestId,
        status: 200,
        provider: 'cloudbase-hybrid',
        reason: 'no_docs_found',
        elapsed,
      }));
      return {
        reply: '知识库中暂无与您问题直接相关的内容。您可以尝试换个问法，或询问《伤寒论》《金匮要略》《黄帝内经》《神农本草经》等经典、天纪、针灸、方剂等相关内容。',
        provider: 'cloudbase-hybrid',
        thread_id: sessionId || requestId,
        request_id: requestId,
        knowledge_sources: [],
      };
    }

    // 输出被二次安全检查拦截
    if (result.errorMsg === 'output_blocked') {
      console.log(JSON.stringify({
        request_id: requestId,
        status: 200,
        provider: 'cloudbase-hybrid',
        reason: 'output_blocked',
        elapsed,
      }));
      return {
        reply: result.text,
        provider: 'system',
        blocked: true,
        request_id: requestId,
        knowledge_sources: [],
      };
    }

    // 空答
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
      provider: 'cloudbase-hybrid',
      elapsed,
      has_knowledge: result.knowledgeBase.length > 0,
    }));

    return {
      reply: result.text,
      provider: 'cloudbase-hybrid',
      thread_id: sessionId || requestId,
      request_id: requestId,
      knowledge_sources: result.knowledgeBase,
    };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const errType = err && err.constructor ? err.constructor.name : 'Error';
    const errMsg = err && err.message ? err.message.slice(0, 200) : 'unknown';
    console.log(JSON.stringify({
      request_id: requestId,
      status: 500,
      reason: 'hybrid_rag_error',
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
exports.isMedicalOutput = isMedicalOutput;
exports.hasLearningContext = hasLearningContext;
exports.ALWAYS_BLOCK_PATTERNS = ALWAYS_BLOCK_PATTERNS;
exports.CONTEXT_SENSITIVE_PATTERNS = CONTEXT_SENSITIVE_PATTERNS;
exports.MEDICAL_OUTPUT_PATTERNS = MEDICAL_OUTPUT_PATTERNS;
exports.hashOpenId = hashOpenId;
exports.validateHistory = validateHistory;
exports.MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH;
exports.MAX_HISTORY_LENGTH = MAX_HISTORY_LENGTH;
exports.MAX_HISTORY_ITEMS = MAX_HISTORY_ITEMS;
exports.RATE_LIMIT_PER_MINUTE = RATE_LIMIT_PER_MINUTE;
exports.RATE_LIMIT_PER_DAY = RATE_LIMIT_PER_DAY;
exports.getMedicalBlockReply = getMedicalBlockReply;
exports.getMedicalBlockReplyFromContext = getMedicalBlockReplyFromContext;
exports.checkRateLimit = checkRateLimit;
exports.resetRateLimitState = resetRateLimitState;
