/**
 * 知识库检索模块 v2 — BM25 关键词检索 + 最低分阈值
 *
 * 改进：
 *   1. 使用 BM25 算法（字符 bigram/trigram 作为 token）
 *   2. 最低分阈值：低于阈值的文档不返回
 *   3. 完全无关问题返回零结果（而非强行召回）
 *   4. 返回证据片段（命中的上下文片段）
 *
 * 加载 knowledge-base.json，提供 searchDocuments(query, limit) 函数
 */

const path = require('path');
const fs = require('fs');

// 模块级缓存
let _data = null;
let _documents = null;
let _docTokens = null; // 缓存每个文档的 token 集合
let _df = null; // document frequency
let _avgDocLength = 0;

// BM25 参数
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const MIN_SCORE_THRESHOLD = 18.0; // 最低 BM25 分数阈值（相关问题最低约24，无关问题最高约16）
const MIN_MATCHED_TERMS = 3; // 至少匹配 3 个查询 token 才返回

// 经典名称映射 — 用于查询扩展
const CLASSIC_NAMES = {
  '伤寒论': 'shanghan',
  '伤寒': 'shanghan',
  '金匮': 'jinkuei',
  '金匮要略': 'jinkuei',
  '黄帝内经': 'huangdi',
  '内经': 'huangdi',
  '素问': 'huangdi',
  '灵枢': 'huangdi',
  '神农本草': 'shennong',
  '本草经': 'shennong',
  '本草': 'shennong',
};

// 主题领域关键词 — 用于查询扩展
const TOPIC_KEYWORDS = {
  '天纪': ['天纪', '天机道', '人间道', '地脉道', '紫微', '斗数', '易经', '六十四卦', '风水'],
  '针灸': ['针灸', '针法', '灸法', '经络', '穴位', '针灸大成'],
  '方剂': ['方剂', '经方', '汉唐', '汤方', '桂枝汤', '麻黄汤', '小柴胡', '理中', '四逆'],
  '课程': ['课程', '讲座', '演讲', '闭门课', '扶阳', '梁冬'],
  '命理': ['八字', '四柱', '紫微', '斗数', '命理', '十神', '五行'],
};

function loadData() {
  if (_data) return _data;
  const jsonPath = path.join(__dirname, 'knowledge-base.json');
  // 容错：knowledge-base.json 不存在时返回空数据（CI 环境或文件缺失时降级）
  if (!fs.existsSync(jsonPath)) {
    _data = { chunks: [] };
    _documents = [];
    _docTokens = [];
    _df = new Map();
    _avgDocLength = 0;
    return _data;
  }
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  _data = JSON.parse(raw);
  _documents = _data.chunks || [];
  
  // 预计算每个文档的 token 集合和长度
  _docTokens = _documents.map((doc) => {
    const tokens = tokenize(doc.content);
    return {
      tokens,
      tokenSet: new Set(tokens),
      length: tokens.length,
    };
  });
  
  // 计算 document frequency
  _df = new Map();
  for (const { tokenSet } of _docTokens) {
    for (const token of tokenSet) {
      _df.set(token, (_df.get(token) || 0) + 1);
    }
  }
  
  // 平均文档长度
  _avgDocLength = _docTokens.length > 0
    ? _docTokens.reduce((s, d) => s + d.length, 0) / _docTokens.length
    : 0;
  
  return _data;
}

// 中文分词：提取字符 bigram 和 trigram + 标点分割的词
function tokenize(text) {
  const tokens = [];
  if (!text) return tokens;
  
  // 按标点和空格分割
  const segments = text.split(/[\s,，。、;；：:？?！!（）()【】\[\]"""''《》<>\/\-—|·•]+/);
  for (const seg of segments) {
    if (!seg) continue;
    // 保留 2-4 字的中文片段作为整体 token
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(seg)) {
      tokens.push(seg);
    }
    // 提取 bigram
    for (let i = 0; i <= seg.length - 2; i++) {
      const bg = seg.slice(i, i + 2);
      if (/^[\u4e00-\u9fa5]{2}$/.test(bg)) tokens.push(bg);
    }
    // 提取 trigram
    for (let i = 0; i <= seg.length - 3; i++) {
      const tg = seg.slice(i, i + 3);
      if (/^[\u4e00-\u9fa5]{3}$/.test(tg)) tokens.push(tg);
    }
  }
  return tokens;
}

// 查询扩展：加入主题关键词
function expandQuery(query) {
  const expanded = [];
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (query.includes(topic) || keywords.some((kw) => query.includes(kw))) {
      expanded.push(...keywords);
    }
  }
  return expanded;
}

// BM25 打分
function bm25Score(queryTokens, docIndex) {
  const docInfo = _docTokens[docIndex];
  if (!docInfo) return 0;
  
  const N = _documents.length;
  let score = 0;
  const matchedTerms = new Set();
  
  for (const qt of queryTokens) {
    if (!docInfo.tokenSet.has(qt)) continue;
    matchedTerms.add(qt);
    const df = _df.get(qt) || 0;
    if (df === 0) continue;
    // IDF
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    // TF
    const tf = docInfo.tokens.filter((t) => t === qt).length;
    // BM25
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docInfo.length / _avgDocLength));
    score += idf * (numerator / denominator);
  }
  
  return { score, matchedCount: matchedTerms.size };
}

// 提取证据片段：在文档内容中找到匹配 token 的上下文
function extractEvidence(content, queryTokens, contextChars = 80) {
  if (!content) return '';
  // 找到第一个匹配的 trigram 或 bigram 位置
  for (const qt of queryTokens) {
    if (qt.length < 2) continue;
    const idx = content.indexOf(qt);
    if (idx >= 0) {
      const start = Math.max(0, idx - contextChars / 2);
      const end = Math.min(content.length, idx + qt.length + contextChars / 2);
      let snippet = content.slice(start, end);
      if (start > 0) snippet = '...' + snippet;
      if (end < content.length) snippet = snippet + '...';
      // 清理换行
      return snippet.replace(/\n+/g, ' ').trim();
    }
  }
  // 没找到精确匹配，返回开头
  return content.slice(0, contextChars).replace(/\n+/g, ' ').trim() + '...';
}

function searchDocuments(query, limit = 5) {
  const data = loadData();
  if (!_documents.length) return [];
  
  // 分词查询
  let queryTokens = tokenize(query);
  
  // 查询扩展
  const expanded = expandQuery(query);
  if (expanded.length) {
    queryTokens = [...new Set([...queryTokens, ...expanded])];
  }
  
  if (!queryTokens.length) return [];
  
  // 对每个文档打分
  const scored = [];
  for (let i = 0; i < _documents.length; i++) {
    const { score, matchedCount } = bm25Score(queryTokens, i);
    if (score < MIN_SCORE_THRESHOLD) continue;
    if (matchedCount < MIN_MATCHED_TERMS) continue;
    scored.push({ doc: _documents[i], score, matchedCount, index: i });
  }
  
  // 按分数降序
  scored.sort((a, b) => b.score - a.score);
  
  // 返回 top N，附带证据片段
  return scored.slice(0, limit).map((s) => ({
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

function getStats() {
  const data = loadData();
  return data.chunk_stats || {};
}

module.exports = {
  searchDocuments,
  tokenize,
  extractEvidence,
  getStats,
  MIN_SCORE_THRESHOLD,
  MIN_MATCHED_TERMS,
};
