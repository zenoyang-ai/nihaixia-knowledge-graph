# 经典中医学习问答小程序：目的、执行记录、文件地图与验收交接

> 文档用途：交给其他模型继续检查、修复和验收。
> 生成时间：2026-07-21（Asia/Shanghai）
> 路径/测试数修订：2026-07-23（以仓库真源路径与本地 `node --test` 为准）
> 本文档不含任何 AppKey、API Key、私钥或 Token。
> 以本地最新代码为准，同时明确区分本地、GitHub、CloudBase 与微信后台状态。

---

## 0. 当前结论（TL;DR）

> **2026-07-23 修订**：以下仅列出仓库内可客观核对项；微信备案/审核/正式版、CloudBase 线上部署、GitHub 远端同步等标为 **待人工确认**。

- 本地 `scripts/upload.js` 版本号为 **5.3.0**（`upload.js` 内 `VERSION` 常量）。
- 本地 Git HEAD：`1269e50` — feat: 网页与小程序前端改版进入体验版候选。
- 工作区有未提交改动（含 `miniprogram/`、`docs/`、`cloudbase/`、`tests/` 等）；**待人工确认**是否已 push 到 GitHub。
- 本地自动化测试（2026-07-23 实测）：MP **98/98**、Router **24/24** 通过。
- 知识库语料：`knowledge-base.json` 含 **4852** 个分块（生成于 2026-07-21）。
- **待人工确认**：微信小程序备案/审核/正式版与体验版状态、是否已上传 5.3.0、CloudBase 两云函数线上版本、CI 远端是否全绿。
- **待办（若备案已通过）**：提交审核 → 发布上线 → 正式版更新为新版界面。

---

## 1. 项目目的

构建一个**经典中医学习问答小程序**（原代号"数字问渡"），让用户通过微信小程序向 AI 提问关于中医经典（伤寒论、金匮要略、黄帝内经、神农本草经）以及天纪/紫微斗数/针灸/方剂等的学习问题，获得基于本地知识库的 RAG 检索增强答案。

**核心约束**：
- 仅供学习研究，不提供诊断、处方、剂量或治疗建议（医疗可执行请求在客户端 + 服务端双重拦截）
- 不依赖已停服的腾讯元器小程序（2026-07-15 停服）
- 使用 CloudBase 云函数 + generateText() 生成（免费 AI 资源）
- 前端可在国内访问，无需 VPN
- 项目名与备注不得出现具体个人名（使用"经典中医学习问答"等中性名）

---

## 2. 技术架构

### 2.1 整体架构
```
微信小程序（前端）
   ├── pages/index/index     ← 主页（入口）
   ├── pages/chat/chat       ← 聊天页
   └── pages/history/history ← 历史记录页
        │
        │ wx.cloud.callFunction
        ▼
CloudBase 云函数 nihaixia-qa-mp（小程序专用）
   ├── knowledge-search.js    ← BM25 检索器（阈值 18.0）
   ├── knowledge-base.json   ← 4852 分块语料（约 8.6 MB）
   └── generateText()         ← 混合 RAG 生成
        │
        │ （备用线路，未启用）
        ▼
CloudBase Agent ai.bot.sendMessage（需切换计费后可用）

CloudBase 云函数 nihaixia-qa-router（网站/外部调用）
   └── 同上架构，支持 CORS
```

### 2.2 关键技术决策
- **混合 RAG（方案 B）**：knowledge-base.json 嵌入云函数 + BM25 关键词检索 + generateText() 生成
- **OpenID 获取**：使用 `wx-server-sdk` 的 `getWXContext()`（微信官方推荐），回退到 `context.OPENID`
- **限流**：基于 CloudBase 数据库共享计数器，原子操作（get + set/update），每用户每分钟 6 次、每日 20 次
- **医疗拦截**：客户端正则 + 服务端正则 + 生成结果二次安全检查
- **history 校验**：role 限制为 user/assistant，必须交替，单条 ≤ 2000 字符

---

## 3. 执行记录（时间线）

### 3.1 早期版本（v3.x）
- v3.1.1：direct LLM 迁移体验版（已上线，2026-07-19 15:01 发布）
- 使用 CloudBase Agent sendMessage，无本地知识库

### 3.2 混合 RAG 版本（v5.0.0 → v5.1.0）
- v5.0.0：实现混合 RAG 架构，4 部经典 20 个分块
- v5.1.0：语料扩展到完整 11 组上传包（4852 分块，约 8.6 MB），BM25 + 最低分阈值 18.0，医疗拦截扩充，history 严格校验，原子限流

