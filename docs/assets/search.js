// 搜索模块 — 全局搜索 + 拼音/缩写/正文召回 + 提示词与 AI 问答兜底
class Search {
    constructor(data) {
        this.data = data;
        this.allNodes = [...data.nodes, ...data.articles];
        this.input = document.getElementById('global-search');
        this.dropdown = document.getElementById('search-dropdown');
        this.bindEvents();
    }

    escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    scoreNode(n, query, pinyinEntries) {
        const title = (n.title || '').toLowerCase();
        const def = (n.definition || '').toLowerCase();
        const summary = (n.summary || '').toLowerCase();
        const core = ((n.sections && n.sections['核心理解']) || '').toLowerCase();
        const q = query.toLowerCase();
        let score = -1;
        let aliasScore = -1;

        for (const [py, targets] of pinyinEntries) {
            const matchedTarget = targets.some((t) => title.includes(t.toLowerCase()));
            if (!matchedTarget) continue;
            if (py === q) aliasScore = Math.max(aliasScore, 520);
            else if (q.length >= 2 && py.startsWith(q)) aliasScore = Math.max(aliasScore, 460);
            else if (q.length >= 2 && py.includes(q)) aliasScore = Math.max(aliasScore, 410);
        }

        if (title === q) score = 1000;
        else if (title.startsWith(q)) score = 800;
        else if (title.includes(q)) score = 600 - Math.min(title.indexOf(q), 40);
        else if (aliasScore >= 0) score = aliasScore;
        else if (def.includes(q)) score = 200 - Math.min(def.indexOf(q), 80);
        else if (summary.includes(q)) score = 120 - Math.min(summary.indexOf(q), 40);
        else if (core.includes(q)) score = 90 - Math.min(core.indexOf(q), 30);
        return score;
    }

