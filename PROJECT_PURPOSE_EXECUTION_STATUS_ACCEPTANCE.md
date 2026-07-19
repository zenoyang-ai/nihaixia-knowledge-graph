# 倪海厦知识图谱项目：目的、执行记录、文件地图与验收交接

> 文档用途：交给其他模型继续检查、修复和验收。
> 生成时间：2026-07-19（Asia/Shanghai）
> 本文不包含任何 AppKey、API Key、私钥或 Token。
> 本文以本地最新代码为准，同时明确区分本地、GitHub 和线上部署状态。

## 0. 当前结论

> 更新时间：2026-07-19 23:10（Asia/Shanghai）— Cursor 已完成本地可自动完成项；待推送后确认远端 CI/Pages，并做人机真机与 CloudBase 部署核对。

当前项目处于：**本地阻断项已修复；远端同步与真机验收仍未完成**。

| 项目 | 当前状态 |
|---|---|
| 本地待推送改动 | 修复 MP package-lock、3 条悬空链接、README/QA_REPORT 口径、cloudbaserc 对齐、validate 增强并接入 CI |
| 基线提交 | e38aecf（v5.2.0 主页/历史/段落复制/返回导航）仍领先 origin/main=e533587 |
| GitHub origin/main（推送前） | e533587；CI Run 29683595468 曾因 npm ci 失败 |
| 本地网站数据校验 | 通过：64 节点 + 5 文章 = 69；directed=338 undirected=283 dangling=0 |
| 本地 Router 测试 | 24/24 通过 |
| 本地 MP 测试 | 56/56 通过；干净 `npm ci` 后可加载 wx-server-sdk@2.7.2 |
| 本地 JavaScript 语法检查 | 通过 |
| 微信开发者工具/真机验收 | 尚未由本轮独立证明 |
| CloudBase 线上函数版本 | 尚未由本轮独立证明与本地一致 |
| 发布判定 | 暂不能标记为最终完成 |

### 已修复的原 P0

`cloudbase/functions/nihaixia-qa-mp/package-lock.json` 已与 `package.json` 同步；本地干净环境 `npm ci` 成功。

### 已修复的原 P1 数据口径

docs/data/graph.json 当前实际为：

- nodes 数组：64 个
- articles 数组：5 个
- 合计：69 个内容项
- 有向 node_links：338 条
- 图谱运行时去重后的无向边：283 条
- 悬空 node_links：0 条（已把旧路径改到现存节点 id）

README / `docs/QA_REPORT.md` 已按上述口径更新；`scripts/build_site_data.py --validate` 会检查悬空链接。

## 1. 项目目的

### 1.1 知识图谱网站

将个人 Obsidian 知识库中整理的倪海厦相关学习材料，整理成一个适合公开访问的静态网站：

- 用总览展示知识体系入口；
- 用人纪、天纪学习路径帮助学习者进入内容；
- 用交互式知识图谱展示节点关系；
- 用节点详情卡片展示定义、摘要、上下游和安全边界；
- 用天纪提示词工具包提供结构化学习入口；
- 用站内 AI 问答基于知识库检索后回答学习问题；
- 对外公开时不把高风险原始资料、患者隐私、付费课程全文和本机文件路径放进公开网站。

### 1.2 微信小程序

提供一个独立的经典学习问答小程序：

- 用户可以免下载资料，直接在小程序内提问；
- 小程序通过 CloudBase 云函数调用混合 RAG；
- BM25 检索知识库片段，再由 CloudBase 模型根据检索片段生成回答；
- 返回引用资料和证据摘要；
- 对诊断、处方、剂量、服法和个体化治疗请求进行拦截；
- 支持主页、学习对话、历史记录、会话恢复、删除历史和复制回答段落。

### 1.3 明确非目标

本项目不是：

- 医疗诊断或在线问诊系统；
- 处方、剂量或治疗方案提供工具；
- 完整付费课程传播仓库；
- 患者医案隐私发布站；
- 将所有原始 PDF、DOC、视频和网盘资料上传到 GitHub 的资料库；
- 以通用大模型自由发挥为主的聊天机器人。

## 2. 公开入口与本地入口

### 2.1 GitHub 与网站

