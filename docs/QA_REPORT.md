# QA_REPORT

> 网站数据与质量口径说明。以下内容以当前发布目录和校验脚本为准。

## 当前口径（2026-07-19）

| 指标 | 数值 |
|------|------|
| 图谱节点 `nodes` | 64 |
| 主题文章 `articles` | 5 |
| 内容项合计 | 69 |
| 有向 `node_links` | 338 |
| 运行时去重后无向边 | 283 |
| 悬空 `node_links` | 0 |
| Manifest 资料数 | 231 |
| 可枚举文件数 | 227 |
| 公开原文 `public_sources` | 4（其中 3 可读） |

校验命令：

```bash
python3 scripts/build_site_data.py --validate
```

预期输出包含：

```text
OK nodes_total=69
OK topic_articles=5
OK public_sources=4 (3 readable)
OK medical_safety=learning_only
OK node_links directed=338 undirected=283 dangling=0
```

说明：

- 顶层没有 `links` 数组；图谱边由各节点 `node_links` 在 `docs/assets/graph.js` 运行时派生。
- `nodes_total=69` = 64 节点 + 5 主题文章。
- 旧文档中的「71 节点 / 6 主题文章 / 289 关系」均已作废。

## 医疗安全检查

- [x] 所有节点与主题文章均为 `medical_safety: learning_only`
- [x] 均有「安全边界」章节
- [x] 方剂/案例节点显示额外免责声明
- [x] 页面不提供诊断、处方、剂量、服法建议
