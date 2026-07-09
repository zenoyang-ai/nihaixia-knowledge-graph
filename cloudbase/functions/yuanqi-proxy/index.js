/**
 * 倪海厦知识库问答 — CloudBase 事件函数
 * 由 CloudBase HTTP 网关触发
 * 使用 CloudBase AI SDK 直接调用大模型（多模型自动回退）
 */

const cloudbase = require('@cloudbase/node-sdk');

const ALLOWED_ORIGINS = [
  'https://zenoyang-ai.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
];

function buildResponse(statusCode, body, origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
    body: JSON.stringify(body),
  };
}

exports.main = async (event, context) => {
  const origin = (event.headers && event.headers.origin) || '';

  // OPTIONS 预检
  if (event.httpMethod === 'OPTIONS') {
    return buildResponse(204, {}, origin);
  }

  if (event.httpMethod !== 'POST') {
    return buildResponse(405, { error: '仅支持 POST 请求' }, origin);
  }

  // 解析请求体
  let rawBody = event.body || '{}';
  if (event.isBase64Encoded) {
    rawBody = Buffer.from(rawBody, 'base64').toString('utf-8');
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return buildResponse(400, { error: '请求体必须是 JSON' }, origin);
  }

  const { message } = body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return buildResponse(400, { error: '请提供 message 字段' }, origin);
  }
  if (message.length > 2000) {
    return buildResponse(400, { error: '消息长度不能超过 2000 字' }, origin);
  }

  try {
    const app = cloudbase.init({ env: 'zeno-d9g0gdvw4a57635c0' });
    const ai = app.ai();
    const model = ai.createModel('cloudbase');
    
    // 按优先级尝试多个模型
    const models = ['hunyuan-lite', 'hunyuan-turbo', 'hy3-preview', 'deepseek-v4-flash'];
    
    for (const modelName of models) {
      try {
        console.log(`尝试模型: ${modelName}`);
        const res = await model.generateText({
          model: modelName,
          messages: [
            { role: 'user', content: `请以中医专家倪海厦的身份回答以下问题，用中文，专业准确：${message.trim()}` }
          ],
        });
        if (res.text) {
          console.log(`模型 ${modelName} 成功`);
          return buildResponse(200, { reply: res.text }, origin);
        }
      } catch (e) {
        console.log(`模型 ${modelName} 失败: ${e.message}`);
      }
    }
    
    throw new Error('所有模型调用失败');
  } catch (err) {
    console.error('AI 调用失败:', err.message);
    return buildResponse(502, { error: 'AI 服务暂时不可用，请稍后重试' }, origin);
  }
};