# 倪海厦知识图谱

倪海厦公开教学资料的学习整理索引，包含 70 个知识节点、五层架构、人纪/天纪学习路径和主题文章。

## 项目状态

**知识图谱**：70 个节点（35 概念 + 14 经典/课程 + 16 方剂/案例 + 5 篇主题文章），已可浏览。

**原文资料状态**：
- 已发布 4 个公开源文件：3 个《神农本草经》可读章节 + 1 个目录索引
- 另有 49 个待审文件保留在 `sources-review/`，不随 GitHub Pages 发布
- 知识图谱节点可追溯原始出处，显示"可阅读"、"待校对"或"仅索引"状态

## 功能

- 知识图谱浏览（70 个节点、289 条关系）
- 五层架构展示
- 人纪/天纪学习路径
- 主题文章阅读
- 搜索
- 节点原始出处追溯（显示公开状态）
- 少量公开原文文件保留在 `sources-public`，当前网站主要展示知识卡片和出处状态

## 本地运行

```bash
# 更新公开原文数据
python3 scripts/build_site_data.py

# 验证数据一致性
python3 scripts/build_site_data.py --validate

# 启动服务器
python3 -m http.server 8765 --directory docs
```

访问 http://127.0.0.1:8765/

## 内容分级

| 等级 | 内容 | 状态 |
|------|------|------|
| A 类 | 古籍原文、原创节点/文章 | 节点已公开，部分原文已开放 |
| B 类 | 现代整理版、课程稿 | 不进入开源包 |
| C 类 | 医案、临床案例 | 只公开节点索引 |
| D 类 | 个人笔记、付费内容 | 不公开 |

## 公开原文分级

- `public_ready`：可公开且可直接阅读（当前 3 个）
- `needs_review`：可公开但 OCR/排版待校对（当前 1 个目录索引）
- `summary_only`：只公开摘要/索引，不公开全文
- `private_only`：不进入开源仓库

## 版权声明

- **代码**：MIT License
- **原创内容**：CC BY-SA 4.0
- **第三方资料**：保留来源说明，不声称版权

## 免责声明

1. 本项目仅供学习研究，不构成医疗建议
2. 中医理论学习不等于临床能力
3. 如有健康问题，请咨询专业医师
4. 不提供诊断、处方、剂量、服法等可执行用药信息

## 目录结构

```
nihaixia-knowledge-graph-open/
├── README.md
├── LICENSE
├── CONTENT_NOTICE.md
├── docs/                    # 网站文件（GitHub Pages）
│   ├── index.html
│   ├── assets/
│   ├── data/graph.json      # 图谱数据
│   └── sources-public/      # 公开原文（3 个可读章节 + 1 个目录索引）
├── sources-review/          # 待审文件，不随 GitHub Pages 发布
└── scripts/                 # 工具脚本
    └── build_site_data.py   # 数据构建/验证
```

## 联系方式

如有问题，请通过 GitHub Issues 联系。
