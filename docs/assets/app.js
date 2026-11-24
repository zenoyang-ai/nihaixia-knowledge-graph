// 主入口 — 初始化所有模块
const ASSET_VERSION = document.querySelector('meta[name="asset-version"]')?.content || '20260723-v18';
const HUB_ROUTE_STORAGE = 'nihaixia_last_hub_route_v1';
const HUB_ROUTE_LABELS = {
    '/': '← 返回总览',
    '/path': '← 返回人纪路径',
    '/path/renji': '← 返回人纪路径',
    '/path/tianji': '← 返回天纪路径',
    '/graph': '← 返回图谱',
    '/prompts': '← 返回天纪提示词',
    '/qa': '← 返回 AI 问答',
};

window.updateNihaixiaHubRoute = function (hubPath) {
    if (!hubPath || !HUB_ROUTE_LABELS[hubPath]) return;
    window.__nhxLastHubRoute = hubPath;
    try { sessionStorage.setItem(HUB_ROUTE_STORAGE, hubPath); } catch (_) {}
};

window.getNihaixiaReturnRoute = function () {
    let hub = window.__nhxLastHubRoute;
    if (!hub) {
        try { hub = sessionStorage.getItem(HUB_ROUTE_STORAGE); } catch (_) {}
    }
    if (!hub || !HUB_ROUTE_LABELS[hub]) hub = '/graph';
    return {
        href: `#${hub === '/path/renji' ? '/path' : hub}`,
        label: HUB_ROUTE_LABELS[hub],
    };
};

class NihaixiaApp {
    constructor() {
        this.data = null;
        this.init();
    }

