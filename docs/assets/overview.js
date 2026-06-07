// 总览视图模块
class Overview {
    constructor(data) {
        this.data = data;
        this.allNodes = [...data.nodes, ...data.articles];
        this.activeStage = 0;
        this.render();
    }

    render() {
        const stats = this.data.stats;
        const nodesEl = document.getElementById('stat-nodes');
        const sourcesEl = document.getElementById('stat-sources');
        if (nodesEl) nodesEl.textContent = stats.nodes_total;
        if (sourcesEl) sourcesEl.textContent = stats.manifest_total || stats.indexed_sources;
        document.getElementById('node-count').textContent = `${stats.nodes_total} 个节点`;

        // 五层阶段卡片
        this.stages = [
            { num: '01', name: '底层框架', desc: '阴阳五行，天人关系', layers: ['底层框架'], color: '#c0392b' },
            { num: '02', name: '辨证框架', desc: '八纲六经，脏腑经络', layers: ['辨证框架'], color: '#2980b9' },
            { num: '03', name: '方法工具', desc: '经方本草，针灸方剂', layers: ['方法工具'], color: '#27ae60' },
            { num: '04', name: '案例研读', desc: '医案索引，望诊学习', layers: ['案例研读'], color: '#d4a017' },
            { num: '05', name: '天纪体系', desc: '易经象数，三才贯通', layers: ['天纪体系'], color: '#8e44ad' },
        ];

        const stagesRow = document.getElementById('stages-row');
        if (stagesRow) {
            stagesRow.innerHTML = this.stages.map((s, i) => `
                <div class="stage-card${i === 0 ? ' active' : ''}" data-stage="${i}">
                    <div class="stage-num" style="color:${s.color}">${s.num}</div>
                    <div class="stage-name">${s.name}</div>
                    <div class="stage-desc">${s.desc}</div>
                </div>
            `).join('');

            // 点击阶段卡片
            stagesRow.querySelectorAll('.stage-card').forEach(card => {
                card.addEventListener('click', () => {
                    stagesRow.querySelectorAll('.stage-card').forEach(c => c.classList.remove('active'));
                    card.classList.add('active');
                    this.activeStage = parseInt(card.dataset.stage);
                    this.renderStageContent();
                });
            });

            this.renderStageContent();
        }
    }

    renderStageContent() {
        const stage = this.stages[this.activeStage];
        const stageNodes = this.allNodes.filter(n => stage.layers.includes(n.layer));

        // 移除旧的内容区域
        const oldContent = document.querySelector('.stage-content');
        if (oldContent) oldContent.remove();

        // 在 stages-row 后面插入新内容
        const stagesRow = document.getElementById('stages-row');
        if (!stagesRow) return;

        const descriptions = {
            '底层框架': '阴阳五行是整个体系的地基。不理解阴阳，后面所有辨证都是空中楼阁。',
            '辨证框架': '八纲辨证、六经辨证、脏腑辨证——三大辨证体系构成诊断的核心骨架。',
            '方法工具': '经方、本草、针灸是三大治疗支柱。经方内服，针灸外治，本草为底。',
            '案例研读': '通过医案把理论串起来。先遮住诊断和处方，自己尝试辨证，再对照倪海厦的判断。',
            '天纪体系': '天机道、地脉道、人间道三才贯通，以易经为轴，研究天地人关系。',
        };

        const contentHtml = `
            <div class="stage-content active">
                <div class="stage-content-text">${descriptions[stage.name] || ''}</div>
                <div class="stage-nodes">
                    ${stageNodes.map(n => `<a class="stage-node" href="#/note/${encodeURIComponent(n.title)}">${n.title}</a>`).join('')}
                </div>
            </div>
        `;

        stagesRow.insertAdjacentHTML('afterend', contentHtml);
    }
}

window.Overview = Overview;
