# 反馈功能：飞书应用私聊（推荐）

网站反馈（`docs/assets/feedback.js`）通过独立云函数 `nihaixia-feedback` 转发至飞书。

- 前端 POST：`https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-feedback`
- 成功文案：**已送达飞书**
- 失败：诚实报错，并尝试 `localStorage` 兜底保存
- 客户端限流：同页 60 秒内最多 1 次

云函数路径：`cloudbase/functions/nihaixia-feedback/`

---

## 推荐方案：飞书 CLI 应用私聊

使用飞书开放平台应用（如「杨圣旦的飞书 CLI」）以 bot 身份向指定用户发送私聊消息。无需群机器人 Webhook。

### 1. 获取应用凭证

1. 打开 [飞书开发者后台](https://open.feishu.cn/app)
2. 进入目标应用（示例：`cli_aa9059f5d038dcd4`，杨圣旦的飞书 CLI）
3. 复制 **App ID** 与 **App Secret**

### 2. 确认应用权限与可用范围

应用需具备发消息相关权限（如 `im:message`），且接收通知的用户须在应用**可用范围**内。

接收人 open_id 示例：`ou_1527d3dbbeae3c13a25cb0159a6bff94`（可通过飞书 API 或 CLI 获取）。

### 3. 部署云函数

```bash
cd cloudbase
tcb fn deploy nihaixia-feedback
```

### 4. 配置环境变量（控制台，勿写入仓库）

在 [CloudBase 控制台](https://console.cloud.tencent.com/tcb) → 云函数 → `nihaixia-feedback` → 环境变量，添加：

| 变量名 | 说明 |
|--------|------|
| `FEISHU_APP_ID` | 飞书应用 App ID（**推荐必填**） |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret（**推荐必填**，仅控制台配置） |
| `FEISHU_NOTIFY_OPEN_ID` | 接收通知用户的 open_id（默认 `ou_1527d3dbbeae3c13a25cb0159a6bff94`，可按需覆盖） |
| `ALLOWED_ORIGINS` | CORS 白名单（已在 `cloudbaserc.json` 预设，可按需覆盖） |

> **安全提示**：`FEISHU_APP_SECRET` 具有应用调用权限，**绝不**写入前端代码或 Git 仓库明文。`APP_ID` / `OPEN_ID` 也建议仅在控制台配置。

### 5. 验证

```bash
# 健康检查（配置后 feishu_configured 应为 true，channel 为 app_im）
curl -s 'https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-feedback' | jq

# 发送测试反馈（需从白名单 origin 发起）
curl -s -X POST \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://zenoyang-ai.github.io' \
  -d '{"category":"其他","content":"测试反馈，请忽略"}' \
  'https://zeno-d9g0gdvw4a57635c0-1452182285.ap-shanghai.app.tcloudbase.com/nihaixia-feedback' | jq
```

健康检查响应示例：

```json
{
  "ok": true,
  "version": "1.1.0",
  "feishu_configured": true,
  "channel": "app_im"
}
```

---

## 备用方案：飞书群机器人 Webhook（可选）

若未配置应用凭证，可降级使用群机器人 Webhook：

1. 目标飞书群 → **设置** → **群机器人** → **添加机器人** → **自定义机器人**
2. 复制 Webhook 地址（格式：`https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx`）
3. 在 CloudBase 控制台配置 `FEISHU_WEBHOOK`

> 通道优先级：`FEISHU_APP_ID` + `FEISHU_APP_SECRET` + `FEISHU_NOTIFY_OPEN_ID` 齐全时走应用私聊；否则有 `FEISHU_WEBHOOK` 时走 webhook；都没有则返回 503。

---

## 云函数行为

| 方法 | 说明 |
|------|------|
| `GET` | 健康检查 `{ ok:true, version:'1.1.0', feishu_configured: bool, channel: 'app_im'|'webhook'|'none' }` |
| `POST` | 接收 `{ category, content, contact?, page?, time?, userAgent? }` |
| `OPTIONS` | CORS 预检 |

校验规则：
- `content` 非空，长度 ≤ 2000
- `category` 白名单或截断至 20 字符
- 未配置飞书通道 → 503 `feishu_not_configured`
- 飞书返回非 200 或 `code !== 0` → 502，不假成功
- 进程内 IP+origin 限流：60 秒 1 次

应用私聊发送流程：
1. `POST /auth/v3/tenant_access_token/internal` 换取 `tenant_access_token`
2. `POST /im/v1/messages?receive_id_type=open_id` 发送文本消息

---

## 方案 B：邮箱（备选，未实现）

### Formspree（最快）

1. 注册 Formspree，创建 form，得到 `https://formspree.io/f/{id}`
2. 前端 `fetch` POST：`{ email: contact, message: content, _subject: category }`
3. 同样：只有响应成功才提示成功

### Resend / SMTP

在云函数里用 API Key 发信到你的邮箱。Key 放环境变量，勿进前端。

---

## 本地导出（兜底）

站长在浏览器控制台：

```js
getFeedbacks()      // 查看本机保存的反馈
exportFeedbacks()   // 下载 nihaixia-feedbacks.json
```

也可引导用户到公众号「数字问渡」留言。
