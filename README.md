# 倪海厦知识图谱

#### 把倪海厦公开教学资料整理成一张能走进去的知识地图

🌐 **国内主站（推荐）**：[https://zeno-d9g0gdvw4a57635c0-1452182285.tcloudbaseapp.com](https://zeno-d9g0gdvw4a57635c0-1452182285.tcloudbaseapp.com)
🌏 **海外备份**：[https://zenoyang-ai.github.io/nihaixia-knowledge-graph/](https://zenoyang-ai.github.io/nihaixia-knowledge-graph/) · [内容声明](./CONTENT_NOTICE.md)

![License](https://img.shields.io/badge/license-MIT-blue)
![Nodes](https://img.shields.io/badge/nodes-69-purple)
![CloudBase](https://img.shields.io/badge/CloudBase-国内主站-blue)
![GitHub Pages](https://img.shields.io/badge/GitHub-Pages-海外备份-brightgreen)

这不是原文资料仓库，而是一个面向学习者的知识入口：用图谱、学习路径和知识卡片，把倪海厦的人纪、天纪、经方、针灸、本草、案例研读串起来。

---

## 你可以用它做什么

| 入口 | 适合做什么 |
|---|---|
| 知识图谱 | 看 69 个节点之间怎么互相连接 |
| 学习路径 | 按人纪 / 天纪路径进入体系 |
| 节点卡片 | 快速理解一个概念的定义、上下游、学习边界 |
| 天纪提示词 | 用八字、紫微、易经、小六壬做结构化自我复盘 |
| AI 问答 | CloudBase Hybrid RAG，基于站内知识语料检索生成 |
| 搜索 | 快速定位节点 |

---

## 适合谁

- 想系统理解倪海厦教学体系的学习者
- 已有一堆资料，但不知道从哪里进入的人
- 想用 AI + 知识图谱整理复杂知识体系的人

## 不适合谁

- 想直接找处方、剂量、治疗方案的人
- 想看完整课程原文或医案全文的人
- 想把它当医疗建议使用的人

---

## 项目内容

- 64 个图谱节点 + 5 篇主题文章（合计 69 个内容项）
- 338 条有向 `node_links`（运行时去重后无向边 283）
- 五层知识架构
- 人纪 / 天纪学习路径
- 5 篇主题文章
- 天纪提示词工具包

---

## 访问入口与部署架构

本项目采用**双线部署**，一份代码、两处托管：

| 角色 | 地址 | 说明 |
|---|---|---|
| 国内主站 | https://zeno-d9g0gdvw4a57635c0-1452182285.tcloudbaseapp.com | 腾讯云 CloudBase 静态托管，国内访问稳定，推荐 |
| 海外备份 | https://zenoyang-ai.github.io/nihaixia-knowledge-graph/ | GitHub Pages，海外与开发者友好 |

- **静态站点**（`docs/`）：推送 `main` 分支后，GitHub Action（`.github/workflows/deploy.yml`）自动部署到 CloudBase；同时 GitHub Pages 自动从 `docs/` 发布。
- **云端函数**（AI 问答 RAG）：由 `cloudbaserc.json` 定义，单独部署。
- 部署凭证以 GitHub Secrets（`CLOUDBASE_SECRET_ID` / `CLOUDBASE_SECRET_KEY`）保存，为腾讯云 API 密钥（CAM）。

## 本地预览

```bash
python3 -m http.server 8765 --directory docs
```

---

## 内容边界

本项目仅供学习研究，不构成医疗建议。
不提供诊断、处方、剂量、服法等可执行用药信息。
不公开付费课程、医案全文、个人隐私资料和高风险原始材料。
AI 问答由 CloudBase Hybrid RAG 承载，基于站内知识语料检索生成；资料不足时会明确说明，不使用无知识库依据的通用模型兜底。

更完整说明见 [CONTENT_NOTICE.md](./CONTENT_NOTICE.md)。

## 小程序上传密钥

若本地存有 `private.wx*.key` 上传密钥，请确保文件权限为 `0600`（`chmod 600 private.wx*.key`），并优先移出 Git 仓库、仅在 CI 或本机安全目录保管。密钥不应提交到版本库。

## 许可

代码采用 MIT License。
原创整理内容采用 CC BY-SA 4.0。
第三方资料保留原来源说明，如有权利问题请通过 Issue 联系。
