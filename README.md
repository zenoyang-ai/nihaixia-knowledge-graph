# 倪海厦知识图谱

#### 把倪海厦公开教学体系整理成一张「在线可探索 + 离线可带走 + AI 可直接调用」的知识地图

[![License](https://img.shields.io/badge/license-MIT%20%2F%20CC%20BY--SA%204.0-blue)](./LICENSE)
[![Graph](https://img.shields.io/badge/%E7%9F%A5%E8%AF%86%E5%9B%BE%E8%B0%B1-64%20%E8%8A%82%E7%82%B9%20%C2%B7%205%20%E4%B8%93%E9%A2%98%20%C2%B7%20338%20%E5%85%B3%E7%B3%BB-purple)](https://www.nihaixia-knowledge.xyz/#/graph)
[![Main Site](https://img.shields.io/badge/%E5%9C%A8%E7%BA%BF%E4%B8%BB%E7%AB%99-nihaixia--knowledge.xyz-b9362c)](https://www.nihaixia-knowledge.xyz/)
[![GitHub Pages](https://img.shields.io/badge/%E6%B5%B7%E5%A4%96%E5%A4%87%E4%BB%BD-GitHub%20Pages-brightgreen)](https://zenoyang-ai.github.io/nihaixia-knowledge-graph/)

> **访问入口**：国内主站 [www.nihaixia-knowledge.xyz](https://www.nihaixia-knowledge.xyz/) ｜ 腾讯云备用 [CloudBase](https://zeno-d9g0gdvw4a57635c0-1452182285.tcloudbaseapp.com/) ｜ 海外备份 [GitHub Pages](https://zenoyang-ai.github.io/nihaixia-knowledge-graph/)
> **使用边界**：本项目仅供个人非商业学习与知识工程研究；古籍与批注文本中出现的历史剂量、经方配伍与灸法表述均保留文献原貌，仅供文献研习，不构成个人用药指导、医疗诊断或治疗方案。详见 [内容声明](./CONTENT_NOTICE.md) 与 [开源资料声明](./knowledge/LICENSE.md)。

---

## 在线网站 vs GitHub 仓库，有什么区别？

| 渠道 | 更适合用来做什么 | 你能直接获得什么 |
|------|------------------|------------------|
| **在线图谱网站** | 交互探索与即时问答 | D3 力导向图谱、人纪/天纪学习路径、64 个节点 + 5 篇专题详情、5 套天纪提示词、CloudBase Hybrid RAG 问答、分享海报生成 |
| **本 GitHub 仓库** | **离线收藏、喂给 AI 与二次搭建** | **1）Obsidian 零死链双链笔记库**；**2）NotebookLM / Dify / Coze AI 语料包**；**3）按卷分章的天纪/人纪阅读库**；**4）天纪 Agent Skill**；**5）网站与小程序全栈源码** |

---

## 你能从本仓库直接带走什么？

### 1. [`knowledge/`](./knowledge/README.md) — 结构化知识库与开源阅读资料（120+ 篇文档 · 约 92 万字 · 单文件均 ≤ 186 KB）

- **[`01-知识图谱笔记/`](./knowledge/01-知识图谱笔记/README.md)**：由线上真源 [graph.json](./docs/data/graph.json) 自动生成的 **64 个节点 + 5 篇专题文章 + 人纪/天纪学习路径**；GitHub 网页可直接点击阅读，导入 Obsidian 打开 [`00-知识图谱总览-MOC.md`](./knowledge/01-知识图谱笔记/00-知识图谱总览-MOC.md) 即可享零死链 `[[双链]]`。
- **[`02-AI知识库语料包/`](./knowledge/02-AI知识库语料包/README.md)**：开箱即用的大模型/Agent 底座：
  - [`nihaixia-corpus-all.md`](./knowledge/02-AI知识库语料包/nihaixia-corpus-all.md)：合并单文件，可直接拖入 NotebookLM / Claude / ChatGPT / Kimi；
  - [`nodes.jsonl`](./knowledge/02-AI知识库语料包/nodes.jsonl)（64 条）、[`articles.jsonl`](./knowledge/02-AI知识库语料包/articles.jsonl)（5 条）、[`edges.jsonl`](./knowledge/02-AI知识库语料包/edges.jsonl)（338 条有向关系）：适合接入 Dify、Coze、Cherry Studio 或构建 GraphRAG；
  - [`tianji-prompts.md`](./knowledge/02-AI知识库语料包/tianji-prompts.md)：5 套天纪提示词完整 Markdown。
- **[`03-天纪学习资料/`](./knowledge/03-天纪学习资料/README.md)**：保留原文并去噪分卷的《天机道》《地脉道》[《人间道》（3 卷）](./knowledge/03-天纪学习资料/03-人间道/README.md)《易经64卦图》及[配套听课笔记](./knowledge/03-天纪学习资料/笔记与参考/README.md)。
- **[`04-人纪学习资料/`](./knowledge/04-人纪学习资料/README.md)**：明·杨继洲[《针灸大成》（十卷全本）](./knowledge/04-人纪学习资料/针灸大成/README.md)、[《人纪·针灸篇（课堂实录整理·8 章）》](./knowledge/04-人纪学习资料/人纪-针灸篇/README.md)、[《神农本草经（批注整理·5 卷）》](./knowledge/04-人纪学习资料/神农本草经/README.md)及[《黄帝内经》《伤寒论》《金匮要略》已校勘节选](./knowledge/04-人纪学习资料/经方与内经节选/README.md)（其余篇章持续校勘中）。

### 2. [`skills/nihaixia-tianji/`](./skills/nihaixia-tianji/SKILL.md) — 天纪提示词 Agent Skill

本仓库已整合天纪 Agent Skill，支持 **Claude Code / Cursor / Codex / Antigravity** 等主流 Agent 客户端一键安装（覆盖八字校盘、大运流年、紫微命盘解读、易经三才拆解与小六壬快断）：

```bash
npx skills add zenoyang-ai/nihaixia-knowledge-graph --skill nihaixia-tianji
```

如果你使用 Codex 内置 Python 安装脚本，也可以运行：

```bash
python3 ~/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py \
  --repo zenoyang-ai/nihaixia-knowledge-graph \
  --path skills/nihaixia-tianji
```

### 3. 全栈工程模板 — 10 分钟复刻你自己的知识图谱网站

如果你想把任意学科、读书笔记或个人知识库做成同款「宣纸浅色 / 暖棕夜读」双主题知识图谱：

1. Fork 本仓库，按 `docs/data/graph.json` 结构替换你的节点、文章与 `node_links` 关系；
2. 运行校验与资产同步脚本：
   ```bash
   python3 scripts/build_site_data.py --validate
   python3 scripts/export_knowledge_assets.py
   ```
3. 本地预览 `docs/` 静态站点（零构建依赖，**直接双击 `docs/index.html` 即可离线浏览完整图谱**，也可起本地服务预览，或直接部署 GitHub Pages / CloudBase / Vercel）：
   ```bash
   python3 -m http.server 8765 --directory docs
   ```

---

## 仓库架构与部署说明

- **`docs/`**：纯原生 HTML / CSS / ES6 + D3.js v7 + marked.js 静态站点（推送 `main` 后通过 [deploy.yml](./.github/workflows/deploy.yml) 自动部署至腾讯云 CloudBase，同时支持 GitHub Pages）。
- **`miniprogram/` & `cloudbase/`**：配套微信小程序与 CloudBase 云函数（`nihaixia-qa-router` / `nihaixia-qa-mp` Hybrid RAG、`nihaixia-feedback` 飞书反馈、`nihaixia-analytics` 访问与 GitHub 导流点击统计，见 [ANALYTICS.md](./docs/ANALYTICS.md) 与 [FEEDBACK_REAL_API.md](./docs/FEEDBACK_REAL_API.md)）。
- **`scripts/` & `tests/`**：站点数据校验（`build_site_data.py`）、知识库资产导出与零死链/排版校验（`export_knowledge_assets.py`）、QA 语料脱敏构建（`build_qa_corpus.py` / `generate-knowledge-base.js`）以及全套路由、安全与统计单元测试。
- 部署凭证仅保存于平台环境变量与 GitHub Secrets（`CLOUDBASE_SECRET_ID` / `CLOUDBASE_SECRET_KEY`），仓库不保存本机路径或个人密钥。

---

## 适合谁 / 不适合谁

| 适合 | 不适合（主动边界） |
|------|------------------|
| 想系统梳理倪海厦人纪与天纪知识脉络的学习者 | 想直接照搬文献中历史剂量或附方进行个人自诊自疗的人 |
| 需要 Obsidian 双链笔记库或分卷版经典读物的读者 | 想寻找《汉唐方剂讲解》或患者临床医案全文的人（本仓库不收录） |
| 想给 NotebookLM / Dify / Coze 挂载中医与术数知识库的 AI 玩家 | 想将本仓库资料用于任何商业售卖或付费培训打包的人 |

---

## 许可与著作权说明

- **源码与脚本**：[MIT License](./LICENSE)
- **原创图谱节点、专题文章、提示词与 Agent Skill**：[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- **古籍原典与公开流传学习资料**：古代医经原典（如明·杨继洲《针灸大成》及四部经典古文）属于公有领域；涉及倪海厦先生著作、批注及课堂讲授思想的公开整理内容，著作权归**倪海厦先生**及其权利继承人所有，仅限非商业学习研究。详情见 [CONTENT_NOTICE.md](./CONTENT_NOTICE.md) 与 [knowledge/LICENSE.md](./knowledge/LICENSE.md)，若权利方有任何异议请通过 GitHub Issues 联系，核实后 7 个工作日内移除。
