/**
 * 倪海厦知识库 AI 问答 — 小程序专用云函数
 *
 * 纯转发适配器：接收小程序请求，转发给 nihaixia-qa-router，返回同一响应结构。
 * 不包含 system prompt、不包含 RAG 逻辑、不包含通用模型调用。
 *
 * 小程序端通过 wx.cloud.callFunction 调用本函数，
 * 本函数通过 CloudBase SDK 调用同环境的 nihaixia-qa-router HTTP 函数。
 */

const cloudbase = require('@cloudbase/node-sdk');

exports.main = async (event, context) => {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startTime = Date.now();

  try {
    // 解析入参：兼容 { message } 和 { messages, session_id }
    let messages = event.messages;
    let sessionId = event.session_id || 'mp-anon';

    if (!messages && event.message) {
      messages = [{ role: 'user', content: event.message.trim() }];
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return { error: '请提供 message 或 messages 字段' };
    }

    // 转发给 nihaixia-qa-router（内部调用，origin 为空跳过 CORS）
    const app = cloudbase.init({ env: cloudbase.SYMBOL_DEFAULT_ENV });

    const res = await app.callFunction({
      name: 'nihaixia-qa-router',
      data: {
        httpMethod: 'POST',
        headers: {
          origin: '',
          'x-forwarded-for': '127.0.0.1',
        },
        body: JSON.stringify({
          session_id: sessionId,
          messages,
        }),
      },
    });

    const elapsed = Date.now() - startTime;

    // 解析 router 返回的 HTTP 响应
    const httpRes = res && res.result;
    if (!httpRes) {
      console.log(JSON.stringify({ request_id: requestId, status: 'no_response', elapsed }));
      return { error: '问答服务暂时不可用，请稍后重试', request_id: requestId };
    }

    // router 返回 { statusCode, headers, body }
    let body;
    try {
      body = typeof httpRes.body === 'string' ? JSON.parse(httpRes.body) : httpRes.body;
    } catch {
      body = { error: '解析响应失败' };
    }

    console.log(JSON.stringify({ request_id: requestId, status: httpRes.statusCode || 200, elapsed }));

    // 透传 router 的响应结构
    return body;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.log(JSON.stringify({ request_id: requestId, status: 'error', reason: 'adapter_error', elapsed }));
    return { error: '服务暂时不可用，请稍后重试', request_id: requestId };
  }
};
