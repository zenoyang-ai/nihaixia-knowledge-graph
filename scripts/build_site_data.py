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


def compute_expected_stats(graph):
    """基于 nodes 与 articles 实时计算精确统计口径。"""
    nodes = graph.get("nodes", [])
    articles = graph.get("articles", [])
    concept_nodes = sum(1 for n in nodes if n.get("node_type") == "concept")
    classic_course_nodes = sum(1 for n in nodes if n.get("node_type") in ("classic", "course"))
    case_formula_nodes = sum(1 for n in nodes if n.get("node_type") in ("case", "formula"))
    topic_articles = len(articles)
    return {
        "nodes_total": len(nodes) + len(articles),
        "concept_nodes": concept_nodes,
        "classic_course_nodes": classic_course_nodes,
        "case_formula_nodes": case_formula_nodes,
        "topic_articles": topic_articles,
    }


def _dedupe_titles(names):
    seen = set()
    out = []
    for name in names or []:
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out


def sync_links_and_stats(graph):
    """以 upstream + downstream + related 为单一真源派生 node_links，并重算 stats。"""
    content_items = graph.get("nodes", []) + graph.get("articles", [])
    by_id = {item["id"]: item for item in content_items if item.get("id")}
    by_title = {item["title"]: item for item in content_items if item.get("title")}

    for item in content_items:
        self_title = item.get("title")
        up = [t for t in _dedupe_titles(item.get("upstream")) if t != self_title]
        down = [t for t in _dedupe_titles(item.get("downstream")) if t != self_title]
        rel = [t for t in _dedupe_titles(item.get("related")) if t != self_title]

        existing_sem = set(up + down + rel)
        for lk in item.get("node_links") or []:
            if not isinstance(lk, dict):
                continue
            target = by_id.get(lk.get("path"))
            if target and target["title"] != self_title and target["title"] not in existing_sem:
                rel.append(target["title"])
                existing_sem.add(target["title"])

        item["upstream"] = up
        item["downstream"] = down
        item["related"] = rel

        combined = _dedupe_titles(up + down + rel)
        rebuilt_links = []
        for target_title in combined:
            target = by_title.get(target_title)
            if target:
                rebuilt_links.append({"path": target["id"], "alias": target["title"]})
        item["node_links"] = rebuilt_links

    expected = compute_expected_stats(graph)
    graph.setdefault("stats", {}).update(expected)
    return graph