- GitHub 仓库：https://github.com/zenoyang-ai/nihaixia-knowledge-graph
- GitHub Pages：https://zenoyang-ai.github.io/nihaixia-knowledge-graph/
- 网站 AI 问答：https://zenoyang-ai.github.io/nihaixia-knowledge-graph/#/qa
- 本地网站预览：http://127.0.0.1:8765/
- 本地网站问答：http://127.0.0.1:8765/#/qa

本地预览命令：

~~~bash
cd "/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open"
python3 -m http.server 8765 --directory docs
~~~

### 2.2 微信小程序

- 小程序项目目录：/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open
- 小程序根目录：miniprogram/
- 小程序 AppID：配置在 project.config.json 和上传脚本中；不要改动或在公开文档中重复暴露私钥
- 项目名称：wendu-classic-qa
- 当前本地版本：5.2.0
- 当前上传脚本：/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/scripts/upload.js
- 上传私钥：本机的 private.wx11826bcc1883aa28.key，已被 *.key 忽略，绝不能提交或复制到聊天记录

### 2.3 CloudBase

- CloudBase 环境 ID：配置在 cloudbaserc.json 和 cloudbase/cloudbaserc.json
- 云函数主目录：cloudbase/functions/
- 网站 HTTP 路由：nihaixia-qa-router
- 小程序云函数：nihaixia-qa-mp
- 当前配置主线路：cloudbase-hybrid
- 当前仓库没有有效 Yuanqi AppKey；Yuanqi 相关代码仅保留为可选历史线路，不能作为当前发布结论

## 3. 总体架构

~~~mermaid
flowchart TD
    A[Obsidian 人生知识库] --> B[知识图谱导出数据]
    B --> C[docs/data/graph.json]
    C --> D[GitHub Pages 静态网站]

    E[11 个 QA Markdown 上传文件] --> F[generate-knowledge-base.js]
    F --> G[knowledge-base.json + inverted-index.json]
    G --> H[CloudBase nihaixia-qa-router]
    G --> I[CloudBase nihaixia-qa-mp]

    D -->|HTTP POST /qa| H
    H --> J[BM25 检索]
    J --> K[检索片段达到阈值]
    K --> L[CloudBase generateText 生成]
    L --> D

    M[微信小程序] -->|wx.cloud.callFunction| I
    I --> N[OpenID 哈希限流]
    N --> J
    I --> M
~~~

### 3.1 网站问答线路

网站只调用 docs/assets/app.js 中的 CloudBase HTTP 路由：

1. 浏览器发送当前问题和最近对话历史；
2. Router 做 CORS、历史格式、长度、医疗请求和限流校验；
3. BM25 检索知识库片段；
4. 没有达到阈值时返回“知识库中暂无相关内容”，不调用通用模型胡乱回答；
5. 有检索结果时调用 CloudBase 模型生成学习性回答；
6. 返回 knowledge_sources、证据摘要、provider 和 request ID。

网站此前的 Yuanqi 备用链接已经删除。当前网站没有真正的第二个可用 HTTP 容灾线路，失败时主要是重试。不要把已经失效的 Yuanqi 体验页重新加回来。

### 3.2 小程序问答线路

小程序直接调用 nihaixia-qa-mp，不经过网站 Router：

1. 微信云函数获取 OpenID；
2. OpenID 只做哈希后用于限流，不保存原始 OpenID；
3. 输入先经过客户端提示和服务端最终拦截；
4. 服务端执行 BM25 检索和模型生成；
5. 返回回答、provider、引用资料、证据和安全状态；
6. 小程序将会话消息保存到本地 Storage，支持恢复历史对话。

## 4. 已执行操作与提交记录

| 提交 | 操作 |
|---|---|
| 7c6aaae | 混合 RAG v2：完整语料、BM25 检索、医疗拦截、原子限流 |
| dca0527 | P0/P1/P2 修复：检索内存、502、hybrid 测试、history、安全和限流 |
| 81d0084 | CI fixture 注入、测试隔离、真哈希去重、source_group 限额、引用 CSS |
| da68280 | TTL 字段、缺失 OpenID 明确提示、临时下载目录忽略 |
| 59ca69d | 小程序首屏紧凑改版、网站失效 Yuanqi 链接清理 |
| 3491d13 | 修复 WXML 表达式、setData 时序、空来源判断、输入框高度 |
| f6425c2 | 使用 wx-server-sdk 获取 OpenID，增加诊断日志 |
| 3e4b298 | 移除不兼容的 upsert，改为 get + set/update |
| e533587 | 对话排版优化、长按复制消息 |
| e38aecf | v5.2.0：主页、历史记录、会话恢复、段落复制、返回导航 |

