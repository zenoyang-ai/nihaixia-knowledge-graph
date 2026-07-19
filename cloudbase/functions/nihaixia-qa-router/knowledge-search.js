/**
 * 知识库检索模块 v4 — 倒排索引 + BM25 + 真哈希去重 + source_group 限额
 *
 * 改进（v4）：
 *   1. 支持 setDataDir(dir) 注入测试 fixture，不再固定读 __dirname
 *   2. 支持 setMinScoreThreshold(n) 测试时降低阈值（fixture N 小，分数天然低）
 *   3. 去重改用 SHA-256(content) 而非 content.slice(0, 200)
 *   4. 同一 source_group 最多保留 2 个结果，保证多样性
 *   5. 保留 BM25 阈值 + 最低匹配数 + 证据片段
 *
 * 依赖：
 *   - knowledge-base.json：分块语料（chunks 数组）
 *   - inverted-index.json：倒排索引（token -> [docIdx1, tf1, docIdx2, tf2, ...]）
 *
 * searchDocuments(query, limit) 返回 [{source_group, source_quality, subfile,
 *   chunk_title, content, content_length, score, matched_terms, evidence}]
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 模块级缓存
let _data = null;          // knowledge-base.json
let _inverted = null;      // 普通对象：token -> [docIdx1, tf1, docIdx2, tf2, ...]（扁平格式）
let _docLengths = null;    // 数组：每个文档的 token 数
let _avgDocLength = 0;
let _totalDocs = 0;

// 数据目录与阈值覆盖（供测试注入）
let _dataDir = null;             // null = 使用 __dirname
let _thresholdOverride = null;   // null = 使用 MIN_SCORE_THRESHOLD
let _matchedTermsOverride = null;

// BM25 参数
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const MIN_SCORE_THRESHOLD = 18.0;
const MIN_MATCHED_TERMS = 3;

// 同一 source_group 在最终结果中最多占多少条（保证多样性）
const MAX_PER_SOURCE_GROUP = 2;

// 主题领域关键词（备用，如果 inverted-index.json 未内嵌）
const TOPIC_KEYWORDS_FALLBACK = {
  '天纪': ['天纪', '天机道', '人间道', '地脉道', '紫微', '斗数', '易经', '六十四卦', '风水'],
  '针灸': ['针灸', '针法', '灸法', '经络', '穴位', '针灸大成'],
  '方剂': ['方剂', '经方', '汉唐', '汤方', '桂枝汤', '麻黄汤', '小柴胡', '理中', '四逆'],
  '课程': ['课程', '讲座', '演讲', '闭门课', '扶阳', '梁冬'],
  '命理': ['八字', '四柱', '紫微', '斗数', '命理', '十神', '五行'],
};

let _topicKeywords = TOPIC_KEYWORDS_FALLBACK;

/**
 * 注入数据目录（用于测试 fixture）。
 * 调用后重置缓存，下次 loadData 会从新目录读取。
 */
function setDataDir(dir) {
  _dataDir = dir;
  _data = null;
  _inverted = null;
  _docLengths = null;
  _avgDocLength = 0;
  _totalDocs = 0;
}

/**
 * 覆盖 BM25 最低分阈值（用于测试 fixture，N 较小时分数天然较低）。
 * 传 null 恢复默认值。
 */
function setMinScoreThreshold(t) {
  _thresholdOverride = (typeof t === 'number' && t >= 0) ? t : null;
}

/**
 * 覆盖最低匹配 token 数。传 null 恢复默认值。
 */
function setMinMatchedTerms(n) {
  _matchedTermsOverride = (typeof n === 'number' && n >= 0) ? n : null;
}

