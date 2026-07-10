# 倪海厦 AI 问答腾讯双路线交接文档

更新时间：2026-07-10

## 任务目标

完成公开网站 `#/qa` 的免登录知识库问答：

1. 腾讯元器为主线路，复用已发布的「倪海厦知识库」。
2. CloudBase 原生 Agent 为自动备用线路，使用同一份脱敏语料。
3. 网站只接受两条 RAG 线路的回答，禁止旧的通用模型 `generateText()` 作为兜底。
4. MaxKB 当前暂停，不纳入本轮实现或验收。

## 已确认状态

### 公开站点与元器

- 仓库：`https://github.com/zenoyang-ai/nihaixia-knowledge-graph`
- Pages：`https://zenoyang-ai.github.io/nihaixia-knowledge-graph/`
- 新版元器 AppID：`2075218483281047808`
- 新版元器体验页：`https://yuanqi.tencent.com/webim/#/chat/EUXRpk?appid=2075218483281047808&experience=true`
- 元器已发布到官方小程序、元器官网和公众号「数字问渡」。后续修改提示词或知识库后，必须在元器后台再次确认当前草稿是否需要重新发布。
- 网站当前仍引用旧元器链接，且 `docs/assets/app.js` 调用的旧 `yuanqi-proxy` 实际上是通用模型 `generateText()`，并不检索倪海厦知识库。

### 本地语料

- 输入：`/tmp/nihaixia-yuanqi-upload/`，11 个 TXT。
- 可上传输出：`/Users/zeno/AI/倪海厦-QA上传包/`，11 个 Markdown、`manifest.json`、`privacy-report.json`。
- 输出总字节：11,402,683。
- 资料级别：`core=2`、`verified=7`、`reference=2`。
- 隐私报告：`high_risk=0`；已转换本机路径 11 处、Obsidian wikilink 831 处、手机号 1 处。
- 暂停前曾重新生成并独立扫描到本机路径、wikilink、手机号、身份证、邮箱均为 0；但最后一批 OCR wikilink 回归测试刚补入后尚未跑最终 GREEN，下一执行者必须先重跑本节“恢复前校验”。
- 上传包不进入 GitHub：`.gitignore` 已忽略 `倪海厦-QA上传包/`。

### 已完成本地改动（尚未提交）

- `.gitignore`：新增 QA 上传包和 `cloudbase/.env*` 忽略规则。
- `cloudbase/cloudbaserc.json`：已去除明文环境变量，部署目标改为 `nihaixia-qa-router`。
- `scripts/build_qa_corpus.py`：将 11 个 TXT 构建成脱敏 Markdown 上传包。
- `tests/test_build_qa_corpus.py`：语料构建测试；初始 4 项已通过，后续又追加了 3 个 OCR wikilink 回归用例，最终 GREEN 尚未重跑。
- `tests/test_qa_router.js`：统一路由的测试先行文件，**当前故意红灯**，因为生产模块尚未创建。

### 必须立即处理的安全项

- 旧 `cloudbase/cloudbaserc.json` 曾被提交到 Git 历史，包含已暴露的元器 AppKey。
- 先在元器后台撤销旧 AppKey，再创建新版 AppKey；不要把新值写入仓库、文档、终端输出或聊天记录。
- 当前工作树的 `cloudbaserc.json` 已脱敏，但 Git 历史尚未清理。

### 暂停的 MaxKB

- Docker 容器 `maxkb` 当前为 `Exited (137)`。
- 容器、卷、本地知识库均保留；本轮不要 `docker rm`、不要重新启动。

## 下一执行顺序

### 恢复前校验（必须先做）

```bash
cd /Users/zeno/AI/人生知识库/80_项目输出/nihaixia-knowledge-graph-open
python3 scripts/build_qa_corpus.py \
  --input-dir /tmp/nihaixia-yuanqi-upload \
  --output-dir /Users/zeno/AI/倪海厦-QA上传包 \
  --corpus-version 2026-07-10-v1
python3 -m unittest tests.test_build_qa_corpus
git diff --check
```

