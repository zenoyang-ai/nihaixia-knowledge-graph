// 目录栏模块 — 左侧可折叠目录
class Sidebar {
    constructor(data) {
        this.data = data;
        this.sidebar = document.getElementById('sidebar');
        this.nav = document.getElementById('sidebar-nav');
        this.toggle = document.getElementById('sidebar-toggle');
        this.overlay = document.getElementById('sidebar-overlay');
        this.countEl = document.getElementById('sidebar-count');
        this.activeTitle = null;
        this.build();
        this.bindEvents();
    }

    resolveLayer(node) {
        return (node && (node.layer || (node.node_type === 'topic' ? '深度专题' : ''))) || '其他';
    }

    // 按 layer 分组构建目录
    build() {
        const layerColors = {
            '底层框架': 'var(--layer-cosmology)',
            '辨证框架': 'var(--layer-diagnosis)',
            '方法工具': 'var(--layer-treatment)',
            '案例研读': 'var(--layer-cases)',
            '天纪体系': 'var(--layer-tianji)',
            '学习路径': 'var(--layer-path)',
            '深度专题': 'var(--layer-topic)',
        };

        const groups = {};
        const allNodes = [...this.data.nodes, ...this.data.articles];
        allNodes.forEach(node => {
            const layer = this.resolveLayer(node);
            if (!groups[layer]) groups[layer] = [];
            groups[layer].push(node);
        });

        // 按 layers 数组顺序排列
        const orderedLayers = [...(this.data.layers || []), ...Object.keys(groups).filter(l => !this.data.layers.includes(l))];

        this.countEl.textContent = `${allNodes.length} 个节点`;

        this.nav.innerHTML = orderedLayers.map(layer => {
            const nodes = groups[layer] || [];
            const color = layerColors[layer] || 'var(--muted)';
            return `
                <div class="sidebar-group" data-layer="${layer}">
                    <div class="sidebar-group-header" role="button" tabindex="0" aria-expanded="false" aria-controls="sidebar-group-${encodeURIComponent(layer)}">
                        <span class="sidebar-group-dot" style="background:${color}"></span>
                        <span class="sidebar-group-name">${layer}</span>
                        <span class="sidebar-group-count">${nodes.length}</span>
                        <span class="sidebar-group-arrow">▶</span>
                    </div>
                    <div class="sidebar-group-items" id="sidebar-group-${encodeURIComponent(layer)}" role="group" aria-label="${layer}">
                        ${nodes.map(n => `
                            <a class="sidebar-item" data-title="${n.title}" href="#/note/${encodeURIComponent(n.title)}">
                                ${n.title}
                                <span class="sidebar-item-type">${this.typeLabel(n.node_type)}</span>
                            </a>
                        `).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    typeLabel(type) {
        const map = { concept: '概念', classic: '经典', course: '课程', formula: '方剂', case: '案例', topic: '文章' };
        return map[type] || '';
    }

    bindEvents() {
        // 折叠/展开侧边栏
        this.toggle.addEventListener('click', () => this.toggleSidebar());
        this.overlay.addEventListener('click', () => this.closeSidebar());

        const toggleGroup = (header) => {
            const group = header.closest('.sidebar-group');
            if (!group) return;
            group.classList.toggle('expanded');
            header.setAttribute('aria-expanded', group.classList.contains('expanded') ? 'true' : 'false');
        };

        // 点击节点后在抽屉模式下自动收起目录，避免遮挡内容
        this.nav.addEventListener('click', (e) => {
            const item = e.target.closest('.sidebar-item');
            if (item && window.innerWidth <= 1024) {
                this.closeSidebar();
                return;
            }
            const header = e.target.closest('.sidebar-group-header');
            if (header) toggleGroup(header);
        });
        this.nav.addEventListener('keydown', (e) => {
            const header = e.target.closest('.sidebar-group-header');
            if (!header) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleGroup(header);
            }
        });
        if (window.matchMedia) {
            const drawerMq = window.matchMedia('(max-width: 1024px)');
            const resetOnBreakpoint = () => {
                this.closeSidebar();
                this.sidebar.classList.remove('collapsed');
            };
            if (drawerMq.addEventListener) {
                drawerMq.addEventListener('change', resetOnBreakpoint);
            } else if (drawerMq.addListener) {
                drawerMq.addListener(resetOnBreakpoint);
            }
        }
    }

    toggleSidebar() {
        const isDrawer = window.innerWidth <= 1024;
        if (isDrawer) {
            this.sidebar.classList.remove('collapsed');
            this.sidebar.classList.toggle('open');
            this.overlay.classList.toggle('show');
        } else {
            this.closeSidebar();
            this.sidebar.classList.toggle('collapsed');
        }
    }

    closeSidebar() {
        this.sidebar.classList.remove('open');
        this.overlay.classList.remove('show');
    }

    // 高亮当前活动节点
    setActive(title) {
        this.activeTitle = title;
        this.nav.querySelectorAll('.sidebar-item').forEach(item => {
            item.classList.toggle('active', item.dataset.title === title);
        });
        // 展开对应分组
        if (title) {
            const node = [...this.data.nodes, ...this.data.articles].find(n => n.title === title);
            if (node) {
                const group = this.nav.querySelector(`.sidebar-group[data-layer="${this.resolveLayer(node)}"]`);
                if (group) {
                    group.classList.add('expanded');
                    const header = group.querySelector('.sidebar-group-header');
                    if (header) header.setAttribute('aria-expanded', 'true');
                }
            }
        }
    }
}

window.Sidebar = Sidebar;
