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

        // 直达深链接时，路由可能早于异步数据初始化；补一次当前页面的首次渲染。
        const currentPath = (window.location.hash || '#/').replace(/^#/, '') || '/';
        if (currentPath === '/graph' && this.forceGraph) {
            setTimeout(() => {
                try { this.forceGraph.render(); } catch (e) { console.error('Initial graph render error:', e); }
            }, 0);
        }
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
            const trimmed = valid.slice(-MAX_HISTORY_ROUNDS * 2);
            if (trimmed.length % 2 === 1) trimmed.shift();
            return trimmed;
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
                    <p>从一个概念开始，逐步追问它与经典、方法和学习路径的关系。</p>
                    <p class="qa-chat-empty-hint">回答来自当前接入的知识库；资料不足时会明确说明。</p>
                <p class="qa-chat-empty-hint" style="margin-top:4px;">如遇到超时，可点击重新尝试按钮。</p>
                </div>`;
        }
        if (retryBtn) retryBtn.hidden = true;
        setStatus('对话已清空');
        setTimeout(clearStatus, 2000);
    }

    // ---- 状态与消息渲染 ----
    let isSending = false;
    let lastFailedMessage = '';

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

    function formatKnowledgeSources(sources) {
        if (!sources || !sources.length) return '';
        // 只显示来源文件名，不显示内容摘要（evidence），避免暴露内部细节
        const items = sources.map((s) => {
            const sourceName = s.source_group || s.chunk_title || '未知来源';
            const scoreInfo = s.score ? ` <span class="qa-source-score">相关度 ${s.score}</span>` : '';
            return `<div class="qa-source-item">
                <div class="qa-source-title">📚 ${sourceName}${scoreInfo}</div>
            </div>`;
        }).join('');
        return `<div class="qa-sources">
            <div class="qa-sources-title">📎 引用资料（${sources.length} 条）</div>
            ${items}
        </div>`;
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
        messagesEl.scrollTop = messagesEl.scrollHeight;
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

    function buildErrorReply() {
        return `抱歉，当前知识库暂时没有返回结果。请检查网络后点击“重新尝试”。`;
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
            const data = await res.json();

            removeTyping();

            if (res.ok && data.reply) {
                const providerInfo = { provider: data.provider, degraded: data.degraded };
                addMessage('assistant', data.reply, providerInfo, data.knowledge_sources);
                clearStatus();
                lastFailedMessage = '';
                if (retryBtn) retryBtn.hidden = true;
                // 保存助手回复到历史
                saveHistory([...requestMessages, { role: 'assistant', content: data.reply }]);
            } else {
                lastFailedMessage = trimmedMsg;
                addMessage('assistant', buildErrorReply());
                if (retryBtn) retryBtn.hidden = false;
                setStatus('问答服务返回错误', true);
            }
        } catch (err) {
            removeTyping();
            lastFailedMessage = trimmedMsg;
            addMessage('assistant', buildErrorReply());
            if (retryBtn) retryBtn.hidden = false;
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
