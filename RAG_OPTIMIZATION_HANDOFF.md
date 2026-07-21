# RAG 回答质量优化交接文档

> 文档用途：交给下一个模型优化 RAG 回答质量，使其达到 IMA 知识库的回答水平。
> 生成时间：2026-07-21（Asia/Shanghai）
> 本文档不含任何 API Key、Token 或私钥。

---

## 0. 一句话总结

当前 RAG 系统回答"紫微星、天府星有啥用"时，缺少"帝星""官带星""三台八座"等关键信息，而 IMA 知识库能完整回答。**根本原因不是知识库缺内容，而是分块策略和检索限制导致包含详细象征意义的 chunk 被 BM25 评分较低的排盘表格 chunk 挤掉。**

---

## 1. 理想回答效果（对标 IMA 知识库）

以下是用户在 IMA 知识库中问"紫微星、天府星有啥用"得到的理想回答：

### 1.1 IMA 的回答内容

**紫微星**：
- 身份：北斗星君，为帝星，属阳土
- 核心作用：代表领导地位、权威、稳重与格局
- 关键特性：
  - 需辅佐：帝星需要左辅右弼来配合，否则便是孤星
  - 解厄制化：紫微星有解厄制化的功能，碰到凶星时可以化解一部分凶性
  - 官运：紫微是官带星，入官禄宫最好，官星越大，官做得越大
- 注意事项：紫微单独出现时需要与其他吉星如天府、左辅右弼等配合

**天府星**：
- 身份：南斗星君，属阳土
- 核心作用：代表贤能、厚道、善于理财与守成
- 关键特性：
  - 无解厄功能：天府星本身没有解厄制化的功能，需要依靠三台、八座等辅星
  - 心眼较多：相学上，天府星的人眉毛较浓，心眼比较多，但心地厚道
  - 府相会命：天府星与天相星同宫或会照命宫，称为"府相会命"，是天生辅佐之才
- 注意事项：天府星较为保守，善于守成但不善于开创

### 1.2 理想回答的特征

1. **按星曜分点**：每颗星独立段落
2. **四个维度完整**：身份/核心作用/关键特性/注意事项
3. **包含具体术语**：帝星、解厄制化、官带星、左辅右弼、三台八座、府相会命
4. **不引用排盘表格名**：不出现"安紫微诸星表""定天府表"等
5. **不引用原始资料文件名**：不出现"天机道终稿""原稿"等
6. **不暴露作者名**：不出现任何人名

---

## 2. 当前回答效果（我们的系统）

### 2.1 当前 Router 的回答

**紫微星**：
- 身份/核心作用：帝星，是紫微斗数中的核心主星，代表先天格局中的领导地位
- 关键特性：属土，自带解厄制化的功能；主贵气、领导力
- 注意事项：需要吉星辅佐，需配合左辅、右弼等辅星

**天府星**：
- 身份/核心作用：南斗星君，属于文官星、教星
- 关键特性：属土，性格温和厚道；府相会命格局；没有解厄制化的功能
- 注意事项：流年走到天府星时仍需注意规避风险

### 2.2 与理想回答的差距

| 信息点 | IMA 回答 | 我们当前回答 | 差距原因 |
|--------|---------|-------------|---------|
| 帝星 | ✅ | ✅ | 已包含 |
| 属阳土 | ✅ | ❌ 只说"属土" | LLM 未提取"阳土" |
| 解厄制化 | ✅ | ✅ | 已包含 |
| 官带星 | ✅ | ❌ 未提到"官带" | **chunk 未被检索到** |
| 左辅右弼 | ✅ | ✅（提到但不够详细） | 部分提取 |
| 三台八座 | ✅ | ❌ | **chunk 未被检索到** |
| 南斗星君 | ✅ | ✅ | 已包含 |
| 府相会命 | ✅ | ✅ | 已包含 |
| 心眼多/眉毛浓 | ✅ | ✅ | 已包含 |
| 无解厄功能 | ✅ | ✅ | 已包含 |

---

## 3. 为什么当前模式达不到理想效果

### 3.1 根本原因：分块策略 + 检索限制

知识库中的紫微斗数内容来自一个叫"子文件21"的原始文件，它被按 **2000 字符固定长度** 切成了 13 个 chunk。这导致：

- **内容混杂**：一个 chunk 里同时包含化忌、财帛宫、主星之紫微星、天机星等多个主题
- **BM25 评分低**：因为内容混杂，"紫微星"在这个 chunk 中的词频密度不高，BM25 评分只有 38.72，排第 10 位

