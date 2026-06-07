#!/usr/bin/env python3
"""
倪海厦知识图谱网站数据生成脚本

用法：
  python3 scripts/build_site_data.py          # 更新 public_sources 并写入 graph.json
  python3 scripts/build_site_data.py --validate # 验证数据一致性

本脚本设计为在开源包根目录 nihaixia-knowledge-graph-open/ 内运行。
节点数据来自已有的 graph.json（从 vault 导出），本脚本只更新 public_sources 部分。
"""

import json
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# 路径配置 — 以开源包根目录为基准
OPEN_ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = OPEN_ROOT / "docs"
DATA_DIR = DOCS_DIR / "data"
SOURCES_PUBLIC_DIR = DOCS_DIR / "sources-public"
GRAPH_JSON = DATA_DIR / "graph.json"

# 公开原文的最低正文长度（字符），低于此视为空壳
MIN_BODY_LENGTH = 100


def parse_frontmatter(content):
    """解析 YAML frontmatter"""
    fm = {}
    if content.startswith("---"):
        end = content.find("---", 3)
        if end > 0:
            fm_text = content[3:end].strip()
            for line in fm_text.split("\n"):
                if ":" in line:
                    key, value = line.split(":", 1)
                    fm[key.strip()] = value.strip()
    return fm


def strip_frontmatter(content):
    """移除 frontmatter，返回正文"""
    if content.startswith("---"):
        end = content.find("---", 3)
        if end > 0:
            return content[end + 3:].strip()
    return content.strip()


def extract_title(content):
    """提取第一个 # 标题"""
    for line in content.split("\n"):
        if line.startswith("# ") and not line.startswith("## "):
            return line[2:].strip()
    return ""


def infer_source_type(rel_path, fm):
    """为旧 frontmatter 补一个稳定的公开资料类型。"""
    if fm.get("source_type"):
        return fm["source_type"]
    if "classics" in rel_path.parts:
        return "classic_text_with_notes"
    return fm.get("type", "converted_source")


def infer_license_status(fm):
    """不对第三方整理文本版权做过度承诺，只标注需保留来源。"""
    return fm.get("license_status") or "source_attribution_required"


def is_readable(content):
    """判断文件是否有可读的正文内容（排除 OCR 乱码和空壳）"""
    body = strip_frontmatter(content)

    # 去掉空行和 markdown 标记
    body_text = re.sub(r'[\s\n\r\t]', '', body)
    body_text = re.sub(r'[#>*\-|`\-]+', '', body_text)

    if len(body_text) < MIN_BODY_LENGTH:
        return False

    # 检测 OCR 乱码特征：连续非 CJK 字符占比过高
    # 正常中文古籍文件 CJK 字符应占 40%+ 以上
    cjk_chars = len(re.findall(r'[一-鿿]', body_text))
    total_chars = len(body_text)
    if total_chars > 0:
        cjk_ratio = cjk_chars / total_chars
        # 如果中文字符占比低于 40%，很可能是 OCR 乱码
        if cjk_ratio < 0.40:
            return False

    # 检测 "机器转换，待校对" 占主体的情况
    if '机器转换，待校对' in body and len(body_text) < 300:
        return False

    # 检测连续重复字符（OCR 垃圾特征：如 "oooo", "cccc", "eeee"）
    garbage_pattern = re.findall(r'(?:oo|cc|ee|OO|CC|EE){4,}', body_text)
    if len(garbage_pattern) > 5:
        return False

    # 检测乱码特征：连续大写字母或特殊符号组合
    noise = re.findall(r'[A-Z]{8,}', body_text)
    if len(noise) > 20:
        return False

    return True


