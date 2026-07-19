// pages/history/history.js
Page({
  data: {
    sessions: [],
    isEmpty: true,
  },

  onShow() {
    this.loadSessions();
  },

  loadSessions() {
    const sessions = wx.getStorageSync('chat_sessions') || [];
    // 按更新时间倒序
    const sorted = sessions
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    this.setData({
      sessions: sorted,
      isEmpty: sorted.length === 0,
    });
  },

  // 继续某个对话
  onContinueSession(e) {
    const sessionId = e.currentTarget.dataset.sessionId;
    if (!sessionId) return;
    wx.navigateTo({
      url: '/pages/chat/chat?sessionId=' + sessionId,
    });
  },

  // 删除某个对话
  onDeleteSession(e) {
    const sessionId = e.currentTarget.dataset.sessionId;
    if (!sessionId) return;

    wx.showModal({
      title: '删除对话',
      content: '确定删除这条对话记录吗？删除后不可恢复。',
      confirmText: '删除',
      confirmColor: '#B94736',
      success: (res) => {
        if (!res.confirm) return;
        const sessions = wx.getStorageSync('chat_sessions') || [];
        const filtered = sessions.filter(s => s.sessionId !== sessionId);
        wx.setStorageSync('chat_sessions', filtered);
        // 同时清理该会话的消息存储
        try {
          wx.removeStorageSync('chat_messages_' + sessionId);
        } catch (e) {}
        this.loadSessions();
        wx.showToast({
          title: '已删除',
          icon: 'success',
          duration: 1500,
        });
      },
    });
  },

  // 清空所有对话
  onClearAll() {
    if (this.data.sessions.length === 0) return;
    wx.showModal({
      title: '清空所有对话',
      content: '确定清空全部对话记录吗？此操作不可恢复。',
      confirmText: '清空',
      confirmColor: '#B94736',
      success: (res) => {
        if (!res.confirm) return;
        const sessions = wx.getStorageSync('chat_sessions') || [];
        // 清理每个会话的消息存储
        sessions.forEach(s => {
          try {
            wx.removeStorageSync('chat_messages_' + s.sessionId);
          } catch (e) {}
        });
        wx.removeStorageSync('chat_sessions');
        this.loadSessions();
        wx.showToast({
          title: '已清空',
          icon: 'success',
          duration: 1500,
        });
      },
    });
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

  // 分享
  onShareAppMessage() {
    return {
      title: '经典中医学习问答',
      path: '/pages/index/index',
    };
  },
});
