// 路由模块 — hash 路由管理
class Router {
    constructor() {
        this.routes = {};
        this.currentRoute = null;
        this.onRouteChange = null;
        window.addEventListener('hashchange', () => this.handleRoute());
    }

    // 注册路由
    on(pattern, handler) {
        this.routes[pattern] = handler;
        return this;
    }

    // 解析当前 hash
    parse(hash) {
        const path = hash.replace(/^#/, '') || '/';
        // 精确匹配
        if (this.routes[path]) return { pattern: path, params: {}, handler: this.routes[path] };
        // 参数匹配（如 /note/:title）
        for (const pattern of Object.keys(this.routes)) {
            const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
            const match = path.match(regex);
            if (match) return { pattern, params: match.groups || {}, handler: this.routes[pattern] };
        }
        return null;
    }

    // 处理路由变化
    handleRoute() {
        const result = this.parse(window.location.hash);
        if (result) {
            this.currentRoute = result;
            result.handler(result.params);
        }
        if (this.onRouteChange) this.onRouteChange(result);
    }

    // 导航
    navigate(path) {
        window.location.hash = path;
    }

    // 启动
    start() {
        this.handleRoute();
    }
}

window.AppRouter = new Router();
