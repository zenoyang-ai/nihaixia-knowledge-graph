const assert = require('node:assert/strict');
const test = require('node:test');

const {
  shanghaiDay,
  yesterdayShanghai,
  buildDailyReportText,
  hashVid,
  normalizeSite,
  createAnalyticsHandler,
  resolveFeishu,
  isTimerEvent,
} = require('../cloudbase/functions/nihaixia-analytics');

test('normalizeSite accepts known sites', () => {
  assert.equal(normalizeSite('cn'), 'cn');
  assert.equal(normalizeSite('overseas'), 'overseas');
  assert.equal(normalizeSite('LOCAL'), 'local');
  assert.equal(normalizeSite('other'), '');
});

test('hashVid is stable and short', () => {
  assert.equal(hashVid('abc'), hashVid('abc'));
  assert.equal(hashVid('abc').length, 16);
  assert.notEqual(hashVid('abc'), hashVid('abcd'));
});

test('shanghaiDay returns YYYY-MM-DD', () => {
  assert.match(shanghaiDay(new Date('2026-07-23T16:30:00.000Z')), /^\d{4}-\d{2}-\d{2}$/);
});

test('yesterdayShanghai differs from today', () => {
  assert.notEqual(yesterdayShanghai(), shanghaiDay());
});

test('buildDailyReportText includes both sites', () => {
  const text = buildDailyReportText('2026-07-22', {
    cn: { uv: 3, pv: 10 },
    overseas: { uv: 1, pv: 2 },
    local: { uv: 0, pv: 0 },
  });
  assert.match(text, /【图谱访问日报】/);
  assert.match(text, /国内站：UV 3 · PV 10/);
  assert.match(text, /海外站：UV 1 · PV 2/);
  assert.match(text, /合计（不含本地）：UV 4 · PV 12/);
});

test('resolveFeishu requires secret', () => {
  assert.equal(resolveFeishu({ FEISHU_APP_ID: 'a', FEISHU_NOTIFY_OPEN_ID: 'b' }).configured, false);
  assert.equal(resolveFeishu({
    FEISHU_APP_ID: 'a',
    FEISHU_APP_SECRET: 's',
    FEISHU_NOTIFY_OPEN_ID: 'b',
  }).configured, true);
});

test('isTimerEvent detects timer payload', () => {
  assert.equal(isTimerEvent({ Type: 'Timer', TriggerName: 'dailyVisitReport' }), true);
  assert.equal(isTimerEvent({ httpMethod: 'GET' }), false);
});

test('GET health does not leak secrets', async () => {
  const { main } = createAnalyticsHandler({
    env: {
      FEISHU_APP_ID: 'cli_test',
      FEISHU_APP_SECRET: 'super-secret',
      FEISHU_NOTIFY_OPEN_ID: 'ou_test',
      ALLOWED_ORIGINS: 'https://zenoyang-ai.github.io',
    },
  });
  const res = await main({
    httpMethod: 'GET',
    headers: { origin: 'https://zenoyang-ai.github.io' },
  });
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.feishu_configured, true);
  assert.equal(JSON.stringify(body).includes('super-secret'), false);
});

test('POST pageview writes through dbFactory', async () => {
  const store = new Map();
  const dbFactory = () => ({
    command: {
      inc: (n) => ({ $inc: n }),
      addToSet: (v) => ({ $addToSet: v }),
    },
    collection() {
      return {
        doc(id) {
          return {
            async update(data) {
              if (!store.has(id)) throw new Error('not found');
              const cur = store.get(id);
              if (data.pv && data.pv.$inc) cur.pv += data.pv.$inc;
              if (data.uvids && data.uvids.$addToSet) {
                if (!cur.uvids.includes(data.uvids.$addToSet)) cur.uvids.push(data.uvids.$addToSet);
              }
              store.set(id, cur);
            },
            async set(data) {
              store.set(id, {
                day: data.day,
                site: data.site,
                pv: data.pv,
                uvids: [...data.uvids],
              });
            },
          };
        },
      };
    },
  });

  const { main } = createAnalyticsHandler({
    env: { ALLOWED_ORIGINS: 'https://zenoyang-ai.github.io' },
    dbFactory,
  });
  const res = await main({
    httpMethod: 'POST',
    headers: { origin: 'https://zenoyang-ai.github.io', 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ site: 'cn', path: '/graph', vid: 'visitor-demo-001' }),
  });
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.site, 'cn');
  assert.equal(store.size, 1);
});
