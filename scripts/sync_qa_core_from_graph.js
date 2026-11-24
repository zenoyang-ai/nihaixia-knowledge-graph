#!/usr/bin/env node
/**
 * 基于 docs/data/graph.json 与三纪总览文档，热同步云函数 QA 语料包的核心层，
 * 并原封不动保留 03~11 组的古籍/天纪/讲座原文分块，最后重算 BM25 倒排索引。
 *
 * 用法：
 *   node scripts/sync_qa_core_from_graph.js <source-kb-json-or-dir> [output-dirs...]
 *
 * 默认输出到：
 *   - cloudbase/functions/nihaixia-qa-router/
 *   - cloudbase/functions/nihaixia-qa-mp/
 */

const fs = require('fs');
const path = require('path');
const {
  buildInvertedIndex,
  extractKeywords,
  splitIntoChunks,
} = require('./generate-knowledge-base');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_GRAPH_PATH = path.join(REPO_ROOT, 'docs', 'data', 'graph.json');
const DEFAULT_OVERVIEW_PATH = path.join(REPO_ROOT, 'knowledge', '00-倪海厦生平与三纪总览.md');
const DEFAULT_TARGETS = [
  path.join(REPO_ROOT, 'cloudbase', 'functions', 'nihaixia-qa-router'),
  path.join(REPO_ROOT, 'cloudbase', 'functions', 'nihaixia-qa-mp'),
];

const PRESERVED_GROUPS_BEFORE_06 = [
  '03_经文原文-公开版',
  '04_经文原文-完整版',
  '05_汉唐方剂讲解',
];
const PRESERVED_GROUPS_AFTER_06 = [
  '07_天纪资料',
  '08_补充课程',
  '09_中医原始资料',
  '10_课程字幕',
  '11_玄学体系',
];
const ALL_GROUPS_ORDER = [
  '01_知识卡片',
  '02_主题文章',
  ...PRESERVED_GROUPS_BEFORE_06,
  '06_补充资料',
  ...PRESERVED_GROUPS_AFTER_06,
];

// 06_补充资料 中保留的非索引补充短笔记；其余旧版总览/旧路径/网盘说明将被三纪总览与新卡片取代
const KEEP_SUPPLEMENT_TITLES = new Set([
  'flomo 标签｜#天纪',
  '中医知识关联',
  '天人合一思想整合',
]);

const FORBIDDEN_PATTERNS = [
  { name: 'stale_first_classic', re: /第一本经典/ },
  { name: 'stale_old_order', re: /理论→本草/ },
  { name: 'local_home_path', re: /\/(?:Users|home)\/[^\s"')]+/ },
  { name: 'unstripped_wikilink', re: /\[\[|\]\]/ },
];

/**
 * 清洗文本中的双链、相对文件链接、本机路径与个人标识。
 */
function sanitizeCardText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.replace(/\r\n/g, '\n');

  // Obsidian wikilinks: ![[a/b.md|alias]] or [[a/b|alias]] -> alias or basename
  text = text.replace(/!?\s*\[\s*\[\s*([^\]|]+?)(?:\|([^\]]+?))?\s*\]\s*\]/g, (_, target, alias) => {
    if (alias && alias.trim()) return alias.trim();
    const base = target.trim().split('/').pop() || target.trim();
    return base.replace(/\.md$/i, '');
  });

  // Markdown 相对链接 [标题](../path/file.md) -> 标题
  text = text.replace(/\[([^\]]+)\]\(\.\.?\/[^)\s]+\)/g, '$1');

  // 清除误入的本机路径与敏感联系方式格式
  text = text.replace(/\/(?:Users|home)\/[^\s\]\[()<>\"'，。；：、]+/g, '[已脱敏路径]');
  text = text.replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[已脱敏手机号]');
  text = text.replace(/(?<!\d)(?:\d{17}[0-9Xx]|\d{15})(?!\d)/g, '[已脱敏证件号]');
  text = text.replace(/(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w.-])/g, '[已脱敏邮箱]');

  return text.trim();
}

/**
 * 清理并去重原始出处中的多行重复条目。
 */