### 4.1 知识资料处理

资料处理链路：

1. 从个人 vault 的倪海厦资料中抽取公开学习所需内容；
2. 生成 11 个 QA Markdown 文件；
3. 清理本机绝对路径和 Obsidian 专用 wikilink；
4. 生成 manifest.json，记录文件数量、字节数和 SHA-256；
5. 生成 privacy-report.json；
6. 用 scripts/generate-knowledge-base.js 切分为约 4837 个 chunks；
7. 同时生成 BM25 倒排索引；
8. 将两套生成数据放入两个 CloudBase 函数目录，但通过 .gitignore 排除，不进入 GitHub。

当前上传包：

~~~text
/Users/zeno/AI/倪海厦-QA上传包/
├── 01_知识卡片.md
├── 02_主题文章.md
├── 03_经文原文-公开版.md
├── 04_经文原文-完整版.md
├── 05_汉唐方剂讲解.md
├── 06_补充资料.md
├── 07_天纪资料.md
├── 08_补充课程.md
├── 09_中医原始资料.md
├── 10_课程字幕.md
├── 11_玄学体系.md
├── manifest.json
└── privacy-report.json
~~~

已读取到的上传包统计：11 个 Markdown，约 11.4 MB，manifest 文件数 11，总字节数 11,402,677；privacy report 为 status=pass、high_risk=0。重新上传或重新生成前，仍需再次运行隐私扫描，不能只相信旧报告。

## 5. 完整文件地图

项目根目录：

~~~text
/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/
~~~

### 5.1 网站页面与资源

| 路径 | 作用 |
|---|---|
| docs/index.html | 网站壳、导航、总览、路径、图谱、提示词、AI 问答和 footer |
| docs/assets/app.js | 网站应用初始化、路由、问答请求、Markdown 渲染、历史对话和引用显示 |
| docs/assets/router.js | Hash 路由和导航状态 |
| docs/assets/graph.js | D3 力导向图、拖拽、滚轮缩放、节点点击、概念框和图例 |
| docs/assets/overview.js | 总览视图 |
| docs/assets/path.js | 人纪/天纪学习路径 |
| docs/assets/prompts.js | 天纪提示词工具包 |
| docs/assets/detail.js | 节点详情 |
| docs/assets/sidebar.js | 左侧目录 |
| docs/assets/search.js | 全局搜索 |
| docs/assets/styles.css | 全站布局、图谱、问答、移动端和 footer 样式 |
| docs/data/graph.json | 64 个节点、5 篇主题文章、节点关系、来源和安全字段 |
| docs/data/prompts.json | 天纪提示词数据，目前是 5 项数组 |
| docs/sources-public/ | 公开古籍 Markdown，目前 4 个文件，其中 3 个可读 |
| docs/vendor/d3.v7.min.js | D3 力导向图依赖 |
| docs/vendor/marked.min.js | Markdown 渲染依赖 |
| docs/assets/qrcode-digital-wendu.jpg | 数字问渡公众号二维码 |
| docs/.nojekyll | GitHub Pages 静态部署标记 |

网站页面功能：

- #/：总览；
- #/path：学习路径；
- #/graph：知识图谱；
- #/prompts：天纪提示词；
- #/qa：站内知识库 AI 问答；
- 节点详情由路由和 detail.js 动态展示。

### 5.2 小程序页面

| 路径 | 作用 |
|---|---|
| miniprogram/app.json | 页面注册、窗口和小程序全局配置 |
| miniprogram/app.js | wx.cloud.init |
| miniprogram/app.wxss | 全局底色、字体和主题色 |
| miniprogram/pages/index/index.* | 首页、开始学习、最近对话、进入历史 |
| miniprogram/pages/chat/chat.* | 问答主页面、推荐问题、引用来源、重试、新对话、复制和导航 |
| miniprogram/pages/history/history.* | 历史列表、恢复、删除单条、清空全部 |
| miniprogram/sitemap.json | 小程序 sitemap |
| miniprogram-icon* | 临时图标文件，已忽略，尚未确定正式图标 |