### 3.3 UI 优化与 Bug 修复（v5.1.1）
- 修复 WXML `inputValue.trim()` 表达式 → 改用 `canSend` 布尔字段
- 修复推荐问题 setData 时序 → 提取 `sendQuestion(text)` 方法 + setData 回调
- 修复空来源不显示 provider → 新增 `hasSources` 布尔字段
- 修复输入框非 76rpx → 设置 `height + min-height + max-height + overflow-y`
- 修复真机 `missing_user_id` → 集成 `wx-server-sdk`，使用 `getWXContext()`
- 修复 `upsert is not a function` → 改为 get + set/update
- 修复 `不能更新_id的值` → 移除 set 数据中的 `_id` 字段
- 优化对话排版：行高 1.75、字号 29rpx、padding 22rpx、引用块样式
- 新增长按复制：`wx.showActionSheet` + `wx.setClipboardData`

### 3.4 v5.2.0（当前最新版本）
**新增功能**：
- 新增主页 `pages/index/index`：入口页，展示最近对话 + 开始学习按钮
- 新增历史记录页 `pages/history/history`：查看全部、删除单条、清空全部
- 聊天记录持久化：`wx.setStorageSync`，按 sessionId 索引
- 聊天页顶部导航栏：返回主页 + 标题 + 进入历史记录
- 段落级复制：长按 → "复制全文" 或 "选择段落复制" → 弹层点击段落即复制
- 继续历史对话：从历史记录点击进入 chat 页，自动加载已有消息

### 3.5 代码上传记录
- 2026-07-19 19:06:53 — v5.1.1 上传成功（31656 字节）
- 2026-07-19 19:17:39 — v5.2.0 上传成功（51775 字节）
- 上传方式：`miniprogram-ci` + `private.<appid>.key`（权限 `chmod 600`，勿入库；**待人工确认** IP 白名单与上传记录）
- 两次上传均自动设为体验版

---

## 4. 文件地图

### 4.1 项目根目录
```
/Users/zeno/Workspace/20_领域/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/
```

### 4.2 小程序前端代码
| 文件 | 行数 | 说明 |
|------|------|------|
| `miniprogram/app.js` | 15 | 云开发初始化，envId=zeno-d9g0gdvw4a57635c0 |
| `miniprogram/app.json` | 15 | 页面注册（index/chat/history），导航栏配色 #F7F7F4 |
| `miniprogram/app.wxss` | - | 全局样式（如有） |
| `miniprogram/sitemap.json` | - | 站点地图配置 |
| `miniprogram/pages/index/index.js` | 56 | 主页逻辑：加载最近会话、开始对话、查看历史 |
| `miniprogram/pages/index/index.wxml` | - | 主页模板：hero 区 + 主按钮 + 最近对话列表 |
| `miniprogram/pages/index/index.wxss` | - | 主页样式 |
| `miniprogram/pages/index/index.json` | - | 主页配置 |
| `miniprogram/pages/chat/chat.js` | 616 | 聊天页核心逻辑：会话持久化、段落拆分、云函数调用 |
| `miniprogram/pages/chat/chat.wxml` | 204 | 聊天页模板：导航栏 + 消息列表 + 输入区 + 段落复制弹层 |
| `miniprogram/pages/chat/chat.wxss` | 696 | 聊天页样式：导航栏 + 气泡 + 输入区 + 段落复制弹层 |
| `miniprogram/pages/chat/chat.json` | - | 聊天页配置 |
| `miniprogram/pages/history/history.js` | 108 | 历史记录页：加载/删除/清空 |
| `miniprogram/pages/history/history.wxml` | - | 历史记录模板 |
| `miniprogram/pages/history/history.wxss` | - | 历史记录样式 |
| `miniprogram/pages/history/history.json` | - | 历史记录配置 |

### 4.3 云函数代码
| 文件 | 行数 | 说明 |
|------|------|------|
| `cloudbase/functions/nihaixia-qa-mp/index.js` | 746 | 小程序专用云函数 v5.1.0：混合 RAG + OpenID + 限流 + 医疗拦截 |
| `cloudbase/functions/nihaixia-qa-mp/knowledge-search.js` | - | BM25 检索器（阈值 18.0） |
| `cloudbase/functions/nihaixia-qa-mp/knowledge-base.json` | 约 8.6 MB | 4852 分块语料 |
| `cloudbase/functions/nihaixia-qa-mp/inverted-index.json` | - | 倒排索引 |
| `cloudbase/functions/nihaixia-qa-mp/package.json` | - | 依赖：@cloudbase/node-sdk + wx-server-sdk |
| `cloudbase/functions/nihaixia-qa-router/index.js` | 680 | 网站/外部调用云函数（同架构 + CORS） |
| `cloudbase/functions/nihaixia-qa-router/...` | - | 同 mp 的其他文件 |