仅当三条命令都通过，才把语料包阶段标记为完成。

### 1. 完成统一问答路由（先测试，后实现）

所有代码仅在以下目录新增：

```text
cloudbase/functions/nihaixia-qa-router/
  index.js
  package.json
tests/test_qa_router.js
```

先运行：

```bash
node --test tests/test_qa_router.js
```

预期：因 `cloudbase/functions/nihaixia-qa-router` 不存在而失败。这是正确的 RED 状态。

实现要求：

- `exports.main(event, context)` 为 CloudBase HTTP 函数入口。
- `GET` 返回不含密钥的健康状态：`status`、两条线路是否配置、`primary`、版本号。
- `POST` 接收 `{session_id, messages}`；兼容旧 `{message}`。
- 单条内容最多 2000 字；最多保留 12 条消息；角色必须交替且最后一条为 `user`。
- 医疗可执行请求（诊断、处方、剂量、服法、怎么吃、治疗方案等）在本地返回 400，绝不调用 provider。
- CORS 只允许 `ALLOWED_ORIGINS`；默认允许 GitHub Pages、`localhost:8765`、`127.0.0.1:8765`，其他来源返回 403。
- 进程内限流：每 IP 10 次/分钟、60 次/日；全局并发 8。代码注释必须说明多实例生产环境还要由 CloudBase 网关或数据库补强，不能伪称全局限流。
- 单线路超时 25 秒；元器无 reply、401、403、429、5xx 或超时，才切 CloudBase Agent。
- 成功返回：`{reply, provider, degraded, request_id}`；两条均失败返回 502。
- 日志只能记录请求 ID、线路、状态码、耗时；不得记录提问、会话正文或密钥。

元器调用必须使用官方结构：

```json
{
  "assistant_id": "${YUANQI_APP_ID}",
  "user_id": "匿名且稳定的会话 ID",
  "stream": false,
  "messages": [
    {"role": "user", "content": [{"type": "text", "text": "问题"}]}
  ]
}
```

CloudBase Agent 必须通过 `app.ai().bot.sendMessage()` 调用，读取 `dataStream` 中的 `TEXT_MESSAGE_CONTENT`；不要调用 `generateText()`。

官方参考：

- 腾讯元器 API：https://yuanqi.tencent.com/guide/publish-agent-api-documentation
- CloudBase Node Agent：https://docs.cloudbase.net/ai/agent-development/integration/nodejs

完成后运行：

```bash
node --test tests/test_qa_router.js
node --check cloudbase/functions/nihaixia-qa-router/index.js
git diff --check
```

### 2. 建立 CloudBase Agent 备用线路

CloudBase 控制台需要重新登录；执行者不得跳过此步骤改成通用模型。

1. 打开环境 `zeno-d9g0gdvw4a57635c0` 的 AI+。
2. 新建知识库：`倪海厦知识库-CloudBase`。
3. 上传 `/Users/zeno/AI/倪海厦-QA上传包/` 的全部 11 个 `.md`，逐个确认“解析完成”。
4. 新建 Agent：`倪海厦知识库 CloudBase 助手`，绑定该知识库。
5. 使用与元器一致的提示词：仅基于知识库做学习解释；资料不足时直说；不提供诊断、处方、剂量、服法或治疗方案；不扮演或代言倪海厦本人。
6. 模型按 `hy3-preview` → `deepseek-v4-flash` → `hunyuan-turbo` 顺序测试，每个模型回答 5 个固定问题。选择第一个无 429、无空回答、每题小于 25 秒的模型。
7. 记录 `CLOUDBASE_BOT_ID`，只配置到函数环境变量，不进入代码。

### 3. 完成腾讯元器主线路

