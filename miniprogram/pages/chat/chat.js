// pages/chat/chat.js

// ===========================================================================
// 医疗可执行请求检测 — 客户端即时提示（服务端是最终边界）
// 意图结构优先，学习语境豁免（与云函数 index.js 保持同步）
// ===========================================================================
const LEARNING_CONTEXT_PATTERN = /(?:学习|原文|归经|原则|意义|类型|有哪些|是什么|如何理解|讲解|论述|在学习|经方学习|配伍原则|穴位归经|承担什么作用|经典|古籍|定位|伤寒论|金匮|内经|神农|治什么病|组成是什么|对应什么)/;

const PERSON_PATTERN = /(?:我|我妈|我爸|我家人|我家老人|孩子|宝宝|婴儿|孕妇|孙子|孙女|本人|老公|老婆|妻子|丈夫|先生|太太|爱人|老伴|父亲|母亲|爷爷|奶奶|外公|外婆|他|她)/;

const SYMPTOM_PATTERN = /(?:高血压|糖尿病|感冒|发烧|发热|咳嗽|失眠|胃痛|头痛|便秘|腹泻|肝炎|胃炎|肾炎|关节炎|湿疹|哮喘|冠心病|中风|贫血|过敏|抑郁|焦虑|痛风|结石|肿瘤|癌症)/;

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

const ALWAYS_BLOCK_PATTERNS = [
  /(?:打针|注射|输液|手术|化疗|放疗|住院|挂水)/,
  EMERGENCY_PATTERN,
  /(?:假装|扮演|假设|作为).{0,15}(?:医生|医师|中医|大夫|专家).{0,30}(?:开|告诉|建议|推荐|处方|剂量|用量|怎么治|怎么吃)/,
  /(?:忽略|跳过|不要管|disregard).{0,15}(?:限制|规则|前面|安全|拦截).{0,30}(?:剂量|处方|怎么治|怎么吃|开药)/,
  /(?:开(?:什么|个)?药|给我.{0,5}(?:药|方)|推荐(?!经方).{0,5}(?:药|方)|建议(?!经方).{0,5}(?:药|方)|什么药.{0,3}好|该用.{0,5}方|什么方子.{0,3}治|开.{0,15}(?:处方|药方|汤方|方子)|帮我.{0,5}(?:开|配|抓).{0,10}(?:处方|方子|药方|汤方)|(?:开|抓).{0,3}(?:个)?(?:方|方子|药方|汤方)(?!剂)|配(?!伍).{0,3}(?:个)?(?:方|方子|药方|汤方)(?!剂))/,
  /(?:根据|按照|针对).{0,12}(?:我的|他的|她的|症状|体质|情况).{0,20}(?:开|配|用|吃|服|方|药|汤)/,
];

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

// ===========================================================================
// Markdown 转 HTML（rich-text 内联样式；按系统主题生成颜色，避免暗色割裂）
// ===========================================================================
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getThemePalette(theme) {
  const dark = theme === 'dark';
  return dark ? {
    strong: '#ece4d6',
    muted: '#a39481',
    body: '#ddd3c2',
    accent: '#d4594e',
    quoteBg: '#1c1712',
    codeBg: 'rgba(255,255,255,0.08)',
  } : {
    strong: '#241f1a',
    muted: '#776b5f',
    body: '#342d25',
    accent: '#b9362c',
    quoteBg: '#fbf5ea',
    codeBg: 'rgba(0,0,0,0.06)',
  };
}

function detectSystemTheme() {
  try {
    const info = wx.getSystemInfoSync();
    return info.theme === 'dark' ? 'dark' : 'light';
  } catch (e) {
    return 'light';
  }
}