    parseHashParts(rawHash) {
        const clean = (rawHash || window.location.hash || '#/').replace(/^#/, '');
        const qIdx = clean.indexOf('?');
        const path = (qIdx >= 0 ? clean.slice(0, qIdx) : clean) || '/';
        const query = qIdx >= 0 ? clean.slice(qIdx + 1) : '';
        return { path, query };
    }

    applyQaPrefill(queryStr) {
        if (!queryStr) return;
        let q = '';
        try {
            q = (new URLSearchParams(queryStr).get('q') || '').trim();
        } catch (_) {
            return;
        }
        if (!q) return;
        window.__nhxPendingQaPrompt = q;
        const inputEl = document.getElementById('qa-chat-input');
        const statusEl = document.getElementById('qa-chat-status');
        if (inputEl) {
            inputEl.value = q;
            inputEl.dispatchEvent(new Event('input'));
            requestAnimationFrame(() => {
                inputEl.focus();
                try {
                    const len = inputEl.value.length;
                    inputEl.setSelectionRange(len, len);
                } catch (_) {}
            });
            window.__nhxPendingQaPrompt = '';
        }
        if (statusEl) {
            statusEl.textContent = '已填入预设问题，按回车或点击右侧发送即可提问';
            statusEl.style.color = '';
        }
        const hintEl = document.getElementById('qa-chat-hint');
        if (hintEl) hintEl.hidden = true;
        try {
            history.replaceState(null, '', '#/qa');
        } catch (_) {}
    }

    loadOfflineData() {
        if (window.__NIHAIXIA_OFFLINE_DATA__) {
            return Promise.resolve(window.__NIHAIXIA_OFFLINE_DATA__);
        }
        if (this._offlineDataPromise) {
            return this._offlineDataPromise;
        }
        this._offlineDataPromise = new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = `data/offline-data.js?v=${ASSET_VERSION}`;
            script.async = true;
            script.onload = () => resolve(window.__NIHAIXIA_OFFLINE_DATA__ || null);
            script.onerror = () => resolve(null);
            document.head.appendChild(script);
        });
        return this._offlineDataPromise;
    }

    async init() {
        // 1. 先注册路由（必须最先执行，否则导航完全失效）
        try {
            this.setupRoutes();
        } catch(e) {
            console.error('Router setup error:', e);
        }

        // 2. 根据当前 hash 立即切换视图（不等数据加载）
        this.switchViewFromHash();

        // 3. 加载图谱数据（本地 file:// 直开按需加载 offline-data.js，线上走 fetch 不增加带宽）
        const isFileProtocol = window.location.protocol === 'file:';
        try {
            if (isFileProtocol) {
                const offline = await this.loadOfflineData();
                this.data = offline && offline.graph ? offline.graph : null;
            } else {
                const response = await fetch(`data/graph.json?v=${ASSET_VERSION}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                this.data = await response.json();
            }
        } catch (error) {
            const offline = await this.loadOfflineData();
            if (offline && offline.graph) {
                this.data = offline.graph;
            } else {
                console.error('加载图谱数据失败，部分功能不可用:', error);
                this.data = null;
            }
        }

        if (!this.data) {
            this._showRouteNotice('知识图谱数据加载失败，请刷新页面或通过本地服务重新打开');
        }

        // 4. 初始化各模块（每个独立 try-catch，一个失败不影响其他）
        if (this.data) {
            window.__nhxNodeTitles = new Set(
                [...(this.data.nodes || []), ...(this.data.articles || [])].map((n) => n && n.title).filter(Boolean)
            );
            window.__nhxTopicTitles = new Set(
                (this.data.articles || []).map((a) => a && a.title).filter(Boolean)
            );
            try { this.overview = new Overview(this.data); } catch(e) { console.error('Overview init error:', e); }
            try { this.sidebar = new Sidebar(this.data); } catch(e) { console.error('Sidebar init error:', e); }
            try { this.pathView = new PathView(this.data); } catch(e) { console.error('PathView init error:', e); }
            try { this.forceGraph = new ForceGraph(this.data); } catch(e) { console.error('ForceGraph init error:', e); }
            try { this.noteDetail = new NoteDetail(this.data); } catch(e) { console.error('NoteDetail init error:', e); }
            try { this.search = new Search(this.data); } catch(e) { console.error('Search init error:', e); }
        }

        // 5. 提示词工具包独立加载，不依赖 graph.json
        try {
            let promptData = null;
            if (isFileProtocol) {
                const offline = await this.loadOfflineData();
                promptData = offline && offline.prompts ? offline.prompts : null;
            } else {
                try {
                    const promptResponse = await fetch(`data/prompts.json?v=${ASSET_VERSION}`);
                    if (!promptResponse.ok) throw new Error(`HTTP ${promptResponse.status}`);
                    promptData = await promptResponse.json();
                } catch (_) {
                    const offline = await this.loadOfflineData();
                    promptData = offline && offline.prompts ? offline.prompts : null;
                }
            }
            if (!promptData) throw new Error('Empty prompts data');
            this.promptView = new PromptView(promptData);
        } catch(e) {
            console.error('PromptView init error:', e);
            // 显示兜底错误提示
            const el = document.getElementById('prompts-view');
            if (el) el.innerHTML = '<div class="prompt-notice prompt-error-notice">提示词数据加载失败，请刷新页面重试。</div>';
        }

        // 6. 再次根据 hash 切换（数据加载完成后，确保视图状态正确）
        this.switchViewFromHash();

        const { path: currentPath } = this.parseHashParts(window.location.hash);
        if (currentPath.startsWith('/note/') && this.noteDetail) {
            const title = decodeURIComponent(currentPath.slice('/note/'.length));
            this.noteDetail.render(title);
            if (this.sidebar) this.sidebar.setActive(title);
        }

        // 7. 监听路由变化更新导航
        window.addEventListener('hashchange', () => {
            this.switchViewFromHash();
        });
    }

    setupRoutes() {
        const router = window.AppRouter;

        // 路由处理器只做视图特有的逻辑，视图切换统一由 switchViewFromHash 处理
        router.on('/graph', () => {
            this._requestGraphRender();
        });
        router.on('/qa', () => {});
        router.on('/note/:title', (params) => {
            const title = decodeURIComponent(params.title);
            if (this.noteDetail) this.noteDetail.render(title);
            if (this.sidebar) this.sidebar.setActive(title);
        });

        router.start();
    }

    // 根据当前 hash 切换视图（比 switchView 多一步 hash 解析）
    switchViewFromHash() {
        const { path, query } = this.parseHashParts(window.location.hash);

        const knownStatic = ['/', '/path', '/path/renji', '/path/tianji', '/graph', '/prompts', '/qa'];
        const isNote = path.startsWith('/note/') && path.length > '/note/'.length;
        const isValid = knownStatic.includes(path) || isNote;

        if (!isValid) {
            history.replaceState(null, '', '#/');
            window.updateNihaixiaHubRoute('/');
            this._showRouteNotice('页面不存在，已返回总览');
            this.switchView('overview');
            this.updateNav();
            return;
        }

        if (!isNote && !(path === '/qa' && query)) {
            window.updateNihaixiaHubRoute(path);
        }

        // 解析路由到视图名
        let viewName = 'overview';
        if (path === '/') viewName = 'overview';
        else if (path === '/path' || path === '/path/renji' || path === '/path/tianji') viewName = 'path';
        else if (path === '/graph') viewName = 'graph';
        else if (path === '/prompts') viewName = 'prompts';
        else if (path === '/qa') viewName = 'qa';
        else if (isNote) viewName = 'note';

        this.switchView(viewName);
        if (viewName === 'path' && this.pathView) {
            this.pathView.setActiveTab(path === '/path/tianji' ? 'tianji' : 'renji');
        }
        if (viewName === 'qa' && query) {
            this.applyQaPrefill(query);
        }
        this.updateNav();
    }

    _showRouteNotice(message) {
        const main = document.getElementById('main-content');
        if (!main) return;
        let el = document.getElementById('route-notice');
        if (!el) {
            el = document.createElement('div');
            el.id = 'route-notice';
            el.className = 'route-notice';
            el.setAttribute('role', 'status');
            main.prepend(el);
        }
        el.textContent = message;
        el.hidden = false;
        clearTimeout(this._routeNoticeTimer);
        this._routeNoticeTimer = setTimeout(() => {
            if (el) el.hidden = true;
        }, 4000);
    }

    switchView(view) {
        // 隐藏所有视图（双保险：class + inline style）
        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.style.display = 'none';
        });

        // 同步主容器 QA 视口弹性布局标记
        const mainContentEl = document.getElementById('main-content');
        if (mainContentEl) {
            mainContentEl.classList.toggle('main--qa', view === 'qa');
        }

        // 显示目标视图
        const target = document.getElementById(`view-${view}`);
        if (target) {
            target.classList.add('active');
            target.style.display = 'block';
        }

        if (view === 'graph') {
            this._requestGraphRender();
        }

        // 普通路由切换回到页面顶部；图谱内部缩放/拖拽由 graph.js sessionStorage 自行保留
        if (view !== 'graph') {
            window.scrollTo(0, 0);
            const main = document.querySelector('.main');
            if (main) main.scrollTop = 0;
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
        } else {
            // 进入图谱时也复位页面级滚动，避免外层偏移；图内 transform 另存
            window.scrollTo(0, 0);
        }
    }

    _requestGraphRender() {
        if (!this.forceGraph) return;
        if (this._graphRenderScheduled) return;
        this._graphRenderScheduled = true;
        requestAnimationFrame(() => {
            this._graphRenderScheduled = false;
            const view = document.getElementById('view-graph');
            if (!view || !view.classList.contains('active')) return;
            if (this.forceGraph.svg) return;
            try {
                this.forceGraph.render();
            } catch (e) {
                console.error('Graph render error:', e);
                this.forceGraph.svg = null;
                if (this.forceGraph.container && !this.forceGraph.container.querySelector('.graph-fallback')) {
                    this.forceGraph.renderMissingEngineFallback([...this.data.nodes, ...this.data.articles]);
                }
            }
        });
    }

    updateNav() {
        const { path } = this.parseHashParts(window.location.hash);

        document.querySelectorAll('.nav-btn').forEach(btn => {
            const route = btn.dataset.route;
            if (route === '/') {
                btn.classList.toggle('active', path === '/');
            } else {
                btn.classList.toggle('active', path.startsWith(route));
            }
        });
    }

}

// 启动
document.addEventListener('DOMContentLoaded', () => {
    new NihaixiaApp();

    // ============================================
    // AI 问答 — CloudBase Hybrid RAG（站内知识库语料检索生成）
    // ============================================
    // 主线路：BM25 检索 knowledge-base.json + generateText() 生成
    // 备用线路：CloudBase Agent（ai.bot.sendMessage）
    // 资料不足时会明确说明，不使用无知识库依据的通用模型兜底
    const QA_ROUTER_URL = 'https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-qa-router';

    const messagesEl = document.getElementById('qa-chat-messages');
    const inputEl = document.getElementById('qa-chat-input');
    const sendBtn = document.getElementById('qa-chat-send');
    const statusEl = document.getElementById('qa-chat-status');
    const clearBtn = document.getElementById('qa-chat-clear');
    const retryBtn = document.getElementById('qa-chat-retry');
    const questionsSectionEl = document.getElementById('qa-questions');
    const questionsToggleBtn = document.getElementById('qa-questions-toggle');
    const hintEl = document.getElementById('qa-chat-hint');

    // ---- localStorage 会话管理 ----
    const LS_SESSION_KEY = 'nihaixia_qa_session';
    const LS_HISTORY_KEY = 'nihaixia_qa_history';
    const MAX_HISTORY_ROUNDS = 6;

    function getSessionId() {
        let sid = localStorage.getItem(LS_SESSION_KEY);
        if (!sid) {
            sid = 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
            localStorage.setItem(LS_SESSION_KEY, sid);
        }
        return sid;
    }

    function getHistory() {
        try {
            const raw = localStorage.getItem(LS_HISTORY_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(parsed)) return [];

            // 兼容旧版在请求失败时留下的孤立 user 消息，避免下一次请求角色不交替。
            const valid = [];
            for (const item of parsed) {
                if (!item || !['user', 'assistant'].includes(item.role)) continue;
                if (typeof item.content !== 'string' || !item.content.trim()) continue;
                if (valid.length && valid[valid.length - 1].role === item.role) {
                    if (item.role === 'assistant') valid[valid.length - 1] = item;
                    continue;
                }
                valid.push({ role: item.role, content: item.content.trim() });
            }

            // 历史必须以完整的一轮结束，不能把未获得回答的 user 留在上下文里。
            if (valid.at(-1)?.role === 'user') valid.pop();
            if (valid[0]?.role === 'assistant') valid.shift();

            // 自愈清理：过滤旧版可能误存入历史的医疗拒答轮次，防止下一轮正常提问被连带拦截。
            const sanitized = [];
            const BLOCKED_ASSISTANT_RE = /(?:本系统仅供学习研究，不提供诊断|如遇紧急医疗情况，请立即拨打\s*120)/;
            for (let i = 0; i + 1 < valid.length; i += 2) {
                const u = valid[i];
                const a = valid[i + 1];
                if (u.role === 'user' && a.role === 'assistant' && !BLOCKED_ASSISTANT_RE.test(a.content)) {
                    sanitized.push(u, a);
                }
            }
            const trimmed = sanitized.slice(-MAX_HISTORY_ROUNDS * 2);
            if (trimmed.length % 2 === 1) trimmed.shift();
            return trimmed;
        } catch { return []; }
    }

    function saveHistory(messages) {
        // 只保留最近 MAX_HISTORY_ROUNDS 轮
        const trimmed = messages.slice(-MAX_HISTORY_ROUNDS * 2);
        localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(trimmed));
    }

    function setQuestionsCollapsed(collapsed) {
        if (!questionsSectionEl) return;
        questionsSectionEl.classList.toggle('is-collapsed', collapsed);
        if (questionsToggleBtn) {
            questionsToggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            const label = questionsToggleBtn.querySelector('.qa-questions-toggle-text');
            if (label) {
                label.textContent = collapsed ? '展开示例' : '收起示例';
            }
        }
    }

    if (questionsToggleBtn && questionsSectionEl) {
        questionsToggleBtn.addEventListener('click', () => {
            setQuestionsCollapsed(!questionsSectionEl.classList.contains('is-collapsed'));
        });
    }

    queueMicrotask(() => {
        if (messagesEl && messagesEl.querySelector('.qa-chat-message')) {
            setQuestionsCollapsed(true);
        }
    });

    function clearHistory() {
        localStorage.removeItem(LS_HISTORY_KEY);
        localStorage.removeItem(LS_SESSION_KEY);
        if (messagesEl) {
            messagesEl.innerHTML = `
                <div class="qa-chat-empty">
                    <p>从一个概念开始，逐步追问它与经典、方法和学习路径的关系。</p>
                    <p class="qa-chat-empty-hint">回答来自当前接入的知识库；资料不足时会明确说明。</p>
                <p class="qa-chat-empty-hint" style="margin-top:4px;">如遇到超时，可点击重新尝试按钮。</p>
                </div>`;
        }
        if (retryBtn) retryBtn.hidden = true;
        setQuestionsCollapsed(false);
        setStatus('对话已清空');
        setTimeout(clearStatus, 2000);
    }

    // ---- 状态与消息渲染 ----
    let isSending = false;
    let lastFailedMessage = '';

    function setStatus(text, isError = false) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.style.color = isError ? 'var(--accent)' : '';
        if (hintEl) hintEl.hidden = Boolean(text);
    }

    function clearStatus() {
        if (!statusEl) return;
        statusEl.textContent = '';
        statusEl.style.color = '';
        if (hintEl) hintEl.hidden = false;
    }

    function removeEmptyState() {
        const empty = messagesEl?.querySelector('.qa-chat-empty');
        if (empty) empty.remove();
    }

    function getProviderLabel(provider, degraded) {
        if (provider === 'cloudbase') {
            return degraded ? '学习资料库（备用线路·降级）' : '学习资料库（备用线路）';
        }
        if (provider === 'cloudbase-hybrid' || provider === 'hybrid') {
            return degraded ? '学习资料库（降级）' : '学习资料库';
        }
        if (provider === 'system') {
            return '系统安全提示';
        }
        return provider || '未知线路';
    }

    function escapeAttr(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    const SOURCE_GROUP_LABELS = {
        '01_知识卡片': '知识卡片',
        '02_主题文章': '深度专题',
        '03_经文原文-公开版': '经文原典',
        '04_经文原文-完整版': '经文原典',
        '05_医案资料': '临床医案',
        '06_补充资料': '体系总览',
        '07_天纪资料': '天纪资料',
        '08_补充课程': '公开讲座',
        '09_中医原始资料': '中医原典',
        '10_人纪资料': '人纪资料',
        '11_玄学体系': '天纪体系',
    };

    const CLASSIC_ROOTS = [
        '黄帝内经', '伤寒论', '金匮要略', '神农本草经', '针灸大成',
        '天机道', '地脉道', '人间道', '紫微斗数', '四柱命理', '风水堪舆', '易经',
    ];

    function humanizeSourceGroup(rawGroup) {
        const g = String(rawGroup || '').trim();
        if (!g) return '知识库资料';
        if (SOURCE_GROUP_LABELS[g]) return SOURCE_GROUP_LABELS[g];
        return g.replace(/^\d+_/, '').replace(/-(?:公开版|完整版)$/, '') || '知识库资料';
    }

    function normalizeKnowledgeSources(sources) {
        if (!Array.isArray(sources) || !sources.length) return [];
        const nodeTitles = window.__nhxNodeTitles instanceof Set ? window.__nhxNodeTitles : new Set();
        const topicTitles = window.__nhxTopicTitles instanceof Set ? window.__nhxTopicTitles : new Set();
        const grouped = new Map();

        sources.forEach((s) => {
            if (!s || typeof s !== 'object') return;
            const rawGroup = String(s.source_group || '').trim();
            let category = humanizeSourceGroup(rawGroup);
            const rawTitle = String(s.chunk_title || s.title || '').trim();
            const base = rawTitle ? rawTitle.split('/').pop() : '';
            let cleanTitle = base
                .replace(/\.(?:md|txt|pdf|docx|doc)$/i, '')
                .replace(/(?:[-_\s]*(?:ocr[-_]?sample|B5|终稿|个人整理|完整版|公开版))+$/ig, '')
                .trim();

            // 识别并收敛古籍分册（如 黄帝内经上/中/下册/注解 → 黄帝内经原典与注解），避免 09/03/04 跨目录重复铺屏
            let matchedClassic = '';
            let isClassicVolume = false;
            for (const classic of CLASSIC_ROOTS) {
                if (cleanTitle.startsWith(classic) && cleanTitle.length > classic.length) {
                    const tail = cleanTitle.slice(classic.length);
                    if (/^(?:上册|中册|下册|全册|注解|讲义|白话|原文|卷[一二三四五六七八九十\d]+)$/.test(tail)) {
                        matchedClassic = classic;
                        isClassicVolume = true;
                        break;
                    }
                    if (/^(?:体系|笔记)$/.test(tail)) {
                        matchedClassic = classic;
                        break;
                    }
                }
            }

            const isCardOrTopicGroup = rawGroup === '01_知识卡片' || rawGroup === '02_主题文章';
            if (!cleanTitle || /^(?:子文件|chunk[-_]?)\d+$/i.test(cleanTitle)) {
                cleanTitle = `${category}选篇`;
            } else if (isClassicVolume && !isCardOrTopicGroup) {
                cleanTitle = `${matchedClassic}原典与注解`;
                if (category === '中医原典') category = '经文原典';
            }

            // 解析站内深链（知识卡片 / 深度专题 / 学习路径）
            let href = '';
            let actionLabel = '';
            if (cleanTitle === '倪海厦天纪学习路径' || cleanTitle === '天纪学习路径') {
                href = '#/path/tianji';
                category = '学习路径';
                actionLabel = '查看路径';
            } else if (cleanTitle === '倪海厦人纪学习路径' || cleanTitle === '人纪学习路径') {
                href = '#/path';
                category = '学习路径';
                actionLabel = '查看路径';
            } else if (nodeTitles.has(cleanTitle)) {
                href = `#/note/${encodeURIComponent(cleanTitle)}`;
                category = topicTitles.has(cleanTitle) ? '深度专题' : '知识卡片';
                actionLabel = topicTitles.has(cleanTitle) ? '阅读专题' : '查看卡片';
            } else if (matchedClassic && nodeTitles.has(matchedClassic)) {
                href = `#/note/${encodeURIComponent(matchedClassic)}`;
                actionLabel = '对应卡片';
            }

            const score = Number.isFinite(Number(s.score)) ? Number(s.score) : 0;
            const key = `${cleanTitle}::${category}`;
            const existing = grouped.get(key);
            if (existing) {
                existing.hits += 1;
                if (score > existing.score) existing.score = score;
                if (!existing.href && href) {
                    existing.href = href;
                    existing.actionLabel = actionLabel;
                }
            } else {
                grouped.set(key, {
                    title: cleanTitle,
                    category,
                    href,
                    actionLabel,
                    score,
                    hits: 1,
                });
            }
        });

        const list = Array.from(grouped.values()).sort((a, b) => b.score - a.score || b.hits - a.hits);
        const maxScore = list.reduce((m, item) => Math.max(m, item.score), 0);
        return list.map((item) => {
            const ratio = maxScore > 0 ? item.score / maxScore : 0;
            let relLabel = '参考';
            let relLevel = 'low';
            if (ratio >= 0.78) { relLabel = '高相关'; relLevel = 'high'; }
            else if (ratio >= 0.50) { relLabel = '较相关'; relLevel = 'mid'; }
            return { ...item, relLabel, relLevel };
        });
    }

    function formatKnowledgeSources(sources) {
        if (!sources || !sources.length) return '';
        const normalized = normalizeKnowledgeSources(sources);
        if (!normalized.length) return '';

        const totalChunks = sources.length;
        const maxVisible = 8;
        const visibleItems = normalized.slice(0, maxVisible);
        const hiddenCount = Math.max(0, normalized.length - visibleItems.length);
        const previewChips = normalized.slice(0, 3).map((item) =>
            `<span class="qa-sources-chip">${escapeAttr(item.title)}</span>`
        ).join('');
        const moreChip = normalized.length > 3
            ? `<span class="qa-sources-chip qa-sources-chip--more">+${normalized.length - 3}</span>`
            : '';

        const rowsHtml = visibleItems.map((item) => {
            const scoreTip = item.score > 0 ? ` title="BM25 检索引擎最高分：${item.score.toFixed(2)}"` : '';
            const hitBadge = item.hits > 1 ? `<span class="qa-source-hits">${item.hits} 处片段</span>` : '';
            const relBadge = item.score > 0
                ? `<span class="qa-source-rel qa-source-rel--${item.relLevel}"${scoreTip}>${item.relLabel}</span>`
                : '';
            const inner = `
                <div class="qa-source-row-main">
                    <span class="qa-source-cat">${escapeAttr(item.category)}</span>
                    <span class="qa-source-name">${escapeAttr(item.title)}</span>
                    ${hitBadge}
                </div>
                <div class="qa-source-row-side">
                    ${relBadge}
                    ${item.href ? `<span class="qa-source-jump">${escapeAttr(item.actionLabel || '查看')} →</span>` : ''}
                </div>
            `;
            if (item.href) {
                return `<a class="qa-source-card qa-source-card--link" href="${item.href}">${inner}</a>`;
            }
            return `<div class="qa-source-card">${inner}</div>`;
        }).join('');

        const chunkMeta = totalChunks > normalized.length
            ? `<span class="qa-sources-chunks"> · 合并 ${totalChunks} 处片段</span>`
            : '';

        return `<details class="qa-sources">
            <summary class="qa-sources-summary">
                <span class="qa-sources-summary-left">
                    <span class="qa-sources-icon" aria-hidden="true">📎</span>
                    <span class="qa-sources-count">参考 ${normalized.length} 份资料${chunkMeta}</span>
                    <span class="qa-sources-preview">${previewChips}${moreChip}</span>
                </span>
                <span class="qa-sources-chevron" aria-hidden="true">▾</span>
            </summary>
            <div class="qa-sources-drawer">
                ${rowsHtml}
                ${hiddenCount > 0 ? `<div class="qa-sources-footnote">已精选展示相关度最高的 ${visibleItems.length} 份资料（其余 ${hiddenCount} 份边缘片段已折叠）</div>` : ''}
            </div>
        </details>`;
    }

    function addMessage(role, content, providerInfo, knowledgeSources) {
        if (!messagesEl) return;
        removeEmptyState();
        const div = document.createElement('div');
        div.className = `qa-chat-message ${role}`;
        let providerTag = '';
        if (role === 'assistant' && providerInfo) {
            const degradedClass = providerInfo.degraded ? ' qa-provider-degraded' : '';
            providerTag = `<span class="qa-provider-tag${degradedClass}">${getProviderLabel(providerInfo.provider, providerInfo.degraded)}</span>`;
        }
        const sourcesHtml = (role === 'assistant' && knowledgeSources && knowledgeSources.length)
            ? formatKnowledgeSources(knowledgeSources)
            : '';
        div.innerHTML = `
            <span class="qa-chat-role">${role === 'user' ? '你' : '倪海厦知识库助手'}${providerTag}</span>
            <div class="qa-chat-bubble">${formatContent(content)}</div>
            ${sourcesHtml}
        `;
        messagesEl.appendChild(div);
        const sourcesDetails = div.querySelector('details.qa-sources');
        if (sourcesDetails) {
            sourcesDetails.addEventListener('toggle', () => {
                if (sourcesDetails.open) {
                    requestAnimationFrame(() => {
                        try {
                            sourcesDetails.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        } catch (_) {}
                    });
                }
            });
        }
        if (role === 'assistant') {
            // 新回复到达时定位到回复开头：用无 transform 影响的布局坐标差，避免 offsetParent 或入场位移把首段顶出可视区
            if (messagesEl.clientHeight > 0) {
                const layoutTop = (el) => {
                    let y = 0;
                    let cur = el;
                    while (cur) {
                        y += cur.offsetTop + (cur === el ? 0 : cur.clientTop);
                        cur = cur.offsetParent;
                    }
                    return y;
                };
                const relTop = layoutTop(div) - layoutTop(messagesEl) - messagesEl.clientTop;
                const targetTop = Math.max(0, relTop - 12);
                messagesEl.scrollTop = targetTop;
            }
        } else {
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }
    }

    // ---- HTML 消毒 ----
    // 校验 URL 协议是否在允许列表内；同时拒绝包含控制字符的可疑 URL
    function isSafeUrl(url, allowedProtocols) {
        if (!url || typeof url !== 'string') return false;
        const trimmed = url.trim();
        if (!trimmed) return false;
        // 拒绝包含控制字符（可能被用于绕过协议检查，例如嵌入 NUL 或换行）
        if (/[\x00-\x1f\x7f]/.test(trimmed)) return false;
        let parsed;
        try {
            parsed = new URL(trimmed);
        } catch {
            return false;
        }
        return allowedProtocols.includes(parsed.protocol.toLowerCase());
    }

    // 使用 DOM API 解析 HTML 并移除危险标签/属性：
    // - 移除 <script>/<style>/<iframe>/<object>/<embed> 标签
    // - 移除所有 on* 事件属性
    // - 移除 style 属性
    // - href 仅允许 http:/https:/mailto:，src 仅允许 http:/https:
    function sanitizeHtml(html) {
        if (typeof window === 'undefined' || !window.DOMParser) return html;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const FORBIDDEN_TAGS = ['script', 'style', 'iframe', 'object', 'embed'];

        function walk(node) {
            if (!node || node.nodeType !== 1) return; // 仅处理元素节点
            const tag = node.tagName.toLowerCase();
            if (FORBIDDEN_TAGS.includes(tag)) {
                node.remove();
                return;
            }
            // 先快照属性集合，避免遍历过程中修改导致索引错乱
            const attrs = Array.from(node.attributes);
            for (const attr of attrs) {
                const name = attr.name.toLowerCase();
                // on* 事件属性（onclick/onerror/onload 等）
                if (name.startsWith('on')) {
                    node.removeAttribute(attr.name);
                    continue;
                }
                // style 属性可能携带 CSS 注入
                if (name === 'style') {
                    node.removeAttribute(attr.name);
                    continue;
                }
                // href 仅允许 http/https/mailto
                if (name === 'href') {
                    if (!isSafeUrl(attr.value, ['http:', 'https:', 'mailto:'])) {
                        node.removeAttribute(attr.name);
                    }
                    continue;
                }
                // src 仅允许 http/https
                if (name === 'src') {
                    if (!isSafeUrl(attr.value, ['http:', 'https:'])) {
                        node.removeAttribute(attr.name);
                    }
                    continue;
                }
            }
            // 递归处理子节点（快照后遍历，子节点被移除不影响迭代）
            const children = Array.from(node.children);
            for (const child of children) {
                walk(child);
            }
        }

        walk(doc.body);
        return doc.body.innerHTML;
    }

    function formatContent(text) {
        // 先按行处理 markdown 结构
        let lines = text.split('\n');
        let html = [];
        let inList = false;
        let listType = '';

        for (let line of lines) {
            let trimmed = line.trim();

            // 空行 → 段落分隔
            if (trimmed === '') {
                if (inList) { html.push(`</${listType}>`); inList = false; }
                html.push('');
                continue;
            }

            // 标题 ### / ## / #
            let headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
            if (headingMatch) {
                if (inList) { html.push(`</${listType}>`); inList = false; }
                html.push(`<div class="qa-md-heading">${headingMatch[2]}</div>`);
                continue;
            }

            // 有序列表 1. 2. 3.
            let olMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
            if (olMatch) {
                if (!inList || listType !== 'ol') {
                    if (inList) html.push(`</${listType}>`);
                    html.push('<ol>');
                    inList = true;
                    listType = 'ol';
                }
                html.push(`<li>${olMatch[2]}</li>`);
                continue;
            }

            // 无序列表 - 或 *
            let ulMatch = trimmed.match(/^[-*]\s+(.*)/);
            if (ulMatch) {
                if (!inList || listType !== 'ul') {
                    if (inList) html.push(`</${listType}>`);
                    html.push('<ul>');
                    inList = true;
                    listType = 'ul';
                }
                html.push(`<li>${ulMatch[1]}</li>`);
                continue;
            }

            // 普通段落
            if (inList) { html.push(`</${listType}>`); inList = false; }
            html.push(`<p>${trimmed}</p>`);
        }

        if (inList) html.push(`</${listType}>`);

        // 组装后处理行内格式
        let result = html.join('\n');

        // HTML 转义安全：行内标记替换
        result = result
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            // 恢复我们生成的 HTML 标签
            .replace(/&lt;div class="qa-md-heading"&gt;/g, '<div class="qa-md-heading">')
            .replace(/&lt;\/div&gt;/g, '</div>')
            .replace(/&lt;p&gt;/g, '<p>')
            .replace(/&lt;\/p&gt;/g, '</p>')
            .replace(/&lt;ol&gt;/g, '<ol>')
            .replace(/&lt;\/ol&gt;/g, '</ol>')
            .replace(/&lt;ul&gt;/g, '<ul>')
            .replace(/&lt;\/ul&gt;/g, '</ul>')
            .replace(/&lt;li&gt;/g, '<li>')
            .replace(/&lt;\/li&gt;/g, '</li>')
            .replace(/&lt;br&gt;/g, '<br>')
            .replace(/&lt;strong&gt;/g, '<strong>')
            .replace(/&lt;\/strong&gt;/g, '</strong>')
            .replace(/&lt;em&gt;/g, '<em>')
            .replace(/&lt;\/em&gt;/g, '</em>')
            .replace(/&lt;pre&gt;&lt;code&gt;/g, '<pre><code>')
            .replace(/&lt;\/code&gt;&lt;\/pre&gt;/g, '</code></pre>')
            .replace(/&lt;code&gt;/g, '<code>')
            .replace(/&lt;\/code&gt;/g, '</code>');

        // 行内 markdown 格式
        result = result
            // 代码块
            .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            // 行内代码
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // 加粗
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            // 斜体
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            // 链接 [text](url) — 仅允许 http/https/mailto，不安全的 URL 只显示文本不加链接
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
                // URL 此前已被 HTML 转义（& -> &amp;），先解码回原始形态再做协议校验
                const decodedUrl = url.replace(/&amp;/g, '&');
                if (isSafeUrl(decodedUrl, ['http:', 'https:', 'mailto:'])) {
                    return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
                }
                return text;
            });

        // 清理空段落
        result = result.replace(/<p><\/p>/g, '').replace(/\n\n+/g, '\n');

        // 最终 HTML 消毒：移除任何残留的危险标签/属性，限制 href/src 协议
        result = sanitizeHtml(result);

        return result;
    }

    function addTyping() {
        if (!messagesEl) return;
        removeEmptyState();
        const div = document.createElement('div');
        div.className = 'qa-chat-message assistant';
        div.id = 'qa-typing-indicator';
        div.innerHTML = `
            <span class="qa-chat-role">倪海厦知识库助手</span>
            <div class="qa-chat-bubble">
                <span class="qa-chat-typing">
                    <span class="qa-chat-typing-dot"></span>
                    <span class="qa-chat-typing-dot"></span>
                    <span class="qa-chat-typing-dot"></span>
                </span>
            </div>
        `;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function removeTyping() {
        const el = document.getElementById('qa-typing-indicator');
        if (el) el.remove();
    }

    function buildErrorReply(detail) {
        const hint = detail ? `（${detail}）` : '';
        return `抱歉，当前无法连接问答服务${hint}。请检查网络或稍后重试；若持续失败，可能是服务未配置或浏览器跨域限制。`;
    }

    function formatBlockedReply(data) {
        const raw = String(data?.reply || data?.error || '').trim();
        if (/120|急救|紧急医疗/.test(raw)) {
            return raw;
        }
        if (raw.startsWith('本系统仅供学习研究')) {
            return `不好意思，${raw.replace('如有健康问题，', '此类身体不适、问诊或用药问题，')}`;
        }
        if (raw) {
            return raw.startsWith('不好意思') || raw.startsWith('抱歉') ? raw : `不好意思，${raw}`;
        }
        return '不好意思，本系统仅供学习研究，不提供诊断、处方、剂量或治疗建议。此类身体不适、问诊或用药问题，请咨询专业中医师或前往线下医疗机构就诊。';
    }

    function describeQaFailure(res, data) {
        if (data?.blocked) return null;
        if (data?.rate_limited || (res && res.status === 429)) return data?.error || '提问过于频繁，请稍后再试';
        if (data?.error) return data.error;
        if (res && res.status === 403) return '服务拒绝访问：来源未授权（跨域未配置）';
        if (res && res.status >= 500) return '问答服务暂时不可用，请稍后重试';
        if (res && !res.ok) return `服务返回错误（HTTP ${res.status}）`;
        return '服务未返回有效回答';
    }

    async function sendMessage(message) {
        if (isSending || !message.trim()) return;
        isSending = true;
        sendBtn && (sendBtn.disabled = true);
        inputEl && (inputEl.disabled = true);
        clearStatus();
        setQuestionsCollapsed(true);

        const trimmedMsg = message.trim();
        addMessage('user', trimmedMsg);

        // 更新历史
        const history = getHistory();
        const requestMessages = [...history, { role: 'user', content: trimmedMsg }];

        addTyping();

        // 构建请求：发送当前消息 + 历史上下文
        const sessionId = getSessionId();
        const messages = requestMessages.slice(-MAX_HISTORY_ROUNDS * 2).map(m => ({
            role: m.role,
            content: m.content,
        }));

        try {
            setStatus('正在连接问答服务...');
            const res = await fetch(QA_ROUTER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: sessionId, messages }),
            });

            let data = {};
            try {
                data = await res.json();
            } catch (parseErr) {
                data = {};
            }

            removeTyping();

            if (data.blocked) {
                // 问诊/处方/急救类安全拒答（覆盖 HTTP 400 第一层输入拦截与 HTTP 200 第二层输出拦截）：
                // 友好提示就医、不显示假网络错误与重试按钮，且不写入本地历史免得连带拦截后续正常学习提问。
                addMessage('assistant', formatBlockedReply(data), { provider: 'system', degraded: false });
                clearStatus();
                lastFailedMessage = '';
                if (retryBtn) retryBtn.hidden = true;
            } else if (data.invalid_history) {
                localStorage.removeItem(LS_HISTORY_KEY);
                localStorage.removeItem(LS_SESSION_KEY);
                addMessage('assistant', '当前对话上下文已过期或格式异常，已为您自动重置会话，请点击重试或重新发送问题。', { provider: 'system', degraded: false });
                lastFailedMessage = trimmedMsg;
                if (retryBtn) retryBtn.hidden = false;
                clearStatus();
            } else if (res.ok && data.reply) {
                const providerInfo = { provider: data.provider, degraded: data.degraded };
                addMessage('assistant', data.reply, providerInfo, data.knowledge_sources);
                clearStatus();
                lastFailedMessage = '';
                if (retryBtn) retryBtn.hidden = true;
                // 保存助手回复到历史
                saveHistory([...requestMessages, { role: 'assistant', content: data.reply }]);
            } else if (res.status === 429 || data.rate_limited) {
                const msg = data.error || '提问过于频繁，请稍等几秒后再试。';
                addMessage('assistant', `不好意思，${msg}`, { provider: 'system', degraded: false });
                lastFailedMessage = trimmedMsg;
                if (retryBtn) retryBtn.hidden = false;
                setStatus(msg, true);
            } else if (res.status === 400 && data.error) {
                addMessage('assistant', `请调整提问后再试：${data.error}`, { provider: 'system', degraded: false });
                lastFailedMessage = '';
                if (retryBtn) retryBtn.hidden = true;
                clearStatus();
            } else {
                const detail = describeQaFailure(res, data);
                lastFailedMessage = trimmedMsg;
                addMessage('assistant', buildErrorReply(detail));
                if (retryBtn) retryBtn.hidden = false;
                setStatus(detail || '问答服务返回错误', true);
            }
        } catch (err) {
            removeTyping();
            lastFailedMessage = trimmedMsg;
            const isNetwork = err instanceof TypeError || /fetch|network|CORS/i.test(String(err.message || ''));
            const detail = isNetwork
                ? (window.location.protocol === 'file:'
                    ? '当前为本地离线文件（file://）直开，云端问答接口受跨域安全白名单保护，请前往线上主站 www.nihaixia-knowledge.xyz 或通过本地 http://127.0.0.1:8765 服务体验 AI 问答'
                    : '网络连接失败：服务未配置、跨域限制或地址不可达')
                : (err.message || '未知错误');
            addMessage('assistant', buildErrorReply(detail));
            if (retryBtn) retryBtn.hidden = false;
            setStatus(detail, true);
        }

        isSending = false;
        sendBtn && (sendBtn.disabled = false);
        inputEl && (inputEl.disabled = false);
        inputEl && inputEl.focus();
    }

    // 推荐问题点击 → 直接发送
    document.querySelectorAll('.qa-question-card').forEach((card) => {
        card.addEventListener('click', () => {
            const question = card.dataset.question || card.textContent.trim();
            if (inputEl) inputEl.value = '';
            sendMessage(question);
        });
    });

    // 清空对话按钮
    clearBtn && clearBtn.addEventListener('click', () => {
        clearHistory();
    });


    // Header scroll detection
    document.addEventListener('scroll', () => {
        const header = document.querySelector('.header');
        if (header) {
            header.classList.toggle('scrolled', window.scrollY > 10);
        }
    }, { passive: true });

        retryBtn && retryBtn.addEventListener('click', () => {
        if (!lastFailedMessage || isSending) return;
        const retryMessage = lastFailedMessage;
        if (inputEl) inputEl.value = '';
        sendMessage(retryMessage);
    });

    // 发送按钮
    sendBtn && sendBtn.addEventListener('click', () => {
        const msg = inputEl?.value || '';
        if (inputEl) inputEl.value = '';
        sendMessage(msg);
    });

    // 回车发送（Shift+Enter 换行）

    // Textarea auto-resize
    if (inputEl) {
        const autoResize = () => {
            inputEl.style.height = 'auto';
            inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
        };
        inputEl.addEventListener('input', autoResize);
        inputEl.addEventListener('focus', autoResize);
        if (window.__nhxPendingQaPrompt) {
            inputEl.value = window.__nhxPendingQaPrompt;
            window.__nhxPendingQaPrompt = '';
            autoResize();
            setStatus('已填入预设问题，按回车或点击右侧发送即可提问');
        }
    }

        inputEl && inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const msg = inputEl.value;
            inputEl.value = '';
            sendMessage(msg);
        }
    });

    // 自动调整输入框高度
    inputEl && inputEl.addEventListener('input', () => {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });

    // Footer 公众号浮层
    const brandBtn = document.getElementById('footer-brand-btn');
    const popover = document.getElementById('footer-popover');
    if (brandBtn && popover) {
        brandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = popover.classList.toggle('show');
            brandBtn.setAttribute('aria-expanded', isOpen);
        });
        document.addEventListener('click', (e) => {
            if (!popover.contains(e.target) && e.target !== brandBtn) {
                popover.classList.remove('show');
                brandBtn.setAttribute('aria-expanded', 'false');
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                popover.classList.remove('show');
                brandBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }
});