### 3.2 具体的分块问题

**子文件21 的 13 个 chunk 分布**（项目路径：`cloudbase/functions/nihaixia-qa-mp/knowledge-base.json`）：

| chunk 索引 | 内容主题 | 长度 | 问题 |
|-----------|---------|------|------|
| 0 | 目录 + 紫薇斗数总论 | 1974 | 混杂 |
| 1 | 命宫 + 官禄宫 | 1988 | 混杂 |
| 2 | 官禄宫 + 夫妻宫 | 1972 | 混杂 |
| 3 | 夫妻宫 + 子女宫 + 子午流注 | 1995 | **严重混杂**（命理和医学混在一起） |
| 4 | 疾厄宫 + 四化星 + 面相 | 1997 | 混杂 |
| 5 | **化忌 + 主星之紫微星 + 天机星 + 太阳星 + 武曲星** | 1998 | **关键 chunk，但混杂** |
| 6 | 武曲星 + 太阴星 + 天梁星 | 1988 | 混杂 |
| 7 | 天相星 + 七杀星 + 紫微在各宫 | 1995 | 混杂 |
| 8 | 巨门星 + 贪狼星 + 文昌文曲 | 1991 | 混杂 |
| 9 | 文曲文昌 + 魁钺 + 紫微在各宫 | 1996 | 混杂 |
| 10 | 大运流年批断 | 1997 | 混杂 |
| 11 | 紫微在各宫位 | 1942 | 混杂 |
| 12 | 鼻窦炎按摩法 | 353 | **与紫微斗数完全无关** |

**关键发现**：chunk 5 包含"主星之紫微星"的完整内容（帝星、解厄制化、官带、左辅右弼），但它同时包含化忌、财帛宫、天机星、太阳星、武曲星等内容，导致 BM25 评分低。

### 3.3 检索限制：MAX_PER_SOURCE_GROUP = 2

文件位置：`cloudbase/functions/nihaixia-qa-mp/knowledge-search.js` 第 42 行

```javascript
const MAX_PER_SOURCE_GROUP = 2;
```

这个配置限制同一个 `source_group` 最多只返回 2 条结果。07_天纪资料 有 215 个 chunk，但只能返回 2 条：

- 第 1 条：`徐 序`（score 72.8）— 这是排盘表格内容（安紫微诸星表等）
- 第 2 条：`子文件21` 的某个 chunk（score 38.72）— 包含天府星内容

**包含紫微星详细象征意义的 chunk（子文件21 的 chunk 5，包含"帝星""官带""解厄制化"）没有被返回**，因为它是 07_天纪资料 的第 3 条候选结果，被 `MAX_PER_SOURCE_GROUP = 2` 限制挤掉了。

### 3.4 BM25 评分偏向概览性内容

搜索"紫微星、天府星有啥用"时，BM25 评分排名：

| 排名 | source_group | chunk_title | score | 内容类型 |
|------|-------------|-------------|-------|---------|
| 1 | 06_补充资料 | 倪海厦天纪学习路径 | 86.18 | 概览 |
| 2 | 11_玄学体系 | 天纪三才框架 | 84.10 | 概览 |
| 3 | 06_补充资料 | 一级原材料清单 | 77.33 | 文件列表 |
| 4 | 07_天纪资料 | 徐 序 | 72.80 | **排盘表格** |
| 5 | 11_玄学体系 | 八字四柱体系 | 71.25 | 概览 |
| 6 | 01_知识卡片 | 天机道 | 64.61 | 概览 |
| 7 | 01_知识卡片 | 人间道 | 63.28 | 概览 |
| 8 | 02_主题文章 | 天纪三才如何互相支撑 | 53.07 | 概览 |
| 9 | 02_主题文章 | 倪海厦天纪提示词工具包 | 50.61 | 概览 |
| 10 | 07_天纪资料 | 子文件21 | 38.72 | **天府星详细内容** |
| 11 | 10_课程字幕 | B站倪海厦课程清单 | 31.03 | 文件列表 |
| 12 | 08_补充课程 | 子文件87 | 29.92 | 其他 |

**问题**：前 9 条都是概览性内容或文件列表，对回答"星曜有什么用"几乎没有实质帮助。真正有用的详细内容排在第 10 位。

### 3.5 问题链总结