def scan_public_sources():
    """扫描 docs/sources-public/ 中可公开的原文资料"""
    public_sources = []

    if not SOURCES_PUBLIC_DIR.exists():
        print(f"  警告: {SOURCES_PUBLIC_DIR} 不存在")
        return public_sources

    for filepath in sorted(SOURCES_PUBLIC_DIR.rglob("*.md")):
        rel_path = filepath.relative_to(SOURCES_PUBLIC_DIR)

        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception:
            continue

        fm = parse_frontmatter(content)
        body = strip_frontmatter(content)
        title = extract_title(content) or filepath.stem

        # 判断质量
        quality = fm.get("quality", "unknown")
        public_status = fm.get("public_status", "")
        source_type = fm.get("source_type", "")
        license_status = fm.get("license_status", "")
        medical_safety = fm.get("medical_safety", "")
        original_file = fm.get("original_file", "")
        source_category = fm.get("source_category", "")
        conversion_tool = fm.get("conversion_tool", "")
        conversion_date = fm.get("conversion_date", "")

        source_type = infer_source_type(rel_path, fm)
        license_status = infer_license_status(fm)

        # 如果正文不可读，标记为 needs_review
        readable = is_readable(content)
        if not readable:
            quality = "empty_shell"
            public_status = "needs_review"

        public_sources.append({
            "path": str(rel_path),
            "title": title,
            "quality": quality,
            "public_status": public_status if public_status else ("public_ready" if readable else "needs_review"),
            "source_type": source_type,
            "license_status": license_status,
            "medical_safety": medical_safety,
            "original_file": original_file,
            "source_category": source_category,
            "conversion_tool": conversion_tool,
            "conversion_date": conversion_date,
            "readable": readable,
            "size": filepath.stat().st_size,
        })

    return public_sources


def load_existing_graph():
    """加载已有的 graph.json"""
    if not GRAPH_JSON.exists():
        print(f"  错误: {GRAPH_JSON} 不存在")
        sys.exit(1)

    with open(GRAPH_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


def validate(graph):
    """验证数据一致性"""
    errors = []
    stats = graph["stats"]

    # 检查节点数据存在
    if stats.get("nodes_total", 0) == 0:
        errors.append("nodes_total=0, 节点数据为空")

    if stats.get("topic_articles", 0) == 0:
        errors.append("topic_articles=0, 主题文章为空")

    # 检查 public_sources 一致性
    actual_public = graph.get("public_sources", [])
    readable_count = sum(1 for s in actual_public if s.get("readable", False))

    if stats.get("public_sources", 0) != len(actual_public):
        errors.append(
            f"public_sources 不一致: stats={stats.get('public_sources', 0)}, "
            f"实际={len(actual_public)}"
        )

    required_source_fields = {
        "path",
        "title",
        "quality",
        "public_status",
        "source_type",
        "license_status",
        "medical_safety",
        "readable",
    }
    for source in actual_public:
        missing = [field for field in required_source_fields if not source.get(field) and field != "readable"]
        if missing:
            errors.append(f"公开源 {source.get('path', '?')} 缺少字段: {', '.join(missing)}")

    # 检查 medical_safety
    for node in graph.get("nodes", []) + graph.get("articles", []):
        if node.get("medical_safety") != "learning_only":
            errors.append(f"节点 {node.get('id', '?')} 缺少 learning_only")
        if not node.get("sections", {}).get("安全边界"):
            errors.append(f"节点 {node.get('id', '?')} 缺少安全边界")

    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "stats": stats,
        "total_public": len(actual_public),
        "readable_public": readable_count,
    }


def build_and_update():
    """更新 graph.json 的 public_sources 部分"""
    print("加载已有 graph.json...")
    graph = load_existing_graph()

    print("扫描公开原文...")
    public_sources = scan_public_sources()

    readable_count = sum(1 for s in public_sources if s.get("readable", False))
    print(f"  找到 {len(public_sources)} 个文件, 其中 {readable_count} 个可读")

    # 更新 graph 数据
    readable_count = sum(1 for s in public_sources if s.get("readable", False))
    graph["public_sources"] = public_sources
    graph["stats"]["public_sources"] = len(public_sources)
    graph["stats"]["public_sources_readable"] = readable_count
    graph["generated_at"] = datetime.now(timezone(timedelta(hours=8))).isoformat()

    # 写入
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(GRAPH_JSON, "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, indent=2)

    print(f"已更新: {GRAPH_JSON}")
    print(f"public_sources: {len(public_sources)} ({readable_count} 可读)")

    return graph


def main():
    validate_only = "--validate" in sys.argv

    if validate_only:
        print("验证模式...")
        graph = load_existing_graph()
        result = validate(graph)

        if result["ok"]:
            print(f"OK nodes_total={result['stats']['nodes_total']}")
            print(f"OK topic_articles={result['stats']['topic_articles']}")
            print(f"OK public_sources={result['total_public']} ({result['readable_public']} readable)")
            print(f"OK medical_safety=learning_only")
        else:
            for error in result["errors"]:
                print(f"ERROR: {error}")
            sys.exit(1)
    else:
        print("更新 public_sources...")
        graph = build_and_update()

        print("\n验证更新后的数据...")
        result = validate(graph)
        if result["ok"]:
            print("验证通过")
        else:
            for error in result["errors"]:
                print(f"WARNING: {error}")


if __name__ == "__main__":
    main()
