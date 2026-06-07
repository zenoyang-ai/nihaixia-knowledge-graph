// 天纪提示词工具包视图模块
class PromptView {
    constructor(data) {
        this.data = data || [];
        this.filter = 'all';
        this.render();
    }

    render() {
        const container = document.getElementById('prompts-view');
        if (!container) return;

        container.innerHTML = `
            <div class="prompt-notice">
                <strong>天纪提示词</strong> —— 基于倪海厦天纪的天机道、人间道、地脉道框架，结合现代自我成长与行动规划视角的现代化转译。
                所有提示词仅供学习参考，不构成医疗、投资、婚姻等重大决策的唯一依据。"命境建构论"为本站现代化表达，不作为倪海厦原文训诂。
            </div>
            <div class="prompt-toolbar" id="prompt-toolbar">
                <button class="prompt-filter active" data-filter="all">全部</button>
                <button class="prompt-filter" data-filter="八字">八字</button>
                <button class="prompt-filter" data-filter="紫微斗数">紫微</button>
                <button class="prompt-filter" data-filter="易经">易经</button>
                <button class="prompt-filter" data-filter="小六壬">小六壬</button>
            </div>
            <div class="prompt-list" id="prompt-list">
                ${this.renderCards()}
            </div>
        `;

        this.bindEvents();
    }

    renderCards() {
        const cards = this.getFilteredCards();
        if (cards.length === 0) {
            return '<p class="prompt-empty">暂无匹配的提示词卡片。</p>';
        }
        return cards.map(card => this.renderCard(card)).join('');
    }

    getFilteredCards() {
        if (this.filter === 'all') return this.data;
        return this.data.filter(c => c.tags.some(t => t === this.filter));
    }

