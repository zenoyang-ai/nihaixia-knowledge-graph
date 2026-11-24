const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  assertNoForbiddenContent,
  resolveSourceKbPath,
  sanitizeCardText,
  syncQaCoreFromGraph,
} = require('../scripts/sync_qa_core_from_graph');
const routerSearch = require('../cloudbase/functions/nihaixia-qa-router/knowledge-search');

test('sanitizeCardText strips wikilinks, relative links, local paths, and phones', () => {
  const raw = [
    '- [[倪海厦资料/中医/伤寒论/伤寒论注解B5|伤寒论注解B5]]',
    '- [黄帝内经注解](../../04-人纪学习资料/黄帝内经.md)',
    '本地路径 /Users/example/secret/doc.md 手机 13812345678',
  ].join('\n');
  const out = sanitizeCardText(raw);
  assert.ok(!out.includes('[['));
  assert.ok(!out.includes(']]'));
  assert.ok(!out.includes('../../'));
  assert.ok(!out.includes('/Users/'));
  assert.ok(!out.includes('13812345678'));
  assert.ok(out.includes('伤寒论注解B5'));
  assert.ok(out.includes('黄帝内经注解'));
});

test('resolveSourceKbPath resolves both direct file and nested tcb download dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-resolve-'));
  try {
    const nested = path.join(tmp, 'nihaixia-qa-router');
    fs.mkdirSync(nested, { recursive: true });
    const kbFile = path.join(nested, 'knowledge-base.json');
    fs.writeFileSync(kbFile, '{"chunks":[]}', 'utf-8');
    assert.equal(fs.realpathSync(resolveSourceKbPath(kbFile)), fs.realpathSync(kbFile));
    assert.equal(fs.realpathSync(resolveSourceKbPath(tmp)), fs.realpathSync(kbFile));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('assertNoForbiddenContent flags stale sequence claims and wikilinks', () => {
  assert.throws(
    () => assertNoForbiddenContent([{ id: '01#0#0', source_group: '01_知识卡片', chunk_title: '测试', content: '这是第一本经典。' }]),
    /stale_first_classic/
  );
  assert.throws(
    () => assertNoForbiddenContent([{ id: '02#0#0', source_group: '02_主题文章', chunk_title: '测试', content: '[[未清洗双链]]' }]),
    /unstripped_wikilink/
  );
});

test('syncQaCoreFromGraph refreshes 01/02/06 from graph.json while preserving 03..11 chunks', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-sync-'));
  try {
    const sourceKb = path.join(tmp, 'source-kb.json');
    const outDir = path.join(tmp, 'out');
    const mockSource = {
      corpus_version: 'v-test',
      source_manifest: { total_files: 11, total_bytes: 100, files: [] },
      chunks: [
        {
          id: '01_知识卡片#0#0',
          source_group: '01_知识卡片',
          source_quality: 'core',
          subfile: '黄帝内经',
          chunk_title: '黄帝内经',
          content: '旧错句：黄帝内经是第一本经典。',
          content_length: 16,
          keywords: ['黄帝内经'],
        },
        {
          id: '06_补充资料#24#1',
          source_group: '06_补充资料',
          source_quality: 'verified',
          subfile: '倪海厦知识图谱总览',
          chunk_title: '倪海厦知识图谱总览',
          content: '旧错句：黄帝内经：第一本经典。',
          content_length: 16,
          keywords: [],
        },
        {
          id: '06_补充资料#12#0',
          source_group: '06_补充资料',
          source_quality: 'verified',
          subfile: 'flomo 标签｜#天纪',
          chunk_title: 'flomo 标签｜#天纪',
          content: '去蒙之道，是有时机的。要戒壮，即不要太过刚猛，以免事情发展到不可控程度。'.repeat(2),
          content_length: 76,
          keywords: ['天纪'],
        },
        {
          id: '03_经文原文-公开版#0#0',
          source_group: '03_经文原文-公开版',
          source_quality: 'verified',
          subfile: '伤寒论',
          chunk_title: '太阳病',
          content: '太阳之为病，脉浮，头项强痛而恶寒。太阳病提纲原文出处在此。',
          content_length: 30,
          keywords: ['太阳病'],
        },
        {
          id: '07_天纪资料#0#0',
          source_group: '07_天纪资料',
          source_quality: 'verified',
          subfile: '天机道',
          chunk_title: '天机道',
          content: '天机道论紫微斗数十二宫与三方四正之运用。',
          content_length: 22,
          keywords: ['天机道'],
        },
      ],
    };
    fs.writeFileSync(sourceKb, JSON.stringify(mockSource), 'utf-8');

    const summary = syncQaCoreFromGraph({ sourceKbPath: sourceKb, outputDirs: [outDir] });
    assert.equal(summary.cardChunks, 64);
    assert.equal(summary.articleChunks, 7);

    const rebuilt = JSON.parse(fs.readFileSync(path.join(outDir, 'knowledge-base.json'), 'utf-8'));
    const allText = rebuilt.chunks.map((c) => c.content).join('\n');
    assert.ok(!allText.includes('第一本经典'));
    assert.ok(!allText.includes('理论→本草'));
    assert.ok(allText.includes('阳宅定位'));
    assert.ok(allText.includes('六十四卦'));
    assert.ok(allText.includes('以果决行'));
    assert.ok(allText.includes('针灸大成'));

    // Preserved groups remain verbatim
    assert.ok(rebuilt.chunks.some((c) => c.id === '03_经文原文-公开版#0#0'));
    assert.ok(rebuilt.chunks.some((c) => c.id === '07_天纪资料#0#0'));
    assert.ok(rebuilt.chunks.some((c) => c.id === '06_补充资料#12#0'));

    // Verify searchDocuments works against newly built output directory
    routerSearch.setDataDir(outDir);
    routerSearch.setMinScoreThreshold(2.0);
    routerSearch.setMinMatchedTerms(2);
    const hits = routerSearch.searchDocuments('地脉道 阳宅定位', 5);
    assert.ok(hits.some((h) => h.chunk_title === '阳宅定位'), `Expected 阳宅定位 in search hits: ${hits.map((h) => h.chunk_title)}`);
  } finally {
    routerSearch.setDataDir(null);
    routerSearch.setMinScoreThreshold(null);
    routerSearch.setMinMatchedTerms(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
