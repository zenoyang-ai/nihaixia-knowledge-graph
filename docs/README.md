# 倪海厦知识图谱网站

> 本目录是网站源码与部署根（`docs/`）。
> 国内主站（推荐）：https://zeno-d9g0gdvw4a57635c0-1452182285.tcloudbaseapp.com
> 海外备份：https://zenoyang-ai.github.io/nihaixia-knowledge-graph/

倪海厦公开教学资料的结构化知识图谱网站，包含交互式力导向图、知识卡片和学习路径。

## 本地运行

```bash
python3 -m http.server 8765 --directory docs
```

访问：http://127.0.0.1:8765/

## 技术方案

- D3.js 力导向图 + 缩放拖拽
- marked.js Markdown 渲染
- 纯 HTML + CSS + JS，无构建工具
- GitHub Pages 直接部署

## 文件结构

```
docs/
├── index.html           # 主页面
├── assets/
│   ├── styles.css       # 样式
│   ├── app.js           # 主入口
│   ├── router.js        # hash 路由
│   ├── sidebar.js       # 左侧目录
│   ├── graph.js         # 力导向图
│   ├── detail.js        # 知识卡片
│   ├── overview.js      # 首页
│   ├── path.js          # 学习路径
│   ├── search.js        # 搜索
│   └── prompts.js       # 天纪提示词工具包
├── data/
│   └── graph.json       # 图谱数据（70 节点 / 289 关系）
├── vendor/              # 本地化第三方库（D3、marked）
├── sources-public/      # 公开原文（3 个可读章节 + 1 个目录索引）
└── README.md            # 本文件
```

## 免责声明

本网站是倪海厦公开教学资料的学习整理索引，仅供个人学习研究，不构成医疗建议、诊断或治疗方案。如有健康问题，请咨询专业医师。