    bindEvents() {
        if (!this.input) return;

        const pinyinMap = {
            'shanghanlun': ['伤寒论'], 'shl': ['伤寒论'],
            'huangdineijing': ['黄帝内经'], 'hdnj': ['黄帝内经'],
            'jinguiyaolue': ['金匮要略'], 'jgyl': ['金匮要略'],
            'shennongbencaojing': ['神农本草经'], 'snbcj': ['神农本草经'],
            'guizhitang': ['桂枝汤'], 'gzt': ['桂枝汤'],
            'mahuangtang': ['麻黄汤'], 'mht': ['麻黄汤'],
            'xiaochaihutang': ['小柴胡汤'], 'xcht': ['小柴胡汤'],
            'wulingsan': ['五苓散'], 'wls': ['五苓散'],
            'sinitang': ['四逆汤'], 'snt': ['四逆汤'],
            'zhenwutang': ['真武汤'], 'zwt': ['真武汤'],
            'baihutang': ['白虎汤'], 'bht': ['白虎汤'],
            'jinguishenqiwan': ['金匮肾气丸'], 'jgsqw': ['金匮肾气丸'],
            'ziweidoushu': ['紫微斗数'], 'ziwei': ['紫微斗数'], 'zwds': ['紫微斗数'],
            'bazi': ['四柱命理'], 'bz': ['四柱命理'], 'sizhumingli': ['四柱命理'], 'szml': ['四柱命理'],
            'tianji': ['天纪'], 'tj': ['天纪'],
            'renji': ['人纪'], 'rj': ['人纪'],
            'tianjidao': ['天机道'], 'tjd': ['天机道'],
            'dimaidao': ['地脉道'], 'dmd': ['地脉道'],
            'renjiandao': ['人间道'], 'rjd': ['人间道'],
            'fengshui': ['风水堪舆'], 'fengshuikanyu': ['风水堪舆'], 'fsky': ['风水堪舆'],
            'yangzhai': ['阳宅定位'], 'yangzhaidingwei': ['阳宅定位'], 'yzdw': ['阳宅定位'],
            'yijing': ['易经'], 'yj': ['易经'],
            'liushisigua': ['六十四卦'], '64gua': ['六十四卦'], 'lssg': ['六十四卦'],
            'xiangshu': ['象数'], 'xs': ['象数'],
            'yiguojuexing': ['以果决行'], 'ygjx': ['以果决行'],
            'sancai': ['三才'], 'sc': ['三才'],
            'yinyang': ['阴阳'], 'yy': ['阴阳'],
            'wuxing': ['五行'], 'wx': ['五行'],
            'tianrenheyi': ['天人合一'], 'trhy': ['天人合一'],
            'zhenjiudacheng': ['针灸大成'], 'zjdc': ['针灸大成'],
            'zhenjiu': ['针灸'], 'zj': ['针灸'],
            'jingluo': ['经络'], 'jl': ['经络'],
            'bencao': ['本草'], 'bc': ['本草'],
            'bagang': ['八纲辨证'], 'bagangbianzheng': ['八纲辨证'], 'bgbz': ['八纲辨证'],
            'liujing': ['六经辨证'], 'liujingbianzheng': ['六经辨证'], 'ljbz': ['六经辨证'],
            'zangfu': ['脏腑辨证'], 'zangfubianzheng': ['脏腑辨证'], 'zfbz': ['脏腑辨证'],
            'fuyang': ['扶阳'], 'fy': ['扶阳'],
            'jingfang': ['经方'], 'jf': ['经方'],
        };
        const pinyinEntries = Object.entries(pinyinMap);

        this.input.addEventListener('input', () => {
            const query = this.input.value.trim();
            if (!query) {
                this.dropdown.classList.remove('show');
                this.dropdown.innerHTML = '';
                return;
            }

            const qLower = query.toLowerCase();
            const scored = this.allNodes
                .map((n) => ({ n, score: this.scoreNode(n, query, pinyinEntries) }))
                .filter((x) => x.score >= 0)
                .sort((a, b) => b.score - a.score || (a.n.title || '').localeCompare(b.n.title || '', 'zh'))
                .slice(0, 8)
                .map((x) => x.n);

            const itemsHtml = scored.map(n => {
                const title = this.escapeHtml(n.title);
                const def = this.escapeHtml(n.definition);
                return `
                <div class="search-dropdown-item" role="option" tabindex="0" data-title="${title}">
                    <div class="search-dropdown-item-title">${title}</div>
                    <div class="search-dropdown-item-sub">${def}</div>
                </div>`;
            });

            const actionItems = [];
            if (/小六壬|xlr|掐指/i.test(qLower)) {
                actionItems.push(`
                <div class="search-dropdown-item search-dropdown-action" role="option" tabindex="0" data-href="#/prompts">
                    <div class="search-dropdown-item-title">🔮 前往「天纪提示词」查看小六壬工具卡 →</div>
                    <div class="search-dropdown-item-sub">含小六壬日常小事快断提示词与时间起课模板</div>
                </div>`);
            }

            if (scored.length === 0) {
                actionItems.push(`
                <div class="search-dropdown-item search-dropdown-action" role="option" tabindex="0" data-href="#/qa?q=${encodeURIComponent(query)}">
                    <div class="search-dropdown-item-title">💬 去 AI 问答提问「${this.escapeHtml(query)}」→</div>
                    <div class="search-dropdown-item-sub">未在 69 个图谱节点命中标题，可直接在站内知识库语料中检索问答</div>
                </div>`);
            }

            this.dropdown.innerHTML = [...itemsHtml, ...actionItems].join('');
            this.dropdown.setAttribute('role', 'listbox');
            this.dropdown.classList.add('show');

            this.dropdown.querySelectorAll('.search-dropdown-item').forEach(item => {
                const go = () => {
                    if (item.dataset.href) {
                        window.location.hash = item.dataset.href.replace(/^#/, '');
                    } else if (item.dataset.title) {
                        window.location.hash = `/note/${encodeURIComponent(item.dataset.title)}`;
                    }
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
