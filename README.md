# 倪海厦知识图谱

#### 把倪海厦公开教学资料整理成一张能走进去的知识地图

[在线访问](https://zenoyang-ai.github.io/nihaixia-knowledge-graph/) · [内容声明](./CONTENT_NOTICE.md)

![License](https://img.shields.io/badge/license-MIT-blue)
![Nodes](https://img.shields.io/badge/nodes-69-purple)
![GitHub Pages](https://img.shields.io/badge/GitHub-Pages-brightgreen)

这不是原文资料仓库，而是一个面向学习者的知识入口：用图谱、学习路径和知识卡片，把倪海厦的人纪、天纪、经方、针灸、本草、案例研读串起来。

---

## 你可以用它做什么

| 入口 | 适合做什么 |
|---|---|
| 知识图谱 | 看 69 个节点之间怎么互相连接 |
| 学习路径 | 按人纪 / 天纪路径进入体系 |
| 节点卡片 | 快速理解一个概念的定义、上下游、学习边界 |
| 天纪提示词 | 用八字、紫微、易经、小六壬做结构化自我复盘 |
| AI 问答 | 通过统一路由连接腾讯元器与 CloudBase 知识库 |
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

- 69 个知识节点
- 289 条图谱关系
- 五层知识架构
- 人纪 / 天纪学习路径
- 5 篇主题文章
- 天纪提示词工具包

---

## 国内镜像

国内访问 GitHub Pages 可能不稳定。可将 `docs/` 目录部署到阿里云 OSS 等国内静态托管服务。部署说明见 [releases/国内镜像部署说明.md](releases/国内镜像部署说明.md)。

## 本地预览

```bash
python3 -m http.server 8765 --directory docs
```

---

## 内容边界

本项目仅供学习研究，不构成医疗建议。
不提供诊断、处方、剂量、服法等可执行用药信息。
不公开付费课程、医案全文、个人隐私资料和高风险原始材料。
AI 问答采用双线路架构：腾讯元器为主线路，CloudBase 知识库 Agent 为备用线路。站内问答免登录，由统一路由 `nihaixia-qa-router` 自动切换；线路是否可用以 CloudBase 线上配置和健康检查为准。当前路由版本为 `2.0.1`，使用知识库 Agent 的文本流 API，不使用无知识库依据的通用模型兜底。

更完整说明见 [CONTENT_NOTICE.md](./CONTENT_NOTICE.md)。

## 许可

代码采用 MIT License。
原创整理内容采用 CC BY-SA 4.0。
第三方资料保留原来源说明，如有权利问题请通过 Issue 联系。
