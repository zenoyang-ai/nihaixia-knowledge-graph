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
    }

    /* ---- 3. 三态切换器（插入 header） ---- */
    var OPTIONS = [
        { value: 'light', label: '浅色' },
        { value: 'dark',  label: '暖棕' },
    ];

    function createSwitch() {
        var wrap = document.createElement('div');
        wrap.className = 'theme-switch';
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', '切换站点主题');
        OPTIONS.forEach(function (opt) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'theme-switch-btn';
            btn.dataset.themeValue = opt.value;
            btn.textContent = opt.label;
            btn.setAttribute('aria-label', '切换到' + opt.label + '主题');
            btn.addEventListener('click', function () { setTheme(opt.value); });
            wrap.appendChild(btn);
        });
        return wrap;
    }

    function updateSwitchState(t) {
        var btns = document.querySelectorAll('.theme-switch-btn');
        btns.forEach(function (btn) {
            var active = btn.dataset.themeValue === t;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
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
