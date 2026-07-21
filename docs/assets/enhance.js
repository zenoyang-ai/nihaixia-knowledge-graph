/* ============================================
   体验增强 — Hero 字符动画 + 朱砂印章
   （独立文件，不侵入原有模块）
   ============================================ */
(function () {
    'use strict';

    /* ---- 1. Hero 标题字符级淡入 ---- */
    var splitDone = false;

    function splitHeroTitle() {
        var title = document.querySelector('.hero-title');
        if (!title) return;

        // 已拆分过则重放动画（重新触发动画只需重建节点）
        var chars = [];
        collectChars(title, chars);
        chars.forEach(function (c, i) {
            c.style.setProperty('--ci', i);
        });
        splitDone = true;
    }

    function collectChars(root, out) {
        // 首次：把文本节点替换为 char span；再次调用时直接收集已有 span
        if (!splitDone) {
            var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
            var textNodes = [];
            while (walker.nextNode()) textNodes.push(walker.currentNode);
            textNodes.forEach(function (node) {
                var frag = document.createDocumentFragment();
                Array.from(node.textContent).forEach(function (ch) {
                    var span = document.createElement('span');
                    span.className = 'char';
                    span.textContent = ch;
                    frag.appendChild(span);
                });
                node.parentNode.replaceChild(frag, node);
            });
        }
        root.querySelectorAll('.char').forEach(function (span) { out.push(span); });
    }

    function replayHeroAnimation() {
        var title = document.querySelector('.hero-title');
        if (!title || !splitDone) { splitHeroTitle(); return; }
        // 重放：移除再强制回流后加回
        var chars = title.querySelectorAll('.char');
        chars.forEach(function (c) { c.style.animation = 'none'; });
        void title.offsetWidth;
        chars.forEach(function (c) { c.style.animation = ''; });
    }

    /* ---- 2. 朱砂印章 ---- */
    function mountSeal() {
        var hero = document.querySelector('.hero-new');
        if (!hero || hero.querySelector('.hero-seal')) return;
        var seal = document.createElement('div');
        seal.className = 'hero-seal';
        seal.setAttribute('aria-hidden', 'true');
        ['人', '纪', '天', '纪'].forEach(function (ch) {
            var span = document.createElement('span');
            span.textContent = ch;
            seal.appendChild(span);
        });
        hero.appendChild(seal);
    }

    /* ---- 3. 回到总览页时重放 ---- */
    function onRouteChange() {
        var hash = window.location.hash || '#/';
        if (hash === '#/' || hash === '#') {
            setTimeout(replayHeroAnimation, 30);
        }
    }

    function mount() {
        splitHeroTitle();
        mountSeal();
        window.addEventListener('hashchange', onRouteChange);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