```
用户问"紫微星、天府星有啥用"
  ↓
BM25 搜索返回 12 条结果
  ↓
前 9 条是概览/文件列表（score 高但无实质内容）
  ↓
07_天纪资料 只能占 2 个名额（MAX_PER_SOURCE_GROUP=2）
  ↓
第 1 名额给了排盘表格（score 72.8）
  ↓
第 2 名额给了包含天府星内容的 chunk（score 38.72）
  ↓
包含紫微星帝星/官带/左辅右弼详细内容的 chunk 被挤掉
  ↓
LLM 只看到天府星的详细内容 + 大量概览内容
  ↓
回答中紫微星部分缺少"官带星""三台八座"等详细信息
```

---

## 4. 当前系统完整状况

### 4.1 系统架构

```
微信小程序 / 网页端
  ↓
CloudBase 云函数
  ├── nihaixia-qa-mp（小程序专用，Event 函数）
  └── nihaixia-qa-router（网页端专用，HTTP 函数）
       ↓
       BM25 关键词检索（knowledge-search.js）
       ↓
       knowledge-base.json（4837 个 chunk，12.3 MB）
       ↓
       generateText() 生成回答（混元模型 hy3-preview）
```

### 4.2 知识库统计

| source_group | chunk 数 | 说明 |
|-------------|---------|------|
| 09_中医原始资料 | 1499 | 中医经典原文 |
| 03_经文原文-公开版 | 1221 | 公开版经文 |
| 04_经文原文-完整版 | 1077 | 完整版经文 |
| 05_汉唐方剂讲解 | 339 | 方剂 |
| 08_补充课程 | 274 | 补充课程 |
| 07_天纪资料 | 215 | **天纪/紫微斗数** |
| 01_知识卡片 | 131 | 知识卡片 |
| 06_补充资料 | 39 | 补充资料 |
| 02_主题文章 | 19 | 主题文章 |
| 11_玄学体系 | 17 | 玄学体系 |
| 10_课程字幕 | 6 | 课程字幕 |
| **总计** | **4837** | |

### 4.3 检索配置（当前值）

文件位置：`cloudbase/functions/nihaixia-qa-mp/knowledge-search.js`

| 配置项 | 当前值 | 行号 | 说明 |
|--------|-------|------|------|
| MIN_SCORE_THRESHOLD | 18.0 | 第 38 行 | BM25 最低分阈值 |
| MIN_MATCHED_TERMS | 3 | 第 39 行 | 最少匹配词数 |
| MAX_PER_SOURCE_GROUP | 2 | 第 42 行 | **同一 source_group 最多返回条数** |
| searchDocuments 调用 | topK=12 | MP 第 423 行 / Router 第 370 行 | 搜索返回总数 |
| MAX_CONTEXT_CHARS | 30000 | MP 第 122 行 | 上下文总量上限 |

### 4.4 当前 prompt

文件位置：
- MP：`cloudbase/functions/nihaixia-qa-mp/index.js` 第 459-475 行
- Router：`cloudbase/functions/nihaixia-qa-router/index.js` 第 398-414 行

```text
你是「经典中医学习研习助手」，专注于回答关于经典中医理论、天纪、紫微斗数、针灸、方剂等方面的问题。

请基于以下知识库内容回答用户的问题。
如果知识库内容不足以完整回答问题，请基于已有内容给出部分回答，并简要说明哪些方面知识库暂未覆盖。

重要规则：
- 不要建议用户去查阅外部资料、原稿或完整版资料。
- 不要在回复中提及"天机道终稿""天机道·地脉道·人间道""天机道笔记"等原始资料文件名。
- 不要提及任何作者、整理者的人名。
- 不要引用排盘表格名称（如"安紫微诸星表""定天府表""安天府诸星表""起紫微表"等）
- 回答星曜问题时，请专注于：星曜的身份定位、五行属性、性格特征、核心作用、关键功能、组合意义、注意事项等。
- 回答结构建议：按星曜分点说明，每颗星包含"身份/核心作用/关键特性/注意事项"四个维度。
- 引用时使用知识卡片的章节名，而非原始资料文件名或排盘表格名。

知识库内容：
${context}
```

### 4.5 已完成的优化（git log）

| 提交 | 说明 |
|------|------|
| 9e9dc09 | 禁止引用排盘表格名，专注星曜象征意义 |
| 413517e | BM25 搜索返回数从 5 增加到 12 |
| 59f75e4 | 网页端知识来源只显示文件名 + prompt 规范 |
| aedc672 | 同步 MP lockfile |
| e38aecf | v5.2.0 新增主页/历史记录/段落复制 |