### 4.4 配置文件
| 文件 | 说明 |
|------|------|
| `project.config.json` | AppID=wx11826bcc1883aa28, 项目名=wendu-classic-qa, 基础库 3.7.1 |
| `cloudbase/cloudbaserc.json` | envId=zeno-d9g0gdvw4a57635c0, 两个函数配置 |
| `cloudbaserc.json` | 根目录 CloudBase 配置（可能重复） |
| `miniprogram/app.json` | 小程序配置（页面注册、导航栏、窗口） |
| `.gitignore` | 排除 *.key、node_modules/、.DS_Store 等 |
| `.github/workflows/ci.yml` | CI：静态校验 + Router 测试 + MP 测试 + Secret Scan + Mobile Smoke |

### 4.5 测试文件
| 文件 | 说明 |
|------|------|
| `tests/test_qa_mp.js` | MP 云函数测试（98 个用例） |
| `tests/test_qa_router.js` | Router 云函数测试（24 个用例） |
| `tests/fixtures/knowledge-base.json` | 测试用知识库夹具 |
| `tests/fixtures/inverted-index.json` | 测试用倒排索引夹具 |

### 4.6 脚本与工具
| 文件 | 说明 |
|------|------|
| `scripts/upload.js` | miniprogram-ci 上传脚本（当前版本 5.3.0） |
| `scripts/generate-knowledge-base.js` | 知识库生成脚本 |
| `scripts/build_qa_corpus.py` | QA 语料构建脚本 |
| `scripts/build_site_data.py` | 网站数据构建脚本 |

### 4.7 知识库原始资料
| 目录 | 说明 |
|------|------|
| `sources-public/classics/shanghan-lun/` | 伤寒论（5 章） |
| `sources-public/classics/jin-kuei-yao-lue/` | 金匮要略（3 章） |
| `sources-public/classics/huangdi-neijing/` | 黄帝内经（5 章） |
| `sources-public/classics/shennong-bencao/` | 神农本草经（3 章） |

### 4.8 文档
| 文件 | 说明 |
|------|------|
| `README.md` | 项目说明 |
| `PROJECT_PURPOSE_EXECUTION_STATUS_ACCEPTANCE.md` | 本文档（验收交接） |
| `CONTENT_NOTICE.md` | 内容声明 |
| `cloudbase/CLOUDBASE_AGENT_GUIDE.md` | CloudBase Agent 使用指南 |
| `docs/QA_REPORT.md` | QA 报告 |
| `releases/国内镜像部署说明.md` | 国内镜像部署说明 |

---

## 5. 当前状态

### 5.1 代码状态
- **本地 Git HEAD**：`1269e50` — feat: 网页与小程序前端改版进入体验版候选
- **工作区状态**：有未提交改动（`miniprogram/`、`docs/`、`cloudbase/`、`tests/` 等）
- **最近 5 次提交**（截至 2026-07-23 本地核对）：
  1. `1269e50` feat: 网页与小程序前端改版进入体验版候选
  2. `aedc672` fix: 同步 MP lockfile、修复悬空图谱链接并对齐发布口径
  3. `e38aecf` feat: v5.2.0 新增主页/历史记录/段落复制/返回导航
  4. `e533587` feat(mp): 优化对话排版 + 长按复制消息
  5. `3e4b298` fix(mp): 移除 upsert 调用，改为 get+set/update 兼容 @cloudbase/node-sdk

### 5.2 微信小程序状态（**待人工确认** — 以下摘自 2026-07-21 记录，线上状态需登录微信公众平台核对）
- **AppID**：wx11826bcc1883aa28
- **项目名**：wendu-classic-qa
- **基础库版本**：3.7.1
- **线上正式版**：v3.1.1（2026-07-19 15:01:11 发布，旧版 direct LLM）— **待人工确认**
- **开发版本**：v5.2.0（2026-07-19 19:17:39 上传）— **待人工确认**是否已有 5.3.0 上传
- **体验版**：v5.2.0（扫码可用）— **待人工确认**
- **备案状态**：**待人工确认**（文档记录为 2026-07-19 提交备案审核中）
- **审核版本**：**待人工确认**