def validate(graph):
    """验证数据一致性"""
    errors = []
    stats = graph["stats"]

    # 检查节点数据存在与分类算术一致
    expected_stats = compute_expected_stats(graph)
    if expected_stats["nodes_total"] == 0:
        errors.append("nodes_total=0, 节点数据为空")
    if expected_stats["topic_articles"] == 0:
        errors.append("topic_articles=0, 主题文章为空")

    category_sum = (
        expected_stats["concept_nodes"]
        + expected_stats["classic_course_nodes"]
        + expected_stats["case_formula_nodes"]
        + expected_stats["topic_articles"]
    )
    if category_sum != expected_stats["nodes_total"]:
        errors.append(
            f"节点类型统计加总异常: sum={category_sum} != nodes_total={expected_stats['nodes_total']}"
        )

    for key, exp_val in expected_stats.items():
        if stats.get(key) != exp_val:
            errors.append(f"stats.{key} 不一致: 写着 {stats.get(key)}, 实际={exp_val}")

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

    # 检查 upstream/downstream/related 与 node_links 是否指向已有条目且完全同源
    content_items = graph.get("nodes", []) + graph.get("articles", [])
    id_set = {item.get("id") for item in content_items if item.get("id")}
    by_title = {item.get("title"): item for item in content_items if item.get("title")}
    directed_links = 0
    dangling_links = []
    undirected = set()
    for node in content_items:
        source_id = node.get("id")
        self_title = node.get("title") or source_id
        sem_titles = set()
        for field in ("upstream", "downstream", "related"):
            for ref in node.get(field) or []:
                if not ref or ref not in by_title or ref == self_title:
                    errors.append(f"悬空语义引用 {self_title}.{field} -> {ref or '?'}")
                else:
                    sem_titles.add(ref)

        link_titles = set()
        for link in node.get("node_links") or []:
            directed_links += 1
            target_path = link.get("path") if isinstance(link, dict) else None
            alias = link.get("alias") if isinstance(link, dict) else None
            if not target_path or target_path not in id_set or target_path == source_id:
                dangling_links.append(f"{self_title} -> {target_path or '?'}")
                continue
            if not alias or alias not in by_title or by_title[alias].get("id") != target_path:
                errors.append(f"node_links 别名/路径不匹配 {self_title} -> alias={alias}, path={target_path}")
            else:
                link_titles.add(alias)
            undirected.add(tuple(sorted((source_id, target_path))))

        if sem_titles != link_titles:
            only_sem = sorted(sem_titles - link_titles)
            only_nl = sorted(link_titles - sem_titles)
            errors.append(
                f"{self_title} 详情关联与图谱连线不一致 (sem_only={only_sem}, node_links_only={only_nl})"
            )

    if dangling_links:
        preview = "; ".join(dangling_links[:5])
        more = "" if len(dangling_links) <= 5 else f" …共 {len(dangling_links)} 条"
        errors.append(f"悬空 node_links {len(dangling_links)} 条: {preview}{more}")

    # 检查 learning_paths 单一真源（0 悬空引用、100% 覆盖全部节点与专题文章）
    title_set = {item.get("title") for item in content_items if item.get("title")}
    layers_list = graph.get("layers") or []
    for node in graph.get("nodes", []):
        if node.get("layer") and node.get("layer") not in layers_list:
            errors.append(f"节点 {node.get('title', '?')} 的 layer={node.get('layer')} 不在顶层 layers 数组中")

    learning_paths = graph.get("learning_paths")
    if not isinstance(learning_paths, dict):
        errors.append("graph.json 缺少顶层 learning_paths 真源配置")
    else:
        covered_titles = set()
        for path_key in ("renji", "tianji"):
            lp = learning_paths.get(path_key)
            if not isinstance(lp, dict):
                errors.append(f"learning_paths 缺少路径: {path_key}")
                continue
            if not (lp.get("title") and lp.get("desc")):
                errors.append(f"learning_paths.{path_key} 缺少 title 或 desc")
            stages = lp.get("stages")
            if not isinstance(stages, list) or not stages:
                errors.append(f"learning_paths.{path_key} 缺少 stages")
                continue
            for stage in stages:
                st_title = stage.get("title", "?")
                st_nodes = stage.get("nodes") or []
                if not st_nodes:
                    errors.append(f"learning_paths.{path_key} 阶段「{st_title}」未配置任何节点")
                for ntitle in st_nodes:
                    if ntitle not in title_set:
                        errors.append(f"learning_paths.{path_key} 阶段「{st_title}」引用了不存在的节点: {ntitle}")
                    else:
                        covered_titles.add(ntitle)
        uncovered = sorted(title_set - covered_titles)
        if uncovered:
            errors.append(
                f"以下 {len(uncovered)} 个条目未纳入任何学习路径（请补充到 learning_paths）: {', '.join(uncovered)}"
            )

    # 检查 graph.json 节点与专题文章无私人文件夹路径与过时后缀残留
    for item in content_items:
        blob = json.dumps(item, ensure_ascii=False)
        for bad in ("倪海厦资料", "天机道终稿", "注解B5", "个人整理", ".docx"):
            if bad in blob:
                errors.append(f"条目「{item.get('title', '?')}」含未清洗内部标识: {bad}")

    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "stats": stats,
        "total_public": len(actual_public),
        "readable_public": readable_count,
        "directed_links": directed_links,
        "undirected_links": len(undirected),
        "dangling_links": len(dangling_links),
    }


def build_and_update():
    """同步 node_links / stats / public_sources 并写入 graph.json"""
    print("加载已有 graph.json...")
    graph = load_existing_graph()

    print("同步 node_links 与统计口径...")
    sync_links_and_stats(graph)

    print("扫描公开原文...")
    public_sources = scan_public_sources()

    readable_count = sum(1 for s in public_sources if s.get("readable", False))
    print(f"  找到 {len(public_sources)} 个文件, 其中 {readable_count} 个可读")

    # 更新 graph 数据
    graph["public_sources"] = public_sources
    graph["stats"]["public_sources"] = len(public_sources)
    graph["stats"]["public_sources_readable"] = readable_count
    graph["generated_at"] = datetime.now(timezone(timedelta(hours=8))).isoformat()

    # 写入
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(GRAPH_JSON, "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, indent=2)

    print(f"已更新: {GRAPH_JSON}")
    print(
        f"stats: nodes_total={graph['stats']['nodes_total']}, "
        f"public_sources={len(public_sources)} ({readable_count} 可读)"
    )

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
            print(
                f"OK node_links directed={result['directed_links']} "
                f"undirected={result['undirected_links']} dangling={result['dangling_links']}"
            )
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