function formatCleanSourceSection(raw) {
  const cleaned = sanitizeCardText(raw);
  if (!cleaned) return '';
  const seen = new Set();
  const lines = [];
  for (const line of cleaned.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    lines.push(trimmed);
  }
  return lines.join('\n');
}

/**
 * 将 graph.json 单个节点或专题文章渲染为紧凑可读 Markdown 文本。
 */
function formatItemMarkdown(item) {
  const parts = [`# ${item.title}`];
  if (item.layer) {
    parts.push(`所属层级：${item.layer}`);
  }
  if (item.definition) {
    parts.push(`## 一句话定义\n\n${sanitizeCardText(item.definition)}`);
  }
  if (item.summary) {
    parts.push(`## 白话解释\n\n${sanitizeCardText(item.summary)}`);
  }

  const sections = item.sections || {};
  const sectionOrder = ['核心理解', '学习路径', '原始出处', '安全边界'];
  const extraKeys = Object.keys(sections).filter((k) => !sectionOrder.includes(k));
  for (const secName of [...sectionOrder, ...extraKeys]) {
    const rawVal = sections[secName];
    if (!rawVal || !String(rawVal).trim()) continue;
    const text = secName === '原始出处'
      ? formatCleanSourceSection(String(rawVal))
      : sanitizeCardText(String(rawVal));
    if (text) {
      parts.push(`## ${secName}\n\n${text}`);
    }
  }

  if (Array.isArray(item.quotes) && item.quotes.length > 0) {
    const qLines = item.quotes
      .map((q) => {
        if (typeof q === 'string') return `- ${sanitizeCardText(q)}`;
        const txt = sanitizeCardText(q.text || '');
        const src = sanitizeCardText(q.source || '');
        return txt ? `- “${txt}”${src ? ` —— ${src}` : ''}` : '';
      })
      .filter(Boolean);
    if (qLines.length) {
      parts.push(`## 倪海厦原话\n\n${qLines.join('\n')}`);
    }
  }

  if (Array.isArray(item.misconceptions) && item.misconceptions.length > 0) {
    const mLines = item.misconceptions
      .map((m) => {
        if (typeof m === 'string') return `- ${sanitizeCardText(m)}`;
        const wrong = sanitizeCardText(m.wrong || '');
        const corr = sanitizeCardText(m.correction || '');
        if (!wrong && !corr) return '';
        return `- 误区：${wrong}${corr ? `；正解：${corr}` : ''}`;
      })
      .filter(Boolean);
    if (mLines.length) {
      parts.push(`## 常见误区\n\n${mLines.join('\n')}`);
    }
  }

  const linkLines = [];
  if (Array.isArray(item.upstream) && item.upstream.length) {
    linkLines.push(`- 上游前置：${item.upstream.join('、')}`);
  }
  if (Array.isArray(item.downstream) && item.downstream.length) {
    linkLines.push(`- 下游延伸：${item.downstream.join('、')}`);
  }
  if (Array.isArray(item.related) && item.related.length) {
    linkLines.push(`- 同层/关联：${item.related.join('、')}`);
  }
  if (linkLines.length) {
    parts.push(`## 图谱关联\n\n${linkLines.join('\n')}`);
  }

  return parts.join('\n\n');
}

/**
 * 将 learning_paths（人纪 / 天纪）渲染为可读学习路线 Markdown。
 */
function formatLearningPathMarkdown(lp) {
  const parts = [`# ${lp.title}`, `> ${sanitizeCardText(lp.desc || '')}`];
  for (const stage of lp.stages || []) {
    const nodesText = Array.isArray(stage.nodes) && stage.nodes.length
      ? `\n\n核心节点：${stage.nodes.join('、')}`
      : '';
    parts.push(`## ${stage.title}\n\n${sanitizeCardText(stage.desc || '')}${nodesText}`);
  }
  return parts.join('\n\n');
}

/**
 * 将 Markdown 文档切片并打包为标准 QA chunk 对象数组。
 */
