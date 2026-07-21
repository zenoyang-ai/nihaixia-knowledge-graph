#!/usr/bin/env node
/**
 * 从 11 个 QA 上传包 MD 文件生成分块知识库 + 倒排索引
 *
 * 用法：
 *   node scripts/generate-knowledge-base.js <qa-upload-dir> [output-dir]
 *
 * 默认输出到 cloudbase/functions/nihaixia-qa-router/ 和 nihaixia-qa-mp/：
 *   - knowledge-base.json：分块语料（chunks + manifest）
 *   - inverted-index.json：BM25 倒排索引（token → 文档列表）
 *
 * 分块策略：
 *   - 每个 QA MD 文件按 "={80,}" 分隔符切分子文件
 *   - 每个子文件按段落（双换行）进一步切分
 *   - 对明确的星曜标题优先按语义段落切分，避免多个主星混在同一块
 *   - 其余内容累积段落直到 1200-2000 字符为一块
 *
 * 校验：
 *   - manifest 的 11 个文件必须全部存在
 *   - 每个文件的字节数和 SHA-256 必须与 manifest 一致
 *   - 任一不符非零退出
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const QA_DIR = process.argv[2] || process.env.QA_DIR || '';
const OUTPUT_DIR = process.argv[3] || '';

const MANIFEST_PATH = path.join(QA_DIR, 'manifest.json');

const TARGET_CHUNK_MIN = 1200;
const TARGET_CHUNK_MAX = 2000;

// 天纪原始资料中部分标题没有 Markdown #，而是独占一行并以反斜杠结尾。
// 只识别明确的星曜章节，避免把目录中的“紫微星 12”之类条目误判为正文。
const STAR_SECTION_HEADING = /^(?:主星之)?(?:紫微|天机|太阳|武曲|天同|廉贞|天府|太阴|天梁|天相|七杀|破军|贪狼|巨门)星$/;
const AUXILIARY_STAR_SECTION_HEADINGS = new Set([
  '左辅右弼、三台八座',
  '禄存星',
  '六吉星之曲昌',
  '六吉星之魁钺',
  '六吉星之红鸾、天喜',
  '六煞星：羊陀 火铃 空劫',
]);

// BM25 参数（与 knowledge-search.js 保持一致）
const BM25_K1 = 1.5;
const BM25_B = 0.75;

// ---------------------------------------------------------------------------
// 校验 manifest 完整性
// ---------------------------------------------------------------------------
function validateManifest(manifest) {
  const errors = [];
  if (!manifest.files || !Array.isArray(manifest.files)) {
    errors.push('manifest.files 不是数组');
    return errors;
  }
  if (manifest.files.length !== 11) {
    errors.push(`manifest.files 期望 11 个文件，实际 ${manifest.files.length}`);
  }
  for (const entry of manifest.files) {
    if (!entry.filename) {
      errors.push('manifest 条目缺少 filename');
      continue;
    }
    if (!entry.source_group) {
      errors.push(`${entry.filename}: 缺少 source_group`);
    }
    if (!entry.source_quality) {
      errors.push(`${entry.filename}: 缺少 source_quality`);
    }
    if (typeof entry.bytes !== 'number' || entry.bytes <= 0) {
      errors.push(`${entry.filename}: bytes 无效`);
    }
    if (!entry.sha256 || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      errors.push(`${entry.filename}: sha256 无效`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 校验文件存在、字节数、SHA-256
// ---------------------------------------------------------------------------
function verifyFile(filePath, entry) {
  if (!fs.existsSync(filePath)) {
    return `文件不存在: ${entry.filename}`;
  }
  const stat = fs.statSync(filePath);
  if (stat.size !== entry.bytes) {
    return `${entry.filename}: 字节数不符（期望 ${entry.bytes}，实际 ${stat.size}）`;
  }
  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  if (hash !== entry.sha256) {
    return `${entry.filename}: SHA-256 不符（期望 ${entry.sha256.slice(0, 16)}...，实际 ${hash.slice(0, 16)}...）`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 解析与分块
// ---------------------------------------------------------------------------
function parseFrontmatter(text) {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) return { frontmatter: {}, body: text };
  const fmText = fmMatch[1];
  const frontmatter = {};
  for (const line of fmText.split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (m) frontmatter[m[1]] = m[2];
  }
  return { frontmatter, body: text.slice(fmMatch[0].length) };
}

function extractKeywords(content) {
  const keywords = new Set();
  for (const line of content.split('\n')) {
    const m = line.match(/^#+\s*(.+)$/);
    if (m) {
      const title = m[1].trim();
      const segs = title.split(/[\s,，。、;；：:？?！!（）()【】\[\]"""''《》<>\/\-—|]+/);
      for (const seg of segs) {
        if (/^[\u4e00-\u9fa5]{2,8}$/.test(seg)) keywords.add(seg);
      }
    }
  }
  return Array.from(keywords).slice(0, 20);
}

function splitIntoChunks(content, maxLen = TARGET_CHUNK_MAX, minLen = TARGET_CHUNK_MIN) {
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const chunks = [];
  let current = '';
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (trimmed.length > maxLen) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      const sentences = trimmed.split(/(?<=[。！？；])/);
      for (const s of sentences) {
        if ((current + s).length > maxLen && current.length >= minLen) {
          chunks.push(current);
          current = s;
        } else {
          current += s;
        }
      }
    } else if ((current + '\n\n' + trimmed).length > maxLen && current.length >= minLen) {
      chunks.push(current);
      current = trimmed;
    } else {
      current = current ? current + '\n\n' + trimmed : trimmed;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  if (chunks.length >= 2 && chunks[chunks.length - 1].length < minLen / 2) {
    chunks[chunks.length - 2] += '\n\n' + chunks[chunks.length - 1];
    chunks.pop();
  }
  return chunks;
}

function getSemanticSectionTitle(line) {
  const normalized = line
    .trim()
    .replace(/\\+$/, '')
    .replace(/^#+\s*/, '')
    .trim();

  if (STAR_SECTION_HEADING.test(normalized)) {
    return normalized.replace(/^主星之/, '');
  }
  return AUXILIARY_STAR_SECTION_HEADINGS.has(normalized) ? normalized : '';
}

