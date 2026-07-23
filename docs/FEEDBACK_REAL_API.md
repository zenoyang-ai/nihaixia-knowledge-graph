# 反馈功能：本地保存 → 独立真实接口

当前网站反馈（`docs/assets/feedback.js`）采用 **本机 localStorage 真实保存**：

- 成功文案明确写「已保存在本机」，**不会**再假装写入云端。
- 站长在浏览器控制台执行：`getFeedbacks()` 或 `exportFeedbacks()`。
- 也可引导用户到公众号「数字问渡」留言。

用户量不大时，本地保存足够。需要飞书/邮箱时，按下面接入，不要再把反馈塞进问答云函数。

---

## 方案 A：飞书自定义机器人 Webhook（推荐）

1. 飞书群 → 设置 → 群机器人 → 添加「自定义机器人」→ 复制 Webhook URL。  
2. **不要把 Webhook 写进前端公开仓库**（会被滥用）。应走：
   - 新建云函数 `nihaixia-feedback`（仅接受 `{category,content,contact,time}`），或
   - Cloudflare Worker / 自建小后端代理转发。
3. 云函数伪代码：

```js
exports.main = async (event) => {
  const body = typeof event === 'string' ? JSON.parse(event) : event;
  if (!body.content || String(body.content).length > 2000) {
    return { ok: false, error: 'invalid' };
  }
  const text = [
    `【倪海厦图谱反馈】${body.category || '其他'}`,
    body.content,
    body.contact ? `联系：${body.contact}` : '',
    body.time || new Date().toISOString(),
    body.page || '',
  ].filter(Boolean).join('\n');

  await fetch(process.env.FEISHU_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'text', content: { text } }),
  });
  return { ok: true };
};
```

4. 前端仅在 **HTTP 200 且 ok:true** 时显示「已送达」；失败显示错误，并可继续本地兜底保存。

环境变量示例：`FEISHU_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxxx`

---

## 方案 B：邮箱（Formspree / Resend / 自建 SMTP）

### Formspree（最快）

1. 注册 Formspree，创建 form，得到 `https://formspree.io/f/xxxxxx`。  
2. 前端 `fetch` POST：`{ email: contact, message: content, _subject: category }`。  
3. 同样：只有响应成功才提示成功。

### Resend / SMTP

在云函数里用 API Key 发信到你的邮箱。Key 放环境变量，勿进前端。

---

## 方案 C：继续本地 + 定期导出

```js
exportFeedbacks()  // 下载 nihaixia-feedbacks.json
```

适合早期，零运维。

---

## 前端改造要点（接入真实接口时）

1. 删除/停用问答 router 作为反馈通道。  
2. `await fetch(FEEDBACK_URL)` → 检查 `res.ok`。  
3. 成功：显示「已送达站长」；失败：显示原因 + 仍可 `localStorage` 兜底。  
4. 加简单限流（同页 60 秒内最多 1 次）防刷。

当前阶段：**本地保存已诚实可用**；真实接口按 A/B 择一即可上线。
