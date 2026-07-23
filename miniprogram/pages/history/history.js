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
    let sessions = [];
    try {
      sessions = wx.getStorageSync('chat_sessions') || [];
      if (!Array.isArray(sessions)) sessions = [];
    } catch (e) {
      wx.showToast({ title: '读取历史失败', icon: 'none' });
      sessions = [];
    }
    const sorted = sessions
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    this.setData({
      sessions: sorted,
      isEmpty: sorted.length === 0,
    });
  },

  onContinueSession(e) {
    const sessionId = e.currentTarget.dataset.sessionId;
    if (!sessionId) return;
    wx.navigateTo({
      url: '/pages/chat/chat?sessionId=' + sessionId,
    });
  },

  onDeleteSession(e) {
    const sessionId = e.currentTarget.dataset.sessionId;
    if (!sessionId) return;

    wx.showModal({
      title: '删除对话',
      content: '确定删除这条对话记录吗？删除后不可恢复。',
      confirmText: '删除',
      confirmColor: '#b9362c',
      success: (res) => {
        if (!res.confirm) return;
        let ok = false;
        try {
          const sessions = wx.getStorageSync('chat_sessions') || [];
          const filtered = (Array.isArray(sessions) ? sessions : [])
            .filter((s) => s.sessionId !== sessionId);
          wx.setStorageSync('chat_sessions', filtered);
          try {
            wx.removeStorageSync('chat_messages_' + sessionId);
          } catch (e) {
            // 消息清理失败不阻断会话列表更新
          }
          ok = true;
        } catch (err) {
          ok = false;
        }

        this.loadSessions();
        wx.showToast({
          title: ok ? '已删除' : '删除失败，请重试',
          icon: ok ? 'success' : 'none',
          duration: 1800,
        });
      },
    });
  },

  onClearAll() {
    if (this.data.sessions.length === 0) return;
    wx.showModal({
      title: '清空所有对话',
      content: '确定清空全部对话记录吗？此操作不可恢复。',
      confirmText: '清空',
      confirmColor: '#b9362c',
      success: (res) => {
        if (!res.confirm) return;
        let ok = false;
        try {
          let sessions = [];
          try {
            sessions = wx.getStorageSync('chat_sessions') || [];
          } catch (e) {
            sessions = [];
          }
          (Array.isArray(sessions) ? sessions : []).forEach((s) => {
            try {
              wx.removeStorageSync('chat_messages_' + s.sessionId);
            } catch (e) {}
          });
          wx.removeStorageSync('chat_sessions');
          ok = true;
        } catch (err) {
          ok = false;
        }

        this.loadSessions();
        wx.showToast({
          title: ok ? '已清空' : '清空失败，请重试',
          icon: ok ? 'success' : 'none',
          duration: 1800,
        });
      },
    });
  },

  onBackHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onShareAppMessage() {
    return {
      title: '倪师智慧学习问答',
      path: '/pages/index/index',
    };
  },
});
