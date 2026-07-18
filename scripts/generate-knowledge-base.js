#!/usr/bin/env node
/**
 * 从 11 个 QA 上传包 MD 文件生成分块知识库
 *
 * 用法：
 *   node scripts/generate-knowledge-base.js <qa-upload-dir> [output-path]
 *
 * 默认输出到 cloudbase/functions/nihaixia-qa-router/knowledge-base.json
 * 和 cloudbase/functions/nihaixia-qa-mp/knowledge-base.json
 *
 * 分块策略：
 *   - 每个 QA MD 文件按 "={80,}" 分隔符切分子文件
 *   - 每个子文件按段落（双换行）进一步切分
 *   - 累积段落直到 1200-2000 字符为一块
 *   - 保留 frontmatter 元数据（source_group、source_quality、learning_use、medical_safety）
 *   - 保留子文件标题作为 chunk_title
 */

const fs = require('fs');
const path = require('path');

const QA_DIR = process.argv[2] || process.env.QA_DIR || '';
const OUTPUT_PATH = process.argv[3] || '';

if (!QA_DIR) {
  console.error('Usage: node scripts/generate-knowledge-base.js <qa-upload-dir> [output-path]');
  console.error('Example: node scripts/generate-knowledge-base.js /path/to/QA上传包');
  process.exit(1);
}

const MANIFEST_PATH = path.join(QA_DIR, 'manifest.json');

const TARGET_CHUNK_MIN = 1200;
const TARGET_CHUNK_MAX = 2000;

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
  const topicsMatch = content.match(/topics:\s*\n([\s\S]*?)(?=\n\w|\n---|\nsource_refs)/);
  if (topicsMatch) {
    for (const line of topicsMatch[1].split('\n')) {
      const m = line.match(/\s+-\s+(.+)/);
      if (m) {
        const t = m[1].trim();
        if (/^[\u4e00-\u9fa5]{2,8}$/.test(t)) keywords.add(t);
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

    const { frontmatter: subFm, body: subBody } = parseFrontmatter(trimmed);
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

    const subChunks = splitIntoChunks(actualContent);
    subChunks.forEach((chunkContent, idx) => {
      chunks.push({
        id: `${manifestEntry.source_group}#${subfileIndex}#${idx}`,
        source_group: manifestEntry.source_group,
        source_quality: manifestEntry.source_quality,
        learning_use: fileFm.learning_use || 'learning_research',
        medical_safety: fileFm.medical_safety || 'learning_only',
        subfile: subfilePath || subfileTitle,
        chunk_title: subfileTitle,
        chunk_index: idx,
        content: chunkContent,
        content_length: chunkContent.length,
        keywords: extractKeywords(chunkContent),
      });
    });

    subfileIndex++;
  }

  return chunks;
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  const allChunks = [];
  const sourceStats = [];

  for (const entry of manifest.files) {
    const filePath = path.join(QA_DIR, entry.filename);
    if (!fs.existsSync(filePath)) {
      console.error(`Missing: ${filePath}`);
      continue;
    }
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

  const output = {
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

  const jsonStr = JSON.stringify(output, null, 0);
  const sizeKB = Math.round(jsonStr.length / 1024);

  if (OUTPUT_PATH) {
    fs.writeFileSync(OUTPUT_PATH, jsonStr, 'utf-8');
    console.log(`\nOutput: ${OUTPUT_PATH}`);
  } else {
    // 默认写入两个云函数目录
    const repoRoot = path.resolve(__dirname, '..');
    const targets = [
      path.join(repoRoot, 'cloudbase', 'functions', 'nihaixia-qa-router', 'knowledge-base.json'),
      path.join(repoRoot, 'cloudbase', 'functions', 'nihaixia-qa-mp', 'knowledge-base.json'),
    ];
    for (const target of targets) {
      fs.writeFileSync(target, jsonStr, 'utf-8');
      console.log(`Output: ${target}`);
    }
  }

  console.log(`Total chunks: ${allChunks.length}`);
  console.log(`Total chars: ${output.chunk_stats.total_chars}`);
  console.log(`Avg chunk length: ${output.chunk_stats.avg_chunk_length}`);
  console.log(`File size: ${sizeKB} KB`);
}

main();