---

## 5. 完整文件位置索引

### 5.1 项目根目录

```
/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/
```

### 5.2 核心文件（需要修改的文件）

| 文件 | 绝对路径 | 说明 |
|------|---------|------|
| MP 云函数主逻辑 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/cloudbase/functions/nihaixia-qa-mp/index.js` | 746 行，含 prompt（第 459 行）、搜索调用（第 423 行） |
| Router 云函数主逻辑 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/cloudbase/functions/nihaixia-qa-router/index.js` | 680 行，含 prompt（第 398 行）、搜索调用（第 370 行） |
| BM25 检索器 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/cloudbase/functions/nihaixia-qa-mp/knowledge-search.js` | 含 MIN_SCORE_THRESHOLD、MAX_PER_SOURCE_GROUP 等配置 |
| Router BM25 检索器 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/cloudbase/functions/nihaixia-qa-router/knowledge-search.js` | 与 MP 版本相同 |
| 知识库（MP） | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/cloudbase/functions/nihaixia-qa-mp/knowledge-base.json` | 12.3 MB，4837 个 chunk |
| 知识库（Router） | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/cloudbase/functions/nihaixia-qa-router/knowledge-base.json` | 与 MP 版本相同 |
| 倒排索引（MP） | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/cloudbase/functions/nihaixia-qa-mp/inverted-index.json` | BM25 倒排索引 |
| 倒排索引（Router） | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/cloudbase/functions/nihaixia-qa-router/inverted-index.json` | 与 MP 版本相同 |

### 5.3 知识库生成脚本

| 文件 | 绝对路径 | 说明 |
|------|---------|------|
| 知识库生成 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/scripts/generate-knowledge-base.js` | 生成 knowledge-base.json 和 inverted-index.json |
| QA 语料构建 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/scripts/build_qa_corpus.py` | Python 脚本 |

### 5.4 原始资料

| 目录 | 绝对路径 | 说明 |
|------|---------|------|
| 天纪资料 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/sources-public/` | 原始资料目录 |

### 5.5 小程序前端

| 文件 | 绝对路径 | 说明 |
|------|---------|------|
| 聊天页逻辑 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/miniprogram/pages/chat/chat.js` | 616 行 |
| 聊天页模板 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/miniprogram/pages/chat/chat.wxml` | 204 行 |
| 主页 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/miniprogram/pages/index/index.js` | 56 行 |
| 历史记录页 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/miniprogram/pages/history/history.js` | 108 行 |
| 小程序配置 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/miniprogram/app.json` | 页面注册 |
| 项目配置 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/project.config.json` | AppID=wx11826bcc1883aa28 |

### 5.6 网页端

| 文件 | 绝对路径 | 说明 |
|------|---------|------|
| 网页端主逻辑 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/docs/assets/app.js` | 含知识来源显示逻辑 |
| Router URL | `https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-qa-router` | 网页端调用的云函数地址 |

### 5.7 CloudBase 配置

| 文件 | 绝对路径 | 说明 |
|------|---------|------|
| CloudBase 配置 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/cloudbase/cloudbaserc.json` | envId=zeno-d9g0gdvw4a57635c0 |
| 根目录配置 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/cloudbaserc.json` | 可能重复 |

### 5.8 测试文件

| 文件 | 绝对路径 | 说明 |
|------|---------|------|
| MP 测试 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/tests/test_qa_mp.js` | 56 个用例 |
| Router 测试 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/tests/test_qa_router.js` | 24 个用例 |
| 知识库夹具 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/tests/fixtures/knowledge-base.json` | 测试用 |
| 倒排索引夹具 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/tests/fixtures/inverted-index.json` | 测试用 |

### 5.9 部署相关

| 文件 | 绝对路径 | 说明 |
|------|---------|------|
| 上传脚本 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/scripts/upload.js` | miniprogram-ci 上传 |
| CI 配置 | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/.github/workflows/ci.yml` | GitHub Actions |
| .gitignore | `/Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open/.gitignore` | 排除 *.key 等 |

---

## 6. 优化建议（给下一个模型）

### 6.1 方案 A：调整检索参数（最小改动，效果有限）

