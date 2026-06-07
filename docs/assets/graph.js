// 力导向图模块 — d3-force + d3.zoom（交互优化版）
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

        this.layerColor = {
            '底层框架': '#c0392b', '辨证框架': '#2980b9', '方法工具': '#27ae60',
            '案例研读': '#d4a017', '天纪体系': '#8e44ad', '学习路径': '#7f8c8d',
        };
        this.layerAngle = {
            '底层框架': -90, '辨证框架': -18, '方法工具': 54,
            '案例研读': 126, '天纪体系': 198, '学习路径': 270,
        };
        this.typeLabel = { concept:'概念', classic:'经典', formula:'方剂', case:'案例', topic:'文章' };
    }

    render(nodeList) {
        if (!nodeList) nodeList = [...this.data.nodes, ...this.data.articles];
        this.container.innerHTML = '';
        this.detailPanel.classList.remove('open');
        this.selectedNode = null;
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

        const getRadius = (n) => {
            if (n.importance === 'core') return 20;
            return 4 + Math.min(linkCount[n.id] || 0, 8) * 1.0;
        };

        // 初始位置
        const cx = width / 2, cy = height / 2;
        const spread = Math.min(width, height) * 0.36;
        this.nodes.forEach(n => {
            const angle = (this.layerAngle[n.layer] || 0) * Math.PI / 180;
            const jitter = (Math.random() - 0.5) * spread * 0.5;
            const r = spread * (0.4 + Math.random() * 0.6);
            n.x = cx + Math.cos(angle + jitter * 0.01) * r;
            n.y = cy + Math.sin(angle + jitter * 0.01) * r;
        });

        // SVG
        const NS = 'http://www.w3.org/2000/svg';
        this.svg = document.createElementNS(NS, 'svg');
        this.svg.setAttribute('width', width);
        this.svg.setAttribute('height', height);
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
            });

        d3.select(this.svg).call(zoomBehavior).on('dblclick.zoom', null);
        this.zoomBehavior = zoomBehavior;
        this.viewport = g;

        // 边
        this.linkEls = document.createElementNS(NS, 'g');
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
        this.nodes.forEach(n => {
            const ng = document.createElementNS(NS, 'g');
            ng.classList.add('graph-node');
            ng.dataset.id = n.id;
            ng.__data__ = n;

            const r = getRadius(n);
            const color = this.layerColor[n.layer] || '#999';

            const circle = document.createElementNS(NS, 'circle');
            circle.setAttribute('r', r);
            circle.setAttribute('fill', color);
            circle.setAttribute('fill-opacity', n.importance === 'core' ? '0.95' : '0.65');
            circle.setAttribute('stroke', n.importance === 'core' ? '#fff' : 'rgba(255,255,255,0.2)');
            circle.setAttribute('stroke-width', n.importance === 'core' ? '2' : '0.5');

            const text = document.createElementNS(NS, 'text');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dy', -(r + 5));
            text.style.fontSize = n.importance === 'core' ? '13px' : '9px';
            text.style.fontWeight = n.importance === 'core' ? '700' : '400';
            text.style.fill = n.importance === 'core' ? '#2d2520' : '#9a9289';
            text.textContent = n.title;

            ng.appendChild(circle);
            ng.appendChild(text);
            this.nodeEls.appendChild(ng);
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
                    // 松手后保持低 alpha 让节点自然回弹
                    self.simulation.alphaTarget(0.06);
                    setTimeout(() => { if (self.simulation) self.simulation.alphaTarget(0); }, 800);
                }
                d.fx = null;
                d.fy = null;
                setTimeout(() => { dragged = false; }, 100);
            });

        d3.select(this.nodeEls).selectAll('.graph-node').data(this.nodes, d => d.id).call(drag);

        // 点击 — 防拖拽冲突
        d3.select(this.nodeEls).selectAll('.graph-node').on('click', function(event, d) {
            if (dragged) return;
            event.stopPropagation();
            self.onNodeClick(d);
        });

        // hover 高亮
        d3.select(this.nodeEls).selectAll('.graph-node')
            .on('mouseenter', function(event, d) {
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
                if (self.selectedNode) return;
                self.nodeEls.querySelectorAll('.graph-node').forEach(ng => { ng.style.opacity = ''; });
                self.linkEls.querySelectorAll('line').forEach(line => { line.style.opacity = ''; line.style.stroke = ''; });
            });

        // 力模拟
        const isCore = (n) => n.importance === 'core';
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
            .velocityDecay(0.38)
            .alphaDecay(0.008);

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
    }

    clearSelection() {
        this.selectedNode = null;
        this.detailPanel.classList.remove('open');
        this.viewport.querySelectorAll('.graph-node').forEach(g => { g.style.opacity = ''; });
        this.viewport.querySelectorAll('.graph-link').forEach(l => { l.style.opacity = ''; l.style.stroke = ''; });
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