function splitSemanticSections(content) {
  const sections = [];
  const prefix = [];
  let current = null;

  for (const line of content.split('\n')) {
    const sectionTitle = getSemanticSectionTitle(line);
    if (sectionTitle) {
      if (current) {
        sections.push({ title: current.title, content: current.lines.join('\n').trim() });
      } else if (prefix.join('\n').trim()) {
        sections.push({ title: '', content: prefix.join('\n').trim() });
      }
      current = { title: sectionTitle, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      prefix.push(line);
    }
  }

  if (current) {
    sections.push({ title: current.title, content: current.lines.join('\n').trim() });
  }

  return sections.some((section) => section.title) ? sections : null;
}

function splitSubfileContent(content, fallbackTitle) {
  const sections = splitSemanticSections(content);
  if (!sections) {
    return splitIntoChunks(content).map((chunkContent) => ({
      chunkContent,
      chunkTitle: fallbackTitle,
      sectionTitle: '',
    }));
  }

  const chunks = [];
  for (const section of sections) {
    const sectionChunks = splitIntoChunks(section.content);
    for (const chunkContent of sectionChunks) {
      chunks.push({
        chunkContent,
        chunkTitle: section.title || fallbackTitle,
        sectionTitle: section.title,
      });
    }
  }
  return chunks;
}

function extractSubfileTitle(subfileContent) {
  for (const line of subfileContent.split('\n')) {
    const m = line.match(/^#+\s*(.+)$/);
    if (m) return m[1].trim();
  }
  for (const line of subfileContent.split('\n')) {
    const m = line.match(/^文件：(.+)$/);
    if (m) return m[1].trim();
  }
  return '';
}

function processQaFile(filePath, manifestEntry) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { frontmatter: fileFm, body } = parseFrontmatter(raw);

  const chunks = [];
  const separator = /^={80,}$/m;
  const parts = body.split(separator);

  let subfileIndex = 0;
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const { body: subBody } = parseFrontmatter(trimmed);
    const subfileTitle = extractSubfileTitle(trimmed) || `子文件${subfileIndex + 1}`;

    let subfilePath = '';
    for (const line of trimmed.split('\n')) {
      const m = line.match(/^文件：(.+)$/);
      if (m) {
        subfilePath = m[1].trim();
        break;
      }
    }

    let actualContent = subBody;
    actualContent = actualContent.replace(/^文件：.+\n+/m, '');

    if (!actualContent.trim()) continue;

    const subChunks = splitSubfileContent(actualContent, subfileTitle);
    subChunks.forEach(({ chunkContent, chunkTitle, sectionTitle }, idx) => {
      chunks.push({
        id: `${manifestEntry.source_group}#${subfileIndex}#${idx}`,
        source_group: manifestEntry.source_group,
        source_quality: manifestEntry.source_quality,
        learning_use: fileFm.learning_use || 'learning_research',
        medical_safety: fileFm.medical_safety || 'learning_only',
        subfile: subfilePath || subfileTitle,
        chunk_title: chunkTitle,
        section_title: sectionTitle || undefined,
        chunk_index: idx,
        content: chunkContent,
        content_length: chunkContent.length,
        keywords: extractKeywords(`${sectionTitle ? `# ${sectionTitle}\n` : ''}${chunkContent}`),
      });
    });

    subfileIndex++;
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// 中文分词（与 knowledge-search.js 保持一致）
// ---------------------------------------------------------------------------
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

// 主题领域关键词 — 用于查询扩展（与 knowledge-search.js 保持一致）
const TOPIC_KEYWORDS = {
  '天纪': ['天纪', '天机道', '人间道', '地脉道', '紫微', '斗数', '易经', '六十四卦', '风水'],
  '针灸': ['针灸', '针法', '灸法', '经络', '穴位', '针灸大成'],
  '方剂': ['方剂', '经方', '汉唐', '汤方', '桂枝汤', '麻黄汤', '小柴胡', '理中', '四逆'],
  '课程': ['课程', '讲座', '演讲', '闭门课', '扶阳', '梁冬'],
  '命理': ['八字', '四柱', '紫微', '斗数', '命理', '十神', '五行'],
};

// ---------------------------------------------------------------------------
// 构建倒排索引（紧凑格式）
// ---------------------------------------------------------------------------
function buildInvertedIndex(chunks) {
  // token -> Map<docIndex, tf>
  const inverted = new Map();
  const docLengths = [];

  for (let i = 0; i < chunks.length; i++) {
    const tokens = tokenize(chunks[i].content);
    docLengths.push(tokens.length);

    // 统计每个 token 在本文档的 tf
    const tfMap = new Map();
    for (const t of tokens) {
      tfMap.set(t, (tfMap.get(t) || 0) + 1);
    }

    // 写入倒排表
    for (const [token, tf] of tfMap) {
      if (!inverted.has(token)) inverted.set(token, []);
      inverted.get(token).push([i, tf]);
    }
  }

  // 过滤低频 token（df < 2）— 大幅减少索引体积，对检索质量影响极小
  let filteredCount = 0;
  const filteredInverted = new Map();
  for (const [token, postings] of inverted) {
    if (postings.length < 2) {
      filteredCount++;
      continue;
    }
    filteredInverted.set(token, postings);
  }
  console.log(`过滤低频 token: ${filteredCount} 个（df<2），保留 ${filteredInverted.size} 个`);

  // 序列化为扁平格式：token -> [docIdx1, tf1, docIdx2, tf2, ...]
  // 比嵌套数组 [[docIdx, tf], ...] 节省 ~50% 内存
  const invertedObj = {};
  for (const [token, postings] of filteredInverted) {
    const flat = [];
    for (const [idx, tf] of postings) {
      flat.push(idx, tf);
    }
    invertedObj[token] = flat;
  }

  const totalTokens = docLengths.reduce((s, n) => s + n, 0);
  const avgDocLength = chunks.length > 0 ? totalTokens / chunks.length : 0;

  return {
    total_docs: chunks.length,
    avg_doc_length: Math.round(avgDocLength * 100) / 100,
    doc_lengths: docLengths,
    inverted_index: invertedObj,
    topic_keywords: TOPIC_KEYWORDS, // 内嵌以便运行时使用
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
function main() {
  if (!QA_DIR) {
    console.error('Usage: node scripts/generate-knowledge-base.js <qa-upload-dir> [output-dir]');
    console.error('Example: node scripts/generate-knowledge-base.js /path/to/QA上传包');
    process.exit(1);
  }
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));

  // 1. 校验 manifest 结构
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length) {
    console.error('Manifest 校验失败:');
    manifestErrors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log('✓ Manifest 结构校验通过');

  // 2. 校验每个文件的存在性、字节数、SHA-256
  let verifyErrors = 0;
  for (const entry of manifest.files) {
    const filePath = path.join(QA_DIR, entry.filename);
    const err = verifyFile(filePath, entry);
    if (err) {
      console.error(`✗ ${err}`);
      verifyErrors++;
    } else {
      console.log(`✓ ${entry.filename}: ${entry.bytes} bytes, SHA-256 OK`);
    }
  }
  if (verifyErrors > 0) {
    console.error(`\n${verifyErrors} 个文件校验失败，中止生成`);
    process.exit(1);
  }

  // 3. 分块
  const allChunks = [];
  const sourceStats = [];
  for (const entry of manifest.files) {
    const filePath = path.join(QA_DIR, entry.filename);
    const chunks = processQaFile(filePath, entry);
    console.log(`${entry.filename}: ${chunks.length} chunks, ${chunks.reduce((s, c) => s + c.content_length, 0)} chars`);
    allChunks.push(...chunks);
    sourceStats.push({
      source_group: entry.source_group,
      source_quality: entry.source_quality,
      chunk_count: chunks.length,
      total_chars: chunks.reduce((s, c) => s + c.content_length, 0),
    });
  }

  if (allChunks.length === 0) {
    console.error('生成 0 个分块，中止');
    process.exit(1);
  }

  // 4. 构建知识库 JSON
  const kbOutput = {
    corpus_version: manifest.corpus_version,
    generated_at: new Date().toISOString(),
    source_manifest: {
      total_files: manifest.file_count,
      total_bytes: manifest.total_bytes,
      files: manifest.files,
    },
    chunk_stats: {
      total_chunks: allChunks.length,
      total_chars: allChunks.reduce((s, c) => s + c.content_length, 0),
      avg_chunk_length: Math.round(allChunks.reduce((s, c) => s + c.content_length, 0) / allChunks.length),
      by_source: sourceStats,
    },
    chunks: allChunks,
  };

  // 5. 构建倒排索引
  console.log('\n构建倒排索引...');
  const indexOutput = buildInvertedIndex(allChunks);
  const indexSize = JSON.stringify(indexOutput).length;
  console.log(`倒排索引: ${Object.keys(indexOutput.inverted_index).length} 个 token, ${Math.round(indexSize / 1024)} KB`);

  // 6. 写入文件
  const jsonStr = JSON.stringify(kbOutput, null, 0);
  const indexStr = JSON.stringify(indexOutput, null, 0);
  const kbSizeKB = Math.round(jsonStr.length / 1024);
  const indexSizeKB = Math.round(indexStr.length / 1024);

  const targets = OUTPUT_DIR
    ? [OUTPUT_DIR]
    : [
        path.join(__dirname, '..', 'cloudbase', 'functions', 'nihaixia-qa-router'),
        path.join(__dirname, '..', 'cloudbase', 'functions', 'nihaixia-qa-mp'),
      ];

  for (const dir of targets) {
    const kbPath = path.join(dir, 'knowledge-base.json');
    const idxPath = path.join(dir, 'inverted-index.json');
    fs.writeFileSync(kbPath, jsonStr, 'utf-8');
    fs.writeFileSync(idxPath, indexStr, 'utf-8');
    console.log(`Output: ${kbPath} (${kbSizeKB} KB)`);
    console.log(`Output: ${idxPath} (${indexSizeKB} KB)`);
  }

  console.log(`\nTotal chunks: ${allChunks.length}`);
  console.log(`Total chars: ${kbOutput.chunk_stats.total_chars}`);
  console.log(`Avg chunk length: ${kbOutput.chunk_stats.avg_chunk_length}`);
  console.log(`Knowledge base: ${kbSizeKB} KB`);
  console.log(`Inverted index: ${indexSizeKB} KB`);
}

if (require.main === module) {
  main();
}

module.exports = {
  getSemanticSectionTitle,
  splitIntoChunks,
  splitSemanticSections,
  splitSubfileContent,
};
