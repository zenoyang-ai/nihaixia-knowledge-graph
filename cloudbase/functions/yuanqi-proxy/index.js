/**
 * 倪海厦知识库问答 — CloudBase 云函数（HTTP）
 * 
 * 用途：前端调用本函数，函数转发到腾讯元器 API，
 *       密钥（YUANQI_TOKEN）放在 CloudBase 环境变量中，不暴露到前端。
 * 
 * 部署：tcb fn deploy yuanqi-proxy
 * 环境变量：在 cloudbaserc.json 的 envVariables 中设置 YUANQI_TOKEN
 * HTTP 绑定：部署后在 CloudBase 控制台 → 云函数 → yuanqi-proxy → 绑定域名/触发路径
 */

const YUANQI_API = 'https://open.hunyuan.tencent.com/openapi/v1/agent/chat/completions';
const ASSISTANT_ID = '2075108259383652608';

// 允许的 CORS 来源
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
  };
}

// 简单限流（内存级，非持久化）
const rateMap = new Map();

function checkRate(ip) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const timestamps = rateMap.get(ip) || [];
  const recent = timestamps.filter((t) => t > windowStart);
  if (recent.length >= 20) return false; // 每分钟最多 20 次
  recent.push(now);
  rateMap.set(ip, recent);
  return true;
}

// 定期清理过期 IP（每 5 分钟）
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, timestamps] of rateMap) {
    const valid = timestamps.filter((t) => t > cutoff);
    if (valid.length === 0) rateMap.delete(ip);
    else rateMap.set(ip, valid);
  }
}, 300_000);

exports.main = async (event) => {
  const headers = corsHeaders(event.headers?.origin || '');

  // 预检请求
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  // 仅允许 POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: '仅支持 POST 请求' }),
    };
  }

  // 限流
  const ip = event.headers?.['x-forwarded-for'] || event.headers?.['x-real-ip'] || 'unknown';
  if (!checkRate(ip)) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: '请求过于频繁，请稍后再试' }),
    };
  }

  // 解析请求体
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: '请求体必须是 JSON' }),
    };
  }

  const { message } = body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: '请提供 message 字段' }),
    };
  }
  if (message.length > 2000) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: '消息长度不能超过 2000 字' }),
    };
  }

  // 从环境变量读取密钥
  const token = process.env.YUANQI_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: '服务未配置 API 密钥' }),
    };
  }

  // 调用元器 API
  try {
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
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: message.trim() }],
          },
        ],
      }),
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      console.error('元器 API 错误:', apiResponse.status, errText);
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `元器 API 返回错误 (${apiResponse.status})` }),
      };
    }

    const data = await apiResponse.json();
    const reply = data?.choices?.[0]?.message?.content || '（未获取到回复内容）';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error('调用元器 API 失败:', err);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: '调用元器 API 失败，请稍后重试' }),
    };
  }
};