### 5.3 CloudBase 部署状态（**待人工确认**）
- **环境 ID**：zeno-d9g0gdvw4a57635c0
- **nihaixia-qa-mp**：文档记录为 v5.1.0 — **待人工确认**线上实际版本
- **nihaixia-qa-router**：文档记录为 v3.0.0 — **待人工确认**线上实际版本
- **数据库**：`qa_rate_limit` 集合，带 `ttl_idx` 索引（expireAfterSeconds=0）— **待人工确认**
- **Agent**：ibot-nihaixiazhi-pdcdi9（备用线路，未启用）

### 5.4 测试状态
- Router 测试：24/24 通过（本地 2026-07-23 实测）
- MP 测试：98/98 通过（本地 2026-07-23 实测）
- CI：5 个 job（Static Validation, Router 24, MP 98, Secret Scan, Mobile Smoke）— **待人工确认**远端 GitHub Actions 是否全绿

---

## 6. 验收清单

### 6.1 功能验收（体验版扫码后）
- [ ] 进入小程序应先看到主页（标题、警告、"开始学习对话"按钮）
- [ ] 点击"开始学习对话"进入聊天页
- [ ] 聊天页顶部应有"‹ 返回 | 学习对话 | 历史"
- [ ] 发送一个学习问题（如"什么是太阳病"），应收到带来源的 AI 回复
- [ ] 发送无关问题（如"法国大革命"），应返回零结果或无关提示
- [ ] 发送医疗请求（如"帮我开个桂枝汤的处方"），应被拦截
- [ ] 长按 AI 回复 → 选择"选择段落复制" → 弹层中点击段落即复制
- [ ] 长按用户消息 → 选择"复制全文" → 复制成功
- [ ] 退出聊天页 → 回到主页 → 应看到"最近对话"
- [ ] 点击"历史"或"查看全部" → 进入历史记录页
- [ ] 历史记录页点击某条对话 → 应加载之前的消息继续聊
- [ ] 历史记录页删除单条对话 → 删除成功
- [ ] 快速发送 7 条消息 → 触发限流（每分钟 6 次）
- [ ] 等待 60 秒 → 限流恢复

### 6.2 技术验收
- [ ] 本地 Git HEAD 与远端 GitHub 一致
- [ ] CI 全绿
- [ ] CloudBase 云函数日志无错误
- [ ] 数据库 `qa_rate_limit` 集合有记录
- [ ] `.key` 文件不在 Git 中（.gitignore 已排除）

---

## 7. 待办事项

### 7.1 备案通过前
- [ ] 等待备案审核通过（通常 1-20 个工作日）
- [ ] 体验版可继续测试，无需等待备案
- [ ] 如需在公众号菜单接入新小程序，可先关联小程序（关联不需要备案），但用户点击菜单进入小程序需要小程序已上线

### 7.2 备案通过后
- [ ] 在微信公众平台提交审核（开发版本 → 提交审核）
- [ ] 审核通过后发布上线（正式版更新为 v5.2.0）
- [ ] 更新公众号菜单，关联新小程序（wx11826bcc1883aa28）
- [ ] 移除旧腾讯元器小程序的关联

### 7.3 长期优化（可选）
- [ ] 接入有效的备用接口（当前只有 CloudBase Hybrid RAG 主线路）
- [ ] 扩充语料覆盖（如课程字幕、天纪完整内容等）
- [ ] 优化上下文切块策略（600-1200 字符/片段）
- [ ] 增加用户反馈通道

---

## 8. 关键文件位置索引

```
项目根目录:
/Users/zeno/Workspace/20_领域/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/

小程序前端:
  miniprogram/app.js                              ← 云开发初始化
  miniprogram/app.json                            ← 页面注册
  miniprogram/pages/index/index.{js,wxml,wxss,json}  ← 主页
  miniprogram/pages/chat/chat.{js,wxml,wxss,json}    ← 聊天页
  miniprogram/pages/history/history.{js,wxml,wxss,json} ← 历史记录页

云函数:
  cloudbase/functions/nihaixia-qa-mp/index.js     ← 小程序专用云函数
  cloudbase/functions/nihaixia-qa-mp/knowledge-search.js  ← BM25 检索器
  cloudbase/functions/nihaixia-qa-mp/knowledge-base.json   ← 语料（约 8.6 MB，4852 分块）
  cloudbase/functions/nihaixia-qa-router/index.js ← 网站云函数
  cloudbase/cloudbaserc.json                      ← CloudBase 配置

配置:
  project.config.json                             ← 小程序项目配置
  .gitignore                                      ← Git 忽略规则
  .github/workflows/ci.yml                        ← CI 配置

测试:
  tests/test_qa_mp.js                             ← MP 测试（98 用例）
  tests/test_qa_router.js                         ← Router 测试（24 用例）

脚本:
  scripts/upload.js                               ← miniprogram-ci 上传脚本

文档:
  PROJECT_PURPOSE_EXECUTION_STATUS_ACCEPTANCE.md  ← 本文档
  README.md                                       ← 项目说明
```