当前小程序关键行为：

- canSend 在 JS 中计算，WXML 不再调用 inputValue.trim()；
- 推荐问题和失败重试通过 setData 回调后发送；
- hasSources 区分有无引用；
- 输入框固定为 76rpx；
- 消息长按可以复制全文或选择段落复制；
- 会话保存在 chat_sessions 和 chat_messages_<sessionId>；
- 返回主页和历史入口已经加入；
- 小程序版本和上传描述由 scripts/upload.js 统一维护。

### 5.3 CloudBase 云函数

规范源码目录：

~~~text
cloudbase/functions/nihaixia-qa-router/
├── index.js
├── knowledge-search.js
├── package.json
└── package-lock.json

cloudbase/functions/nihaixia-qa-mp/
├── index.js
├── knowledge-search.js
├── package.json
└── package-lock.json
~~~

本机还存在但被 .gitignore 忽略的生成数据：

~~~text
cloudbase/functions/nihaixia-qa-router/knowledge-base.json
cloudbase/functions/nihaixia-qa-router/inverted-index.json
cloudbase/functions/nihaixia-qa-mp/knowledge-base.json
cloudbase/functions/nihaixia-qa-mp/inverted-index.json
~~~

两套生成数据各约 12 MB + 11 MB，不得提交到公开仓库。需要时从上传包重新生成：

~~~bash
cd "/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open"
node scripts/generate-knowledge-base.js "/Users/zeno/AI/倪海厦-QA上传包"
~~~

云函数核心逻辑：

- index.js：请求规范化、医疗拦截、历史校验、限流、断路器、RAG 生成、响应格式；
- knowledge-search.js：倒排索引、中文 bigram/trigram、BM25、最低分阈值 18、最低匹配 token 数 3、证据提取、去重、source_group 限额；
- knowledge-base.json：分块知识正文；
- inverted-index.json：检索索引；
- package.json/package-lock.json：运行依赖和可复现安装锁文件。

### 5.4 构建、上传与校验脚本

| 路径 | 作用 |
|---|---|
| scripts/build_site_data.py | 扫描公开原文、更新 graph.json 的 public_sources、校验安全字段 |
| scripts/build_qa_corpus.py | 从原始 QA 输入生成脱敏 Markdown 上传包 |
| scripts/generate-knowledge-base.js | 从 11 个 Markdown 生成 chunks 和 BM25 索引 |
| scripts/upload.js | 使用 miniprogram-ci 上传小程序代码，私钥通过命令行参数传入 |
| tests/test_build_qa_corpus.py | QA 语料构建、路径清理、隐私清理测试 |
| tests/test_qa_router.js | Router 24 项测试 |
| tests/test_qa_mp.js | MP 56 项测试 |
| tests/fixtures/knowledge-base.json | CI 用小型检索 fixture |
| tests/fixtures/inverted-index.json | CI 用小型倒排索引 fixture |

### 5.5 CI、安全和部署配置

| 路径 | 作用 |
|---|---|
| .github/workflows/ci.yml | 静态数据、Router、MP、密钥扫描和小程序 JS 冒烟检查 |
| .gitignore | 排除原始资料、上传包、生成 KB、私钥、依赖、临时下载目录 |
| cloudbase/cloudbaserc.json | CloudBase CLI 配置，含函数根目录、运行时、内存、超时和环境变量名 |
| cloudbaserc.json | 根目录另一份 CloudBase 配置，当前与 cloudbase/cloudbaserc.json 存在字段差异，需要确认唯一权威配置 |
| project.config.json | 微信开发者工具项目配置 |
| LICENSE | MIT 代码许可和项目许可说明 |
| CONTENT_NOTICE.md | 公开内容、版权、隐私和医疗边界说明 |
| releases/国内镜像部署说明.md | 国内静态镜像部署说明 |

### 5.6 历史、临时和不应作为当前依据的文件

