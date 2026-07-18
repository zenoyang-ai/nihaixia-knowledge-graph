// pages/chat/chat.js

// ===========================================================================
// 医疗可执行请求检测 — 客户端即时提示（服务端是最终边界）
// ===========================================================================
const MEDICAL_PATTERNS = [
  /(?:剂量|用量|服法|用法|怎么吃|怎么服用|吃多少|吃几[片粒颗毫升克]|每日.{0,4}[片粒颗毫升克]|每天.{0,4}[片粒颗毫升克]|每次.{0,4}[片粒颗毫升克])/,
  /(?:开(?:什么|个)?药|给我.{0,5}(?:药|方)|推荐.{0,5}(?:药|方)|建议.{0,5}(?:药|方)|什么药.{0,3}好|该用.{0,5}方|什么方子.{0,3}治)/,
  /(?:打针|注射|输液|手术|化疗|放疗|住院|挂水)/,
  /(?:救命|急救|危重|抢救|快不行)/,
  /(?:我|我妈|我爸|我家人|我家老人|孩子|宝宝|婴儿|孕妇|孙子|孙女).{0,30}(?:怎么治|能治好吗|该吃什么|吃什么药|用什么方|怎么调理|帮我诊断|帮我分析)/,
  /(?:假装|扮演|假设|作为).{0,15}(?:医生|医师|中医|大夫|专家).{0,30}(?:开|告诉|建议|推荐|处方|剂量|用量|怎么治|怎么吃)/,
  /(?:忽略|跳过|不要管|disregard).{0,15}(?:限制|规则|前面|安全|拦截).{0,30}(?:剂量|处方|怎么治|怎么吃|开药)/,
];

function isMedicalRequest(text) {
  return MEDICAL_PATTERNS.some((p) => p.test(text));
}

// ===========================================================================
// Markdown 转 HTML（用于 rich-text 组件，使用内联样式）
// ===========================================================================
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatInline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code style="background:#f6f0e6;padding:2rpx 8rpx;border-radius:4rpx;font-size:26rpx;">$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}

function formatContent(text) {
  if (!text) return '';
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

    let h = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      if (inList) { html.push('</' + listType + '>'); inList = false; }
      html.push('<div style="font-weight:700;font-size:32rpx;margin:16rpx 0 8rpx;color:#7f211c;border-bottom:1rpx solid #e7d8c1;padding-bottom:6rpx;">' + formatInline(h[2]) + '</div>');
      continue;
    }

    let ol = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (ol) {
      if (!inList || listType !== 'ol') {
        if (inList) html.push('</' + listType + '>');
        html.push('<ol style="padding-left:32rpx;margin:8rpx 0;">');
        inList = true;
        listType = 'ol';
      }
      html.push('<li style="margin:6rpx 0;">' + formatInline(ol[2]) + '</li>');
      continue;
    }

    let ul = trimmed.match(/^[-*]\s+(.*)/);
    if (ul) {
      if (!inList || listType !== 'ul') {
        if (inList) html.push('</' + listType + '>');
        html.push('<ul style="padding-left:32rpx;margin:8rpx 0;">');
        inList = true;
        listType = 'ul';
      }
      html.push('<li style="margin:6rpx 0;">' + formatInline(ul[1]) + '</li>');
      continue;
    }

    if (inList) { html.push('</' + listType + '>'); inList = false; }
    html.push('<p style="margin:8rpx 0;">' + formatInline(trimmed) + '</p>');
  }

  if (inList) html.push('</' + listType + '>');
  return html.join('');
}

// ===========================================================================
// 页面逻辑
// ===========================================================================
const MAX_HISTORY = 6; // 保留最近 6 条消息（3 轮对话）

