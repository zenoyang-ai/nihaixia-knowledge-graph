/**
 * 倪海厦知识库问答 — Cloudflare Worker 代理
 * 
 * 用途：前端调用本 Worker，Worker 转发到腾讯元器 API，
 *       密钥（YUANQI_TOKEN）放在 Cloudflare 环境变量中，不暴露到前端。
 * 
 * 部署：npx wrangler deploy
 * 环境变量：在 Cloudflare Dashboard → Workers → Settings → Variables 中设置 YUANQI_TOKEN
 */

const YUANQI_API = 'https://open.hunyuan.tencent.com/openapi/v1/agent/chat/completions';
const ASSISTANT_ID = '2075108259383652608';

// 允许的 CORS 来源
const ALLOWED_ORIGINS = [
  'https://zenoyang-ai.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request);

    // 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    // 仅允许 POST
    if (request.method !== 'POST') {
      return jsonResponse({ error: '仅支持 POST 请求' }, 405, headers);
    }

    // 限流：每 IP 每分钟最多 20 次请求
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateKey = `rate:${ip}`;

    // 简单限流（使用 Worker 全局变量，非持久化，重启后清零）
    if (!globalThis.rateMap) globalThis.rateMap = new Map();
    const now = Date.now();
    const windowStart = now - 60_000;
    const timestamps = globalThis.rateMap.get(rateKey) || [];
    const recent = timestamps.filter((t) => t > windowStart);
    if (recent.length >= 20) {
      return jsonResponse({ error: '请求过于频繁，请稍后再试' }, 429, headers);
    }
    recent.push(now);
    globalThis.rateMap.set(rateKey, recent);

    // 定期清理过期数据（每 5 分钟）
    if (!globalThis.rateCleanup || now - globalThis.rateCleanup > 300_000) {
      globalThis.rateCleanup = now;
      for (const [k, v] of globalThis.rateMap) {
        const valid = v.filter((t) => t > windowStart);
        if (valid.length === 0) globalThis.rateMap.delete(k);
        else globalThis.rateMap.set(k, valid);
      }
    }

    // 解析请求体
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: '请求体必须是 JSON' }, 400, headers);
    }

    const { message } = body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return jsonResponse({ error: '请提供 message 字段' }, 400, headers);
    }
    if (message.length > 2000) {
      return jsonResponse({ error: '消息长度不能超过 2000 字' }, 400, headers);
    }

    const token = env.YUANQI_TOKEN;
    if (!token) {
      return jsonResponse({ error: '服务未配置 API 密钥' }, 500, headers);
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
        return jsonResponse(
          { error: `元器 API 返回错误 (${apiResponse.status})` },
          502,
          headers
        );
      }

      const data = await apiResponse.json();
      const reply =
        data?.choices?.[0]?.message?.content || '（未获取到回复内容）';

      return jsonResponse({ reply }, 200, headers);
    } catch (err) {
      console.error('调用元器 API 失败:', err);
      return jsonResponse({ error: '调用元器 API 失败，请稍后重试' }, 502, headers);
    }
  },
};