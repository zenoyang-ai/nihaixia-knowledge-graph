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

    // 按 layer 分组构建目录
    build() {
        const layerColors = {
            '底层框架': 'var(--layer-cosmology)',
            '辨证框架': 'var(--layer-diagnosis)',
            '方法工具': 'var(--layer-treatment)',
            '案例研读': 'var(--layer-cases)',
            '天纪体系': 'var(--layer-tianji)',
        };

        const groups = {};
        const allNodes = [...this.data.nodes, ...this.data.articles];
        allNodes.forEach(node => {
            const layer = node.layer || '其他';
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
                    <div class="sidebar-group-header">
                        <span class="sidebar-group-dot" style="background:${color}"></span>
                        <span class="sidebar-group-name">${layer}</span>
                        <span class="sidebar-group-count">${nodes.length}</span>
                        <span class="sidebar-group-arrow">▶</span>
                    </div>
                    <div class="sidebar-group-items">
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

        // 目录组折叠/展开
        this.nav.addEventListener('click', (e) => {
            const header = e.target.closest('.sidebar-group-header');
            if (header) {
                const group = header.closest('.sidebar-group');
                group.classList.toggle('expanded');
            }
        });
    }

    toggleSidebar() {
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            this.sidebar.classList.toggle('open');
            this.overlay.classList.toggle('show');
        } else {
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
                const group = this.nav.querySelector(`.sidebar-group[data-layer="${node.layer || '其他'}"]`);
                if (group) group.classList.add('expanded');
            }
        }
    }
}

window.Sidebar = Sidebar;
