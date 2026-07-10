// 主入口 — 初始化所有模块
class NihaixiaApp {
    constructor() {
        this.data = null;
        this.init();
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

        // 3. 加载图谱数据（失败不阻塞其他模块）
        try {
            const response = await fetch('data/graph.json');
            this.data = await response.json();
        } catch (error) {
            console.error('加载图谱数据失败，部分功能不可用:', error);
            this.data = null;
        }

        // 4. 初始化各模块（每个独立 try-catch，一个失败不影响其他）
        if (this.data) {
            try { this.overview = new Overview(this.data); } catch(e) { console.error('Overview init error:', e); }
            try { this.sidebar = new Sidebar(this.data); } catch(e) { console.error('Sidebar init error:', e); }
            try { this.pathView = new PathView(this.data); } catch(e) { console.error('PathView init error:', e); }
            try { this.forceGraph = new ForceGraph(this.data); } catch(e) { console.error('ForceGraph init error:', e); }
            try { this.noteDetail = new NoteDetail(this.data); } catch(e) { console.error('NoteDetail init error:', e); }
            try { this.search = new Search(this.data); } catch(e) { console.error('Search init error:', e); }
        }

        // 5. 提示词工具包独立加载，不依赖 graph.json
        try {
            const promptResponse = await fetch('data/prompts.json');
            const promptData = await promptResponse.json();
            this.promptView = new PromptView(promptData);
        } catch(e) {
            console.error('PromptView init error:', e);
            // 显示兜底错误提示
            const el = document.getElementById('prompts-view');
            if (el) el.innerHTML = '<div class="prompt-notice" style="color:#c0392b">提示词数据加载失败，请刷新页面重试。</div>';
        }

        // 6. 再次根据 hash 切换（数据加载完成后，确保视图状态正确）
        this.switchViewFromHash();

        // 7. 监听路由变化更新导航
        window.addEventListener('hashchange', () => {
            this.switchViewFromHash();
        });
    }

