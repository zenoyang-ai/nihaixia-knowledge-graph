// 搜索模块 — 全局搜索 + 下拉建议
class Search {
    constructor(data) {
        this.data = data;
        this.allNodes = [...data.nodes, ...data.articles];
        this.input = document.getElementById('global-search');
        this.dropdown = document.getElementById('search-dropdown');
        this.bindEvents();
    }

    bindEvents() {
        if (!this.input) return;

        this.input.addEventListener('input', () => {
            const query = this.input.value.trim().toLowerCase();
            if (!query) {
                this.dropdown.classList.remove('show');
                return;
            }

            const results = this.allNodes.filter(n =>
                n.title.toLowerCase().includes(query) ||
                (n.definition || '').toLowerCase().includes(query)
            ).slice(0, 8);

            if (results.length === 0) {
                this.dropdown.classList.remove('show');
                return;
            }

            this.dropdown.innerHTML = results.map(n => `
                <div class="search-dropdown-item" data-title="${n.title}">
                    <div class="search-dropdown-item-title">${n.title}</div>
                    <div class="search-dropdown-item-sub">${n.definition || ''}</div>
                </div>
            `).join('');

            this.dropdown.classList.add('show');

            this.dropdown.querySelectorAll('.search-dropdown-item').forEach(item => {
                item.addEventListener('click', () => {
                    window.location.hash = `/note/${encodeURIComponent(item.dataset.title)}`;
                    this.input.value = '';
                    this.dropdown.classList.remove('show');
                });
            });
        });

        // 点击外部关闭
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.header-search')) {
                this.dropdown.classList.remove('show');
            }
        });

        // 回车跳转
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const first = this.dropdown.querySelector('.search-dropdown-item');
                if (first) first.click();
            }
        });
    }
}

window.Search = Search;