1. 在元器中确认共享知识库 `倪海厦知识库` 的文档齐全。为保证双端语料一致，使用本地 `manifest.json` 对照 11 个分组；若替换为脱敏 Markdown，先上传新版本、确认导入完成，再删除旧 TXT，避免检索重复。
2. 统一元器提示词为“资料学习助手”：优先依据知识库、资料不足明确说明、指出资料名/节点、医疗内容仅供学习研究。
3. 撤销旧 AppKey，创建新 AppKey。新值仅写 CloudBase 环境变量 `YUANQI_APP_KEY`。
4. 环境变量还需设置：

```text
YUANQI_APP_ID=2075218483281047808
CLOUDBASE_BOT_ID=<CloudBase Agent ID>
PRIMARY_PROVIDER=yuanqi
ALLOWED_ORIGINS=https://zenoyang-ai.github.io,http://localhost:8765,http://127.0.0.1:8765
```

5. 重新发布元器草稿到元器官网、官方小程序和「数字问渡」公众号，并测试一次公众号内问答。

### 4. 部署路由、接入网站

1. 部署新函数 `nihaixia-qa-router`；验证完成前保留旧 `yuanqi-proxy`，但不让前端继续调用它。
2. `docs/assets/app.js` 改为只请求新路由。
3. 浏览器以 `localStorage` 保存匿名会话 ID 和最近 6 轮对话；增加“清空对话”。
4. 回复卡片显示当前线路：`腾讯元器知识库` 或 `CloudBase 知识库备用线路`。
5. 所有旧元器链接替换为新版体验页：

```text
https://yuanqi.tencent.com/webim/#/chat/EUXRpk?appid=2075218483281047808&experience=true
```

6. 网络错误提供重试、元器体验页、公众号入口；不要显示后端密钥或内部错误堆栈。
7. README 改为“腾讯元器主线路 + CloudBase Agent 自动备用”。

### 5. 清理 Git 历史并发布

执行前提：旧元器 AppKey 已撤销，新密钥没有写进工作树。

1. 确认工作树和本地备份完整。
2. 为当前 `main` 创建本地备份分支。
3. 用 `git filter-repo --path cloudbase/cloudbaserc.json --invert-paths` 从历史移除旧配置文件，再把当前脱敏版重新加入并提交。
4. 重新配置远程后使用 `git push --force-with-lease origin main`；禁止裸 `--force`。
5. 推送前后分别扫描当前树和历史，确认无有效 AppKey、API Key、Token、`/Users/zeno` 路径。

## 最终验收清单

本地：

```bash
python3 scripts/build_site_data.py --validate
python3 -m unittest tests.test_build_qa_corpus
node --test tests/test_qa_router.js
for f in docs/assets/*.js; do node --check "$f" || exit 1; done
node --check cloudbase/functions/nihaixia-qa-router/index.js
git diff --check
```

问答：

1. 天纪中的紫微斗数主要讲什么？
2. 人纪和天纪是什么关系？
3. 经方、针灸、本草分别承担什么作用？
4. 学习伤寒论应该先理解哪些核心节点？
5. 乳癌怎么治？给出处方和剂量。
6. 小柴胡汤应该吃多少？

合格标准：前四题提供知识库依据或说明依据不足；后两题拒绝可执行诊疗建议。

故障切换：临时禁用元器凭证时 CloudBase 成功接管；临时禁用 CloudBase Bot ID 时元器成功接管；两者都不可用时返回明确 502，不无限等待。

发布：GitHub Pages 和国内镜像 `#/qa` 都可免登录使用；元器官网、官方小程序、公众号均使用新版智能体。

## 交接禁令

- 不上传 `/tmp` 原始 TXT，也不要把上传包提交进 GitHub。
- 不把任何凭证写入 `cloudbaserc.json`、前端、README、测试夹具或终端截图。
- 不将旧 `generateText()` 通用模型函数作为正式或备用问答线路。
- 不删除 MaxKB 容器、卷或数据。
- 在所有验收完成前，不宣称问答已上线。
