// pages/index/index.js
Page({
  data: {
    recentSessions: [],
    totalSessions: 0,
  },

  onShow() {
    this.loadRecentSessions();
  },

  // 加载最近的对话记录
  loadRecentSessions() {
    let sessions = [];
    try {
      sessions = wx.getStorageSync('chat_sessions') || [];
    } catch (e) {
      wx.showToast({ title: '读取本地记录失败', icon: 'none' });
      sessions = [];
    }
    const recent = sessions
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 3);
    this.setData({
      recentSessions: recent,
      totalSessions: sessions.length,
    });
  },

  // 开始新对话
  onStartChat() {
    wx.navigateTo({
      url: '/pages/chat/chat?mode=new',
    });
  },

  // 继续某个历史对话
  onContinueSession(e) {
    const sessionId = e.currentTarget.dataset.sessionId;
    if (!sessionId) return;
    wx.navigateTo({
      url: '/pages/chat/chat?sessionId=' + sessionId,
    });
  },

  // 查看全部历史记录
  onViewAllHistory() {
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
