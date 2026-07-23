// 倪海厦知识图谱 — 用户意见与反馈 Modal（本地真实保存，不假报云端成功）
(function() {
    let overlay = null;
    let selectedType = '功能建议';
    let previouslyFocused = null;
    const STORAGE_KEY = 'nihaixia_user_feedbacks';

    function initFeedbackModal() {
        overlay = document.getElementById('feedback-modal-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'feedback-modal-overlay';
            overlay.className = 'feedback-modal-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'feedback-title');
            overlay.innerHTML = `
                <div class="feedback-modal-card" tabindex="-1">
                    <button class="feedback-close-btn" id="feedback-close-btn" aria-label="关闭" type="button">&times;</button>
                    <div class="feedback-header">
                        <div class="feedback-eyebrow">FEEDBACK</div>
                        <h2 class="feedback-title oriental-serif" id="feedback-title">说说你的想法</h2>
                        <p class="feedback-subtitle">发现 Bug、想要的新节点/功能、看不顺眼的地方——都可以告诉我。当前反馈会保存在本机浏览器，站长可用控制台查阅；也可在公众号「数字问渡」留言。</p>
                    </div>

                    <form id="feedback-form" onsubmit="return false;">
                        <div class="feedback-type-group">
                            <label class="feedback-label">反馈类型</label>
                            <div class="feedback-tags" role="group" aria-label="反馈类型">
                                <button type="button" class="feedback-tag active" data-type="功能建议">功能建议</button>
                                <button type="button" class="feedback-tag" data-type="Bug 报错">Bug 报错</button>
                                <button type="button" class="feedback-tag" data-type="知识点补充">知识补充</button>
                                <button type="button" class="feedback-tag" data-type="其他">其他</button>
                            </div>
                        </div>

                        <div class="feedback-field">
                            <label class="feedback-label" for="feedback-content-input">想说点什么？ <span class="required">*</span></label>
                            <textarea
                                id="feedback-content-input"
                                class="feedback-textarea"
                                rows="4"
                                maxlength="2000"
                                placeholder="比如：希望在图谱里增加更多神农本草经的药性辨析..."
                                required></textarea>
                            <div class="feedback-char-count"><span id="feedback-char-num">0</span> / 2000</div>
                        </div>

                        <div class="feedback-field">
                            <label class="feedback-label" for="feedback-contact-input">联系方式（选填）</label>
                            <input
                                type="text"
                                id="feedback-contact-input"
                                class="feedback-input"
                                placeholder="留下邮箱或微信号，方便回信" />
                        </div>

                        <div class="feedback-actions">
                            <button type="submit" class="feedback-submit-btn" id="feedback-submit-btn">保存反馈</button>
                        </div>
                    </form>

                    <div class="feedback-success-state" id="feedback-success-state" style="display:none;text-align:center;">
                        <div class="feedback-success-icon">✓</div>
                        <h3 class="oriental-serif" style="margin-bottom:8px;">已保存在本机</h3>
                        <p style="font-size:13px;color:var(--text-light);line-height:1.6;margin-bottom:12px;">
                            反馈已写入浏览器本地存储（非云端实时入库）。如需直接联系站长，请到微信公众号<strong>「数字问渡」</strong>后台留言。
                        </p>
                        <button type="button" class="feedback-btn-secondary" id="feedback-done-btn">完成</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        }

        bindEvents();
    }

    function lockBodyScroll(lock) {
        document.documentElement.style.overflow = lock ? 'hidden' : '';
        document.body.style.overflow = lock ? 'hidden' : '';
    }

    function onKeydown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            toggleFeedbackModal(false);
            return;
        }
        if (e.key !== 'Tab' || !overlay || !overlay.classList.contains('active')) return;
        const focusables = overlay.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
        const list = Array.from(focusables).filter((el) => !el.disabled && el.offsetParent !== null);
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    function bindEvents() {
        if (!overlay || overlay.dataset.bound === '1') return;
        overlay.dataset.bound = '1';

        overlay.querySelector('#feedback-close-btn').addEventListener('click', () => toggleFeedbackModal(false));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) toggleFeedbackModal(false);
        });

        const tags = overlay.querySelectorAll('.feedback-tag');
        tags.forEach(tag => {
            tag.addEventListener('click', () => {
                tags.forEach(t => t.classList.remove('active'));
                tag.classList.add('active');
                selectedType = tag.dataset.type;
            });
        });

        const textarea = overlay.querySelector('#feedback-content-input');
        const charNum = overlay.querySelector('#feedback-char-num');
        textarea.addEventListener('input', () => {
            charNum.textContent = textarea.value.length;
        });

        const form = overlay.querySelector('#feedback-form');
        const submitBtn = overlay.querySelector('#feedback-submit-btn');
        const successState = overlay.querySelector('#feedback-success-state');

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const content = textarea.value.trim();
            const contact = overlay.querySelector('#feedback-contact-input').value.trim();
            if (!content) return;

            submitBtn.disabled = true;
            submitBtn.textContent = '保存中...';

            const payload = {
                type: 'feedback',
                category: selectedType,
                content,
                contact,
                page: location.href,
                userAgent: navigator.userAgent.slice(0, 180),
                time: new Date().toISOString(),
                timeLocal: new Date().toLocaleString(),
            };

            let saved = false;
            let errorMsg = '';
            try {
                const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
                if (!Array.isArray(existing)) throw new Error('存储格式异常');
                existing.push(payload);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
                saved = true;
            } catch (err) {
                errorMsg = (err && err.message) || '本地存储失败（可能空间已满或无权限）';
            }

            if (saved) {
                form.style.display = 'none';
                successState.style.display = 'block';
                successState.querySelector('h3').textContent = '已保存在本机';
                const p = successState.querySelector('p');
                if (p) {
                    p.innerHTML = '反馈已写入浏览器本地存储（非云端实时入库）。站长可在控制台执行 <code>getFeedbacks()</code> 查阅。也可到公众号<strong>「数字问渡」</strong>留言。';
                }
            } else {
                submitBtn.disabled = false;
                submitBtn.textContent = '保存反馈';
                window.alert('反馈未能保存：' + errorMsg + '\n\n请改用公众号「数字问渡」后台留言。');
                return;
            }

            submitBtn.disabled = false;
            submitBtn.textContent = '保存反馈';
        });

        overlay.querySelector('#feedback-done-btn').addEventListener('click', () => {
            toggleFeedbackModal(false);
            setTimeout(() => {
                form.style.display = 'block';
                successState.style.display = 'none';
                textarea.value = '';
                charNum.textContent = '0';
            }, 200);
        });
    }

    window.getFeedbacks = function() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        } catch (e) { return []; }
    };

    window.exportFeedbacks = function() {
        const data = window.getFeedbacks();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'nihaixia-feedbacks.json';
        a.click();
        URL.revokeObjectURL(url);
        return data.length;
    };

    function toggleFeedbackModal(show) {
        if (!overlay) initFeedbackModal();
        if (show) {
            previouslyFocused = document.activeElement;
            overlay.classList.add('active');
            lockBodyScroll(true);
            document.addEventListener('keydown', onKeydown);
            const card = overlay.querySelector('.feedback-modal-card');
            const focusTarget = overlay.querySelector('#feedback-content-input') || card;
            setTimeout(() => focusTarget && focusTarget.focus(), 30);
        } else {
            overlay.classList.remove('active');
            lockBodyScroll(false);
            document.removeEventListener('keydown', onKeydown);
            if (previouslyFocused && previouslyFocused.focus) {
                try { previouslyFocused.focus(); } catch (e) {}
            }
        }
    }

    window.toggleFeedbackModal = toggleFeedbackModal;
    document.addEventListener('DOMContentLoaded', initFeedbackModal);
})();