**修改文件**：`cloudbase/functions/nihaixia-qa-mp/knowledge-search.js` 和 `cloudbase/functions/nihaixia-qa-router/knowledge-search.js`

**修改内容**：
```javascript
// 第 42 行
const MAX_PER_SOURCE_GROUP = 5;  // 从 2 改为 5，让 07_天纪资料 能返回更多条
```

**效果**：07_天纪资料 可以返回 5 条而不是 2 条，包含"帝星""官带"的 chunk 有机会被返回。

**局限**：仍然没有解决概览性内容排在前面的问题，只是让更多 07_天纪资料 的 chunk 能挤进来。

### 6.2 方案 B：重新分块（中等改动，效果显著）

**修改文件**：`scripts/generate-knowledge-base.js`

**修改内容**：把"子文件21"的分块策略从"2000 字符固定分块"改为"按章节/星曜语义分块"：

```
当前分块（按 2000 字符）：
  chunk 5 = 化忌 + 主星之紫微星 + 天机星 + 太阳星 + 武曲星（混杂）

理想分块（按星曜）：
  chunk A = 主星之紫微星（帝星、解厄制化、官带、左辅右弼）
  chunk B = 主星之天府星（南斗星君、府相会命、无解厄）
  chunk C = 天机星
  chunk D = 太阳星
  ...
```

**实现思路**：
1. 检测原始文件中的章节标记（如"主星之紫微星""天机星""太阳星"等）
2. 按章节标记切分，而非固定字符数
3. 每颗星曜的完整内容作为一个独立 chunk

**效果**：BM25 评分会大幅提升，因为 chunk 内容集中，"紫微星"词频密度高。

**注意**：修改后需要重新生成 `knowledge-base.json` 和 `inverted-index.json`，然后重新部署到 CloudBase。

### 6.3 方案 C：二级检索（较大改动，效果最佳）

**修改文件**：`cloudbase/functions/nihaixia-qa-mp/index.js` 和 `cloudbase/functions/nihaixia-qa-router/index.js`

**修改内容**：在 BM25 检索后增加一个二级筛选：

```javascript
// 第一级：BM25 搜索
const docs = searchDocuments(msg, 12);

// 第二级：对搜索结果按内容质量重新排序
// 优先保留包含具体术语（帝星、官带、解厄等）的 chunk
// 降低概览性内容（学习路径、文件列表等）的权重
const reRanked = docs.sort((a, b) => {
  const aHasDetail = /帝星|官带|解厄|府相|辅弼|三台八座/.test(a.content);
  const bHasDetail = /帝星|官带|解厄|府相|辅弼|三台八座/.test(b.content);
  if (aHasDetail && !bHasDetail) return -1;
  if (!aHasDetail && bHasDetail) return 1;
  return b.score - a.score;
});
```

**效果**：确保包含详细象征意义的 chunk 排在前面，LLM 能充分提取。

### 6.4 推荐方案

**短期（立即）**：方案 A + 方案 C，只改检索参数和重排序逻辑，不重新生成知识库。

**长期（后续）**：方案 B，重新分块，从根源解决内容混杂问题。

---

## 7. 部署方式

### 7.1 修改后如何部署

```bash
# 1. 语法检查
cd /Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open
node -c cloudbase/functions/nihaixia-qa-mp/index.js
node -c cloudbase/functions/nihaixia-qa-router/index.js
node -c cloudbase/functions/nihaixia-qa-mp/knowledge-search.js
node -c cloudbase/functions/nihaixia-qa-router/knowledge-search.js

# 2. 登录 CloudBase（如已过期）
cloudbase login
# 浏览器会打开授权页面，点击"确认授权"

# 3. 部署 Router 云函数（较小，几秒）
cloudbase fn deploy nihaixia-qa-router --env-id zeno-d9g0gdvw4a57635c0 --force

# 4. 部署 MP 云函数（含 12MB 知识库，约 1-2 分钟）
cloudbase fn deploy nihaixia-qa-mp --env-id zeno-d9g0gdvw4a57635c0 --force

# 5. 部署网页端（如果修改了 docs/assets/）
cloudbase hosting deploy docs/assets/app.js /assets/app.js --env-id zeno-d9g0gdvw4a57635c0

# 6. 测试 Router
curl -s -X POST "https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-qa-router" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:8765" \
  -d '{"messages":[{"role":"user","content":"紫微星、天府星，这两颗星有啥用"}]}'

# 7. 如果重新生成了知识库
node scripts/generate-knowledge-base.js
# 然后重新部署两个云函数
```

