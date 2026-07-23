App({
  onLaunch() {
    this.ensurePrivacyAuthorized().then((ok) => {
      if (!ok) {
        this.showPrivacyBlockedModal();
      }
    });

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
    privacyAuthorized: null,
  },

  ensurePrivacyAuthorized() {
    if (this.globalData.privacyAuthorized === true) {
      return Promise.resolve(true);
    }
    if (typeof wx.requirePrivacyAuthorize !== 'function') {
      this.globalData.privacyAuthorized = true;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      wx.requirePrivacyAuthorize({
        success: () => {
          this.globalData.privacyAuthorized = true;
          resolve(true);
        },
        fail: () => {
          this.globalData.privacyAuthorized = false;
          resolve(false);
        },
      });
    });
  },

  requestPrivacyAuth() {
    this.globalData.privacyAuthorized = null;
    return this.ensurePrivacyAuthorized();
  },

  showPrivacyBlockedModal(onSuccess) {
    wx.showModal({
      title: '需要同意隐私协议',
      content: '使用问答与本地记录功能前，需同意《用户隐私保护指引》。',
      confirmText: '重新授权',
      cancelText: '查看隐私协议',
      confirmColor: '#b9362c',
      success: (res) => {
        if (res.confirm) {
          this.requestPrivacyAuth().then((ok) => {
            if (ok) {
              wx.showToast({ title: '授权成功', icon: 'success' });
              if (typeof onSuccess === 'function') onSuccess();
            } else {
              this.showPrivacyBlockedModal(onSuccess);
            }
          });
        } else {
          wx.navigateTo({ url: '/pages/privacy/privacy' });
        }
      },
    });
  },

  guardPrivacy(onSuccess) {
    return this.ensurePrivacyAuthorized().then((ok) => {
      if (!ok) {
        this.showPrivacyBlockedModal(onSuccess);
        return false;
      }
      return true;
    });
  },
});
