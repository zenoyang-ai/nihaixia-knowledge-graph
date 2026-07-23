/* ============================================
   主题切换 — 浅色 / 暖棕深色
   优先级：URL 参数 > localStorage > 系统偏好
   ============================================ */
(function () {
    'use strict';

    var STORAGE_KEY = 'nihaixia-theme';
    var THEMES = ['light', 'dark'];

    function isValid(t) { return THEMES.indexOf(t) !== -1; }

    /* ---- 1. 初始主题（页面渲染前执行，避免闪烁） ---- */
    function getInitialTheme() {
        try {
            var params = new URLSearchParams(window.location.search);
            var urlTheme = params.get('theme');
            if (isValid(urlTheme)) return urlTheme;
        } catch (e) {}

        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (isValid(saved)) return saved;
        } catch (e) {}

        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    }

    var theme = getInitialTheme();
    document.documentElement.setAttribute('data-theme', theme);

    /* ---- 2. 切换 ---- */
    function setTheme(next) {
        if (!isValid(next)) return;
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
        updateSwitchState(next);
        document.documentElement.dispatchEvent(new CustomEvent('nihaixia-theme-change', { detail: { theme: next } }));
    }

    /* ---- 3. 单图标切换按钮（浅色 ⇄ 暖棕，太阳/月亮） ---- */
    var ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">'
        + '<circle cx="12" cy="12" r="4"/>'
        + '<path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>'
        + '</svg>';
    var ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M20.6 14.5A8.5 8.5 0 0 1 9.5 3.4a8.5 8.5 0 1 0 11.1 11.1z"/>'
        + '</svg>';

    function currentTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function createSwitch() {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-toggle';
        btn.innerHTML = '<span class="theme-toggle-icon icon-sun">' + ICON_SUN + '</span>'
            + '<span class="theme-toggle-icon icon-moon">' + ICON_MOON + '</span>';
        btn.addEventListener('click', function () {
            setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
        });
        return btn;
    }

    function updateSwitchState(t) {
        var btn = document.querySelector('.theme-toggle');
        if (!btn) return;
        var label = t === 'dark' ? '切换到浅色阅读' : '切换到暖棕夜读';
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
        btn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
    }

    /* ---- 4. 挂载 ---- */
    function mount() {
        var headerContent = document.querySelector('.header-content');
        if (!headerContent) return;
        var sw = createSwitch();
        var searchBox = headerContent.querySelector('.header-search');
        if (searchBox && searchBox.nextSibling) {
            headerContent.insertBefore(sw, searchBox.nextSibling);
        } else {
            headerContent.appendChild(sw);
        }
        updateSwitchState(document.documentElement.getAttribute('data-theme') || 'light');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }

    window.__nihaixiaTheme = { set: setTheme };
})();
