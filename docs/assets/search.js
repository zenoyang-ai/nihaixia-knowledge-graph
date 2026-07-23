// 搜索模块 — 全局搜索 + 下拉建议（标题精确匹配优先）
class Search {
    constructor(data) {
        this.data = data;
        this.allNodes = [...data.nodes, ...data.articles];
        this.input = document.getElementById('global-search');
        this.dropdown = document.getElementById('search-dropdown');
        this.bindEvents();
    }

    scoreNode(n, query, pinyinMap) {
        const title = (n.title || '').toLowerCase();
        const def = (n.definition || '').toLowerCase();
        const q = query.toLowerCase();
        let score = -1;
        let pyMatch = false;
        for (const [py, name] of Object.entries(pinyinMap)) {
            if (py.includes(q) && title.includes(name)) {
                pyMatch = true;
                break;
            }
        }
        if (title === q) score = 1000;
        else if (title.startsWith(q)) score = 800;
        else if (title.includes(q)) score = 600 - Math.min(title.indexOf(q), 40);
        else if (pyMatch) score = 450;
        else if (def.includes(q)) score = 200 - Math.min(def.indexOf(q), 80);
        return score;
    }

    bindEvents() {
        if (!this.input) return;

        const pinyinMap = {
            'shanghanlun': '伤寒论', 'shl': '伤寒论',
            'huangdineijing': '黄帝内经', 'hdnj': '黄帝内经',
            'jinguiyaolue': '金匮要略', 'jgyl': '金匮要略',
            'shennongbencaojing': '神农本草经', 'snbcj': '神农本草经',
            'guizhitang': '桂枝汤', 'gzt': '桂枝汤',
            'mahuangtang': '麻黄汤', 'mht': '麻黄汤',
            'xiaochaihutang': '小柴胡汤', 'xcht': '小柴胡汤',
            'wulingsan': '五苓散', 'wls': '五苓散',
            'ziweidoushu': '紫微斗数', 'zwds': '紫微斗数',
            'yijing': '易经', 'yj': '易经',
            'zhenjiu': '针灸', 'zj': '针灸',
        };

        this.input.addEventListener('input', () => {
            const query = this.input.value.trim();
            if (!query) {
                this.dropdown.classList.remove('show');
                this.dropdown.innerHTML = '';
                return;
            }

            const scored = this.allNodes
                .map((n) => ({ n, score: this.scoreNode(n, query, pinyinMap) }))
                .filter((x) => x.score >= 0)
                .sort((a, b) => b.score - a.score || (a.n.title || '').localeCompare(b.n.title || '', 'zh'))
                .slice(0, 8)
                .map((x) => x.n);

            if (scored.length === 0) {
                this.dropdown.classList.remove('show');
                return;
            }

            this.dropdown.innerHTML = scored.map(n => {
                const title = String(n.title || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
                const def = String(n.definition || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                return `
                <div class="search-dropdown-item" role="option" tabindex="0" data-title="${title}">
                    <div class="search-dropdown-item-title">${title}</div>
                    <div class="search-dropdown-item-sub">${def}</div>
                </div>`;
            }).join('');

            this.dropdown.setAttribute('role', 'listbox');
            this.dropdown.classList.add('show');

            this.dropdown.querySelectorAll('.search-dropdown-item').forEach(item => {
                const go = () => {
                    window.location.hash = `/note/${encodeURIComponent(item.dataset.title)}`;
                    this.input.value = '';
                    this.dropdown.classList.remove('show');
                };
                item.addEventListener('click', go);
                item.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        go();
                    }
                });
            });
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.header-search')) {
                this.dropdown.classList.remove('show');
            }
        });

        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const first = this.dropdown.querySelector('.search-dropdown-item');
                if (first) first.click();
            }
            if (e.key === 'Escape') {
                this.dropdown.classList.remove('show');
            }
        });
    }
}

window.Search = Search;