// 中文分词：提取字符 bigram 和 trigram + 标点分割的词
function tokenize(text) {
  const tokens = [];
  if (!text) return tokens;

  const segments = text.split(/[\s,，。、;；：:？?！!（）()【】\[\]"""''《》<>\/\-—|·•]+/);
  for (const seg of segments) {
    if (!seg) continue;
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(seg)) {
      tokens.push(seg);
    }
    for (let i = 0; i <= seg.length - 2; i++) {
      const bg = seg.slice(i, i + 2);
      if (/^[\u4e00-\u9fa5]{2}$/.test(bg)) tokens.push(bg);
    }
    for (let i = 0; i <= seg.length - 3; i++) {
      const tg = seg.slice(i, i + 3);
      if (/^[\u4e00-\u9fa5]{3}$/.test(tg)) tokens.push(tg);
    }
  }
  return tokens;
}

function loadData() {
  if (_data) return _data;
  const baseDir = _dataDir || __dirname;
  const kbPath = path.join(baseDir, 'knowledge-base.json');
  const idxPath = path.join(baseDir, 'inverted-index.json');

  // 容错：文件缺失时返回空数据（CI 环境降级）
  if (!fs.existsSync(kbPath)) {
    _data = { chunks: [] };
    _inverted = {};
    _docLengths = [];
    _avgDocLength = 0;
    _totalDocs = 0;
    return _data;
  }
  _data = JSON.parse(fs.readFileSync(kbPath, 'utf-8'));
  if (!_data.chunks) _data.chunks = [];

  // 加载倒排索引（直接使用对象，不转换为 Map，避免内存翻倍）
  if (fs.existsSync(idxPath)) {
    const raw = fs.readFileSync(idxPath, 'utf-8');
    const idx = JSON.parse(raw);
    _inverted = idx.inverted_index || {};
    _docLengths = idx.doc_lengths || [];
    _avgDocLength = idx.avg_doc_length || 0;
    _totalDocs = idx.total_docs || _data.chunks.length;
    if (idx.topic_keywords) {
      _topicKeywords = idx.topic_keywords;
    }
    // 释放原始字符串内存
    idx.inverted_index = null;
  } else {
    // 降级：无倒排索引时返回空检索（避免内存膨胀）
    console.warn('inverted-index.json not found, search disabled');
    _inverted = {};
    _docLengths = [];
    _avgDocLength = 0;
    _totalDocs = _data.chunks.length;
  }

  return _data;
}

// 查询扩展：加入主题关键词
function expandQuery(query) {
  const expanded = [];
  for (const [topic, keywords] of Object.entries(_topicKeywords)) {
    if (query.includes(topic) || keywords.some((kw) => query.includes(kw))) {
      expanded.push(...keywords);
    }
  }
  return expanded;
}

// BM25 打分单个文档（使用扁平格式倒排表）
function bm25ScoreDoc(queryTokens, docIndex, docLength) {
  let score = 0;
  let matchedCount = 0;

  for (const qt of queryTokens) {
    const flat = _inverted[qt];
    if (!flat) continue;

    // 扁平格式：[docIdx1, tf1, docIdx2, tf2, ...]
    let tf = 0;
    for (let i = 0; i < flat.length; i += 2) {
      if (flat[i] === docIndex) {
        tf = flat[i + 1];
        break;
      }
    }
    if (tf === 0) continue;

    matchedCount++;
    const df = flat.length / 2; // postings 数 = 数组长度 / 2
    if (df === 0) continue;

    // IDF
    const idf = Math.log(1 + (_totalDocs - df + 0.5) / (df + 0.5));
    // BM25
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / _avgDocLength));
    score += idf * (numerator / denominator);
  }

  return { score, matchedCount };
}

// 提取证据片段
function extractEvidence(content, queryTokens, contextChars = 80) {
  if (!content) return '';
  for (const qt of queryTokens) {
    if (qt.length < 2) continue;
    const idx = content.indexOf(qt);
    if (idx >= 0) {
      const start = Math.max(0, idx - contextChars / 2);
      const end = Math.min(content.length, idx + qt.length + contextChars / 2);
      let snippet = content.slice(start, end);
      if (start > 0) snippet = '...' + snippet;
      if (end < content.length) snippet = snippet + '...';
      return snippet.replace(/\n+/g, ' ').trim();
    }
  }
  return content.slice(0, contextChars).replace(/\n+/g, ' ').trim() + '...';
}

function searchDocuments(query, limit = 5) {
  const data = loadData();
  if (!_data.chunks.length || Object.keys(_inverted).length === 0) return [];

  const threshold = _thresholdOverride !== null ? _thresholdOverride : MIN_SCORE_THRESHOLD;
  const minMatched = _matchedTermsOverride !== null ? _matchedTermsOverride : MIN_MATCHED_TERMS;

  // 分词查询
  let queryTokens = tokenize(query);

  // 查询扩展
  const expanded = expandQuery(query);
  if (expanded.length) {
    queryTokens = [...new Set([...queryTokens, ...expanded])];
  }

  if (!queryTokens.length) return [];

  // 收集候选文档：只打分包含至少一个查询 token 的文档
  const candidateDocs = new Set();
  for (const qt of queryTokens) {
    const flat = _inverted[qt];
    if (flat) {
      for (let i = 0; i < flat.length; i += 2) {
        candidateDocs.add(flat[i]);
      }
    }
  }

  // 打分候选文档
  const scored = [];
  for (const docIndex of candidateDocs) {
    const docLength = _docLengths[docIndex] || 0;
    const { score, matchedCount } = bm25ScoreDoc(queryTokens, docIndex, docLength);
    if (score < threshold) continue;
    if (matchedCount < minMatched) continue;
    scored.push({ doc: _data.chunks[docIndex], score, matchedCount });
  }

  // 按分数降序
  scored.sort((a, b) => b.score - a.score);

  // 去重 + source_group 限额：
  //   - 真正的 SHA-256 哈希，不再用前 200 字符
  //   - 同一 source_group 最多保留 MAX_PER_SOURCE_GROUP 条，保证多样性
  const seenHashes = new Set();
  const sourceGroupCount = new Map();
  const deduped = [];
  for (const s of scored) {
    const hashKey = crypto.createHash('sha256').update(s.doc.content).digest('hex');
    if (seenHashes.has(hashKey)) continue;
    seenHashes.add(hashKey);

    const group = s.doc.source_group || '__unknown__';
    const currentCount = sourceGroupCount.get(group) || 0;
    if (currentCount >= MAX_PER_SOURCE_GROUP) continue;
    sourceGroupCount.set(group, currentCount + 1);

    deduped.push(s);
    if (deduped.length >= limit) break;
  }

  // 返回 top N
  return deduped.map((s) => ({
    source_group: s.doc.source_group,
    source_quality: s.doc.source_quality,
    subfile: s.doc.subfile,
    chunk_title: s.doc.chunk_title,
    content: s.doc.content,
    content_length: s.doc.content_length,
    score: Math.round(s.score * 100) / 100,
    matched_terms: s.matchedCount,
    evidence: extractEvidence(s.doc.content, queryTokens),
  }));
}

module.exports = {
  searchDocuments,
  loadData,
  tokenize,
  setDataDir,
  setMinScoreThreshold,
  setMinMatchedTerms,
  MIN_SCORE_THRESHOLD,
  MIN_MATCHED_TERMS,
  MAX_PER_SOURCE_GROUP,
};
