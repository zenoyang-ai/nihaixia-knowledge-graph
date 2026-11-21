# AI / Agent 知识库语料包

本目录由线上图谱数据自动导出，方便直接导入各类大模型或 AI 知识库工具。

## 文件清单

| 文件 | 内容 | 适用场景 |
|------|------|---------|
| [`nihaixia-corpus-all.md`](./nihaixia-corpus-all.md) | 64 节点 + 5 专题 + 学习路径 + 5 套天纪提示词合并单文件 | 直接拖入 **NotebookLM / Claude / ChatGPT / Kimi** 做问答底座 |
| [`nodes.jsonl`](./nodes.jsonl) | 64 条结构化节点 JSONL（含定义、白话、边界） | 导入 **Dify / Coze / Cherry Studio** 或向量库 |
| [`articles.jsonl`](./articles.jsonl) | 5 篇主题文章 JSONL | 补充长文检索 |
| [`edges.jsonl`](./edges.jsonl) | 338 条有向知识关系边 | 构建 **GraphRAG** 或知识网络分析 |
| [`tianji-prompts.md`](./tianji-prompts.md) | 5 套天纪提示词完整 Markdown | 复制使用或作为 Agent Prompt 模板 |

> 需要给 Codex / Claude Code 等 Agent 安装可调用技能，请见仓库根目录 [`skills/nihaixia-tianji/`](../../skills/nihaixia-tianji/SKILL.md)。