### 7.2 CloudBase 环境信息

- **envId**：`zeno-d9g0gdvw4a57635c0`
- **MP 云函数名**：`nihaixia-qa-mp`（Event 函数）
- **Router 云函数名**：`nihaixia-qa-router`（HTTP 函数）
- **Router URL**：`https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-qa-router`
- **静态托管域名**：`https://zeno-d9g0gdvw4a57635c0-1452182285.tcloudbaseapp.com`

---

## 8. 测试验证方法

### 8.1 本地测试搜索

```bash
cd /Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open
node -e "
const search = require('./cloudbase/functions/nihaixia-qa-mp/knowledge-search.js');
const results = search.searchDocuments('紫微星、天府星，这两颗星有啥用', 12);
results.forEach((r, i) => {
  console.log(i+1, r.source_group, '/', r.chunk_title, '(score:', r.score + ')');
  console.log('  evidence:', r.evidence.substring(0, 150));
});
"
```

### 8.2 线上测试 Router

```bash
curl -s -X POST "https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-qa-router" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:8765" \
  -d '{"messages":[{"role":"user","content":"紫微星、天府星，这两颗星有啥用"}]}' | python3 -m json.tool
```

### 8.3 验证检查清单

- [ ] 回答包含"帝星"
- [ ] 回答包含"官带星"或"官运"
- [ ] 回答包含"解厄制化"
- [ ] 回答包含"左辅右弼"
- [ ] 回答包含"三台八座"
- [ ] 回答包含"南斗星君"
- [ ] 回答包含"府相会命"
- [ ] 回答包含"属阳土"
- [ ] 回答不包含"安紫微诸星表""定天府表"等排盘表格名
- [ ] 回答不包含"天机道终稿""原稿""完整版"
- [ ] 回答不包含任何人名

---

## 9. 知识库中确实包含但检索不到的内容

以下内容**确实在知识库中**，但因为分块混杂和检索限制导致 LLM 看不到：

| 内容 | 所在 chunk | chunk 路径 | 为什么没被检索到 |
|------|-----------|-----------|----------------|
| "北斗星君，为帝星" | 07_天纪资料#20#5 | `knowledge-base.json` 中 `chunks[...]` 的 `chunk_title: "子文件21"` | 被排盘表格（score 72.8）挤掉 |
| "紫微为官带" | 07_天纪资料#20#5 | 同上 | 同上 |
| "帝星一定要左辅右弼来配合" | 07_天纪资料#20#5 | 同上 | 同上 |
| "天府星是南斗星君" | 07_天纪资料#20#6 | 同上 | 已被检索到（score 38.72） |
| "府相会命，天生佐才" | 07_天纪资料#20#6 | 同上 | 已被检索到 |
| "三台八座" | 07_天纪资料#20#1 | 同上 | 被 MAX_PER_SOURCE_GROUP=2 限制 |

### 9.1 如何验证知识库中有这些内容

```bash
cd /Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open
node -e "
const kb = require('./cloudbase/functions/nihaixia-qa-mp/knowledge-base.json');
const keywords = ['帝星', '解厄制化', '府相会命', '南斗星君', '北斗星君', '左辅右弼', '三台八座', '官带星'];
for (const kw of keywords) {
  const hits = kb.chunks.filter(c => c.content.includes(kw));
  console.log(kw, ':', hits.length, '条');
}
"
```

---

## 10. 重要约束（必须遵守）

1. **不要覆盖 02/05 金标**（如有相关数据）
2. **不要删除 .key 文件**，但确保它在 .gitignore 中
3. **不要在日志、文档或代码中包含 API Key、Token 或 .key 文件内容**
4. **修改云函数后需要重新部署**到 CloudBase（使用 `cloudbase fn deploy`）
5. **修改小程序代码后需要重新上传**到微信后台（使用 `node scripts/upload.js private.wx11826bcc1883aa28.key`）
6. **项目名与备注不得出现具体个人名**（使用"经典中医学习问答"等中性名）
7. **不得在回复中提及"天机道终稿""原稿""完整版"等原始资料文件名**
8. **不得在回复中引用排盘表格名**（安紫微诸星表、定天府表等）
9. **不得暴露任何作者、整理者的人名**
10. **医疗可执行请求必须在客户端 + 服务端双重拦截**

---

> 文档结束。如有疑问，请参考上述文件位置索引自行检查代码。
