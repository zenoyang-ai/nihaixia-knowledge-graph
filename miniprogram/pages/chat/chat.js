// pages/chat/chat.js

// ===========================================================================
// 倪海厦知识库 system prompt
// ===========================================================================
const NHS_SYSTEM_PROMPT = `你是「倪海厦知识库学习助手」，基于倪海厦（1954-2012，经方派中医大家）的学术体系回答问题。

倪海厦学术体系概述：
倪海厦致力于中医经典的教学与传承，强调回归汉代经方医学，以《伤寒论》和《金匮要略》为核心，结合《黄帝内经》《神农本草经》《针灸大成》等经典，构建了完整的中医教学体系。

核心知识体系：

一、人纪（中医经典教学）
倪海厦将人纪分为五部经典的教学，学习顺序为：针灸大成 → 神农本草经 → 黄帝内经 → 伤寒论 → 金匮要略。

1. 针灸大成：倪海厦强调经络辨证，注重十二正经与奇经八脉的关系。核心包括：十四经络循行路线、特定穴（五输穴、原穴、络穴、郄穴、背俞穴、募穴）、针刺手法（补法泻法）、灸法运用（直接灸、隔姜灸、隔盐灸等）。强调"宁失其穴，勿失其经"的取穴原则。

2. 神农本草经：将药物分为上品（养命应天，无毒，久服不伤人）、中品（养性以应人，无毒或有毒，斟酌其宜）、下品（治病应地，多毒，不可久服）。倪海厦强调药性四气（寒热温凉）、五味（酸苦甘辛咸）、归经理论。讲解常用药材如人参、黄芪、附子、干姜、桂枝、麻黄、大黄等的性味归经与功效。

3. 黄帝内经：倪海厦重点讲解阴阳五行学说、藏象理论（五脏六腑的生理功能与相互关系）、经络学说、病因病机（六淫：风寒暑湿燥火；七情：喜怒忧思悲恐惊）、诊法（望闻问切，尤重脉诊）、治则治法（正治反治、标本缓急）。

4. 伤寒论：这是倪海厦教学的核心。强调六经辨证体系：
   - 太阳病：脉浮，头项强痛而恶寒。主方桂枝汤（中风）、麻黄汤（伤寒）。
   - 阳明病：胃家实。主方白虎汤（经证）、承气汤（腑证）。
   - 少阳病：口苦咽干目眩。主方小柴胡汤。
   - 太阴病：腹满而吐，食不下，自利益甚。主方理中汤。
   - 少阴病：脉微细，但欲寐。主方四逆汤、真武汤。
   - 厥阴病：消渴，气上撞心，心中疼热，饥而不欲食。主方乌梅丸。
   倪海厦强调"方证对应"，即根据具体的证候表现选用对应的经方，原方原量，不随意加减。

5. 金匮要略：讲解杂病证治，包括五脏风寒积聚、痰饮咳嗽、消渴、水气、黄疸、惊悸吐衄、呕吐哕下利、疮痈肠痈浸淫等病证的辨证与治疗方剂。

二、天纪（玄学体系）
天纪包括：天机道（紫微斗数，研究命盘十二宫与星曜组合）、人间道（易经卦象推断人事吉凶）、地脉道（阳宅风水，研究居住环境对人的影响）。强调天、地、人三才合一的宇宙观。

三、经方方剂
倪海厦推崇汉代张仲景的经方，强调原方原量使用。常用方剂包括：
- 桂枝汤：调和营卫，主治太阳中风证
- 麻黄汤：发汗解表，主治太阳伤寒证
- 小柴胡汤：和解少阳，主治少阳病
- 白虎汤：清热生津，主治阳明经证
- 大承气汤：峻下热结，主治阳明腑实证
- 理中汤：温中散寒，主治太阴病
- 四逆汤：回阳救逆，主治少阴病
- 真武汤：温阳利水，主治少阴病水气内停
- 乌梅丸：温脏安蛔，主治厥阴病
- 肾气丸：温补肾阳
-炙甘草汤：滋阴养血，益气温阳，治疗脉结代

四、诊断方法
倪海厦强调整体观念与辨证论治，诊断注重：
- 望诊：望神、望色、望形态、望舌
- 闻诊：听声音、嗅气味
- 问诊：十问歌（一问寒热二问汗，三问头身四问便，五问饮食六胸腹，七聋八渴俱当辨，九问旧病十问因）
- 切诊：三部九候脉法，强调寸关尺与脏腑对应关系

五、学习理念
倪海厦强调中医学习应从经典入手，先针灸后方药，先伤寒后金匮。反对脱离经典的"经验方"思路，主张回归经方原意。

回答要求：
- 仅回答与倪海厦学术体系相关的问题
- 保持学术严谨，引用经典原文
- 不提供具体医疗诊断、处方或用药建议
- 遇到超出知识范围的问题，如实告知
- 用中文回答，排版清晰`;