| 路径 | 状态 |
|---|---|
| archive/ | 旧 Yuanqi、Cloudflare、Cloud Run 路线，仅保留参考，不部署 |
| functions/ | 从 CloudBase 下载的临时函数目录，.gitignore 忽略，非规范源码 |
| sources-review/ | 待审资料，不能直接发布 |
| 根目录 sources-public/ | 本地资料目录，非网站唯一公开目录；以 docs/sources-public/ 为网站发布目录 |
| HANDOFF_TENCENT_QA.md | 早期 Yuanqi/CloudBase 双路线交接文档，内容有过时状态，不作为当前真相 |
| docs/QA_REPORT.md | 早期网站报告，仍写 71 节点/6 主题文章，已过时，需要标注或更新 |
| .playwright-cli/、.pytest_cache/、__pycache__/ | 临时缓存，不能作为验收证据 |
| private.wx11826bcc1883aa28.key | 本机小程序上传私钥，已忽略，禁止提交、打印和传播 |

## 6. 当前安全边界

### 6.1 代码和仓库

- 当前仓库没有有效 Yuanqi AppKey；
- cloudbaserc.json 中目前只有环境 ID、函数配置和 CloudBase Bot ID 等非 AppKey 配置；
- private*.key 已被 .gitignore 排除，但本机确实存在私钥文件；
- QA 上传包和完整 knowledge-base.json/inverted-index.json 均未纳入 Git 跟踪；
- 不能因为 Secret Scan 通过，就把本地私钥或 CloudBase 控制台环境变量复制到文档；
- 历史 Yuanqi 代码仍会读取 YUANQI_APP_KEY 环境变量，但仓库和前端不提供它；
- 日志只允许记录 request ID、线路、状态和耗时，不得记录用户问题全文、会话正文或密钥。

### 6.2 内容和医疗安全

- 网站节点和主题文章均使用 medical_safety=learning_only；
- 网站不公开高风险原始医案、患者隐私、付费课程全文和未经审查的原始材料；
- 后端拦截诊断、处方、剂量、服法、个体化用药和治疗决策；
- 生成结果还会二次检查剂量、用量和处方式表达；
- 原文中的经典剂量文字如果作为学习引用出现，不能被包装成针对个人的执行建议；
- 资料不足时必须明确说资料不足，不能用无依据的通用模型内容补齐。

## 7. 已完成的验证证据

### 7.1 本地验证

以下验证在本地最新代码上已完成：

~~~text
python3 scripts/build_site_data.py --validate     PASS
node --test tests/test_qa_router.js               24/24 PASS
node --test tests/test_qa_mp.js                   56/56 PASS
所有 miniprogram、cloudbase/functions、docs/assets、scripts JavaScript 语法检查 PASS
git diff --check                                   PASS
~~~

注意：本地 MP 测试输出提示 wx-server-sdk 不可用，因此 OpenID 测试使用了 context.OPENID 回退路径。干净 CI 的 npm ci 目前反而失败，必须先修复 lockfile。

### 7.2 远端验证

历史上已全绿的 CI：

- Run 29678104249：提交 59ca69d，5 个 Job 全绿；
- Run 29678735213：提交 3491d13，CI 全绿。

当前远端状态：

- Run 29683595468：提交 e533587，失败；失败 Job 为 MP Function Tests，失败步骤为 npm ci；
- Run 29683595110：提交 e533587，Pages 部署成功；
- 本地 e38aecf 尚未产生远端 CI 结果。

## 8. 其他模型必须先做的修复计划

### Phase 0：版本和依赖阻断修复

1. 读取本文件、README.md、AGENTS.md 和当前 Git 状态。
2. 不覆盖或回滚本地 e38aecf。
3. 在 cloudbase/functions/nihaixia-qa-mp/ 执行依赖锁定修复：

~~~bash
cd "/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/cloudbase/functions/nihaixia-qa-mp"
npm install --package-lock-only --ignore-scripts
npm ci
~~~

4. 回到项目根目录执行：

~~~bash
cd "/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open"
node --test tests/test_qa_mp.js
git diff --check
~~~

5. 检查 lockfile diff，只接受与 package.json 依赖同步有关的变化，不接受无关依赖升级或秘密写入。
6. 提交并推送 e38aecf + package-lock.json，等待新 CI 运行。
7. 新 CI 必须在同一提交上通过 Static Data、Router、MP、Secret Scan；不能用旧 Run 作为新版本证明。

