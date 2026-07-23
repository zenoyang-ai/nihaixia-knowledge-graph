// 学习路径视图模块
class PathView {
    constructor(data) {
        this.data = data;
        this.allNodes = [...data.nodes, ...data.articles];
        this.render();
        this.bindEvents();
    }

    render() {
        // 人纪：倪海厦官方推荐顺序 针灸→内经→本草→伤寒→金匮
        const renjiStages = [
            {
                title: '第一步：针灸大成',
                desc: '先学针灸，建立经络穴位基础，直观感受人体能量系统',
                nodes: ['针灸', '经络']
            },
            {
                title: '第二步：黄帝内经',
                desc: '中医理论根本，理解阴阳五行、脏腑经络的完整框架',
                nodes: ['阴阳', '五行', '天人合一', '脏腑辨证', '气血津液', '黄帝内经']
            },
            {
                title: '第三步：神农本草经',
                desc: '学习中药药性，为经方学习打基础',
                nodes: ['神农本草经', '四气五味', '本草', '炮制']
            },
            {
                title: '第四步：伤寒论与金匮要略',
                desc: '经方核心，掌握六经辨证体系',
                nodes: ['六经辨证', '八纲辨证', '寒热虚实', '表里', '虚实', '病机', '证候', '经方', '方证对应', '方剂', '伤寒论', '金匮要略']
            },
            {
                title: '第五步：医案研读',
                desc: '通过真实医案把理论串起来，培养临床思维',
                nodes: ['医案学习法', '临床案例索引', '血液类病证研读', '免疫相关案例研读', '疑难病证案例研读', '水液代谢类案例研读', '肿块类案例研读', '脏腑复杂案例研读', '望诊案例研读']
            }
        ];

        // 天纪：天机道→人间道→地脉道（天→人→地）
        const tianjiStages = [
            {
                title: '第一步：易经基础与天机道',
                desc: '以易经为轴，建立天地人三才的认知框架',
                nodes: ['天人合一', '阴阳', '五行', '易经', '象数', '三才', '天机道']
            },
            {
                title: '第二步：人间道——紫微斗数与命理',
                desc: '学习紫微斗数、四柱命理，理解人事推演方法',
                nodes: ['人间道', '紫微斗数', '四柱命理']
            },
            {
                title: '第三步：地脉道——风水堪舆',
                desc: '学习地理风水、罗盘使用，理解环境对人的影响',
                nodes: ['地脉道', '风水堪舆']
            },
            {
                title: '第四步：三才贯通',
                desc: '天机道、人间道、地脉道三者互相参照，形成完整体系',
                nodes: ['天纪与人纪']
            }
        ];

        this.renderStages('renji-stages', renjiStages);
        this.renderStages('tianji-stages', tianjiStages);

        // 天纪路径 CTA 链接
        const tianjiContainer = document.getElementById('tianji-stages');
        if (tianjiContainer) {
            const ctaDiv = document.createElement('div');
            ctaDiv.className = 'path-cta';
            ctaDiv.innerHTML = '<a href="#/prompts" class="path-cta-link">不会写提示词？直接使用天纪提示词工具包 →</a>';
            tianjiContainer.appendChild(ctaDiv);
        }
    }

    renderStages(containerId, stages) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = stages.map(stage => `
            <div class="path-stage">
                <div class="path-stage-header">${stage.title}</div>
                <div class="path-stage-content">
                    <div class="path-node-list">
                        ${stage.nodes.map(name => {
                            const node = this.allNodes.find(n => n.title === name);
                            if (!node) return '';
                            return `<a class="path-node" href="#/note/${encodeURIComponent(name)}">${name}</a>`;
                        }).join('')}
                    </div>
                </div>
            </div>
        `).join('');
    }

    bindEvents() {
        document.querySelectorAll('.path-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.path-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.path-content').forEach(c => c.classList.remove('active'));
                const target = document.getElementById(`${tab.dataset.path}-path`);
                if (target) target.classList.add('active');
            });
        });
    }
}

window.PathView = PathView;
