// 倪海厦知识图谱 — 用户意见与反馈 Modal（POST 云函数 → 飞书，失败时 localStorage 兜底）
(function() {
    const FEEDBACK_URL = 'https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-feedback';
    const RATE_LIMIT_MS = 60000;
    const STORAGE_KEY = 'nihaixia_user_feedbacks';
    const RATE_KEY = 'nihaixia_feedback_last_submit';

    let overlay = null;
    let selectedType = '功能建议';
    let previouslyFocused = null;

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
                        <p class="feedback-subtitle">发现 Bug、想要的新节点/功能、看不顺眼的地方——都可以告诉我。点击「发送反馈」后会送达站长飞书；若网络失败，会尝试保存在本机浏览器。</p>
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
                            <button type="submit" class="feedback-submit-btn" id="feedback-submit-btn">发送反馈</button>
                        </div>
                    </form>

                    <div class="feedback-success-state" id="feedback-success-state" style="display:none;text-align:center;">
                        <div class="feedback-success-icon">✓</div>
                        <h3 class="oriental-serif" style="margin-bottom:8px;">已送达飞书</h3>
                        <p style="font-size:13px;color:var(--text-light);line-height:1.6;margin-bottom:12px;">
                            反馈已送达站长飞书，感谢你的意见。
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

    function getRateLimitRemainingMs() {
        const last = Number(localStorage.getItem(RATE_KEY) || 0);
        const elapsed = Date.now() - last;
        return elapsed >= RATE_LIMIT_MS ? 0 : RATE_LIMIT_MS - elapsed;
    }

    function saveToLocal(payload) {
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        if (!Array.isArray(existing)) throw new Error('存储格式异常');
        existing.push(payload);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
        return true;
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

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const content = textarea.value.trim();
            const contact = overlay.querySelector('#feedback-contact-input').value.trim();
            if (!content) return;

            const remaining = getRateLimitRemainingMs();
            if (remaining > 0) {
                const secs = Math.ceil(remaining / 1000);
                window.alert(`发送过于频繁，请 ${secs} 秒后再试。`);
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = '发送中...';

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

            let apiSuccess = false;
            let apiError = '';

            try {
                const res = await fetch(FEEDBACK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        category: payload.category,
                        content: payload.content,
                        contact: payload.contact,
                        page: payload.page,
                        time: payload.time,
                        userAgent: payload.userAgent,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.ok) {
                    apiSuccess = true;
                    localStorage.setItem(RATE_KEY, String(Date.now()));
                } else {
                    apiError = data.error || data.detail || `HTTP ${res.status}`;
                }
            } catch (err) {
                apiError = (err && err.message) || '网络错误';
            }

            if (apiSuccess) {
                try { saveToLocal(payload); } catch (e) { /* 云端已成功，本地备份失败可忽略 */ }
                form.style.display = 'none';
                successState.style.display = 'block';
                successState.querySelector('h3').textContent = '已送达飞书';
                const p = successState.querySelector('p');
                if (p) {
                    p.textContent = '反馈已送达站长飞书，感谢你的意见。';
                }
            } else {
                let savedLocally = false;
                let localError = '';
                try {
                    saveToLocal(payload);
                    savedLocally = true;
                } catch (err) {
                    localError = (err && err.message) || '本地存储失败';
                }

                if (savedLocally) {
                    form.style.display = 'none';
                    successState.style.display = 'block';
                    successState.querySelector('h3').textContent = '未能送达飞书，已保存本机';
                    const p = successState.querySelector('p');
                    if (p) {
                        p.innerHTML = `飞书发送失败（${apiError || '未知错误'}）。反馈已写入浏览器本地存储作为备份，站长可在控制台执行 <code>getFeedbacks()</code> 查阅。也可到公众号<strong>「数字问渡」</strong>留言。`;
                    }
                } else {
                    window.alert(
                        '反馈未能送达飞书：' + (apiError || '未知错误')
                        + '\n\n本地保存也失败：' + localError
                        + '\n\n请改用公众号「数字问渡」后台留言。'
                    );
                }
            }

            submitBtn.disabled = false;
            submitBtn.textContent = '发送反馈';
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
