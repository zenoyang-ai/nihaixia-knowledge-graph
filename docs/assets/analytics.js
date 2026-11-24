/**
 * 图谱网页轻量访问与出站点击埋点（国内站 / 海外站）
 * - 匿名 visitor id 存 localStorage
 * - 不阻塞主流程与外链跳转；失败静默忽略
 */
(function () {
  const ENDPOINT = 'https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-analytics';
  const VID_KEY = 'nhx_vid';

  function detectSite() {
    const host = (location.hostname || '').toLowerCase();
    if (host.includes('tcloudbaseapp.com') || host.includes('tcloudbase.com')
      || host === 'www.nihaixia-knowledge.xyz' || host === 'nihaixia-knowledge.xyz') return 'cn';
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

  function sendPayload(payload) {
    if (window.location.protocol === 'file:' || detectSite() === 'local') return;
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

  function sendPageview() {
    sendPayload({
      type: 'pageview',
      site: detectSite(),
      path: currentPath(),
      vid: getVid(),
      t: Date.now(),
    });
  }

  /**
   * 上报 GitHub 导流点击事件。
   * 使用 event_site 字段以兼容未升级前的 v0.1.1 云函数（旧版见无 site 会静默跳过而不误增 PV），
   * 云函数升级至 v0.2.0 后自动计入 githubClicks 并在飞书日报展示。
   */
  function sendGithubClick(source) {
    sendPayload({
      type: 'event',
      event: 'github_click',
      source: source || 'other',
      event_site: detectSite(),
      path: currentPath(),
      vid: getVid(),
      t: Date.now(),
    });
  }

  let lastPath = '';
  function trackIfChanged() {
    const path = currentPath();
    if (path === lastPath) return;
    lastPath = path;
    sendPageview();
  }

  document.addEventListener('click', (e) => {
    const target = e.target && e.target.closest
      ? e.target.closest('#header-github-btn, .prompt-skill-link, .note-source-link')
      : null;
    if (!target) return;
    let source = 'prompts';
    if (target.id === 'header-github-btn') source = 'header';
    else if (target.classList.contains('note-source-link')) source = 'note_source';
    sendGithubClick(source);
  }, { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackIfChanged);
  } else {
    trackIfChanged();
  }
  window.addEventListener('hashchange', trackIfChanged);
})();
