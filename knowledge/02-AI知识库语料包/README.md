# AI 知识库语料包

与在线网站同步导出，用来直接喂给大模型或接入自己的知识库工具。

| 文件 | 里头是什么 | 怎么用 |
|------|------|---------|
| [`nihaixia-corpus-all.md`](./nihaixia-corpus-all.md) | 64 张概念卡 + 5 篇专题 + 学习路径 + 5 套天纪提示词 | 直接拖进 NotebookLM、Claude、ChatGPT 或 Kimi 陪读 |
| [`nodes.jsonl`](./nodes.jsonl) | 64 条节点数据（含定义、白话解释、安全边界） | 导入 Dify、Coze、Cherry Studio 或向量库 |
| [`articles.jsonl`](./articles.jsonl) | 5 篇专题文章数据 | 补充长文检索 |
| [`edges.jsonl`](./edges.jsonl) | 338 条节点关联边 | 搭 GraphRAG 或做图谱分析 |
| [`tianji-prompts.md`](./tianji-prompts.md) | 5 套天纪提示词完整版 | 直接复制使用 |
| [`MANIFEST.json`](./MANIFEST.json) | 机器可读数据清单、条数、许可口径与 SHA-256 校验和 | 给自动化脚本或 RAG 流水线核验版本 |

如果想在 Claude Code、Cursor、Codex 里直接安装天纪提示词，看 [`skills/nihaixia-tianji/`](../../skills/nihaixia-tianji/README.md)。