Page({
  data: {
    messages: [],
    inputValue: '',
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
  },

  onLoad() {
    // 生成会话 ID，页面生命周期内保持不变
    this.setData({
      sessionId: 'mp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    });
  },

  // 输入处理
  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  // 推荐问题点击
  onSuggestedTap(e) {
    const question = e.currentTarget.dataset.question;
    this.setData({ inputValue: question });
    this.onSend();
  },

  // 重新发送失败的问题
  onRetry(e) {
    const question = e.currentTarget.dataset.question;
    if (!question) return;
    this.setData({ inputValue: question });
    this.onSend();
  },

  // 发送消息
  async onSend() {
    const text = this.data.inputValue.trim();
    if (!text || this.data.loading) return;

    // 客户端即时医疗提示（服务端是最终边界）
    if (isMedicalRequest(text)) {
      const warnId = this.data.msgIdCounter + 1;
      this.setData({
        msgIdCounter: warnId,
        messages: [
          ...this.data.messages,
          { id: warnId, role: 'user', content: text },
          {
            id: warnId + 1,
            role: 'assistant',
            content: '本系统仅供学习研究，不提供诊断、处方、剂量或治疗建议。如有健康问题，请咨询专业中医师。',
            html: '<p style="margin:8rpx 0;color:#b9362c;">本系统仅供学习研究，不提供诊断、处方、剂量或治疗建议。如有健康问题，请咨询专业中医师。</p>',
            provider: 'system',
          },
        ],
        inputValue: '',
        scrollToView: 'msg-' + (warnId + 1),
      });
      return;
    }

    const userMsgId = this.data.msgIdCounter + 1;
    const aiMsgId = userMsgId + 1;

    // 构建对话历史（只传角色和内容，不传其他字段）
    const history = this.data.messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-MAX_HISTORY)
      .map(m => ({ role: m.role, content: m.content }));

    // 添加用户消息和占位 AI 消息
    this.setData({
      msgIdCounter: aiMsgId,
      messages: [
        ...this.data.messages,
        { id: userMsgId, role: 'user', content: text },
        { id: aiMsgId, role: 'assistant', content: '', html: '', provider: '' },
      ],
      inputValue: '',
      loading: true,
      lastFailedQuestion: '',
      scrollToView: 'msg-' + aiMsgId,
    });

    try {
      // 调用云函数，只传当前问题和会话 ID
      const result = await this._callCloudFunction(text, history);

      // 更新 AI 消息
      const messages = this.data.messages;
      const idx = messages.findIndex(m => m.id === aiMsgId);
      if (idx >= 0) {
        if (result.reply) {
          messages[idx] = {
            ...messages[idx],
            content: result.reply,
            html: formatContent(result.reply),
            provider: result.provider || 'cloudbase-hybrid',
          };
        } else if (result.error) {
          messages[idx] = {
            ...messages[idx],
            content: result.error,
            html: formatContent(result.error),
            provider: 'error',
            retryQuestion: text,
          };
        }
      }

      this.setData({
        messages,
        loading: false,
        scrollToView: 'msg-' + aiMsgId,
      });
    } catch (err) {
      const messages = this.data.messages;
      const idx = messages.findIndex(m => m.id === aiMsgId);
      if (idx >= 0) {
        messages[idx] = {
          ...messages[idx],
          content: err.message || '网络异常，请稍后重试',
          html: formatContent(err.message || '网络异常，请稍后重试'),
          provider: 'error',
          retryQuestion: text,
        };
      }

      this.setData({
        messages,
        loading: false,
        lastFailedQuestion: text,
        scrollToView: 'msg-' + aiMsgId,
      });
    }
  },

  // 云函数调用 — 直接调用 nihaixia-qa-mp（不再转发 router）
  _callCloudFunction(msg, history) {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'nihaixia-qa-mp',
        data: {
          msg,
          session_id: this.data.sessionId,
          history,
        },
        success: (res) => {
          if (res && res.result) {
            resolve(res.result);
          } else {
            reject(new Error('云函数返回为空'));
          }
        },
        fail: (err) => {
          reject(new Error(err.errMsg || '云函数调用失败'));
        },
      });
    });
  },

  // 清空对话 — 生成新的会话 ID，不引用旧对话
  onClearChat() {
    wx.showModal({
      title: '清空对话',
      content: '确定清空所有对话记录吗？将开始新的会话。',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            messages: [],
            msgIdCounter: 0,
            inputValue: '',
            lastFailedQuestion: '',
            sessionId: 'mp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
            scrollToView: '',
          });
        }
      },
    });
  },

  // 分享
  onShareAppMessage() {
    return {
      title: '经典中医学习问答',
      path: '/pages/chat/chat',
    };
  },
});