    renderCard(card) {
        const isSmallLiuren = card.id === 'xiaoliuren-daily';
        const templateKeys = Object.keys(card.inputTemplates || {});
        const defaultKey = templateKeys[0] || 'default';

        return `
            <div class="prompt-card" data-id="${card.id}">
                <div class="prompt-card-header">
                    <div class="prompt-card-title">${card.title}</div>
                    <div class="prompt-card-subtitle">${card.subtitle}</div>
                    <div class="prompt-card-tags">
                        ${card.tags.map(t => `<span class="prompt-badge">${t}</span>`).join('')}
                    </div>
                </div>
                <div class="prompt-card-body">
                    <div class="prompt-card-meta">
                        <div class="prompt-meta-item">
                            <span class="prompt-meta-label">适用场景</span>
                            <span class="prompt-meta-value">${card.scenario}</span>
                        </div>
                        <div class="prompt-meta-item">
                            <span class="prompt-meta-label">准备信息</span>
                            <span class="prompt-meta-value">${card.requiredInfo}</span>
                        </div>
                        <div class="prompt-meta-item">
                            <span class="prompt-meta-label">使用边界</span>
                            <span class="prompt-meta-value">${card.boundaries}</span>
                        </div>
                    </div>
                    <div class="prompt-tabs" data-card-id="${card.id}">
                        <button class="prompt-tab active" data-tab="simple">简版提示词</button>
                        <button class="prompt-tab" data-tab="full">完整版提示词</button>
                        <button class="prompt-tab" data-tab="template">输入模板</button>
                    </div>
                    <div class="prompt-content" data-card-id="${card.id}" data-tab="simple">
                        <pre>${this.escapeHtml(card.simplePrompt)}</pre>
                    </div>
                    <div class="prompt-content" data-card-id="${card.id}" data-tab="full" style="display:none">
                        <pre>${this.escapeHtml(card.fullPrompt)}</pre>
                    </div>
                    ${isSmallLiuren ? `
                        <div class="prompt-content" data-card-id="${card.id}" data-tab="template" style="display:none">
                            <div class="prompt-template-section">
                                <div class="prompt-template-label">模式 A：手动时间起课</div>
                                <pre>${this.escapeHtml(card.inputTemplates.manual || '')}</pre>
                                <button class="prompt-copy-btn" data-target="template-manual" data-card-id="${card.id}">复制</button>
                            </div>
                            <div class="prompt-template-section" style="margin-top:12px;">
                                <div class="prompt-template-label">模式 B：当前时间起课</div>
                                <pre>${this.escapeHtml(card.inputTemplates.auto || '')}</pre>
                                <button class="prompt-copy-btn" data-target="template-auto" data-card-id="${card.id}">复制</button>
                            </div>
                        </div>
                    ` : `
                        <div class="prompt-content" data-card-id="${card.id}" data-tab="template" style="display:none">
                            <pre>${this.escapeHtml(card.inputTemplates[defaultKey] || '')}</pre>
                        </div>
                    `}
                    <div class="prompt-copy-row">
                        <button class="prompt-copy-btn" data-target="active" data-card-id="${card.id}">复制当前内容</button>
                    </div>
                </div>
            </div>
        `;
    }

    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    bindEvents() {
        // Filter buttons
        const toolbar = document.getElementById('prompt-toolbar');
        if (toolbar) {
            toolbar.addEventListener('click', (e) => {
                const btn = e.target.closest('.prompt-filter');
                if (!btn) return;
                toolbar.querySelectorAll('.prompt-filter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.filter = btn.dataset.filter;
                const list = document.getElementById('prompt-list');
                if (list) list.innerHTML = this.renderCards();
                this.rebindCardEvents();
            });
        }

        this.rebindCardEvents();
    }

    rebindCardEvents() {
        // Tab switching
        document.querySelectorAll('.prompt-tabs').forEach(tabBar => {
            tabBar.addEventListener('click', (e) => {
                const tab = e.target.closest('.prompt-tab');
                if (!tab) return;
                const cardId = tabBar.dataset.cardId;
                tabBar.querySelectorAll('.prompt-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll(`.prompt-content[data-card-id="${cardId}"]`).forEach(c => c.style.display = 'none');
                const target = document.querySelector(`.prompt-content[data-card-id="${cardId}"][data-tab="${tab.dataset.tab}"]`);
                if (target) target.style.display = '';
            });
        });

        // Copy buttons
        document.querySelectorAll('.prompt-copy-btn').forEach(btn => {
            btn.addEventListener('click', () => this.handleCopy(btn));
        });
    }

    handleCopy(btn) {
        const cardId = btn.dataset.cardId;
        const target = btn.dataset.target;
        let text = '';

        if (target === 'template-auto' && cardId === 'xiaoliuren-daily') {
            // Auto time template: replace placeholders with actual values
            const card = this.data.find(c => c.id === cardId);
            if (card && card.inputTemplates.auto) {
                const now = new Date();
                const datetime = now.getFullYear() + '-' +
                    String(now.getMonth() + 1).padStart(2, '0') + '-' +
                    String(now.getDate()).padStart(2, '0') + ' ' +
                    String(now.getHours()).padStart(2, '0') + ':' +
                    String(now.getMinutes()).padStart(2, '0');
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时区未知';
                text = card.inputTemplates.auto
                    .replace(/\{\{DATETIME\}\}/g, datetime)
                    .replace(/\{\{TIMEZONE\}\}/g, timezone);
            }
        } else if (target === 'template-manual') {
            const card = this.data.find(c => c.id === cardId);
            if (card) text = card.inputTemplates.manual || '';
        } else {
            // Copy active tab content
            const activeTab = document.querySelector(`.prompt-tabs[data-card-id="${cardId}"] .prompt-tab.active`);
            if (activeTab) {
                const tabName = activeTab.dataset.tab;
                const content = document.querySelector(`.prompt-content[data-card-id="${cardId}"][data-tab="${tabName}"] pre`);
                if (content) text = content.textContent;
            }
        }

        if (!text) return;

        this.copyToClipboard(text).then(() => {
            const originalText = btn.textContent;
            btn.textContent = '已复制 ✓';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('copied');
            }, 1500);
        }).catch(() => {
            const originalText = btn.textContent;
            btn.textContent = '复制失败，请手动选中';
            btn.classList.add('copy-failed');
            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('copy-failed');
            }, 2000);
        });
    }

    copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        // Fallback: textarea + execCommand
        return new Promise((resolve, reject) => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                const ok = document.execCommand('copy');
                document.body.removeChild(textarea);
                ok ? resolve() : reject(new Error('execCommand failed'));
            } catch (e) {
                document.body.removeChild(textarea);
                reject(e);
            }
        });
    }
}

window.PromptView = PromptView;
