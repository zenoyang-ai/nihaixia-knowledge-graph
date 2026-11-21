# 参与贡献

欢迎一起把这份资料整理得更准、更干净。不管你懂不懂写代码，都能帮忙。

## 最欢迎的四类贡献

1. **错字与排版勘误**：阅读 [`knowledge/`](./knowledge/README.md) 时发现错别字、断行异常、OCR 残字或死链，直接提 PR 或开 [勘误 Issue](https://github.com/zenoyang-ai/nihaixia-knowledge-graph/issues/new?template=1-correction.yml)。
2. **三大经典接力校勘**：[`knowledge/04-人纪学习资料/经方与内经节选/`](./knowledge/04-人纪学习资料/经方与内经节选/README.md) 中的《黄帝内经》《伤寒论》《金匮要略》目前只收录了前序可读章节，欢迎按章节校对、补全干净文本。
3. **图谱节点与关系补充**：修改 [`docs/data/graph.json`](./docs/data/graph.json) 补充新概念、原话出处或常见误区。
4. **网站体验与天纪提示词优化**：改进 [`docs/`](./docs/) 的前端交互，或完善 [`skills/nihaixia-tianji/`](./skills/nihaixia-tianji/README.md)。

## 提交前守住 4 条底线

- **不收临床患者医案全文和汉唐临床处方合集**，只保留学习框架与公版/公开讲授文本。
- **不夹带个人隐私、第三方网盘链接、公众号广告或无关个人点评**。
- **单文件尽量控制在 200 KB 以内**，大部头内容按卷或按章拆分，方便在网页上直接翻看。
- **不提交密钥、本机绝对路径或临时缓存文件**。

## 提交 PR 前跑两行自检

如果你改了 `docs/data/graph.json`、`docs/data/prompts.json` 或 `knowledge/` 里的文件，提交前在仓库根目录跑一下同步和校验：

```bash
python3 scripts/build_site_data.py --validate
python3 scripts/export_knowledge_assets.py
```

脚本会自动同步 `01-知识图谱笔记/`、`02-AI知识库语料包/`（含 `MANIFEST.json`）和 `docs/data/offline-data.js`，并检查死链、行尾空白、隐私与格式残留。如果改了前端或云函数代码，再顺手跑一遍测试：

```bash
python3 tests/test_export_knowledge_assets.py
node --test tests/test_qa_router.js tests/test_qa_answer_policy.js tests/test_analytics.js tests/test_feedback.js tests/test_qa_mp.js
```
