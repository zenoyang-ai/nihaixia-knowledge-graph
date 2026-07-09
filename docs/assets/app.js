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
    // AI 问答 — 原生聊天框（双路线）
    // ============================================
    // 路线 A: CloudBase 云函数 → 代理元器 API
    //   部署后获得 URL，形如 https://zeno-xxx.app.tcloudbase.com/yuanqi-proxy
    // 路线 B: CloudBase 原生 Agent（Beta）
    //   创建 Agent 后获得 API Endpoint，无需经过元器
    // 优先级: 路线 A > 路线 B > Cloudflare Worker
    // 部署前留空，此时点击推荐问题会显示部署提示
    const QA_ENDPOINTS = [
        // 路线 A: CloudBase 云函数 → CloudBase AI SDK (hy3-preview)
        { url: 'https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/yuanqi-proxy', label: 'CloudBase 云函数' },
    ];

    const messagesEl = document.getElementById('qa-chat-messages');
    const inputEl = document.getElementById('qa-chat-input');
    const sendBtn = document.getElementById('qa-chat-send');
    const statusEl = document.getElementById('qa-chat-status');

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

    function addMessage(role, content) {
        if (!messagesEl) return;
        removeEmptyState();
        const div = document.createElement('div');
        div.className = `qa-chat-message ${role}`;
        div.innerHTML = `
            <span class="qa-chat-role">${role === 'user' ? '你' : '倪海厦知识库助手'}</span>
            <div class="qa-chat-bubble">${formatContent(content)}</div>
        `;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function formatContent(text) {
        // 简单 markdown 处理：段落、列表、代码
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^|$/g, '<p>')
            .replace(/<p><\/p>/g, '')
            .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>');
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

    async function sendMessage(message) {
        if (isSending || !message.trim()) return;
        isSending = true;
        sendBtn && (sendBtn.disabled = true);
        inputEl && (inputEl.disabled = true);
        clearStatus();

        addMessage('user', message.trim());
        addTyping();

        // 过滤出有效 endpoint
        const activeEndpoints = QA_ENDPOINTS.filter((ep) => ep.url && ep.url.trim());

        if (activeEndpoints.length === 0) {
            // 所有 endpoint 都未配置
            removeTyping();
            addMessage('assistant', '问答服务尚未部署。\n\n请选择以下任一方式启用：\n\n**路线 A（推荐）**：部署 CloudBase 云函数 → 把 URL 填入 `QA_ENDPOINTS`\n详见 `cloudbase/` 目录\n\n**路线 B**：创建 CloudBase 原生 Agent → 把 API Endpoint 填入 `QA_ENDPOINTS`\n详见 `cloudbase/CLOUDBASE_AGENT_GUIDE.md`\n\n**临时方案**：前往 [腾讯元器公开页](https://yuanqi.tencent.com/webim/#/chat/lebbJN?appid=2075108259383652608&experience=true) 提问（需登录）。');
            setStatus('问答后端未部署，详见 cloudbase/ 目录', true);
        } else {
            // 逐个尝试 endpoint，直到成功
            let lastError = '';
            let success = false;
            for (const endpoint of activeEndpoints) {
                try {
                    setStatus(`正在连接 ${endpoint.label}...`);
                    const res = await fetch(endpoint.url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: message.trim() }),
                    });
                    const data = await res.json();
                    if (res.ok && data.reply) {
                        removeTyping();
                        addMessage('assistant', data.reply);
                        clearStatus();
                        success = true;
                        break;
                    } else {
                        lastError = data.error || '未知错误';
                        console.warn(`Endpoint ${endpoint.label} 失败:`, lastError);
                    }
                } catch (err) {
                    lastError = err.message || '网络错误';
                    console.warn(`Endpoint ${endpoint.label} 异常:`, lastError);
                }
            }
            if (!success) {
                removeTyping();
                addMessage('assistant', `抱歉，所有问答后端均不可用。\n\n最后错误：${lastError}\n\n可前往 [腾讯元器公开页](https://yuanqi.tencent.com/webim/#/chat/lebbJN?appid=2075108259383652608&experience=true) 临时提问。`);
                setStatus('所有后端均不可用，请检查部署状态', true);
            }
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
