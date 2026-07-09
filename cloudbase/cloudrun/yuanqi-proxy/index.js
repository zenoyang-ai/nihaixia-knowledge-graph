/**
 * 倪海厦知识库问答 — CloudBase SCF Web 函数
 * 监听端口 9000，接收 HTTP 请求，转发到腾讯元器 API
 */

const http = require('http');

const YUANQI_API = 'https://open.hunyuan.tencent.com/openapi/v1/agent/chat/completions';
const ASSISTANT_ID = '2075108259383652608';

const ALLOWED_ORIGINS = [
  'https://zenoyang-ai.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
];

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function jsonResponse(res, statusCode, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, { ...extraHeaders, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const h = corsHeaders(origin);

  // OPTIONS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, h);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    jsonResponse(res, 405, { error: '仅支持 POST 请求' }, h);
    return;
  }

  // 读取请求体
  let rawBody = '';
  req.on('data', (chunk) => { rawBody += chunk; });
  req.on('end', async () => {
    let body;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      jsonResponse(res, 400, { error: '请求体必须是 JSON' }, h);
      return;
    }

    const { message } = body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      jsonResponse(res, 400, { error: '请提供 message 字段' }, h);
      return;
    }
    if (message.length > 2000) {
      jsonResponse(res, 400, { error: '消息长度不能超过 2000 字' }, h);
      return;
    }

    const token = process.env.YUANQI_TOKEN;
    if (!token) {
      jsonResponse(res, 500, { error: '服务未配置 API 密钥' }, h);
      return;
    }

    try {
      const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
      const apiResponse = await fetch(YUANQI_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Source': 'openapi',
        },
        body: JSON.stringify({
          assistant_id: ASSISTANT_ID,
          user_id: ip,
          stream: false,
          messages: [{ role: 'user', content: [{ type: 'text', text: message.trim() }] }],
        }),
      });

      if (!apiResponse.ok) {
        console.error('元器 API 错误:', apiResponse.status);
        jsonResponse(res, 502, { error: '元器 API 返回错误' }, h);
        return;
      }

      const data = await apiResponse.json();
      const reply = data?.choices?.[0]?.message?.content || '（未获取到回复内容）';
      jsonResponse(res, 200, { reply }, h);
    } catch (err) {
      console.error('调用元器失败:', err.message);
      jsonResponse(res, 502, { error: '调用元器 API 失败' }, h);
    }
  });
});

server.listen(9000, () => {
  console.log('yuanqi-proxy 启动，监听端口 9000');
});