---

## 9. 备案审核期间的使用说明（回答用户疑问）

### Q1: 备案审核没通过前，可以接入到微信公众号吗？

**可以关联，但不能正式上线。**

- **公众号关联小程序**：不需要小程序已完成备案。在公众号后台 → 小程序管理 → 关联小程序 → 搜索 AppID `wx11826bcc1883aa28` → 管理员扫码确认即可。
- **公众号菜单跳转小程序**：需要小程序已上线（正式版）。备案未通过 → 无法提交审核 → 无法发布上线 → 菜单点击会报错。
- **体验版**：不需要备案，开发者和体验成员可扫码使用。

**建议**：备案期间可以先在公众号后台关联新小程序，等备案通过 + 审核上线后再更新菜单。

### Q2: 微信公众号里还是旧的腾讯元器小程序，怎么换？

**在公众号后台操作**：
1. 登录 [mp.weixin.qq.com](https://mp.weixin.qq.com)（公众号后台）
2. 左侧菜单 → 小程序管理
3. 如需解除旧小程序：找到旧小程序 → 解除关联
4. 关联新小程序：添加 → 关联小程序 → 搜索 `wx11826bcc1883aa28` → 管理员扫码
5. 更新自定义菜单：把旧小程序的菜单项改为新小程序

**注意**：旧腾讯元器小程序已于 2026-07-15 停服，即使不解除关联也无法使用。

### Q3: 为什么只有体验版是新的界面，正式版还是旧的？

**原因**：代码上传到微信后台后只是"开发版本"，需要经过以下流程才能更新正式版：

```
开发版本 → 设为体验版（已完成，v5.2.0）
         → 提交审核（需要备案通过才能提交）
         → 审核通过（通常 1-7 天）
         → 发布上线（正式版更新为 v5.2.0）
```

**当前卡在**：备案未通过 → 无法提交审核 → 无法发布上线 → 正式版仍是 v3.1.1

**解决步骤**：
1. 等待备案审核通过（微信公众平台 → 开发管理 → 开发设置 → 备案状态）
2. 备案通过后，在版本管理页面找到开发版本 v5.2.0 → 点击"提交审核"
3. 审核通过后 → 点击"发布上线"
4. 正式版更新为 v5.2.0，所有用户都能看到新界面

**在备案通过前**：
- 体验版可正常使用（扫码进入）
- 可以把体验版二维码分享给少量用户体验
- 正式版用户仍看到旧版 v3.1.1

---

## 10. 已知问题与风险

| 级别 | 问题 | 状态 | 说明 |
|------|------|------|------|
| P0 | 小程序备案/审核 | **待人工确认** | 文档记录 2026-07-19 提交备案；2026-10-08 前不备案将无法打开 |
| P0 | 正式版版本 | **待人工确认** | 文档记录仍为 v3.1.1；需备案通过 → 提交审核 → 发布上线 |
| P1 | 网站只有 CloudBase Hybrid RAG 主线路 | 已知 | 无有效备用接口 |
| P1 | 公众号仍关联旧腾讯元器小程序 | 待解决 | 旧小程序已停服，需关联新小程序 |
| P2 | 上下文切块较大 | 已知 | 当前 600-2000 字符/片段，可优化为 600-1200 |
| P2 | 语料覆盖可扩充 | 已知 | 可增加课程字幕、天纪完整内容等 |

---

## 11. 给接手模型的建议

1. **先验证本地代码可运行**：`node -c miniprogram/pages/chat/chat.js` 等语法检查
2. **跑测试**：`node --test tests/test_qa_mp.js && node --test tests/test_qa_router.js`
3. **不要覆盖 02/05 金标**（如有相关数据）
4. **不要删除 .key 文件**，但确保它在 .gitignore 中
5. **修改云函数后需要重新部署**到 CloudBase
6. **修改小程序代码后需要重新上传**到微信后台（使用 `node scripts/upload.js private.<appid>.key`；私钥权限 `chmod 600`，勿入库）
7. **不要在日志、文档或对话总结中包含 API Key、Token 或 .key 文件内容**

---

> 文档结束。如有疑问，请参考上述文件位置索引自行检查代码。
