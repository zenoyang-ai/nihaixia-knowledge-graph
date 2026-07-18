// 力导向图模块 — d3-force + d3.zoom（交互优化版）
// 标签策略：核心节点常显；普通节点 hover/搜索/筛选/缩放阈值后显示
class ForceGraph {
    constructor(data) {
        this.data = data;
        this.container = document.getElementById('graph-canvas');
        this.detailPanel = document.getElementById('graph-detail-panel');
        this.selectedNode = null;
        this.simulation = null;
        this.svg = null;
        this.nodes = [];
        this.links = [];
        this.linkEls = null;
        this.nodeEls = null;
        this.viewport = null;
        this.positionStorageKey = 'nihaixia_graph_positions_v1';

        // 标签显隐状态
        this.labelZoomThreshold = 1.5;
        this.currentZoomScale = 1;
        this.activeConcept = null;
        this.activeSearchQuery = null;

        // 顶部大概念框（视觉锚点 + 筛选入口）
        this.conceptBoxes = [
            {
                key: 'renji', label: '人纪', desc: '中医教学',
                match: (n) => ['底层框架', '辨证框架', '方法工具', '案例研读', '学习路径'].includes(n.layer),
            },
            {
                key: 'tianji', label: '天纪', desc: '三才术数',
                match: (n) => n.layer === '天纪体系',
            },
            {
                key: 'jingfang', label: '经方', desc: '经典方剂',
                match: (n) => n.node_type === 'formula' || /汤|丸|散|经方|方剂|方义|汉唐/.test(n.title || ''),
            },
            {
                key: 'zhenjiu', label: '针灸', desc: '经络腧穴',
                match: (n) => n.title === '针灸' || n.title === '经络' || (n.title || '').includes('针灸'),
            },
            {
                key: 'bencao', label: '本草', desc: '四气五味',
                match: (n) => ['本草', '神农本草经', '四气五味', '炮制'].includes(n.title) || (n.title || '').includes('本草'),
            },
        ];

        this.layerColor = {
            '底层框架': '#c0392b', '辨证框架': '#2980b9', '方法工具': '#27ae60',
            '案例研读': '#d4a017', '天纪体系': '#8e44ad', '学习路径': '#7f8c8d',
        };
        this.layerAngle = {
            '底层框架': -90, '辨证框架': -18, '方法工具': 54,
            '案例研读': 126, '天纪体系': 198, '学习路径': 270,
        };
        this.typeLabel = { concept:'概念', classic:'经典', formula:'方剂', case:'案例', topic:'文章' };

        // 订阅全局搜索框：在图谱视图下高亮匹配节点
        const searchInput = document.getElementById('global-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                if (!this.svg) return;
                this.highlightSearchMatches(searchInput.value);
            });
        }
    }

    render(nodeList) {
        if (!nodeList) nodeList = [...this.data.nodes, ...this.data.articles];
        this.container.innerHTML = '';
        this.detailPanel.classList.remove('open');
        this.selectedNode = null;
        this.activeConcept = null;
        this.activeSearchQuery = null;
        if (this.simulation) this.simulation.stop();

        const rect = this.container.getBoundingClientRect();
        const width = rect.width || 800;
        const height = rect.height || 600;

        // 构建节点和边
        const nodeIdSet = new Set(nodeList.map(n => n.id));
        this.nodes = nodeList.map(n => ({ ...n }));
        this.links = [];
        nodeList.forEach(n => {
            (n.node_links || []).forEach(link => {
                const target = this.data.nodes.find(t => t.id === link.path) || this.data.articles.find(t => t.id === link.path);
                if (target && nodeIdSet.has(target.id) && n.id !== target.id) {
                    this.links.push({ source: n.id, target: target.id });
                }
            });
        });

        const linkSet = new Set();
        this.links = this.links.filter(l => {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            const key = [s, t].sort().join('|');
            if (linkSet.has(key)) return false;
            linkSet.add(key); return true;
        });

        const linkCount = {};
        this.links.forEach(l => {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            linkCount[s] = (linkCount[s] || 0) + 1;
            linkCount[t] = (linkCount[t] || 0) + 1;
        });

        // === 节点分层：core / standard ===
        // 优先沿用数据中已有的 tier；否则按「连接数 ≥ 5 或顶层概念」自动判断。
        // 顶层概念 = importance=core 或 layer=底层框架 或 主题文章。
        // 上限 20 个，匹配「约 15-20 个核心节点」的规格，避免核心标签再次叠成糊。
        const MAX_CORE = 20;
        const coreCandidates = new Set();
        this.nodes.forEach(n => {
            if (n.tier === 'core') coreCandidates.add(n.id);
            else if (n.importance === 'core') coreCandidates.add(n.id);
            else if (n.layer === '底层框架') coreCandidates.add(n.id);
            else if (n.node_type === 'topic') coreCandidates.add(n.id);
        });
        if (coreCandidates.size < MAX_CORE) {
            const remaining = MAX_CORE - coreCandidates.size;
            const byLinks = this.nodes
                .filter(n => !coreCandidates.has(n.id) && (linkCount[n.id] || 0) >= 5)
                .sort((a, b) => (linkCount[b.id] || 0) - (linkCount[a.id] || 0));
            byLinks.slice(0, remaining).forEach(n => coreCandidates.add(n.id));
        }
        this.nodes.forEach(n => {
            if (!n.tier) n.tier = coreCandidates.has(n.id) ? 'core' : 'standard';
        });

        const getRadius = (n) => {
            if (n.tier === 'core') return 18;
            return 4 + Math.min(linkCount[n.id] || 0, 8) * 1.0;
        };

        // 初始位置：确定性布局避免每次切换页面都完全跳变；用户拖拽后的位置会恢复。
        const cx = width / 2, cy = height / 2;
        const spread = Math.min(width, height) * 0.36;
        const savedPositions = this.loadPositions();
        const hash = (value) => {
            let result = 0;
            for (let i = 0; i < value.length; i += 1) result = ((result << 5) - result + value.charCodeAt(i)) | 0;
            return Math.abs(result);
        };
        this.nodes.forEach(n => {
            const saved = savedPositions[n.id];
            if (saved) {
                n.x = saved.x * width;
                n.y = saved.y * height;
                n.fx = saved.pinned ? n.x : null;
                n.fy = saved.pinned ? n.y : null;
                return;
            }
            const angle = (this.layerAngle[n.layer] || 0) * Math.PI / 180;
            const seed = hash(n.id);
            const jitter = ((seed % 1000) / 1000 - 0.5) * 0.42;
            const r = spread * (0.46 + ((seed >> 4) % 1000) / 1000 * 0.44);
            n.x = cx + Math.cos(angle + jitter) * r;
            n.y = cy + Math.sin(angle + jitter) * r;
        });

        // SVG
        const NS = 'http://www.w3.org/2000/svg';
        this.svg = document.createElementNS(NS, 'svg');
        this.svg.setAttribute('width', width);
        this.svg.setAttribute('height', height);
        this.svg.setAttribute('role', 'img');
        this.svg.setAttribute('aria-label', '倪海厦知识图谱力导向图，共 69 个节点');
        this.svg.style.width = '100%';
        this.svg.style.height = '100%';
        this.svg.style.display = 'block';
        this.container.appendChild(this.svg);

        // d3.zoom — 统一缩放平移
        const self = this;
        const g = document.createElementNS(NS, 'g');
        g.classList.add('viewport');
        this.svg.appendChild(g);

        // 给 SVG 设置 touch-action 避免浏览器默认滚动
        this.svg.style.touchAction = 'none';

        const zoomBehavior = d3.zoom()
            .scaleExtent([0.25, 4])
            .on('zoom', (event) => {
                g.setAttribute('transform', event.transform);
                this.currentZoomScale = event.transform.k;
                this.updateLabelVisibility();
            });

        d3.select(this.svg).call(zoomBehavior).on('dblclick.zoom', null);
        this.zoomBehavior = zoomBehavior;
        this.viewport = g;

        // 边
        this.linkEls = document.createElementNS(NS, 'g');
        this.linkEls.setAttribute('class', 'graph-links');
        this.links.forEach(l => {
            const line = document.createElementNS(NS, 'line');
            line.classList.add('graph-link');
            line.dataset.source = typeof l.source === 'object' ? l.source.id : l.source;
            line.dataset.target = typeof l.target === 'object' ? l.target.id : l.target;
            this.linkEls.appendChild(line);
        });
        g.appendChild(this.linkEls);

        // 节点
        this.nodeEls = document.createElementNS(NS, 'g');
        this.nodeEls.setAttribute('class', 'graph-nodes');
        this.nodes.forEach(n => {
            const ng = document.createElementNS(NS, 'g');
            ng.classList.add('graph-node');
            ng.classList.add(n.tier === 'core' ? 'tier-core' : 'tier-standard');
            ng.dataset.id = n.id;
            ng.dataset.tier = n.tier;
            ng.dataset.layer = n.layer || '';
            ng.__data__ = n;

            // 键盘可达性
            ng.setAttribute('tabindex', '0');
            ng.setAttribute('role', 'button');
            ng.setAttribute('aria-label',
                `${n.title}，${this.typeLabel[n.node_type] || n.node_type || '节点'}，${n.layer || '未分类'}`);

            const r = getRadius(n);
            const color = this.layerColor[n.layer] || '#999';

            const circle = document.createElementNS(NS, 'circle');
            circle.setAttribute('r', r);
            circle.setAttribute('fill', color);
            circle.setAttribute('fill-opacity', n.tier === 'core' ? '0.95' : '0.65');
            circle.setAttribute('stroke', n.tier === 'core' ? '#fff' : 'rgba(255,255,255,0.2)');
            circle.setAttribute('stroke-width', n.tier === 'core' ? '2' : '0.5');

            const text = document.createElementNS(NS, 'text');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dy', -(r + 5));
            text.textContent = n.title;

            ng.appendChild(circle);
            ng.appendChild(text);
            this.nodeEls.appendChild(ng);

            // 键盘：回车 / 空格 触发节点详情
            ng.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    self.onNodeClick(n);
                }
            });
            // 焦点视觉（兼容 Safari 等不渲染 SVG outline 的环境）
            ng.addEventListener('focus', () => ng.classList.add('focused'));
            ng.addEventListener('blur', () => ng.classList.remove('focused'));
        });
        g.appendChild(this.nodeEls);

        // d3 drag — 标准数据绑定
        let dragged = false;
        const drag = d3.drag()
            .on('start', function(event, d) {
                dragged = false;
                if (!event.active) self.simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
            })
            .on('drag', function(event, d) {
                dragged = true;
                d.fx = event.x;
                d.fy = event.y;
            })
            .on('end', function(event, d) {
                if (!event.active) {
                    self.simulation.alphaTarget(0.02).restart();
                }
                // 保留拖拽位置，避免松手后节点突然弹回；双击节点可解除固定。
                d.fx = d.x;
                d.fy = d.y;
                d3.select(this).classed('pinned', true);
                self.savePositions();
                setTimeout(() => { dragged = false; }, 100);
            });

        d3.select(this.nodeEls).selectAll('.graph-node').data(this.nodes, d => d.id).call(drag);

        // 点击 — 防拖拽冲突
        d3.select(this.nodeEls).selectAll('.graph-node').on('click', function(event, d) {
            if (dragged) return;
            event.stopPropagation();
            self.onNodeClick(d);
        });

        d3.select(this.nodeEls).selectAll('.graph-node').on('dblclick', function(event, d) {
            event.stopPropagation();
            d.fx = null;
            d.fy = null;
            d3.select(this).classed('pinned', false);
            self.savePositions();
            self.simulation.alpha(0.12).restart();
        });

        // hover 高亮
        d3.select(this.nodeEls).selectAll('.graph-node')
            .on('mouseenter', function(event, d) {
                // 始终显示该节点的标签
                this.classList.add('hovered');
                if (self.selectedNode) return;
                const neighbors = new Set([d.id]);
                self.links.forEach(l => {
                    const s = typeof l.source === 'object' ? l.source.id : l.source;
                    const t = typeof l.target === 'object' ? l.target.id : l.target;
                    if (s === d.id) neighbors.add(t);
                    if (t === d.id) neighbors.add(s);
                });
                self.nodeEls.querySelectorAll('.graph-node').forEach(ng => {
                    ng.style.opacity = neighbors.has(ng.dataset.id) ? '1' : '0.12';
                });
                self.linkEls.querySelectorAll('line').forEach(line => {
                    const hit = (line.dataset.source === d.id || line.dataset.target === d.id);
                    line.style.opacity = hit ? '0.7' : '0.03';
                    if (hit) line.style.stroke = '#b9362c';
                });
            })
            .on('mouseleave', function() {
                this.classList.remove('hovered');
                if (self.selectedNode) return;
                self.nodeEls.querySelectorAll('.graph-node').forEach(ng => { ng.style.opacity = ''; });
                self.linkEls.querySelectorAll('line').forEach(line => { line.style.opacity = ''; line.style.stroke = ''; });
            });

        // 点击空白处清除选择与概念筛选
        this.svg.addEventListener('click', (event) => {
            const onNode = event.target.closest && event.target.closest('.graph-node');
            if (!onNode) {
                self.clearSelection();
                self.clearConceptFilter();
            }
        });

        // 力模拟
        const isCore = (n) => n.tier === 'core';
        this.simulation = d3.forceSimulation(this.nodes)
            .force('link', d3.forceLink(this.links).id(d => d.id).distance(d => isCore(d.source) || isCore(d.target) ? 155 : 105).strength(d => isCore(d.source) || isCore(d.target) ? 0.18 : 0.09))
            .force('charge', d3.forceManyBody().strength(d => isCore(d) ? -900 : -280).distanceMax(420))
            .force('center', d3.forceCenter(cx, cy).strength(0.04))
            .force('collision', d3.forceCollide().radius(d => getRadius(d) + (isCore(d) ? 18 : 10)).iterations(2))
            .force('x', d3.forceX(d => {
                const a = (this.layerAngle[d.layer] || 0) * Math.PI / 180;
                return cx + Math.cos(a) * spread * 0.28;
            }).strength(d => isCore(d) ? 0.025 : 0.012))
            .force('y', d3.forceY(d => {
                const a = (this.layerAngle[d.layer] || 0) * Math.PI / 180;
                return cy + Math.sin(a) * spread * 0.28;
            }).strength(d => isCore(d) ? 0.025 : 0.012))
            .velocityDecay(0.42)
            .alphaDecay(0.006);

        // tick
        this.simulation.on('tick', () => {
            this.linkEls.querySelectorAll('line').forEach((line, i) => {
                const l = this.links[i];
                line.setAttribute('x1', l.source.x);
                line.setAttribute('y1', l.source.y);
                line.setAttribute('x2', l.target.x);
                line.setAttribute('y2', l.target.y);
            });
            this.nodeEls.querySelectorAll('.graph-node').forEach((ng, i) => {
                const n = this.nodes[i];
                ng.setAttribute('transform', `translate(${n.x},${n.y})`);
            });
        });

        // 顶部大概念框（HTML overlay）
        this.renderConceptBoxes();

        // 初始化标签可见性
        this.updateLabelVisibility();
    }

    // 根据缩放比例切换标签可见性
    updateLabelVisibility() {
        if (!this.viewport) return;
        const zoomed = this.currentZoomScale > this.labelZoomThreshold;
        this.viewport.classList.toggle('zoomed-in', zoomed);
    }

    // 渲染顶部大概念框
    renderConceptBoxes() {
        const existing = this.container.querySelector('.graph-concepts');
        if (existing) existing.remove();
        const wrap = document.createElement('div');
        wrap.className = 'graph-concepts';
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', '大概念筛选');
        this.conceptBoxes.forEach(box => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'graph-concept-box';
            btn.dataset.key = box.key;
            btn.innerHTML =
                `<span class="graph-concept-label">${box.label}</span>` +
                `<span class="graph-concept-desc">${box.desc}</span>`;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.filterByConcept(box);
            });
            wrap.appendChild(btn);
        });
        this.container.appendChild(wrap);
    }

    // 按概念筛选：高亮匹配节点、暗化其余、显示匹配节点标签
    filterByConcept(box) {
        if (!this.nodeEls) return;
        // 重复点击同概念 → 取消
        if (this.activeConcept === box.key) {
            this.clearConceptFilter();
            return;
        }
        this.clearConceptFilter();

        const matchedIds = new Set(this.nodes.filter(n => box.match(n)).map(n => n.id));
        this.nodeEls.querySelectorAll('.graph-node').forEach(ng => {
            const isMatch = matchedIds.has(ng.dataset.id);
            ng.classList.toggle('concept-match', isMatch);
            ng.classList.toggle('concept-dim', !isMatch);
        });
        this.linkEls.querySelectorAll('line').forEach(line => {
            const hit = matchedIds.has(line.dataset.source) && matchedIds.has(line.dataset.target);
            line.classList.toggle('concept-match', hit);
            line.classList.toggle('concept-dim', !hit);
        });
        this.container.querySelectorAll('.graph-concept-box').forEach(b => {
            b.classList.toggle('active', b.dataset.key === box.key);
        });
        this.activeConcept = box.key;
    }

    clearConceptFilter() {
        if (!this.nodeEls) return;
        this.nodeEls.querySelectorAll('.graph-node').forEach(ng => {
            ng.classList.remove('concept-match', 'concept-dim');
        });
        if (this.linkEls) {
            this.linkEls.querySelectorAll('line').forEach(line => {
                line.classList.remove('concept-match', 'concept-dim');
            });
        }
        this.container.querySelectorAll('.graph-concept-box').forEach(b => b.classList.remove('active'));
        this.activeConcept = null;
    }

    // 搜索高亮：在图谱上点亮命中节点并显示标签
    highlightSearchMatches(query) {
        if (!this.nodeEls) return;
        this.clearSearchHighlight();
        if (!query || !query.trim()) return;
        this.activeSearchQuery = query;
        const q = query.trim().toLowerCase();
        let firstMatch = null;
        this.nodes.forEach(n => {
            const isMatch = (n.title || '').toLowerCase().includes(q) ||
                (n.definition || '').toLowerCase().includes(q);
            if (isMatch) {
                const ng = this.nodeEls.querySelector(`.graph-node[data-id="${CSS.escape(n.id)}"]`);
                if (ng) {
                    ng.classList.add('search-match');
                    if (!firstMatch) firstMatch = ng;
                }
            }
        });
        // 将第一个命中节点滚动到视野中央
        if (firstMatch && this.viewport && this.zoomBehavior) {
            const ng = firstMatch;
            const data = ng.__data__;
            if (data && Number.isFinite(data.x) && Number.isFinite(data.y)) {
                const rect = this.container.getBoundingClientRect();
                const transform = d3.zoomIdentity
                    .translate(rect.width / 2 - data.x * 1.3, rect.height / 2 - data.y * 1.3)
                    .scale(1.3);
                d3.select(this.svg).transition().duration(450).call(this.zoomBehavior.transform, transform);
            }
        }
    }

    clearSearchHighlight() {
        if (!this.nodeEls) return;
        this.nodeEls.querySelectorAll('.search-match').forEach(ng => ng.classList.remove('search-match'));
        this.activeSearchQuery = null;
    }

    loadPositions() {
        try {
            const raw = sessionStorage.getItem(this.positionStorageKey);
            return raw ? JSON.parse(raw) : {};
        } catch (error) {
            return {};
        }
    }

    savePositions() {
        if (!this.nodes.length || !this.container) return;
        const rect = this.container.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const positions = {};
        this.nodes.forEach(node => {
            positions[node.id] = {
                x: Math.max(0, Math.min(1, node.x / rect.width)),
                y: Math.max(0, Math.min(1, node.y / rect.height)),
                pinned: Number.isFinite(node.fx) && Number.isFinite(node.fy),
            };
        });
        try {
            sessionStorage.setItem(this.positionStorageKey, JSON.stringify(positions));
        } catch (error) {
            // 布局保存失败不影响图谱使用。
        }
    }

    clearSelection() {
        this.selectedNode = null;
        this.detailPanel.classList.remove('open');
        if (this.viewport) {
            this.viewport.querySelectorAll('.graph-node').forEach(g => {
                g.style.opacity = '';
                g.classList.remove('selected');
            });
            this.viewport.querySelectorAll('.graph-link').forEach(l => { l.style.opacity = ''; l.style.stroke = ''; });
        }
    }

    onNodeClick(node) {
        this.selectedNode = node;
        const connectedIds = new Set([node.id]);
        this.links.forEach(l => {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            if (s === node.id) connectedIds.add(t);
            if (t === node.id) connectedIds.add(s);
        });

        this.viewport.querySelectorAll('.graph-node').forEach(g => {
            g.classList.toggle('selected', g.dataset.id === node.id);
            g.style.opacity = connectedIds.has(g.dataset.id) ? '1' : '0.1';
        });
        this.viewport.querySelectorAll('.graph-link').forEach(line => {
            const hit = (line.dataset.source === node.id || line.dataset.target === node.id);
            line.style.opacity = hit ? '0.8' : '0.03';
            if (hit) line.style.stroke = '#b9362c';
        });

        this.showDetail(node);
    }

    showDetail(node) {
        const all = [...this.data.nodes, ...this.data.articles];
        const up = (node.upstream || []).map(n => all.find(x => x.title === n)).filter(Boolean);
        const down = (node.downstream || []).map(n => all.find(x => x.title === n)).filter(Boolean);
        const rel = (node.related || []).map(n => all.find(x => x.title === n)).filter(Boolean);

        const linkHtml = (arr) => arr.map(n =>
            `<a href="#/note/${encodeURIComponent(n.title)}" class="detail-link-item">${n.title}</a>`
        ).join('');

        this.detailPanel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <span style="font-size:11px;color:var(--muted);">${this.typeLabel[node.node_type]||''} · ${node.layer||''}</span>
                <button onclick="document.getElementById('graph-detail-panel').classList.remove('open')" style="border:none;background:none;cursor:pointer;font-size:16px;color:var(--muted);">✕</button>
            </div>
            <h3 style="font-size:17px;font-weight:700;color:var(--ink);margin-bottom:6px;">${node.title}</h3>
            <p style="font-size:13px;color:var(--text-light);line-height:1.6;margin-bottom:14px;">${node.definition||''}</p>
            ${up.length?`<div style="margin-bottom:10px;"><div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:4px;">上游</div><div>${linkHtml(up)}</div></div>`:''}
            ${down.length?`<div style="margin-bottom:10px;"><div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:4px;">下游</div><div>${linkHtml(down)}</div></div>`:''}
            ${rel.length?`<div style="margin-bottom:10px;"><div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:4px;">相关</div><div>${linkHtml(rel)}</div></div>`:''}
            <a href="#/note/${encodeURIComponent(node.title)}" style="display:block;text-align:center;padding:9px;background:var(--accent);color:#fff;border-radius:6px;text-decoration:none;font-size:12px;font-weight:600;margin-top:14px;">查看完整内容 →</a>
        `;
        this.detailPanel.classList.add('open');
    }
}

window.ForceGraph = ForceGraph;
