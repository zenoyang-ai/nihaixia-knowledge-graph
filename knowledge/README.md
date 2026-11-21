# 倪海厦开源知识库（Knowledge Hub）

本目录沉淀了「倪海厦知识图谱」项目的全部可离线带走与可直接阅读的开源资料，大部头典籍均已按卷/按章拆分，便于在 GitHub 网页端流畅阅读：

| 目录 | 面向人群 | 你可以直接拿走什么？ |
|------|---------|-------------------|
| [`01-知识图谱笔记/`](./01-知识图谱笔记/README.md) | Obsidian / GitHub 读者 | 与线上网站 100% 同步的 **64 节点 + 5 篇专题文章** + 人纪/天纪学习路径（网页端直接点击阅读；Obsidian 打开 [`00-知识图谱总览-MOC.md`](./01-知识图谱笔记/00-知识图谱总览-MOC.md) 享零死链 `[[双链]]`） |
| [`02-AI知识库语料包/`](./02-AI知识库语料包/README.md) | AI / Agent / RAG 玩家 | 单文件 `nihaixia-corpus-all.md`（直拖 NotebookLM / Claude）、`nodes.jsonl` / `edges.jsonl`（接入 Dify / Coze / GraphRAG）+ 5 套天纪提示词 |
| [`03-天纪学习资料/`](./03-天纪学习资料/README.md) | 天纪与术数学习者 | 去噪分卷后的《天机道》《地脉道》《人间道（3 卷）》《易经64卦图》及配套听课笔记 |
| [`04-人纪学习资料/`](./04-人纪学习资料/README.md) | 中医经典与针灸学习者 | 分卷/分章后的《针灸大成（10 卷）》《人纪·针灸篇（课堂实录整理·8 章）》《神农本草经（5 卷）》及内经/伤寒/金匮已校勘节选 |

## 同步与校验

`01-知识图谱笔记/`、`02-AI知识库语料包/` 与站点离线兜底数据 `docs/data/offline-data.js` 均由脚本 [`scripts/export_knowledge_assets.py`](../scripts/export_knowledge_assets.py) 从 `docs/data/graph.json` 与 `docs/data/prompts.json` 自动生成：

```bash
python3 scripts/export_knowledge_assets.py            # 同步 01 / 02 与离线数据包
python3 scripts/export_knowledge_assets.py --validate # 校验零死链、无隐私/路径与排版残留
```

使用边界与著作权声明见 [LICENSE.md](./LICENSE.md)。
