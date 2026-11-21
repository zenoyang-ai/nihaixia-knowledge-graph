# 开源知识库

这里放着整个项目可以离线保存、直接阅读和喂给 AI 的资料，大部头文档都已经按卷或按章拆开（单文件不超过 186 KB），在 GitHub 网页上也能流畅翻看。

| 目录 | 适合干什么 | 里头有什么 |
|------|---------|-------------------|
| [`01-知识图谱笔记/`](./01-知识图谱笔记/README.md) | 在线查概念 / 导入 Obsidian | 与网站同步的 64 张节点卡 + 5 篇专题 + 2 条学习路径（Obsidian 用户打开 [`00-知识图谱总览-MOC.md`](./01-知识图谱笔记/00-知识图谱总览-MOC.md) 即可用双链） |
| [`02-AI知识库语料包/`](./02-AI知识库语料包/README.md) | 喂给 AI 陪读或搭 RAG | 合并单文件 `nihaixia-corpus-all.md`、`nodes/articles/edges.jsonl` 和 5 套天纪提示词 |
| [`03-天纪学习资料/`](./03-天纪学习资料/README.md) | 系统读《天纪》 | 《天机道》《地脉道》《人间道（3 卷）》《易经64卦图》和听课笔记 |
| [`04-人纪学习资料/`](./04-人纪学习资料/README.md) | 系统读《人纪》与经典 | 《针灸大成（10 卷）》《人纪·针灸篇（8 章）》《神农本草经（5 卷）》及内经/伤寒/金匮已校勘节选 |

## 数据同步

`01-知识图谱笔记/`、`02-AI知识库语料包/` 和离线数据包 `docs/data/offline-data.js` 均由 [`scripts/export_knowledge_assets.py`](../scripts/export_knowledge_assets.py) 自动生成：

```bash
python3 scripts/export_knowledge_assets.py            # 同步 01 / 02 与离线数据包
python3 scripts/export_knowledge_assets.py --validate # 校验链接、路径与排版
```

著作权与使用边界见 [LICENSE.md](./LICENSE.md)。