// ===========================================================================
// 医疗可执行请求检测
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
  // code blocks inline
  s = s.replace(/`([^`]+)`/g, '<code style="background:#f6f0e6;padding:2rpx 8rpx;border-radius:4rpx;font-size:26rpx;">$1</code>');
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic
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

    // 标题
    let h = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      if (inList) { html.push('</' + listType + '>'); inList = false; }
      html.push('<div style="font-weight:700;font-size:32rpx;margin:16rpx 0 8rpx;color:#7f211c;border-bottom:1rpx solid #e7d8c1;padding-bottom:6rpx;">' + formatInline(h[2]) + '</div>');
      continue;
    }

    // 有序列表
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

    // 无序列表
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

    // 构建对话历史（用于 API 调用）
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

    // 构建完整消息数组（含 system prompt）
    const apiMessages = [
      { role: 'system', content: NHS_SYSTEM_PROMPT },
      ...history,
    ];

    let replyText = '';
    let provider = 'cloudbase';
    let usedFallback = false;

    // 尝试流式调用
    try {
      if (wx.cloud && wx.cloud.extend && wx.cloud.extend.AI) {
        replyText = await this._streamChat(apiMessages, aiMsgId);
      } else {
        throw new Error('wx.cloud.extend.AI 不可用');
      }
    } catch (err) {
      console.warn('流式调用失败，切换到云函数:', err.message);
      usedFallback = true;
      provider = 'cloudfunction';
      replyText = await this._callCloudFunction(apiMessages);
    }

    // 转换 Markdown 为 HTML 并更新
    const messages = this.data.messages;
    const idx = messages.findIndex(m => m.id === aiMsgId);
    if (idx >= 0) {
      messages[idx] = {
        ...messages[idx],
        content: replyText,
        html: formatContent(replyText),
        provider: provider,
      };
    }

    this.setData({
      messages,
      loading: false,
      scrollToView: 'msg-' + aiMsgId,
    });
  },

  // 流式 AI 调用
  async _streamChat(apiMessages, aiMsgId) {
    const model = wx.cloud.extend.AI.createModel('cloudbase');
    const res = await model.streamText({
      data: {
        model: 'hy3-preview',
        messages: apiMessages,
      },
    });

    let fullText = '';

    for await (let event of res.eventStream) {
      if (event.data === '[DONE]') break;

      try {
        const data = JSON.parse(event.data);
        const delta = data && data.choices && data.choices[0] && data.choices[0].delta;
        const text = delta && delta.content;
        if (text) {
          fullText += text;
          // 实时更新（节流：每 3 个 chunk 更新一次 UI）
          if (fullText.length % 12 < 4) {
            this._updateStreamingMessage(aiMsgId, fullText);
          }
        }
      } catch (e) {
        // 忽略解析错误的 chunk
      }
    }

    // 最终更新
    this._updateStreamingMessage(aiMsgId, fullText);

    if (!fullText.trim()) {
      throw new Error('AI 返回为空');
    }

    return fullText.trim();
  },

  // 更新流式消息（实时显示）
  _updateStreamingMessage(aiMsgId, text) {
    const messages = this.data.messages;
    const idx = messages.findIndex(m => m.id === aiMsgId);
    if (idx >= 0) {
      messages[idx] = {
        ...messages[idx],
        content: text,
      };
      this.setData({
        messages,
        scrollToView: 'chat-bottom',
      });
    }
  },

  // 云函数兜底
  _callCloudFunction(apiMessages) {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'nihaixia-qa-mp',
        data: {
          messages: apiMessages,
        },
        success: (res) => {
          if (res && res.result && res.result.reply) {
            resolve(res.result.reply);
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
      title: '倪海厦知识库智能问答',
      path: '/pages/chat/chat',
    };
  },
});
