// pages/chat/chat.js

// ===========================================================================
// 医疗可执行请求检测 — 客户端拦截
// ===========================================================================
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
    suggestedQuestions: [
      '倪海厦对伤寒论的核心理解是什么？',
      '六经辨证分别对应什么证候和方剂？',
      '倪海厦推荐的中医学习顺序是什么？',
      '桂枝汤和麻黄汤有什么区别？',
    ],
    msgIdCounter: 0,
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

  // 发送消息
  async onSend() {
    const text = this.data.inputValue.trim();
    if (!text || this.data.loading) return;

    // 医疗请求拦截
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
            content: '本系统仅供学习研究，不提供诊断、处方、剂量或治疗建议等医疗建议。如有健康问题，请咨询专业中医师。',
            html: '<p style="margin:8rpx 0;color:#b9362c;">本系统仅供学习研究，不提供诊断、处方、剂量或治疗建议等医疗建议。如有健康问题，请咨询专业中医师。</p>',
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

    // 构建对话历史
    const history = this.data.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-MAX_HISTORY)
      .map(m => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content: text });

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
      scrollToView: 'msg-' + aiMsgId,
    });

    try {
      // 调用云函数 nihaixia-qa-mp（纯转发到 nihaixia-qa-router）
      const result = await this._callCloudFunction(history);

      // 更新 AI 消息
      const messages = this.data.messages;
      const idx = messages.findIndex(m => m.id === aiMsgId);
      if (idx >= 0) {
        messages[idx] = {
          ...messages[idx],
          content: result.reply,
          html: formatContent(result.reply),
          provider: result.provider || 'unknown',
        };
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
          content: err.message || '服务暂时不可用',
          html: formatContent(err.message || '服务暂时不可用'),
          provider: 'error',
        };
      }

      this.setData({
        messages,
        loading: false,
        scrollToView: 'msg-' + aiMsgId,
      });
    }
  },

  // 云函数调用 — 转发给 nihaixia-qa-router
  _callCloudFunction(messages) {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'nihaixia-qa-mp',
        data: {
          session_id: 'mp-' + Date.now().toString(36),
          messages,
        },
        success: (res) => {
          if (res && res.result && res.result.reply) {
            resolve(res.result);
          } else if (res && res.result && res.result.error) {
            reject(new Error(res.result.error));
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

  // 清空对话
  onClearChat() {
    wx.showModal({
      title: '清空对话',
      content: '确定清空所有对话记录吗？',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            messages: [],
            msgIdCounter: 0,
            scrollToView: '',
          });
        }
      },
    });
  },

  // 分享
  onShareAppMessage() {
    return {
      title: '经典中医知识问答',
      path: '/pages/chat/chat',
    };
  },
});
