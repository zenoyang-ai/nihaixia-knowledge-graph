# 倪海厦知识图谱网站

倪海厦公开教学资料的结构化知识图谱网站，包含交互式力导向图、知识卡片和学习路径。

## 功能

- **首页**：极简 Hero + 五层阶段卡片 + 路径入口
- **学习路径**：人纪（针灸→内经→本草→伤寒→金匮）/ 天纪分阶段展示
- **知识图谱**：d3-force 力导向图，核心节点大、分支节点小，hover 高亮，点击查看详情
- **节点详情**：知识卡片格式（定义/解析/为什么重要/核心理解/金句/误区/学习提示/关联节点/安全边界）
- **搜索**：全局搜索 + 下拉建议

## 本地运行

```bash
# 验证数据一致性
python3 scripts/build_site_data.py --validate

# 启动服务器
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
│   └── search.js        # 搜索
├── data/
│   └── graph.json       # 图谱数据（70 节点 / 289 关系）
├── sources-public/      # 公开原文（3 个可读章节 + 1 个目录索引）
└── README.md            # 本文件
```

## 免责声明

本网站是倪海厦公开教学资料的学习整理索引，仅供个人学习研究，不构成医疗建议、诊断或治疗方案。如有健康问题，请咨询专业医师。