### Phase 1：配置和部署一致性

检查并记录以下两份配置的差异：

~~~text
/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/cloudbaserc.json
/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/cloudbase/cloudbaserc.json
~~~

要求：

- 明确哪一份是 CloudBase 部署的唯一权威配置；
- 不复制任何环境变量秘密到配置文件；
- 两个函数的运行时、内存、超时、函数名和 provider 口径一致；
- 确认 CloudBase 控制台上的 nihaixia-qa-mp 已部署 e533587 之后的最新代码；
- 确认网站 Router 和小程序 MP 使用的语料版本一致；
- 确认 CloudBase 数据库 ttl_idx 与代码写入的 ttl 字段一致；
- 记录部署时间、函数版本和回滚方式，但不记录密钥。

### Phase 2：图谱数据完整性

修复或明确处理这 3 条悬空链接：

~~~text
汉唐案例索引 -> 20_概念主题/倪海厦知识图谱/课程节点/汉唐方剂讲解
人纪班闭门课 -> 20_概念主题/倪海厦知识图谱/案例节点/血液类案例学习节点
仲景心法 -> 20_概念主题/倪海厦知识图谱/课程节点/经方的妙用
~~~

可选处理方式：

- 如果节点应当存在：创建最小 planned 节点并标明待补充；
- 如果是旧名称：改成实际存在的节点路径；
- 如果不再需要：删除 node_links 条目。

同时：

- 扩展 scripts/build_site_data.py --validate，检查 node_links 是否指向 nodes 或 articles；
- 统一 README.md 中节点、文章、关系数量；
- 更新 docs/QA_REPORT.md，避免其他模型读取到 71 节点/6 文章的旧结论；
- 明确 graph.json.links=[] 是运行时从 node_links 派生，不要让文档误以为图谱没有边。

### Phase 3：小程序开发者工具和真机验收

在微信开发者工具导入：

~~~text
/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/project.config.json
~~~

至少验证 375px 和 390px 宽度：

1. 首页首屏排版、标题、安全提示和开始对话按钮；
2. 最近对话为空态、创建会话后首页摘要；
3. 推荐问题点击后只发送一次，问题内容正确；
4. 输入空格、长文本、键盘弹出、发送按钮和底部安全区；
5. 学习问题回答、引用资料点击、来源弹窗；
6. 无检索结果时显示资料不足，不显示错误的 provider 状态；
7. 医疗请求拦截，不调用云函数生成治疗建议；
8. 网络失败、重新发送和 loading 状态；
9. 新对话不会覆盖旧历史；
10. 历史列表打开、恢复、删除单条、清空全部；
11. 长按复制全文；
12. 长按后选择段落复制；
13. 返回主页、历史入口和微信返回键；
14. 分享路径能够打开主页或当前约定页面；
15. Console/WXML 编译无红色错误。

### Phase 4：网站回归验收

网站地址：https://zenoyang-ai.github.io/nihaixia-knowledge-graph/

检查：

- 总览、学习路径、知识图谱、天纪提示词、AI 问答均可进入；
- 图谱节点可拖拽、滚轮缩放、点击详情，核心节点与普通节点层级清楚；
- 左下角图例不重叠、不重复；
- #/qa 可以发送推荐问题和自由问题；
- 回答显示知识库来源和证据；
- 无关问题返回资料不足；
- 医疗问题只显示安全提示；
- 页面不出现失效 Yuanqi 备用链接；
- 移动端不横向溢出；
- footer 的数字问渡二维码正常显示。

### Phase 5：最终发布验收

只有以下条件全部满足，才能向用户说“最终完成”：

- 本地 HEAD、origin/main、Pages 部署和 CloudBase 部署版本一致；
- 同一提交的 GitHub CI 全绿；
- npm ci 在干净环境成功；
- Router 24 项、MP 56 项测试通过；
- WXML 在微信开发者工具编译通过；
- 小程序真机完成关键交互；
- CloudBase 线上问答完成学习问题、无关问题、医疗拦截、限流和 OpenID 验证；
- 3 条悬空图谱链接已经处理；
- README、QA_REPORT、内容声明的数量和架构口径一致；
- Git 跟踪列表无私钥、完整上传包、完整生成知识库、患者隐私和有效凭证；
- 小程序 5.2.0 代码上传到体验版并完成体验版测试；
- 如需公开发布，再由微信公众平台提交审核。

