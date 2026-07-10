App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'zeno-d9g0gdvw4a57635c0',
        traceUser: true,
      });
    }
  },
  globalData: {
    userInfo: null,
  },
});