function formatInline(text, palette) {
  const p = palette || getThemePalette(detectSystemTheme());
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, `<code style="background:${p.codeBg};padding:2px 6px;border-radius:4px;font-size:13px;color:${p.accent};font-family:Menlo,Monaco,monospace;">$1</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, `<strong style="font-weight:600;color:${p.strong};">$1</strong>`);
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}

function formatContent(text, theme) {
  if (!text) return '';
  const p = getThemePalette(theme || detectSystemTheme());
  let lines = text.split('\n');
  let html = [];
  let inList = false;
  let listType = '';

  for (let line of lines) {
    let trimmed = line.trim();
    if (trimmed === '') {
      if (inList) { html.push('</' + listType + '>'); inList = false; }
      continue;
    }

    let quote = trimmed.match(/^>\s*(.*)/);
    if (quote) {
      if (inList) { html.push('</' + listType + '>'); inList = false; }
      html.push(`<div style="margin:8px 0;padding:8px 10px;background:${p.quoteBg};border-left:3px solid ${p.accent};border-radius:4px;color:${p.muted};font-size:14px;line-height:1.7;">` + formatInline(quote[1], p) + '</div>');
      continue;
    }

    let h = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      if (inList) { html.push('</' + listType + '>'); inList = false; }
      html.push(`<div style="font-weight:600;font-size:16px;margin:12px 0 6px;color:${p.strong};letter-spacing:0.02em;">` + formatInline(h[2], p) + '</div>');
      continue;
    }

    let ol = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (ol) {
      if (!inList || listType !== 'ol') {
        if (inList) html.push('</' + listType + '>');
        html.push(`<ol style="padding-left:22px;margin:8px 0;color:${p.body};">`);
        inList = true;
        listType = 'ol';
      }
      html.push(`<li style="margin:6px 0;line-height:1.75;color:${p.body};">` + formatInline(ol[2], p) + '</li>');
      continue;
    }

    let ul = trimmed.match(/^[-*]\s+(.*)/);
    if (ul) {
      if (!inList || listType !== 'ul') {
        if (inList) html.push('</' + listType + '>');
        html.push(`<ul style="padding-left:22px;margin:8px 0;color:${p.body};">`);
        inList = true;
        listType = 'ul';
      }
      html.push(`<li style="margin:6px 0;line-height:1.75;color:${p.body};">` + formatInline(ul[1], p) + '</li>');
      continue;
    }

    if (inList) { html.push('</' + listType + '>'); inList = false; }
    html.push(`<p style="margin:8px 0;line-height:1.75;color:${p.body};">` + formatInline(trimmed, p) + '</p>');
  }

  if (inList) html.push('</' + listType + '>');
  return html.join('');
}

// ===========================================================================
// 把一段 markdown 文本拆成"可选择的段落"列表
// 规则：按双换行（或单换行后是列表/标题/引用）拆段，过滤空段
// 每段保留原始文本（含 markdown 标记），用于复制
// ===========================================================================
function splitParagraphs(text) {
  if (!text) return [];
  // 先按双换行拆块
  const blocks = text.split(/\n\s*\n/);
  const paragraphs = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    // 如果块本身是多行（如列表），保持整块为一段
    // 如果块是单行，直接加入
    // 进一步：如果块内部包含多个独立段落（例如引用块 + 普通段），可按单行细分
    // 这里采用保守策略：把多行块按行拆，连续的非列表/非引用行合并
    const lines = trimmed.split('\n');
    let buffer = [];
    for (const line of lines) {
      const lt = line.trim();
      if (!lt) {
        if (buffer.length > 0) {
          paragraphs.push(buffer.join('\n'));
          buffer = [];
        }
        continue;
      }
      // 列表项、标题、引用作为独立段
      if (/^(\d+\.|[-*]|>|#{1,6}\s)/.test(lt)) {
        if (buffer.length > 0) {
          paragraphs.push(buffer.join('\n'));
          buffer = [];
        }
        paragraphs.push(lt);
      } else {
        buffer.push(lt);
      }
    }
    if (buffer.length > 0) {
      paragraphs.push(buffer.join('\n'));
    }
  }
  return paragraphs;
}

// ===========================================================================
// 会话持久化工具
// 存储结构：
//   chat_sessions: [{ sessionId, title, messageCount, updatedAt, updatedAtText, preview }]
//   chat_messages_<sessionId>: [{ id, role, content, html, provider, sources, hasSources, retryQuestion }]
// ===========================================================================
const SESSIONS_KEY = 'chat_sessions';

function loadSessions() {
  try {
    return wx.getStorageSync(SESSIONS_KEY) || [];
  } catch (e) {
    return [];
  }
}

function saveSessions(sessions) {
  try {
    wx.setStorageSync(SESSIONS_KEY, sessions);
    return true;
  } catch (e) {
    console.error('saveSessions failed', e);
    wx.showToast({ title: '对话未能保存到本地', icon: 'none', duration: 2500 });
    return false;
  }
}

function loadMessages(sessionId) {
  try {
    return wx.getStorageSync('chat_messages_' + sessionId) || [];
  } catch (e) {
    wx.showToast({ title: '读取本地记录失败', icon: 'none' });
    return [];
  }
}

function saveMessages(sessionId, messages) {
  try {
    const slim = messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content || '',
      html: m.html || '',
      provider: m.provider || '',
      sources: (m.sources || []).map(s => ({
        source_group: s.source_group || '',
        title: s.title || '',
        score: s.score,
        evidence: String(s.evidence || s.snippet || '').slice(0, 180),
      })),
      hasSources: !!m.hasSources,
      retryQuestion: m.retryQuestion || '',
    }));
    wx.setStorageSync('chat_messages_' + sessionId, slim);
    return true;
  } catch (e) {
    console.error('saveMessages failed', e);
    wx.showToast({ title: '消息未能保存到本地', icon: 'none', duration: 2500 });
    return false;
  }
}

function updateSessionMeta(sessionId, messages) {
  const sessions = loadSessions();
  let session = sessions.find(s => s.sessionId === sessionId);
  const now = Date.now();

  // 生成标题：取第一条 user 消息的前 30 字
  const firstUserMsg = messages.find(m => m.role === 'user' && m.content);
  const title = firstUserMsg ? firstUserMsg.content.slice(0, 30) : '未命名对话';

  // 预览：取最后一条 AI 消息的前 50 字
  const lastAiMsg = [...messages].reverse().find(m => m.role === 'assistant' && m.content);
  const preview = lastAiMsg ? lastAiMsg.content.slice(0, 50) : '';

  // 格式化时间
  const date = new Date(now);
  const pad = n => n < 10 ? '0' + n : '' + n;
  const updatedAtText = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (session) {
    session.title = title;
    session.messageCount = messages.length;
    session.updatedAt = now;
    session.updatedAtText = updatedAtText;
    session.preview = preview;
  } else {
    sessions.push({
      sessionId,
      title,
      messageCount: messages.length,
      updatedAt: now,
      updatedAtText,
      preview,
    });
  }

  saveSessions(sessions);
}

// ===========================================================================
// 页面逻辑
// ===========================================================================
const MAX_HISTORY = 6; // 保留最近 6 条消息（3 轮对话）传给云函数

Page({
  data: {
    messages: [],
    inputValue: '',
    canSend: false, // 是否可发送（inputValue.trim().length > 0 且非 loading）
    loading: false,
    scrollToView: 'chat-bottom',
    sessionId: '', // 页面生命周期内保持同一个会话 ID
    suggestedQuestions: [
      '伤寒论的学习应先理解哪些概念？',
      '人纪与天纪在知识结构中如何关联？',
      '经方、针灸、本草在学习路径中分别承担什么作用？',
      '紫微斗数在天纪资料中主要讨论什么？',
    ],
    msgIdCounter: 0,
    lastFailedQuestion: '', // 用于重新发送
    loadingStage: '', // 分阶段等待提示（检索 → 组织 → 完成）
    // 段落复制弹层
    copyPanelVisible: false,
    copyParagraphs: [],
    copyTitle: '选择段落复制',
    requestSeq: 0,
  },

  onShow() {
    const app = getApp();
    app.guardPrivacy(() => {}).then((ok) => {
      if (!ok) {
        this._stopLoadingStage();
        this._clearTypeTimer();
        this._requestSeq = (this._requestSeq || 0) + 1;
        this.setData({
          messages: [],
          loading: false,
          inputValue: '',
          canSend: false,
          lastFailedQuestion: '',
          requestSeq: this._requestSeq,
        });
      }
    });
  },

  onLoad(options) {
    this._requestSeq = 0;
    this._destroyed = false;
    this._theme = detectSystemTheme();
    if (typeof wx.onThemeChange === 'function') {
      this._onThemeChange = (res) => {
        if (this._destroyed) return;
        const next = (res && res.theme === 'dark') ? 'dark' : 'light';
        if (next === this._theme) return;
        this._theme = next;
        this._reformatMessagesForTheme();
      };
      wx.onThemeChange(this._onThemeChange);
    }
    let sessionId = '';
    let mode = '';

    if (options && options.sessionId) {
      sessionId = options.sessionId;
      mode = 'resume';
    } else if (options && options.mode === 'new') {
      sessionId = '';
      mode = 'new';
    } else {
      mode = 'new';
    }

    const app = getApp();
    app.guardPrivacy(() => this._initSession(mode, sessionId)).then((ok) => {
      if (!ok) {
        this.setData({
          messages: [],
          sessionId: 'mp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
        });
      }
    });
  },

  _initSession(mode, sessionId) {
    if (mode === 'resume' && sessionId) {
      const theme = this._theme || detectSystemTheme();
      const messages = loadMessages(sessionId)
        .filter((m) => m.role !== 'assistant' || m.content)
        .map((m) => {
          if (m.role === 'assistant' && m.content) {
            return Object.assign({}, m, { html: formatContent(m.content, theme) });
          }
          return m;
        });
      const maxId = messages.reduce((max, m) => Math.max(max, m.id || 0), 0);
      this.setData({
        sessionId,
        messages,
        msgIdCounter: maxId,
        scrollToView: messages.length > 0 ? 'msg-' + maxId : '',
      });
    } else {
      this.setData({
        sessionId: 'mp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      });
    }
  },

  // 输入处理 — 同步更新 canSend，避免 WXML 调用字符串方法
  onInput(e) {
    const value = e.detail.value;
    this.setData({
      inputValue: value,
      canSend: value.trim().length > 0,
    });
  },

  // 推荐问题点击 — 使用 setData 回调确保 inputValue 同步后再发送
  onSuggestedTap(e) {
    const question = e.currentTarget.dataset.question;
    if (!question || this.data.loading) return;
    this.setData({ inputValue: question, canSend: true }, () => {
      this.sendQuestion(question);
    });
  },

  // 重新发送失败的问题
  onRetry(e) {
    const question = e.currentTarget.dataset.question;
    if (!question || this.data.loading) return;
    this.setData({ inputValue: question, canSend: true }, () => {
      this.sendQuestion(question);
    });
  },

  // 发送消息（入口：点击发送按钮 / 回车）
  async onSend() {
    if (!this.data.canSend || this.data.loading) return;
    const text = this.data.inputValue.trim();
    if (!text) return;
    wx.vibrateShort({ type: 'light', fail: () => {} });
    await this.sendQuestion(text);
  },

  onUnload() {
    // 作废进行中的云函数请求，避免页面销毁后仍 setData / 持久化
    this._destroyed = true;
    this._requestSeq = (this._requestSeq || 0) + 1;
    this._stopLoadingStage();
    this._clearTypeTimer();
    if (typeof wx.offThemeChange === 'function' && this._onThemeChange) {
      try { wx.offThemeChange(this._onThemeChange); } catch (e) {}
    }
  },

  _safeSetData(data, cb) {
    if (this._destroyed) return;
    this.setData(data, cb);
  },

  _reformatMessagesForTheme() {
    const messages = this.data.messages || [];
    if (!messages.length) return;
    const theme = this._theme || detectSystemTheme();
    const update = {};
    messages.forEach((m, i) => {
      if (m.role === 'assistant' && m.content) {
        update[`messages[${i}].html`] = formatContent(m.content, theme);
      }
    });
    this._safeSetData(update);
  },

  // 实际发送逻辑 — 接收已确认的文本，避免依赖 setData 时序
  async sendQuestion(text) {
    const app = getApp();
    const authorized = await app.ensurePrivacyAuthorized();
    if (!authorized) {
      app.showPrivacyBlockedModal();
      return;
    }

    // 客户端即时医疗提示（服务端是最终边界）
    if (isMedicalRequest(text)) {
      const warnId = this.data.msgIdCounter + 1;
      const base = this.data.messages.length;
      const warnText = getMedicalBlockReply(text);
      const update = {
        msgIdCounter: warnId + 1,
        inputValue: '',
        canSend: false,
        scrollToView: 'msg-' + (warnId + 1),
      };
      update[`messages[${base}]`] = { id: warnId, role: 'user', content: text };
      update[`messages[${base + 1}]`] = {
        id: warnId + 1,
        role: 'assistant',
        content: warnText,
        html: `<p style="margin:8px 0;color:${getThemePalette(this._theme || detectSystemTheme()).accent};">${warnText}</p>`,
        provider: 'system',
        sources: [],
        hasSources: false,
      };
      this.setData(update);
      this._persist();
      return;
    }

    const userMsgId = this.data.msgIdCounter + 1;
    const aiMsgId = userMsgId + 1;

    // 构建对话历史（只传角色和内容，不传其他字段）
    const history = this.data.messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-MAX_HISTORY)
      .map(m => ({ role: m.role, content: m.content }));

    // 添加用户消息和占位 AI 消息（路径化 setData，避免全量替换）
    const base = this.data.messages.length;
    const append = {
      msgIdCounter: aiMsgId,
      inputValue: '',
      canSend: false,
      loading: true,
      lastFailedQuestion: '',
      scrollToView: 'msg-' + aiMsgId,
    };
    append[`messages[${base}]`] = { id: userMsgId, role: 'user', content: text };
    append[`messages[${base + 1}]`] = { id: aiMsgId, role: 'assistant', content: '', html: '', provider: '', sources: [], hasSources: false };
    this.setData(append);
    this._startLoadingStage();
    this._persist();

    const requestSeq = (this._requestSeq || 0) + 1;
    this._requestSeq = requestSeq;
    this.setData({ requestSeq });

    try {
      // 调用云函数，只传当前问题和会话 ID
      const result = await this._callCloudFunction(text, history);
      if (requestSeq !== this._requestSeq || this._destroyed) return;
      this._stopLoadingStage();

      const idx = this.data.messages.findIndex(m => m.id === aiMsgId);
      if (idx < 0) {
        this._safeSetData({ loading: false });
        return;
      }

      if (result.invalid_history) {
        const update = { loading: false, inputValue: '', canSend: false, lastFailedQuestion: '' };
        if (idx >= 0) {
          update[`messages[${idx}].content`] = '对话历史格式无效，请开始新对话后继续。';
          update[`messages[${idx}].html`] = formatContent('对话历史格式无效，请开始新对话后继续。', this._theme);
          update[`messages[${idx}].provider`] = 'system';
          update[`messages[${idx}].retryQuestion`] = '';
        }
        this._safeSetData(update);
        wx.showModal({
          title: '对话历史异常',
          content: '当前对话历史格式无效，请开始新对话后继续。',
          showCancel: false,
          confirmText: '开始新对话',
          confirmColor: '#b9362c',
          success: (modalRes) => {
            if (modalRes.confirm) {
              this._startNewSessionAfterInvalidHistory();
            }
          },
        });
        return;
      }

      if (result.reply) {
        const sources = Array.isArray(result.knowledge_sources) && result.knowledge_sources.length > 0
          ? result.knowledge_sources.slice(0, 5).map(s => ({
              source_group: s.source_group || '',
              title: s.chunk_title || s.title || s.source_group || '资料',
              chunk_title: s.chunk_title || '',
              score: s.score || 0,
              evidence: String(s.evidence || s.snippet || s.text || '').slice(0, 180),
            }))
          : [];
        this._typewriter(idx, result.reply, formatContent(result.reply, this._theme), result.provider || 'cloudbase-hybrid', sources);
      } else {
        const errText = result.error || '网络异常，请稍后重试';
        const update = { loading: false, lastFailedQuestion: text, scrollToView: 'msg-' + aiMsgId };
        update[`messages[${idx}].content`] = errText;
        update[`messages[${idx}].html`] = formatContent(errText, this._theme);
        update[`messages[${idx}].provider`] = 'error';
        update[`messages[${idx}].retryQuestion`] = text;
        this._safeSetData(update);
        this._persist();
      }
    } catch (err) {
      if (requestSeq !== this._requestSeq || this._destroyed) return;
      this._stopLoadingStage();
      const idx = this.data.messages.findIndex(m => m.id === aiMsgId);
      const errText = err.message || '网络异常，请稍后重试';
      const update = { loading: false, lastFailedQuestion: text, scrollToView: 'msg-' + aiMsgId };
      if (idx >= 0) {
        update[`messages[${idx}].content`] = errText;
        update[`messages[${idx}].html`] = formatContent(errText, this._theme);
        update[`messages[${idx}].provider`] = 'error';
        update[`messages[${idx}].retryQuestion`] = text;
      }
      this._safeSetData(update);
      this._persist();
    }
  },

  // 分阶段等待提示：检索 → 组织 → 即将完成
  _startLoadingStage() {
    this._stopLoadingStage();
    const stages = ['正在检索学习资料…', '正在组织回答…', '即将完成…'];
    let i = 0;
    this._safeSetData({ loadingStage: stages[0] });
    this._stageTimer = setInterval(() => {
      if (this._destroyed) {
        this._stopLoadingStage();
        return;
      }
      i = Math.min(i + 1, stages.length - 1);
      this._safeSetData({ loadingStage: stages[i] });
    }, 2400);
  },

  _stopLoadingStage() {
    if (this._stageTimer) {
      clearInterval(this._stageTimer);
      this._stageTimer = null;
    }
  },

  // 打字机逐字显现：先纯文本流式出现，完成后替换为富文本渲染
  _typewriter(idx, fullText, html, provider, sources) {
    this._clearTypeTimer();
    const msgId = this.data.messages[idx] && this.data.messages[idx].id;
    const total = fullText.length;
    const duration = Math.min(2600, Math.max(800, total * 10));
    const TICK = 30;
    const step = Math.max(1, Math.ceil(total / (duration / TICK)));
    let pos = 0;
    let ticks = 0;
    this._scrollFlip = false;

    this._typeTimer = setInterval(() => {
      if (this._destroyed) {
        this._clearTypeTimer();
        return;
      }
      pos = Math.min(total, pos + step);
      ticks += 1;
      const update = {};
      update[`messages[${idx}].content`] = fullText.slice(0, pos);
      // 打字过程中跟随滚动（交替目标强制 scroll-into-view 重复触发）
      if (ticks % 5 === 0) {
        this._scrollFlip = !this._scrollFlip;
        update.scrollToView = this._scrollFlip ? 'chat-bottom' : 'msg-' + msgId;
      }
      this._safeSetData(update);

      if (pos >= total) {
        this._clearTypeTimer();
        if (this._destroyed) return;
        const done = { loading: false, scrollToView: 'chat-bottom' };
        // 结束时按当前主题重渲，避免中途切主题后仍写入旧 html
        done[`messages[${idx}].html`] = formatContent(fullText, this._theme || detectSystemTheme());
        done[`messages[${idx}].provider`] = provider;
        done[`messages[${idx}].sources`] = sources;
        done[`messages[${idx}].hasSources`] = sources.length > 0;
        this._safeSetData(done);
        this._persist();
      }
    }, TICK);
  },

  _clearTypeTimer() {
    if (this._typeTimer) {
      clearInterval(this._typeTimer);
      this._typeTimer = null;
    }
  },

  // 持久化当前会话
  _persist() {
    if (this._destroyed) return;
    if (!this.data.sessionId) return;
    const app = getApp();
    if (app.globalData.privacyAuthorized !== true) return;
    saveMessages(this.data.sessionId, this.data.messages);
    updateSessionMeta(this.data.sessionId, this.data.messages);
  },

  // 云函数调用 — 带超时；新对话后通过 requestSeq 丢弃过期响应
  _callCloudFunction(msg, history) {
    const app = getApp();
    if (app.globalData.privacyAuthorized !== true) {
      return Promise.reject(new Error('需同意隐私协议后才能使用问答功能'));
    }

    const TIMEOUT_MS = 55000;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('请求超时，请稍后重试'));
      }, TIMEOUT_MS);

      wx.cloud.callFunction({
        name: 'nihaixia-qa-mp',
        data: {
          msg,
          session_id: this.data.sessionId,
          history,
        },
        success: (res) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (res && res.result) {
            resolve(res.result);
          } else {
            reject(new Error('云函数返回为空'));
          }
        },
        fail: (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error(err.errMsg || '云函数调用失败'));
        },
      });
    });
  },

  // 历史无效后重置会话，避免重复提交坏 history
  _startNewSessionAfterInvalidHistory() {
    this._stopLoadingStage();
    this._clearTypeTimer();
    this._requestSeq = (this._requestSeq || 0) + 1;
    this.setData({
      messages: [],
      msgIdCounter: 0,
      inputValue: '',
      canSend: false,
      loading: false,
      lastFailedQuestion: '',
      requestSeq: this._requestSeq,
      sessionId: 'mp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      scrollToView: '',
    });
  },

  // 清空对话 — 生成新的会话 ID，并作废进行中的请求
  onClearChat() {
    wx.showModal({
      title: '新对话',
      content: '确定开始新的学习对话吗？当前对话将保存到历史记录。',
      confirmText: '开始新对话',
      confirmColor: '#b9362c',
      success: (res) => {
        if (res.confirm) {
          this._stopLoadingStage();
          this._clearTypeTimer();
          this._requestSeq = (this._requestSeq || 0) + 1;
          this.setData({
            messages: [],
            msgIdCounter: 0,
            inputValue: '',
            canSend: false,
            loading: false,
            lastFailedQuestion: '',
            requestSeq: this._requestSeq,
            sessionId: 'mp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
            scrollToView: '',
          });
        }
      },
    });
  },

  // 展示引用来源详情（含截断证据摘要，不含本机路径）
  onShowSources(e) {
    const sources = e.currentTarget.dataset.sources;
    if (!sources || !sources.length) return;

    const lines = sources.slice(0, 5).map((s, i) => {
      const group = s.source_group || '未知来源';
      const title = s.title || s.chunk_title || '';
      const head = title ? `${group} · ${title}` : group;
      const score = s.score ? `（相关度 ${s.score}）` : '';
      const evidence = String(s.evidence || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const evLine = evidence ? `\n   ${evidence}${evidence.length >= 80 ? '…' : ''}` : '';
      return `${i + 1}. ${head}${score}${evLine}`;
    });

    wx.showModal({
      title: '引用资料',
      content: lines.join('\n\n'),
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#b9362c',
    });
  },

  // 长按消息 — 提供复制菜单（全文 / 选择段落）
  onLongPressMessage(e) {
    const content = e.currentTarget.dataset.content;
    if (!content) return;

    const paragraphs = splitParagraphs(content);

    wx.showActionSheet({
      itemList: paragraphs.length > 1 ? ['复制全文', '选择段落复制'] : ['复制全文'],
      success: (res) => {
        if (res.tapIndex === 0) {
          // 复制全文
          wx.setClipboardData({
            data: content,
            success: () => {
              wx.showToast({
                title: '已复制全文',
                icon: 'success',
                duration: 1500,
              });
            },
          });
        } else if (res.tapIndex === 1 && paragraphs.length > 1) {
          // 打开段落选择弹层
          this.setData({
            copyPanelVisible: true,
            copyParagraphs: paragraphs,
            copyTitle: '选择段落复制',
          });
        }
      },
    });
  },

  // 点击某个段落进行复制
  onCopyParagraph(e) {
    const idx = e.currentTarget.dataset.index;
    const paragraphs = this.data.copyParagraphs;
    if (idx < 0 || idx >= paragraphs.length) return;

    const text = paragraphs[idx];
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({
          title: '已复制该段',
          icon: 'success',
          duration: 1500,
        });
        this.setData({ copyPanelVisible: false });
      },
    });
  },

  // 关闭段落选择弹层
  onCloseCopyPanel() {
    this.setData({ copyPanelVisible: false });
  },

  // 阻止弹层内部点击事件冒泡
  onCopyPanelTap() {
    // 空函数，仅用于 catchtap 阻止冒泡
  },

  // 查看历史记录
  onViewHistory() {
    wx.navigateTo({
      url: '/pages/history/history',
    });
  },

  // 分享
  onShareAppMessage() {
    return {
      title: '倪师智慧学习问答',
      path: '/pages/index/index',
    };
  },
});