## 9. 推荐验收命令

其他模型进入项目后，先执行：

~~~bash
cd "/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open"

git status --short --branch
git log -3 --oneline --decorate
git rev-parse HEAD
git rev-parse origin/main

python3 scripts/build_site_data.py --validate
node --test tests/test_qa_router.js
node --test tests/test_qa_mp.js

find miniprogram cloudbase/functions docs/assets scripts \
  -path '*/node_modules' -prune -o -type f -name '*.js' -print0 \
  | while IFS= read -r -d '' f; do node --check "$f"; done

git diff --check
git ls-files | rg '(^|/)(\.env|.*\.key$|knowledge-base\.json|inverted-index\.json|倪海厦-QA上传包|sources-review)' || true
rg -n -i 'YUANQI_APP_KEY|API_KEY|Bearer |/Users/zeno' \
  --glob '!node_modules/**' --glob '!.git/**' --glob '!*.key' . || true
~~~

如果要检查 GitHub 远端：

~~~bash
gh run list --limit 10 \
  --json databaseId,headSha,status,conclusion,workflowName,createdAt,displayTitle
gh run view <属于当前 HEAD 的 RUN_ID> --log-failed
~~~

## 10. 交给其他模型时的明确要求

请先读取以下文件，不要只看用户转述：

1. 本文件：PROJECT_PURPOSE_EXECUTION_STATUS_ACCEPTANCE.md
2. README.md
3. CONTENT_NOTICE.md
4. .gitignore
5. .github/workflows/ci.yml
6. cloudbase/cloudbaserc.json
7. cloudbaserc.json
8. cloudbase/functions/nihaixia-qa-mp/index.js
9. cloudbase/functions/nihaixia-qa-router/index.js
10. miniprogram/app.json
11. miniprogram/pages/index/index.*
12. miniprogram/pages/chat/chat.*
13. miniprogram/pages/history/history.*
14. docs/index.html
15. docs/assets/app.js
16. docs/assets/graph.js
17. scripts/build_site_data.py
18. scripts/generate-knowledge-base.js
19. tests/test_qa_router.js
20. tests/test_qa_mp.js

执行规则：

- 先报告本地 HEAD、origin/main、最新 CI 和 Pages 版本；
- 先处理 P0，再处理 P1，不能直接做视觉微调；
- 不覆盖用户已有的本地改动；
- 不打印或读取私钥内容；
- 不把生成知识库、上传包、原始资料和环境变量提交到 Git；
- 每完成一个阶段都给出命令、输出摘要和剩余风险；
- 不把旧的 HANDOFF_TENCENT_QA.md 或 docs/QA_REPORT.md 当成当前状态依据；
- 最终必须给出“本地、GitHub、Pages、CloudBase、小程序体验版”五个版本是否一致的结论。

## 11. 当前交接结论

项目的核心产品方向和主要代码已经成型。2026-07-19 Cursor 轮次已完成本地可自动完成项：

1. ~~修复 MP package-lock.json~~（本地 `npm ci` 已通过）
2. ~~处理 3 条悬空图谱链接及关系数口径~~（dangling=0；README/QA_REPORT 已更新）
3. ~~对齐两份 cloudbaserc~~（runtime/handler/ALLOWED_ORIGINS 一致；权威目录为 `cloudbase/`，根目录 `functionRoot` 指向 `cloudbase/functions`）
4. ~~validate 增强并接入 CI~~（`build_site_data.py --validate` 检查悬空链接）
5. 推送包含 e38aecf + 上述修复的提交，等待同一提交 CI/Pages 全绿
6. 用微信开发者工具和真机完成小程序最终验收
7. 核对 CloudBase 控制台函数是否已部署最新代码与语料

在第 5–7 项完成前，本项目应标记为：

~~~text
功能主体：完成
本地代码：已修复 P0/P1
本地自动化测试：通过（含干净 npm ci）
远端版本同步：待推送确认
远端 CI：待同一提交证明
小程序真机：待验收
CloudBase 部署：待核对
最终发布：暂缓
~~~