function buildChunksFromDocs(docs, sourceGroup, sourceQuality) {
  const out = [];
  docs.forEach((doc, subIdx) => {
    const pieces = splitIntoChunks(doc.content);
    pieces.forEach((piece, chunkIdx) => {
      const content = piece.trim();
      if (!content) return;
      out.push({
        id: `${sourceGroup}#${subIdx}#${chunkIdx}`,
        source_group: sourceGroup,
        source_quality: sourceQuality,
        learning_use: 'learning_research',
        medical_safety: 'learning_only',
        subfile: doc.subfile,
        chunk_title: doc.chunkTitle,
        chunk_index: chunkIdx,
        content,
        content_length: content.length,
        keywords: extractKeywords(content),
      });
    });
  });
  return out;
}

/**
 * 解析源 knowledge-base.json 路径，兼容直接传文件路径或下载目录。
 */
function resolveSourceKbPath(inputPath) {
  if (!inputPath) {
    throw new Error('缺少参数：<source-kb-json-or-dir>');
  }
  const abs = path.resolve(inputPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`源路径不存在: ${abs}`);
  }
  const st = fs.statSync(abs);
  if (st.isFile()) return abs;

  const direct = path.join(abs, 'knowledge-base.json');
  if (fs.existsSync(direct)) return direct;

  // tcb fn code download 可能多一层函数名目录
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const nested = path.join(abs, entry.name, 'knowledge-base.json');
      if (fs.existsSync(nested)) return nested;
    }
  }
  throw new Error(`目录中未找到 knowledge-base.json: ${abs}`);
}

/**
 * 断言核心更新区域与补充资料不含陈旧错句、双链语法与本机路径。
 */
function assertNoForbiddenContent(chunks) {
  const checkedGroups = new Set(['01_知识卡片', '02_主题文章', '06_补充资料']);
  const hits = [];
  for (const chunk of chunks) {
    if (!checkedGroups.has(chunk.source_group)) continue;
    const text = chunk.content || '';
    for (const { name, re } of FORBIDDEN_PATTERNS) {
      if (re.test(text)) {
        hits.push(`${chunk.id} (${chunk.chunk_title}): ${name}`);
      }
    }
  }
  if (hits.length) {
    throw new Error(`核心分块安全/一致性校验失败:\n  - ${hits.slice(0, 10).join('\n  - ')}`);
  }
}

/**
 * 基于现有语料包与最新 graph.json 重建完整 knowledge-base 与 inverted-index。
 */
