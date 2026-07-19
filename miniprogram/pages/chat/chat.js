// pages/chat/chat.js

// ===========================================================================
// 医疗可执行请求检测 — 客户端即时提示（服务端是最终边界）
// ===========================================================================
const MEDICAL_PATTERNS = [
  /(?:剂量|用量|服法|用法|怎么吃|怎么服用|吃多少|吃几[片粒颗毫升克]|每日.{0,4}[片粒颗毫升克]|每天.{0,4}[片粒颗毫升克]|每次.{0,4}[片粒颗毫升克])/,
  /(?:开(?:什么|个)?药|给我.{0,5}(?:药|方)|推荐.{0,5}(?:药|方)|建议.{0,5}(?:药|方)|什么药.{0,3}好|该用.{0,5}方|什么方子.{0,3}治)/,
  /(?:打针|注射|输液|手术|化疗|放疗|住院|挂水)/,
  /(?:救命|急救|危重|抢救|快不行)/,
  /(?:我|我妈|我爸|我家人|我家老人|孩子|宝宝|婴儿|孕妇|孙子|孙女).{0,30}(?:怎么治|能治好吗|该吃什么|吃什么药|用什么方|怎么调理|帮我诊断|帮我分析|适合吃|适合用|能不能用|能不能吃|可以用吗|可以吗|能吃吗|能用吗)/,
  /(?:假装|扮演|假设|作为).{0,15}(?:医生|医师|中医|大夫|专家).{0,30}(?:开|告诉|建议|推荐|处方|剂量|用量|怎么治|怎么吃)/,
  /(?:忽略|跳过|不要管|disregard).{0,15}(?:限制|规则|前面|安全|拦截).{0,30}(?:剂量|处方|怎么治|怎么吃|开药)/,
  /(?:高血压|糖尿病|感冒|发烧|发热|咳嗽|失眠|胃痛|头痛|便秘|腹泻|肝炎|胃炎|肾炎|关节炎|湿疹|哮喘|冠心病|中风|贫血|过敏|抑郁|焦虑|痛风|结石|肿瘤|癌症).{0,15}(?:用什么|吃什么|怎么治|什么药|什么方|比较好|有效|推荐)/,
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
  s = s.replace(/`([^`]+)`/g, '<code style="background:#EEF1ED;padding:3rpx 10rpx;border-radius:6rpx;font-size:27rpx;color:#55776C;font-family:Menlo,Monaco,monospace;">$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:600;color:#263238;">$1</strong>');
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

    // 引用块 (> 开头) — 单独样式，灰底+左竖线
    let quote = trimmed.match(/^>\s*(.*)/);
    if (quote) {
      if (inList) { html.push('</' + listType + '>'); inList = false; }
      html.push('<div style="margin:14rpx 0;padding:14rpx 18rpx;background:#F4F7F4;border-left:6rpx solid #55776C;border-radius:6rpx;color:#6B767A;font-size:27rpx;line-height:1.7;">' + formatInline(quote[1]) + '</div>');
      continue;
    }

    let h = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      if (inList) { html.push('</' + listType + '>'); inList = false; }
      html.push('<div style="font-weight:600;font-size:31rpx;margin:20rpx 0 10rpx;color:#263238;letter-spacing:0.02em;">' + formatInline(h[2]) + '</div>');
      continue;
    }

    let ol = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (ol) {
      if (!inList || listType !== 'ol') {
        if (inList) html.push('</' + listType + '>');
        html.push('<ol style="padding-left:40rpx;margin:12rpx 0;">');
        inList = true;
        listType = 'ol';
      }
      html.push('<li style="margin:10rpx 0;line-height:1.75;">' + formatInline(ol[2]) + '</li>');
      continue;
    }

    let ul = trimmed.match(/^[-*]\s+(.*)/);
    if (ul) {
      if (!inList || listType !== 'ul') {
        if (inList) html.push('</' + listType + '>');
        html.push('<ul style="padding-left:40rpx;margin:12rpx 0;">');
        inList = true;
        listType = 'ul';
      }
      html.push('<li style="margin:10rpx 0;line-height:1.75;">' + formatInline(ul[1]) + '</li>');
      continue;
    }

    if (inList) { html.push('</' + listType + '>'); inList = false; }
    html.push('<p style="margin:14rpx 0;line-height:1.75;">' + formatInline(trimmed) + '</p>');
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
  } catch (e) {
    console.error('saveSessions failed', e);
  }
}

function loadMessages(sessionId) {
  try {
    return wx.getStorageSync('chat_messages_' + sessionId) || [];
  } catch (e) {
    return [];
  }
}

function saveMessages(sessionId, messages) {
  try {
    // 只保存必要字段，避免存储过大
    const slim = messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content || '',
      html: m.html || '',
      provider: m.provider || '',
      sources: m.sources || [],
      hasSources: !!m.hasSources,
      retryQuestion: m.retryQuestion || '',
    }));
    wx.setStorageSync('chat_messages_' + sessionId, slim);
  } catch (e) {
    console.error('saveMessages failed', e);
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
    // 段落复制弹层
    copyPanelVisible: false,
    copyParagraphs: [],
    copyTitle: '选择段落复制',
  },

  onLoad(options) {
    let sessionId = '';
    let mode = '';

    if (options && options.sessionId) {
      // 从历史记录进入：加载已有会话
      sessionId = options.sessionId;
      mode = 'resume';
    } else if (options && options.mode === 'new') {
      // 从主页"开始学习对话"进入：新会话
      sessionId = '';
      mode = 'new';
    } else {
      // 默认进入：新会话
      mode = 'new';
    }

    if (mode === 'resume' && sessionId) {
      const messages = loadMessages(sessionId);
      const maxId = messages.reduce((max, m) => Math.max(max, m.id || 0), 0);
      this.setData({
        sessionId,
        messages,
        msgIdCounter: maxId,
        scrollToView: messages.length > 0 ? 'msg-' + maxId : '',
      });
    } else {
      // 新会话
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
    await this.sendQuestion(text);
  },

  // 实际发送逻辑 — 接收已确认的文本，避免依赖 setData 时序
  async sendQuestion(text) {
    // 客户端即时医疗提示（服务端是最终边界）
    if (isMedicalRequest(text)) {
      const warnId = this.data.msgIdCounter + 1;
      const newMessages = [
        ...this.data.messages,
        { id: warnId, role: 'user', content: text },
        {
          id: warnId + 1,
          role: 'assistant',
          content: '本系统仅供学习研究，不提供诊断、处方、剂量或治疗建议。如有健康问题，请咨询专业中医师。',
          html: '<p style="margin:8rpx 0;color:#B94736;">本系统仅供学习研究，不提供诊断、处方、剂量或治疗建议。如有健康问题，请咨询专业中医师。</p>',
          provider: 'system',
          sources: [],
          hasSources: false,
        },
      ];
      this.setData({
        msgIdCounter: warnId + 1,
        messages: newMessages,
        inputValue: '',
        canSend: false,
        scrollToView: 'msg-' + (warnId + 1),
      });
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

    // 添加用户消息和占位 AI 消息
    this.setData({
      msgIdCounter: aiMsgId,
      messages: [
        ...this.data.messages,
        { id: userMsgId, role: 'user', content: text },
        { id: aiMsgId, role: 'assistant', content: '', html: '', provider: '', sources: [], hasSources: false },
      ],
      inputValue: '',
      canSend: false,
      loading: true,
      lastFailedQuestion: '',
      scrollToView: 'msg-' + aiMsgId,
    });
    this._persist();

    try {
      // 调用云函数，只传当前问题和会话 ID
      const result = await this._callCloudFunction(text, history);

      // 更新 AI 消息
      const messages = this.data.messages;
      const idx = messages.findIndex(m => m.id === aiMsgId);
      if (idx >= 0) {
        if (result.reply) {
          // 注入 knowledge_sources（用于"引用 N 条资料"提示）
          const sources = Array.isArray(result.knowledge_sources) && result.knowledge_sources.length > 0
            ? result.knowledge_sources.slice(0, 5).map(s => ({
                source_group: s.source_group || '',
                chunk_title: s.chunk_title || '',
                score: s.score || 0,
              }))
            : [];
          messages[idx] = {
            ...messages[idx],
            content: result.reply,
            html: formatContent(result.reply),
            provider: result.provider || 'cloudbase-hybrid',
            sources,
            hasSources: sources.length > 0,
          };
        } else if (result.error) {
          messages[idx] = {
            ...messages[idx],
            content: result.error,
            html: formatContent(result.error),
            provider: 'error',
            retryQuestion: text,
            sources: [],
            hasSources: false,
          };
        }
      }

      this.setData({
        messages,
        loading: false,
        scrollToView: 'msg-' + aiMsgId,
      });
      this._persist();
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
          sources: [],
          hasSources: false,
        };
      }

      this.setData({
        messages,
        loading: false,
        lastFailedQuestion: text,
        scrollToView: 'msg-' + aiMsgId,
      });
      this._persist();
    }
  },

  // 持久化当前会话
  _persist() {
    if (!this.data.sessionId) return;
    saveMessages(this.data.sessionId, this.data.messages);
    updateSessionMeta(this.data.sessionId, this.data.messages);
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
      title: '新对话',
      content: '确定开始新的学习对话吗？当前对话将保存到历史记录。',
      confirmText: '开始新对话',
      success: (res) => {
        if (res.confirm) {
          // 保存旧会话（已经保存过了，这里只清理页面状态）
          this.setData({
            messages: [],
            msgIdCounter: 0,
            inputValue: '',
            canSend: false,
            lastFailedQuestion: '',
            sessionId: 'mp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
            scrollToView: '',
          });
        }
      },
    });
  },

  // 展示引用来源详情
  onShowSources(e) {
    const sources = e.currentTarget.dataset.sources;
    if (!sources || !sources.length) return;

    const lines = sources.slice(0, 5).map((s, i) => {
      const group = s.source_group || '未知来源';
      const title = s.chunk_title ? ` · ${s.chunk_title}` : '';
      const score = s.score ? `（相关度 ${s.score}）` : '';
      return `${i + 1}. ${group}${title} ${score}`;
    });

    wx.showModal({
      title: '引用资料',
      content: lines.join('\n'),
      showCancel: false,
      confirmText: '知道了',
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

  // 返回主页
  onBackHome() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.reLaunch({ url: '/pages/index/index' });
      },
    });
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
      title: '经典中医学习问答',
      path: '/pages/index/index',
    };
  },
});
