// 学习路径视图模块
class PathView {
    constructor(data) {
        this.data = data;
        this.allNodes = [...data.nodes, ...data.articles];
        this.render();
        this.bindEvents();
    }

    render() {
        const lp = (this.data && this.data.learning_paths) || {};
        const fallbackPaths = {
            renji: {
                title: '倪海厦人纪学习路径',
                desc: '《人纪》是倪海厦的中医教学体系，严格遵循「针灸 → 黄帝内经 → 神农本草经 → 伤寒论 → 金匮要略 → 医案实战」由浅入深推进。',
                stages: [],
            },
            tianji: {
                title: '倪海厦天纪学习路径',
                desc: '《天纪》以《易经》为轴，内分《天机道》《地脉道》《人间道》三册。',
                stages: [],
            },
        };

        ['renji', 'tianji'].forEach((key) => {
            const cfg = lp[key] || fallbackPaths[key];
            const sectionEl = document.getElementById(`${key}-path`);
            if (sectionEl) {
                const h2El = sectionEl.querySelector('h2');
                const descEl = sectionEl.querySelector('.path-desc');
                if (h2El && cfg.title) h2El.textContent = cfg.title;
                if (descEl && cfg.desc) descEl.textContent = cfg.desc;
            }
            this.renderStages(`${key}-stages`, cfg.stages || []);
        });

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
                    ${stage.desc ? `<p class="path-stage-desc">${stage.desc}</p>` : ''}
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

    setActiveTab(tab) {
        const key = tab === 'tianji' ? 'tianji' : 'renji';
        document.querySelectorAll('.path-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.path === key);
        });
        document.querySelectorAll('.path-content').forEach(c => {
            c.classList.toggle('active', c.id === `${key}-path`);
        });
    }

    bindEvents() {
        document.querySelectorAll('.path-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const key = tab.dataset.path === 'tianji' ? 'tianji' : 'renji';
                this.setActiveTab(key);
                const targetHash = key === 'tianji' ? '#/path/tianji' : '#/path';
                if (window.location.hash !== targetHash) {
                    history.replaceState(null, '', targetHash);
                }
            });
        });
    }
}

window.PathView = PathView;