function syncQaCoreFromGraph({
  sourceKbPath,
  graphPath = DEFAULT_GRAPH_PATH,
  overviewPath = DEFAULT_OVERVIEW_PATH,
  outputDirs = DEFAULT_TARGETS,
} = {}) {
  const resolvedKbPath = resolveSourceKbPath(sourceKbPath);
  const existingKb = JSON.parse(fs.readFileSync(resolvedKbPath, 'utf-8'));
  if (!Array.isArray(existingKb.chunks) || existingKb.chunks.length === 0) {
    throw new Error(`源语料包 chunks 为空: ${resolvedKbPath}`);
  }

  const graph = JSON.parse(fs.readFileSync(path.resolve(graphPath), 'utf-8'));
  const nodes = graph.nodes || [];
  const articles = graph.articles || [];
  const learningPaths = graph.learning_paths || {};

  // 1) 从 graph.json 生成最新 01_知识卡片（64 节点）与 02_主题文章（5 专题 + 2 条路径）
  const nodeDocs = nodes.map((n) => ({
    subfile: n.title,
    chunkTitle: n.title,
    content: formatItemMarkdown(n),
  }));
  const coreNodeChunks = buildChunksFromDocs(nodeDocs, '01_知识卡片', 'core');

  const articleDocs = articles.map((a) => ({
    subfile: a.title,
    chunkTitle: a.title,
    content: formatItemMarkdown(a),
  }));
  for (const key of ['renji', 'tianji']) {
    if (learningPaths[key]) {
      articleDocs.push({
        subfile: learningPaths[key].title,
        chunkTitle: learningPaths[key].title,
        content: formatLearningPathMarkdown(learningPaths[key]),
      });
    }
  }
  const coreArticleChunks = buildChunksFromDocs(articleDocs, '02_主题文章', 'core');

  // 2) 清理 06_补充资料中的旧版索引/路径/网盘说明，改用最新三纪总览 + 有效非索引短笔记
  const supDocs = [];
  if (overviewPath && fs.existsSync(overviewPath)) {
    const overviewRaw = fs.readFileSync(path.resolve(overviewPath), 'utf-8');
    const overviewClean = sanitizeCardText(overviewRaw);
    if (overviewClean) {
      supDocs.push({
        subfile: '00-倪海厦生平与三纪总览.md',
        chunkTitle: '倪海厦生平与三纪总览',
        content: overviewClean,
      });
    }
  }
  const rebuiltOverviewChunks = buildChunksFromDocs(supDocs, '06_补充资料', 'verified');
  const keptOldSupChunks = existingKb.chunks.filter(
    (c) =>
      c.source_group === '06_补充资料' &&
      c.content_length > 60 &&
      KEEP_SUPPLEMENT_TITLES.has(c.chunk_title)
  );
  const cleanedSupChunks = [...rebuiltOverviewChunks, ...keptOldSupChunks];

  // 3) 组装全量语料（原封不动保留 03/04/05/07/08/09/10/11 原文分块）
  const byGroup = new Map();
  for (const grp of ALL_GROUPS_ORDER) byGroup.set(grp, []);
  byGroup.set('01_知识卡片', coreNodeChunks);
  byGroup.set('02_主题文章', coreArticleChunks);
  byGroup.set('06_补充资料', cleanedSupChunks);

  for (const c of existingKb.chunks) {
    const grp = c.source_group;
    if (PRESERVED_GROUPS_BEFORE_06.includes(grp) || PRESERVED_GROUPS_AFTER_06.includes(grp)) {
      byGroup.get(grp).push(c);
    }
  }

  const allChunks = [];
  const bySourceStats = [];
  for (const grp of ALL_GROUPS_ORDER) {
    const list = byGroup.get(grp) || [];
    if (!list.length) continue;
    allChunks.push(...list);
    bySourceStats.push({
      source_group: grp,
      source_quality: list[0].source_quality || 'verified',
      chunk_count: list.length,
      total_chars: list.reduce((sum, item) => sum + (item.content_length || item.content.length), 0),
    });
  }

  assertNoForbiddenContent(allChunks);

  const totalChars = allChunks.reduce((sum, item) => sum + (item.content_length || item.content.length), 0);
  const kbOutput = {
    corpus_version: `${existingKb.corpus_version || 'v2'}+graph-sync`,
    generated_at: new Date().toISOString(),
    source_manifest: existingKb.source_manifest || {},
    chunk_stats: {
      total_chunks: allChunks.length,
      total_chars: totalChars,
      avg_chunk_length: allChunks.length > 0 ? Math.round(totalChars / allChunks.length) : 0,
      by_source: bySourceStats,
    },
    chunks: allChunks,
  };

  const indexOutput = buildInvertedIndex(allChunks);
  const kbJson = JSON.stringify(kbOutput);
  const idxJson = JSON.stringify(indexOutput);

  for (const dir of outputDirs) {
    const absDir = path.resolve(dir);
    fs.mkdirSync(absDir, { recursive: true });
    fs.writeFileSync(path.join(absDir, 'knowledge-base.json'), kbJson, 'utf-8');
    fs.writeFileSync(path.join(absDir, 'inverted-index.json'), idxJson, 'utf-8');
  }

  return {
    totalChunks: allChunks.length,
    cardChunks: coreNodeChunks.length,
    articleChunks: coreArticleChunks.length,
    supChunks: cleanedSupChunks.length,
    indexTokens: Object.keys(indexOutput.inverted_index).length,
    bySourceStats,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node scripts/sync_qa_core_from_graph.js <source-kb-json-or-dir> [output-dirs...]');
    process.exit(1);
  }
  const sourceKbPath = args[0];
  const outputDirs = args.length > 1 ? args.slice(1) : DEFAULT_TARGETS;
  const summary = syncQaCoreFromGraph({ sourceKbPath, outputDirs });
  console.log('SYNC_QA_CORE_OK', JSON.stringify(summary));
}

if (require.main === module) {
  main();
}

module.exports = {
  assertNoForbiddenContent,
  formatCleanSourceSection,
  formatItemMarkdown,
  formatLearningPathMarkdown,
  resolveSourceKbPath,
  sanitizeCardText,
  syncQaCoreFromGraph,
};
