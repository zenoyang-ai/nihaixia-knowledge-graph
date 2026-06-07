// 知识卡片模块 — 结构化节点详情（丰富版）
class NoteDetail {
    constructor(data) {
        this.data = data;
        this.view = document.getElementById('note-view');
        this.allNodes = [...data.nodes, ...data.articles];
    }

    render(title) {
        const node = this.findNode(title);
        if (!node) {
            this.view.innerHTML = `<p class="placeholder">未找到节点: ${title}</p>`;
            return;
        }

        const upstream = (node.upstream || []).map(name => this.findNode(name)).filter(Boolean);
        const downstream = (node.downstream || []).map(name => this.findNode(name)).filter(Boolean);
        const related = (node.related || []).map(name => this.findNode(name)).filter(Boolean);
        const misconceptions = node.misconceptions || [];
        const quotes = node.quotes || [];

        // 计算"为什么重要"
        const importanceText = this.generateImportance(node, upstream, downstream);

        this.view.innerHTML = `
            <div class="note-breadcrumb">
                <a class="note-back" href="#/graph">← 返回图谱</a>
                <span class="note-breadcrumb-sep">›</span>
                <span class="note-breadcrumb-current">${node.title}</span>
            </div>

            <div class="note-meta">
                <span class="note-tag">${this.typeLabel(node.node_type)}</span>
                <span class="note-tag layer">${node.layer || '未分类'}</span>
                ${node.importance === 'core' ? '<span class="note-tag" style="border-color:#c0392b;color:#c0392b;">核心节点</span>' : ''}
            </div>

            <h1 class="note-title">${node.title}</h1>

            ${node.definition ? `<div class="note-definition">${node.definition}</div>` : ''}

            <!-- 概念解析 -->
            ${node.summary ? `
                <div class="note-section">
                    <div class="note-section-header">
                        <span class="note-section-icon">📖</span>
                        概念解析
                    </div>
                    <div class="note-section-content">${this.renderMarkdown(node.summary)}</div>
                </div>
            ` : ''}

            <!-- 为什么重要 -->
            ${importanceText ? `
                <div class="note-section">
                    <div class="note-section-header">
                        <span class="note-section-icon">🎯</span>
                        为什么重要
                    </div>
                    <div class="note-section-content">${importanceText}</div>
                </div>
            ` : ''}

            <!-- 核心理解 -->
            ${(node.sections && node.sections['核心理解']) ? `
                <div class="note-section">
                    <div class="note-section-header">
                        <span class="note-section-icon">💡</span>
                        核心理解
                    </div>
                    <div class="note-section-content">${this.renderMarkdown(node.sections['核心理解'])}</div>
                </div>
            ` : ''}

            <!-- 原文金句 -->
            ${quotes.length ? `
                <div class="note-section">
                    <div class="note-section-header">
                        <span class="note-section-icon">💬</span>
                        倪海厦原话
                    </div>
                    <div class="note-quotes">
                        ${quotes.map(q => `
                            <div class="note-quote">
                                <div class="note-quote-text">"${q.text}"</div>
                                ${q.source ? `<div class="note-quote-source">—— ${q.source}</div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            <!-- 常见误区 -->
            ${misconceptions.length ? `
                <div class="note-section">
                    <div class="note-section-header">
                        <span class="note-section-icon">⚠️</span>
                        常见误区
                    </div>
                    ${misconceptions.map(m => `
                        <div class="note-misconception">
                            <div class="note-misconception-wrong">${m.wrong}</div>
                            <div class="note-misconception-correction">${m.correction}</div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <!-- 学习提示 -->
            ${(node.sections && node.sections['学习路径']) ? `
                <div class="note-section">
                    <div class="note-section-header">
                        <span class="note-section-icon">🗺️</span>
                        学习提示
                    </div>
                    <div class="note-section-content">${this.renderMarkdown(node.sections['学习路径'])}</div>
                </div>
            ` : ''}

            <!-- 关联节点 -->
            ${(upstream.length || downstream.length || related.length) ? `
                <div class="note-section">
                    <div class="note-section-header">
                        <span class="note-section-icon">🔗</span>
                        关联节点
                    </div>
                    <div class="note-related">
                        ${upstream.length ? `
                            <div class="note-related-group">
                                <h4>上游概念</h4>
                                <div class="note-related-group-desc">理解这个概念的前提</div>
                                <div class="note-related-list">
                                    ${upstream.map(n => `<a class="note-related-node" href="#/note/${encodeURIComponent(n.title)}">${n.title}</a>`).join('')}
                                </div>
                            </div>
                        ` : ''}
                        ${downstream.length ? `
                            <div class="note-related-group">
                                <h4>下游概念</h4>
                                <div class="note-related-group-desc">由此推导出的结论</div>
                                <div class="note-related-list">
                                    ${downstream.map(n => `<a class="note-related-node" href="#/note/${encodeURIComponent(n.title)}">${n.title}</a>`).join('')}
                                </div>
                            </div>
                        ` : ''}
                        ${related.length ? `
                            <div class="note-related-group">
                                <h4>相关节点</h4>
                                <div class="note-related-list">
                                    ${related.map(n => `<a class="note-related-node" href="#/note/${encodeURIComponent(n.title)}">${n.title}</a>`).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            ` : ''}

            <!-- 安全边界 -->
            ${(node.sections && node.sections['安全边界']) ? `
                <div class="note-section" style="margin-top:32px; padding-top:16px; border-top:1px solid var(--border);">
                    <div class="note-section-header">
                        <span class="note-section-icon">⚕️</span>
                        安全边界
                    </div>
                    <div class="note-section-content" style="font-size:13px; color:var(--text-light); line-height:1.6;">
                        ${node.sections['安全边界']}
                    </div>
                </div>
            ` : ''}
        `;
    }

    // 自动生成"为什么重要"的内容
    generateImportance(node, upstream, downstream) {
        const parts = [];

        // 核心节点特殊说明
        if (node.importance === 'core') {
            parts.push(`这是倪海厦知识体系中的<b>核心节点</b>，在整个知识网络中占据关键位置。`);
        }

        // 上下游关系说明
        if (upstream.length > 0 && downstream.length > 0) {
            parts.push(`它连接了<b>上游的 ${upstream.map(n => n.title).join('、')}</b> 和<b>下游的 ${downstream.map(n => n.title).join('、')}</b>，是知识链路中的重要桥梁。`);
        } else if (upstream.length > 0) {
            parts.push(`理解它需要先掌握 <b>${upstream.map(n => n.title).join('、')}</b>。`);
        } else if (downstream.length > 0) {
            parts.push(`它是 <b>${downstream.map(n => n.title).join('、')}</b> 的理论基础。`);
        }

        // 层级说明
        const layerDesc = {
            '底层框架': '作为底层框架，它支撑着整个辨证和治疗体系。',
            '辨证框架': '辨证框架是中医诊断的核心能力，掌握它才能准确判断病情。',
            '方法工具': '这是理解经方、本草、针灸等方法体系的学习入口。',
            '案例研读': '通过真实案例验证理论，是从理论到实践的关键一步。',
            '天纪体系': '天纪体系拓展了中医的视野，从天地人的角度理解人体。',
        };
        if (node.layer && layerDesc[node.layer]) {
            parts.push(layerDesc[node.layer]);
        }

        return parts.length > 0 ? parts.map(p => `<p>${p}</p>`).join('') : '';
    }

    findNode(title) {
        return this.allNodes.find(n => n.title === title);
    }

    typeLabel(type) {
        const map = { concept: '概念', classic: '经典', course: '课程', formula: '方剂', case: '案例', topic: '文章' };
        return map[type] || type;
    }

    renderMarkdown(text) {
        if (!text) return '';
        let html = text.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (match, name) => {
            return `<a class="note-link" href="#/note/${encodeURIComponent(name)}">${name}</a>`;
        });
        if (window.marked) {
            html = marked.parse(html);
        } else {
            html = html.replace(/\n/g, '<br>');
        }
        return html;
    }
}

window.NoteDetail = NoteDetail;