    setupRoutes() {
        const router = window.AppRouter;

        // 路由处理器只做视图特有的逻辑，视图切换统一由 switchViewFromHash 处理
        router.on('/graph', () => {
            if (this.forceGraph) {
                setTimeout(() => {
                    try { this.forceGraph.render(); } catch(e) { console.error('Graph render error:', e); }
                }, 50);
            }
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
        const hash = window.location.hash || '#/';
        const path = hash.replace(/^#/, '') || '/';

        // 解析路由到视图名
        let viewName = 'overview';
        if (path === '/') viewName = 'overview';
        else if (path === '/path') viewName = 'path';
        else if (path === '/graph') viewName = 'graph';
        else if (path === '/prompts') viewName = 'prompts';
        else if (path === '/qa') viewName = 'qa';
        else if (path.startsWith('/note/')) viewName = 'note';
        else viewName = 'overview';

        this.switchView(viewName);
        this.updateNav();
    }

    switchView(view) {
        // 隐藏所有视图（双保险：class + inline style）
        document.querySelectorAll('.view').forEach(v => {
            v.classList.remove('active');
            v.style.display = 'none';
        });

        // 显示目标视图
        const target = document.getElementById(`view-${view}`);
        if (target) {
            target.classList.add('active');
            target.style.display = 'block';
        }
    }

    updateNav() {
        const hash = window.location.hash || '#/';
        const path = hash.replace(/^#/, '') || '/';

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
    // AI 问答 — 统一问答路由（双线路自动切换）
    // ============================================
    // 统一路由：主线路 腾讯元器 → 备用线路 CloudBase Agent
    // 两条线路均基于知识库 RAG，不使用通用模型兜底
    const QA_ROUTER_URL = 'https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-qa-router';
    const YUANQI_EXPERIENCE_URL = 'https://yuanqi.tencent.com/explore';

    const messagesEl = document.getElementById('qa-chat-messages');
    const inputEl = document.getElementById('qa-chat-input');
    const sendBtn = document.getElementById('qa-chat-send');
    const statusEl = document.getElementById('qa-chat-status');
    const clearBtn = document.getElementById('qa-chat-clear');

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
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    function saveHistory(messages) {
        // 只保留最近 MAX_HISTORY_ROUNDS 轮
        const trimmed = messages.slice(-MAX_HISTORY_ROUNDS * 2);
        localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(trimmed));
    }

    function clearHistory() {
        localStorage.removeItem(LS_HISTORY_KEY);
        localStorage.removeItem(LS_SESSION_KEY);
        if (messagesEl) {
            messagesEl.innerHTML = `
                <div class="qa-chat-empty">
                    <p>基于腾讯元器知识库，围绕倪海厦资料进行学习型提问。</p>
                    <p class="qa-chat-empty-hint">点击上方推荐问题，或直接在下方输入你想了解的内容。</p>
                </div>`;
        }
        setStatus('对话已清空');
        setTimeout(clearStatus, 2000);
    }

    // ---- 状态与消息渲染 ----
    let isSending = false;

    function setStatus(text, isError = false) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.style.color = isError ? '#b9362c' : '';
    }

    function clearStatus() {
        if (!statusEl) return;
        statusEl.textContent = '';
        statusEl.style.color = '';
    }

    function removeEmptyState() {
        const empty = messagesEl?.querySelector('.qa-chat-empty');
        if (empty) empty.remove();
    }

    function getProviderLabel(provider, degraded) {
        if (provider === 'yuanqi') {
            return degraded ? '腾讯元器知识库（降级）' : '腾讯元器知识库';
        }
        if (provider === 'cloudbase') {
            return degraded ? 'CloudBase 知识库备用线路（降级）' : 'CloudBase 知识库备用线路';
        }
        return provider || '未知线路';
    }

    function addMessage(role, content, providerInfo) {
        if (!messagesEl) return;
        removeEmptyState();
        const div = document.createElement('div');
        div.className = `qa-chat-message ${role}`;
        let providerTag = '';
        if (role === 'assistant' && providerInfo) {
            const degradedClass = providerInfo.degraded ? ' qa-provider-degraded' : '';
            providerTag = `<span class="qa-provider-tag${degradedClass}">${getProviderLabel(providerInfo.provider, providerInfo.degraded)}</span>`;
        }
        div.innerHTML = `
            <span class="qa-chat-role">${role === 'user' ? '你' : '倪海厦知识库助手'}${providerTag}</span>
            <div class="qa-chat-bubble">${formatContent(content)}</div>
        `;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
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
            // 链接 [text](url)
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

        // 清理空段落
        result = result.replace(/<p><\/p>/g, '').replace(/\n\n+/g, '\n');

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

    function buildErrorReply(errorMsg) {
        let reply = `抱歉，问答服务暂时不可用。`;
        if (errorMsg) reply += `\n\n原因：${errorMsg}`;
        reply += `\n\n你可以：\n- 前往 [腾讯元器平台](${YUANQI_EXPERIENCE_URL}) 搜索「倪海厦知识库」直接提问\n- 或稍后重试，系统会自动恢复`;
        return reply;
    }

    async function sendMessage(message) {
        if (isSending || !message.trim()) return;
        isSending = true;
        sendBtn && (sendBtn.disabled = true);
        inputEl && (inputEl.disabled = true);
        clearStatus();

        const trimmedMsg = message.trim();
        addMessage('user', trimmedMsg);

        // 更新历史
        const history = getHistory();
        history.push({ role: 'user', content: trimmedMsg });
        saveHistory(history);

        addTyping();

        // 构建请求：发送当前消息 + 历史上下文
        const sessionId = getSessionId();
        const messages = history.slice(-MAX_HISTORY_ROUNDS * 2).map(m => ({
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
            const data = await res.json();

            removeTyping();

            if (res.ok && data.reply) {
                const providerInfo = { provider: data.provider, degraded: data.degraded };
                addMessage('assistant', data.reply, providerInfo);
                clearStatus();
                // 保存助手回复到历史
                history.push({ role: 'assistant', content: data.reply });
                saveHistory(history);
            } else {
                const errorMsg = data.error || `HTTP ${res.status}`;
                addMessage('assistant', buildErrorReply(errorMsg));
                setStatus('问答服务返回错误', true);
            }
        } catch (err) {
            removeTyping();
            const errorMsg = err.message || '网络错误';
            addMessage('assistant', buildErrorReply(errorMsg));
            setStatus('网络连接失败，请检查网络后重试', true);
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
            if (inputEl) inputEl.value = question;
            sendMessage(question);
        });
    });

    // 清空对话按钮
    clearBtn && clearBtn.addEventListener('click', () => {
        clearHistory();
    });

    // 发送按钮
    sendBtn && sendBtn.addEventListener('click', () => {
        const msg = inputEl?.value || '';
        if (inputEl) inputEl.value = '';
        sendMessage(msg);
    });

    // 回车发送（Shift+Enter 换行）
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
