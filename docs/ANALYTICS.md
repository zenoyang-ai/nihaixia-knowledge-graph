# 网页访问统计与飞书日报

国内主站与海外站通过 `docs/assets/analytics.js` 上报 pageview；云函数 `nihaixia-analytics` 聚合后按日发飞书。

- 前端：`docs/assets/analytics.js`（`index.html` asset 版本当前为 `20260723-v21`）
- HTTP：`https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-analytics`
- 集合：`site_daily_stats`（需在控制台已创建）
- 定时触发器：`dailyVisitReport`，cron `0 15 0 * * * *`（本环境 CloudBase cron 按**北京时间**解释，即每天北京 00:15 汇总**前一自然日**）
- 云函数路径：`cloudbase/functions/nihaixia-analytics/`（VERSION `0.1.1`）

## 行为摘要

| 方法 | 说明 |
|------|------|
| `POST` | 上报 `{ type:'pageview', site, path, vid, t }`；失败前端静默 |
| `GET` | 健康检查 / 手工触发报表（以云函数实现为准） |
| 定时器 | 按 `YYYY-MM-DD`（`formatToParts`，勿用 `toLocaleDateString` 默认美式）汇总前一自然日 UV/PV → 飞书 |

`site`：`cn`（CloudBase 静态托管）/ `overseas`（GitHub Pages）/ `local`。

## 飞书与部署注意

- 复用现有飞书应用凭证（与 `nihaixia-feedback` 同类）；`FEISHU_APP_SECRET` **只在控制台配置**。
- `cloudbaserc` 里 **不要**给 analytics / feedback 写空的 `envVariables` 整表覆盖，否则会冲掉云端已有 Secret。
- 部署示例：`cd cloudbase && tcb fn deploy nihaixia-analytics`（以当前 `cloudbaserc.json` 为准）。

## 冒烟

```bash
# 健康检查
curl -s 'https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-analytics' | jq

# 打开国内或海外站任一页面，控制台 Network 应有 pageview POST（可失败静默，但请求应发出）
```

海外站：https://zenoyang-ai.github.io/nihaixia-knowledge-graph/
