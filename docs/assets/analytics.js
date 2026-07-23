/**
 * 图谱网页轻量访问埋点（国内站 / 海外站）
 * - 匿名 visitor id 存 localStorage
 * - 不阻塞主流程；失败静默忽略
 */
(function () {
  const ENDPOINT = 'https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-analytics';
  const VID_KEY = 'nhx_vid';

  function detectSite() {
    const host = (location.hostname || '').toLowerCase();
    if (host.includes('tcloudbaseapp.com') || host.includes('tcloudbase.com')) return 'cn';
    if (host.includes('github.io')) return 'overseas';
    if (host === 'localhost' || host === '127.0.0.1') return 'local';
    return 'cn';
  }

  function getVid() {
    try {
      let vid = localStorage.getItem(VID_KEY);
      if (vid && vid.length >= 12) return vid;
      vid = (crypto.randomUUID && crypto.randomUUID())
        || (`v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
      localStorage.setItem(VID_KEY, vid);
      return vid;
    } catch (_) {
      return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function currentPath() {
    const hash = location.hash || '#/';
    return hash.startsWith('#') ? hash.slice(1) || '/' : hash;
  }

  function sendPageview() {
    const payload = {
      type: 'pageview',
      site: detectSite(),
      path: currentPath(),
      vid: getVid(),
      t: Date.now(),
    };
    const body = JSON.stringify(payload);
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      mode: 'cors',
      keepalive: true,
    }).catch(() => {
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(ENDPOINT, body);
        }
      } catch (_) {
        // ignore
      }
    });
  }

  let lastPath = '';
  function trackIfChanged() {
    const path = currentPath();
    if (path === lastPath) return;
    lastPath = path;
    sendPageview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackIfChanged);
  } else {
    trackIfChanged();
  }
  window.addEventListener('hashchange', trackIfChanged);
})();
