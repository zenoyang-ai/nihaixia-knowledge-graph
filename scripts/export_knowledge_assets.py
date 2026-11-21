#!/usr/bin/env python3
"""导出并校验倪海厦知识图谱开源资产（knowledge/ 目录）。

用法：
  # 1. 仅从仓内真源（docs/data/graph.json 与 prompts.json）同步图谱笔记与 AI 语料包：
  python3 scripts/export_knowledge_assets.py

  # 2. 全量刷新（同时从本地原始整理目录清洗分章导出 03-天纪学习资料 与 04-人纪学习资料）：
  python3 scripts/export_knowledge_assets.py \
    --raw-ima-dir <path-to-ima-pack> \
    --raw-ocr-dir <path-to-ocr-packs> \
    --sources-public-dir sources-public

  # 3. CI / 本地质量校验（零死链、无本机路径、无 OCR/页码/目录点线残留、无行尾空白）：
  python3 scripts/export_knowledge_assets.py --validate
"""

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import unquote

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS_DATA_DIR = REPO_ROOT / "docs" / "data"
GRAPH_JSON = DOCS_DATA_DIR / "graph.json"
PROMPTS_JSON = DOCS_DATA_DIR / "prompts.json"
OFFLINE_DATA_JS = DOCS_DATA_DIR / "offline-data.js"
KNOWLEDGE_DIR = REPO_ROOT / "knowledge"

LAYER_DIRS = {
    "学习路径": "01-学习路径",
    "底层框架": "02-底层框架",
    "辨证框架": "03-辨证框架",
    "方法工具": "04-方法工具",
    "案例研读": "05-案例研读",
    "天纪体系": "06-天纪体系",
}

RENJI_STAGES = [
    ("第一步：针灸大成", "先学针灸，建立经络穴位基础，直观感受人体能量系统", ["针灸", "经络"]),
    ("第二步：黄帝内经", "中医理论根本，理解阴阳五行、脏腑经络的完整框架", ["阴阳", "五行", "天人合一", "脏腑辨证", "气血津液", "黄帝内经"]),
    ("第三步：神农本草经", "学习中药药性，为经方学习打基础", ["神农本草经", "四气五味", "本草", "炮制"]),
    ("第四步：伤寒论与金匮要略", "经方核心，掌握六经辨证体系", ["六经辨证", "八纲辨证", "寒热虚实", "表里", "虚实", "病机", "证候", "经方", "方证对应", "方剂", "伤寒论", "金匮要略"]),
    ("第五步：医案研读", "通过真实医案把理论串起来，培养临床思维", ["医案学习法", "临床案例索引", "血液类病证研读", "免疫相关案例研读", "疑难病证案例研读", "水液代谢类案例研读", "肿块类案例研读", "脏腑复杂案例研读", "望诊案例研读"]),
]

TIANJI_STAGES = [
    ("第一步：易经基础与天机道", "以易经为轴，建立天地人三才的认知框架", ["天人合一", "阴阳", "五行", "易经", "象数", "三才", "天机道"]),
    ("第二步：人间道——紫微斗数与命理", "学习紫微斗数、四柱命理，理解人事推演方法", ["人间道", "紫微斗数", "四柱命理"]),
    ("第三步：地脉道——风水堪舆", "学习地理风水、罗盘使用，理解环境对人的影响", ["地脉道", "风水堪舆"]),
    ("第四步：三才贯通", "天机道、人间道、地脉道三者互相参照，形成完整体系", ["天纪与人纪"]),
]

WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
MD_REL_LINK_RE = re.compile(r"\[[^\]]+\]\((\.\.?/[^)\s]+)\)")
FORBIDDEN_PATH_RE = re.compile(r"/(?:Users|home)/[^\s\"'<>]+|~/Workspace|staging_v\d+|tcm_shennong_full")
FORBIDDEN_PRIVACY_RE = re.compile(
    r"杨圣旦|民间中医爱好者|英年早肥|pan\.baidu\.com|pan\.quark\.cn|aliyundrive\.com|(?<!\d)1[3-9]\d{9}(?!\d)"
)
FORBIDDEN_OCR_RE = re.compile(
    r"==>\s*picture|Start of picture text|End of picture text|INCLUDEPICTURE|\bHYPERLINK\b|\*\*\(\*\*"
)
FORBIDDEN_PAGE_HEADER_RE = re.compile(r"^(?:##?\s*)?第\s*\d+\s*页(?:\s+天行健|\s+地勢坤|\s*$)", re.M)
FORBIDDEN_TOC_DOTS_RE = re.compile(r"(?:\.{10,}|·{10,})")

LEARNING_BANNER_NI = (
    "> **著作与整理声明**：原著与讲授思想归**倪海厦先生**及其权利继承人所有；"
    "本文件保留原文文献原貌，仅作去噪清洗与分章排版，供个人非商业学习与研究。"
    "文中涉及的历史剂量、附方或灸法表述均为文献原貌，不构成用药指导、医疗诊断或人生重大决策依据。"
    "若权利方有异议，请通过 GitHub Issues 联系，核实后将在 7 个工作日内移除。\n"
)

LEARNING_BANNER_CLASSIC = (
    "> **典籍与整理声明**：《针灸大成》为明代杨继洲原著（公有领域古籍），"
    "保留原典文献原貌并按卷拆分排版，供中医经络与理论研习使用，不构成实操医疗指导。\n"
)


def normalize_text(text: str) -> str:
    """统一换行符、去除行尾空白并收敛连续空行。"""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ").replace("\u2028", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned + "\n"


def write_clean(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(normalize_text(content), encoding="utf-8")


def clean_source_section(text: str) -> str:
    """将 graph.json 原始出处里的 vault 双链转为干净纯文本，避免死链与个人草稿文件名残留。"""
    if not text:
        return ""
    cleaned = WIKILINK_RE.sub(lambda m: (m.group(2) or m.group(1)).strip(), text).strip()
    return cleaned.replace("天机道笔记个人整理", "天机道听课与盘面笔记")


def export_offline_site_bundle(graph: dict, prompts: list) -> None:
    """生成 docs/data/offline-data.js，供本地双击 file:// 打开 docs/index.html 时按需离线加载。"""
    payload = json.dumps({"graph": graph, "prompts": prompts}, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    content = (
        "// 自动生成：离线 file:// 直开兜底数据包（与 docs/data/graph.json、prompts.json 保持同步）\n"
        "// 线上 HTTP/HTTPS 访问不会下载此文件，仅在本地 file:// 直开或 fetch 失败时由 app.js 按需加载。\n"
        f"window.__NIHAIXIA_OFFLINE_DATA__ = {payload};\n"
    )
    OFFLINE_DATA_JS.parent.mkdir(parents=True, exist_ok=True)
    OFFLINE_DATA_JS.write_text(content, encoding="utf-8")


def format_link_list(names: list[str], valid_titles: set[str]) -> str:
    if not names:
        return "无"
    parts = [f"[[{name}]]" if name in valid_titles else name for name in names]
    return " · ".join(parts)


def render_obsidian_item(item: dict, valid_titles: set[str]) -> str:
    title = item["title"]
    layer = item.get("layer") or "深度专题"
    node_type = item.get("node_type", "concept")
    importance = item.get("importance", "normal")
    contains_rx = bool(item.get("contains_prescription", False))

    fm_lines = [
        "---",
        f'title: "{title}"',
        f"node_type: {node_type}",
        f'layer: "{layer}"',
        f"importance: {importance}",
        f"medical_safety: {item.get('medical_safety', 'learning_only')}",
        f"contains_prescription: {'true' if contains_rx else 'false'}",
        "---",
        "",
    ]

    body = [f"# {title}", ""]
    if item.get("definition"):
        body.extend(["## 一句话定义", "", item["definition"].strip(), ""])
    if item.get("summary"):
        body.extend(["## 白话解释", "", item["summary"].strip(), ""])

    sections = item.get("sections") or {}
    sec_core = (sections.get("核心理解") or "").strip()
    if sec_core:
        body.extend(["## 核心理解", "", sec_core, ""])

    quotes = item.get("quotes") or []
    if quotes:
        body.extend(["## 倪海厦原话", ""])
        for q in quotes:
            if isinstance(q, dict):
                q_text = (q.get("text") or "").strip()
                q_src = (q.get("source") or "").strip()
            else:
                q_text = str(q).strip()
                q_src = ""
            if q_text:
                line = f"> “{q_text}”"
                if q_src:
                    line += f" —— {q_src}"
                body.append(line)
        body.append("")

    misconceptions = item.get("misconceptions") or []
    if misconceptions:
        body.extend(["## 常见误区", ""])
        for m in misconceptions:
            if isinstance(m, dict):
                wrong = (m.get("wrong") or "").strip()
                corr = (m.get("correction") or "").strip()
                if wrong:
                    body.append(f"- **误区**：{wrong}")
                if corr:
                    body.append(f"  - **正解**：{corr}")
        body.append("")

    sec_path = (sections.get("学习路径") or "").strip()
    if sec_path:
        body.extend(["## 学习路径", "", sec_path, ""])

    upstream = item.get("upstream") or []
    downstream = item.get("downstream") or []
    related = item.get("related") or []
    if upstream or downstream or related:
        body.extend(["## 图谱关联", ""])
        if upstream:
            body.append(f"- **上游前置**：{format_link_list(upstream, valid_titles)}")
        if downstream:
            body.append(f"- **下游延伸**：{format_link_list(downstream, valid_titles)}")
        if related:
            body.append(f"- **同层/关联**：{format_link_list(related, valid_titles)}")
        body.append("")

    origin = clean_source_section(sections.get("原始出处") or "")
    if origin:
        body.extend(["## 原始出处", "", origin, ""])

    safety = (sections.get("安全边界") or "").strip()
    if safety:
        body.extend(["## 安全边界", "", f"> {safety}", ""])

    return "\n".join(fm_lines + body)


def render_learning_path_md(title: str, intro: str, stages: list, valid_titles: set[str]) -> str:
    lines = [
        "---",
        f'title: "{title}"',
        "node_type: learning_path",
        'layer: "学习路径"',
        "medical_safety: learning_only",
        "---",
        "",
        f"# {title}",
        "",
        f"> {intro}",
        "",
    ]
    for stage_title, desc, nodes in stages:
        lines.extend([f"## {stage_title}", "", desc, ""])
        links = [f"- [[{n}]]" if n in valid_titles else f"- {n}" for n in nodes]
        lines.extend(links)
        lines.append("")
    return "\n".join(lines)


def export_graph_and_ai_packs(graph: dict, prompts: list) -> dict:
    """从 docs/data/graph.json 与 prompts.json 导出 Obsidian 双链库与 AI/RAG 语料包。"""
    vault_dir = KNOWLEDGE_DIR / "01-知识图谱笔记"
    rag_dir = KNOWLEDGE_DIR / "02-AI知识库语料包"

    if vault_dir.exists():
        shutil.rmtree(vault_dir)
    if rag_dir.exists():
        shutil.rmtree(rag_dir)

    nodes = graph.get("nodes", [])
    articles = graph.get("articles", [])
    all_items = nodes + articles
    valid_titles = {item["title"] for item in all_items}
    id_to_item = {item["id"]: item for item in all_items}

    # 1. 导出 Obsidian 节点与文章卡片
    layer_groups: dict[str, list[str]] = {}
    for node in nodes:
        layer = node.get("layer") or "其他"
        folder = LAYER_DIRS.get(layer, "02-底层框架")
        write_clean(vault_dir / folder / f"{node['title']}.md", render_obsidian_item(node, valid_titles))
        layer_groups.setdefault(layer, []).append(node["title"])

    for article in articles:
        write_clean(vault_dir / "07-深度专题" / f"{article['title']}.md", render_obsidian_item(article, valid_titles))

    # 2. 导出学习路径与 MOC 总览
    write_clean(
        vault_dir / "01-学习路径" / "人纪学习路径.md",
        render_learning_path_md(
            "倪海厦人纪学习路径",
            "人纪是倪海厦先生的中医教学体系，推荐顺序：针灸 → 黄帝内经 → 神农本草经 → 伤寒论 → 金匮要略 → 医案研读。",
            RENJI_STAGES,
            valid_titles,
        ),
    )
    write_clean(
        vault_dir / "01-学习路径" / "天纪学习路径.md",
        render_learning_path_md(
            "倪海厦天纪学习路径",
            "天纪是天、人、地三才体系，以易经为轴，涵盖天机道、人间道、地脉道。",
            TIANJI_STAGES,
            valid_titles,
        ),
    )

    moc_lines = [
        "# 倪海厦知识图谱总览（Obsidian MOC）",
        "",
        f"> 本 Vault 由线上知识图谱真源（`docs/data/graph.json`）自动导出，共收录 **{len(nodes)} 个概念/经典/方剂/案例节点** + **{len(articles)} 篇深度专题文章**（合计 {len(all_items)} 项），所有 `[[双链]]` 均经过零死链校验。",
        "",
        "## 学习路线入口",
        "",
        "- [[人纪学习路径]]",
        "- [[天纪学习路径]]",
        "",
        "## 知识层级索引",
        "",
    ]
    ordered_layers = ["底层框架", "辨证框架", "方法工具", "案例研读", "天纪体系", "学习路径"]
    for layer in ordered_layers:
        titles = layer_groups.get(layer, [])
        if not titles:
            continue
        moc_lines.append(f"### {layer}（{len(titles)}）")
        moc_lines.append("")
        moc_lines.append(" · ".join(f"[[{t}]]" for t in titles))
        moc_lines.append("")
    moc_lines.extend([f"### 深度专题文章（{len(articles)}）", ""])
    for art in articles:
        moc_lines.append(f"- [[{art['title']}]]")
    moc_lines.append("")
    write_clean(vault_dir / "00-知识图谱总览-MOC.md", "\n".join(moc_lines))

    # 2b. 生成 GitHub 网页可直接点击阅读的 README.md 索引（与 Obsidian 双链 MOC 并存）
    gh_index_lines = [
        "# 知识图谱笔记",
        "",
        f"与在线网站同步的 **{len(nodes)} 张概念卡片 + {len(articles)} 篇专题 + 2 条学习路径**。",
        "",
        "- **在 GitHub 直接读**：直接点下面任意标题即可。",
        "- **放进 Obsidian**：把当前文件夹作为本地仓库打开，从 [00-知识图谱总览-MOC.md](./00-知识图谱总览-MOC.md) 入口就能看到完整双链关系网。",
        "",
        "## 学习顺序",
        "",
        "- [倪海厦人纪学习路径](./01-学习路径/人纪学习路径.md) — 针灸 → 黄帝内经 → 神农本草经 → 伤寒论与金匮要略 → 医案研读",
        "- [倪海厦天纪学习路径](./01-学习路径/天纪学习路径.md) — 天机道（易经/紫微）→ 人间道（命理/人伦）→ 地脉道（风水）→ 三才贯通",
        "",
        "## 全部条目",
        "",
    ]
    for layer in ordered_layers:
        titles = layer_groups.get(layer, [])
        if not titles:
            continue
        folder = LAYER_DIRS.get(layer, "02-底层框架")
        gh_index_lines.append(f"### {layer}（{len(titles)}）")
        gh_index_lines.append("")
        gh_index_lines.append(" · ".join(f"[{t}](./{folder}/{t}.md)" for t in titles))
        gh_index_lines.append("")
    gh_index_lines.extend([f"### 深度专题文章（{len(articles)}）", ""])
    for art in articles:
        gh_index_lines.append(f"- [{art['title']}](./07-深度专题/{art['title']}.md)")
    gh_index_lines.append("")
    write_clean(vault_dir / "README.md", "\n".join(gh_index_lines))

    # 3. 导出 AI / RAG 语料包
    nodes_jsonl = []
    for n in nodes:
        sec = n.get("sections") or {}
        nodes_jsonl.append(json.dumps({
            "id": n["id"],
            "title": n["title"],
            "node_type": n.get("node_type", ""),
            "layer": n.get("layer", ""),
            "importance": n.get("importance", "normal"),
            "medical_safety": n.get("medical_safety", "learning_only"),
            "contains_prescription": bool(n.get("contains_prescription", False)),
            "definition": n.get("definition", ""),
            "summary": n.get("summary", ""),
            "core_understanding": sec.get("核心理解", ""),
            "quotes": n.get("quotes", []),
            "misconceptions": n.get("misconceptions", []),
            "learning_path": sec.get("学习路径", ""),
            "safety_boundary": sec.get("安全边界", ""),
            "upstream": n.get("upstream", []),
            "downstream": n.get("downstream", []),
            "related": n.get("related", []),
        }, ensure_ascii=False))
    write_clean(rag_dir / "nodes.jsonl", "\n".join(nodes_jsonl))

    articles_jsonl = []
    for a in articles:
        sec = a.get("sections") or {}
        articles_jsonl.append(json.dumps({
            "id": a["id"],
            "title": a["title"],
            "node_type": a.get("node_type", "topic"),
            "medical_safety": a.get("medical_safety", "learning_only"),
            "definition": a.get("definition", ""),
            "summary": a.get("summary", ""),
            "core_understanding": sec.get("核心理解", ""),
            "quotes": a.get("quotes", []),
            "misconceptions": a.get("misconceptions", []),
            "safety_boundary": sec.get("安全边界", ""),
        }, ensure_ascii=False))
    write_clean(rag_dir / "articles.jsonl", "\n".join(articles_jsonl))

    edges_jsonl = []
    for item in all_items:
        for link in item.get("node_links") or []:
            target_id = link.get("path")
            target_item = id_to_item.get(target_id)
            edges_jsonl.append(json.dumps({
                "source": item["id"],
                "source_title": item["title"],
                "target": target_id,
                "target_title": target_item["title"] if target_item else link.get("alias", ""),
            }, ensure_ascii=False))
    write_clean(rag_dir / "edges.jsonl", "\n".join(edges_jsonl))

    # 4. 天纪提示词可读包
    prompt_lines = [
        "# 天纪提示词工具包（可复制 / 喂给 AI 版）",
        "",
        "> 基于倪海厦天纪体系（天机道、人间道、地脉道）结合现代自我复盘视角的转译提示词，共 5 套。仅供学习参考，不构成医疗、投资、婚姻等重大决策的唯一依据。",
        "",
    ]
    for p in prompts:
        prompt_lines.extend([
            f"## {p['title']}",
            "",
            f"- **副标题**：{p.get('subtitle', '')}",
            f"- **适用场景**：{p.get('scenario', '')}",
            f"- **准备信息**：{p.get('requiredInfo', '')}",
            f"- **使用边界**：{p.get('boundaries', '')}",
            "",
            "### 简版提示词",
            "",
            "```text",
            p.get("simplePrompt", "").strip(),
            "```",
            "",
            "### 完整版提示词",
            "",
            "```text",
            p.get("fullPrompt", "").strip(),
            "```",
            "",
        ])
    write_clean(rag_dir / "tianji-prompts.md", "\n".join(prompt_lines))

    # 5. 合并单文件 nihaixia-corpus-all.md（方便 NotebookLM / Claude / ChatGPT 一次拖入）
    corpus_parts = [
        "# 倪海厦知识图谱结构化全集（AI 语料单文件版）",
        "",
        "> 仅供学习研究，不构成医疗诊断、处方或用药建议。",
        "",
        "## 一、学习路径总览",
        "",
        "### 人纪学习路径",
    ]
    for st, desc, ns in RENJI_STAGES:
        corpus_parts.append(f"- **{st}**：{desc}（关联节点：{'、'.join(ns)}）")
    corpus_parts.extend(["", "### 天纪学习路径"])
    for st, desc, ns in TIANJI_STAGES:
        corpus_parts.append(f"- **{st}**：{desc}（关联节点：{'、'.join(ns)}）")
    corpus_parts.extend(["", "## 二、图谱节点与专题（69 项）", ""])
    for item in all_items:
        sec = item.get("sections") or {}
        corpus_parts.extend([
            f"### {item['title']}（{item.get('layer') or '深度专题'}）",
            "",
            f"**定义**：{item.get('definition', '').strip()}",
            "",
            f"**白话**：{item.get('summary', '').strip()}",
            "",
        ])
        if sec.get("核心理解"):
            corpus_parts.extend([sec["核心理解"].strip(), ""])
        for q in item.get("quotes") or []:
            if isinstance(q, dict) and q.get("text"):
                src = f" —— {q['source']}" if q.get("source") else ""
                corpus_parts.extend([f"**倪海厦原话**：{q['text'].strip()}{src}", ""])
        for m in item.get("misconceptions") or []:
            if isinstance(m, dict) and m.get("wrong"):
                corpus_parts.extend([
                    f"**常见误区**：{m['wrong'].strip()} ｜ **正解**：{(m.get('correction') or '').strip()}",
                    "",
                ])
        if sec.get("安全边界"):
            corpus_parts.extend([f"**边界**：{sec['安全边界'].strip()}", ""])
    corpus_parts.extend(["## 三、天纪提示词（5 套）", ""])
    for p in prompts:
        corpus_parts.extend([
            f"### {p['title']}",
            "",
            p.get("simplePrompt", "").strip(),
            "",
        ])
    write_clean(rag_dir / "nihaixia-corpus-all.md", "\n".join(corpus_parts))

    rag_readme = f"""# AI 知识库语料包

与在线网站同步导出，用来直接喂给大模型或接入自己的知识库工具。

| 文件 | 里头是什么 | 怎么用 |
|------|------|---------|
| [`nihaixia-corpus-all.md`](./nihaixia-corpus-all.md) | {len(nodes)} 张概念卡 + {len(articles)} 篇专题 + 学习路径 + {len(prompts)} 套天纪提示词 | 直接拖进 NotebookLM、Claude、ChatGPT 或 Kimi 陪读 |
| [`nodes.jsonl`](./nodes.jsonl) | {len(nodes)} 条节点数据（含定义、白话解释、安全边界） | 导入 Dify、Coze、Cherry Studio 或向量库 |
| [`articles.jsonl`](./articles.jsonl) | {len(articles)} 篇专题文章数据 | 补充长文检索 |
| [`edges.jsonl`](./edges.jsonl) | {len(edges_jsonl)} 条节点关联边 | 搭 GraphRAG 或做图谱分析 |
| [`tianji-prompts.md`](./tianji-prompts.md) | {len(prompts)} 套天纪提示词完整版 | 直接复制使用 |

如果想在 Claude Code、Cursor、Codex 里直接安装天纪提示词，看 [`skills/nihaixia-tianji/`](../../skills/nihaixia-tianji/README.md)。
"""
    write_clean(rag_dir / "README.md", rag_readme)

    return {"nodes": len(nodes), "articles": len(articles), "edges": len(edges_jsonl)}


# ---------------------------------------------------------------------------
# 原始文本清洗与分章工具（仅 --raw-ima-dir / --raw-ocr-dir 时运行）
# ---------------------------------------------------------------------------

def strip_picture_wrappers(text: str, drop_tiny_noise: bool = True) -> str:
    """去掉 ==> picture 占位符，并剥离 Start/End of picture text 外壳（保留真实表格/命盘文本）。"""
    text = re.sub(r"\*\*==>\s*picture\s*\[[^\]]*\]\s*intentionally omitted\s*<==\*\*\n*", "", text)

    def _repl(match):
        inner = match.group(1).replace("<br>", "\n").strip()
        cjk_count = len(re.findall(r"[\u4e00-\u9fff]", inner))
        if drop_tiny_noise and cjk_count < 4:
            return ""
        return inner + "\n"

    text = re.sub(
        r"\*\*-----\s*Start of picture text\s*-----\*\*(?:<br>)?\n?(.*?)\*\*-----\s*End of picture text\s*-----\*\*(?:<br>)?\n*",
        _repl,
        text,
        flags=re.S,
    )
    return text


def normalize_bold_parens(text: str) -> str:
    """将 OCR 残余的 **(** 二 **)** / **( )** 等格式收敛为干净括号（不删减正文文字）。"""
    text = re.sub(r"\*\*\(\*\*\s*([^*\n]+?)\s*\*\*\)\*\*", r"（\1）", text)
    text = re.sub(r"\*\*\(\s*\)\*\*", "（）", text)
    return text


def clean_tianji_dao(raw: str) -> str:
    text = normalize_bold_parens(strip_picture_wrappers(raw))
    lines = []
    in_toc_block = False
    for line in text.splitlines():
        s = line.strip()
        if re.match(r"^(?:`[IVX\d]+|\*\*\d+\*\*)\s+`?\d{8}`?\s*非打印第一版$", s):
            continue
        if re.match(r"^目\s*录\s+天机道（天纪系列）$", s):
            continue
        if re.match(r"^天机道\s+天机道（天纪系列）$", s):
            continue
        # 跳过带大量目录点线的印刷目录页（正文紧随其后，不删正文）
        if s == "## 目 录":
            in_toc_block = True
            continue
        if in_toc_block:
            if s.startswith("## 壹、"):
                in_toc_block = False
            else:
                continue
        # 去除混入扫描页脚的 11 位第三方手机号水印，并降级误标标题
        line = re.sub(r"(?<!\d)1[3-9]\d{9}(?!\d)", "", line).rstrip()
        s = line.strip()
        if s == "## 例如：":
            line = "例如："
            s = line
        # 将 OCR 误标为 ## 的诗诀/长句降级为普通正文（保留全部原句，不删字）
        if s.startswith("## "):
            heading_body = s[3:].strip()
            is_table_or_section = bool(re.match(r"^(?:[壹贰叁肆伍陆柒捌玖拾一二三四五六七八九十]+、|（[一二三四五六七八九十\d]+）|.*表\b|徐\s*序|郭\s*序|自\s*序)", heading_body))
            if not is_table_or_section and (heading_body.endswith("。") or "。" in heading_body or "，" in heading_body):
                line = heading_body
        lines.append(line)
    out = "\n".join(lines).strip()
    out = re.sub(r"^天\s*机\s*道\s*\n+", "", out)
    return "# 天机道（天纪系列）\n\n" + LEARNING_BANNER_NI + "\n" + out


def clean_dimai_dao(raw: str) -> str:
    text = normalize_bold_parens(strip_picture_wrappers(raw))
    raw_lines = text.splitlines()
    # 从《序 言》开始保留正文，跳过印刷版点线目录页
    start_idx = 0
    for i, line in enumerate(raw_lines):
        if re.match(r"^##\s*\*?\*?序\s*言\*?\*?$", line.strip()):
            start_idx = i
            break
    lines = []
    for line in raw_lines[start_idx:]:
        s = line.strip()
        if re.match(r"^天纪地脈道\(倪海廈著\)$", s):
            continue
        if re.match(r"^[零一二三四五六七八九十百壹贰叁肆伍陆柒捌玖拾佰]{1,5}$", s):
            continue
        # 地脉道真正的小节/卦名标题均以 **...** 包裹；无 ** 的 ## 均为 OCR 断句误标，降级为正文
        if s.startswith("## "):
            body = s[3:].strip()
            if not (body.startswith("**") and body.endswith("**")):
                line = body
        lines.append(line)
    out = "\n".join(lines)
    return "# 地脉道（天纪系列）\n\n" + LEARNING_BANNER_NI + "\n" + out


def clean_renjian_dao_body(raw: str) -> str:
    """清洗人间道中的图片占位符、民间校勘序、点线目录与每页重复页眉页脚，完整保留原文。"""
    text = normalize_bold_parens(strip_picture_wrappers(raw))
    lines = text.splitlines()
    start_idx = 0
    for i, line in enumerate(lines):
        if re.match(r"^##\s*自\s*序", line.strip()):
            start_idx = i
            break

    kept = []
    in_toc = False
    for line in lines[start_idx:]:
        s = line.strip()
        # 剔除点线印刷目录块（进入 ## 乾爲天 恢复）
        if re.match(r"^##\s*\*?\*?目录\*?\*?$", s):
            in_toc = True
            continue
        if in_toc:
            if s.startswith("## 乾爲天"):
                in_toc = False
            else:
                continue
        if re.match(r"^(?:##\s*\*\*)?倪海厦《人間道》(?:\*\*)?$", s):
            continue
        # 剔除页眉/页脚重复印制的“第 X 页”和无标点格言页眉（保留正文里真正的《象曰：天行健，君子以自彊不息。》）
        if re.match(r"^(?:##\s*)?(?:第\s*\d+\s*页\s*)?(?:天行健君子以自強不息|地勢坤君子以厚德載物)(?:\s+(?:天行健君子以自強不息|地勢坤君子以厚德載物))?$", s):
            continue
        if re.match(r"^(?:##\s*)?第\s*\d+\s*页$", s):
            continue
        # 将序言落款与误标引语从 ## 降级为正文，并闭合孤立粗体标记（原文一字不删）
        if s.startswith("## "):
            body = s[3:].strip()
            if (
                re.match(r"^(?:梵宇龍|中華民國|徐光佑)", body)
                or body.startswith("孟子學而篇：")
            ):
                line = body
        if line.count("**") % 2 == 1:
            line = line.rstrip() + "**"
        kept.append(line)
    return "\n".join(kept)


def export_renjian_dao_split(raw: str, out_dir: Path) -> None:
    if out_dir.exists():
        shutil.rmtree(out_dir)
    body = clean_renjian_dao_body(raw)

    # 切分为：序言与读易心法 / 上经三十卦（乾至离）/ 下经三十四卦（咸至未济）
    m_qian = re.search(r"(?m)^## 乾爲天\s*$", body)
    m_xian = re.search(r"(?m)^## 澤山咸\s*$", body)
    if not (m_qian and m_xian):
        raise ValueError("无法定位《人间道》乾爲天 / 澤山咸 分卷边界")

    preface = body[: m_qian.start()].strip()
    upper = body[m_qian.start() : m_xian.start()].strip()
    lower = body[m_xian.start() :].strip()

    write_clean(out_dir / "00-序言与读易心法.md", "# 人间道 · 序言与读易心法\n\n" + LEARNING_BANNER_NI + "\n" + preface)
    write_clean(out_dir / "01-上经三十卦.md", "# 人间道 · 上经三十卦（乾为天 → 离为火）\n\n" + LEARNING_BANNER_NI + "\n" + upper)
    write_clean(out_dir / "02-下经三十四卦.md", "# 人间道 · 下经三十四卦（泽山咸 → 火水未济）\n\n" + LEARNING_BANNER_NI + "\n" + lower)

    readme = """# 人间道（天纪系列 · 分卷版）

> 原著著作权归**倪海厦先生**及其权利继承人所有；本目录完整保留原文内容，仅去除重复页眉页码与点线目录，并按易经上下经拆分为 3 卷方便 GitHub 在线阅读。

## 分卷目录

| 卷次 | 文件 | 内容范围 |
|------|------|---------|
| 序言 | [00-序言与读易心法.md](./00-序言与读易心法.md) | 自序、郭序、徐序、读易心理准备与人间道总纲 |
| 上经 | [01-上经三十卦.md](./01-上经三十卦.md) | 乾为天 → 离为火（上经三十卦象解与人伦推演） |
| 下经 | [02-下经三十四卦.md](./02-下经三十四卦.md) | 泽山咸 → 火水未济（下经三十四卦象解与人伦推演） |
"""
    write_clean(out_dir / "README.md", readme)


def clean_yijing_64(raw: str) -> str:
    text = normalize_bold_parens(strip_picture_wrappers(raw))
    lines = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("## "):
            body = s[3:].strip()
            if body.endswith("。") or "，" in body:
                line = body
        lines.append(line)
    return "# 易经六十四卦象解（天纪系列）\n\n" + LEARNING_BANNER_NI + "\n" + "\n".join(lines)


def clean_tianji_note(title: str, raw: str) -> str:
    text = raw.replace("\uf0b2", "- ").replace("\uf020", " ")
    cleaned_lines = []
    for line in text.splitlines():
        line = line.rstrip()
        if line.endswith("\\"):
            line = line[:-1].rstrip()
        line = re.sub(r"^\s*-\s{2,}", "- ", line)
        cleaned_lines.append(line)
    return f"# {title}\n\n" + LEARNING_BANNER_NI + "\n" + "\n".join(cleaned_lines)


def clean_renji_acupuncture_body(raw: str) -> str:
    text = normalize_bold_parens(strip_picture_wrappers(raw))
    lines = text.splitlines()
    start_idx = 0
    for i, line in enumerate(lines):
        if line.strip().startswith("## 第一章 针灸的使用时机"):
            start_idx = i
            break
    kept = []
    structural_re = re.compile(r"^(?:第[一二三四五六]章|[一二三四五六七八九十]+、|①?\s*[一二三四五六七八九十]+、|\*?\*?\d+\*?\*?)")
    timecode_re = re.compile(r"\d+:\d{2}:\d{2}")
    for line in lines[start_idx:]:
        s = line.strip()
        # 剔除书尾仅对应 PDF 页码的拼音/笔画/治症索引表（正文已全部结束）
        if s.startswith("## 穴位拼音索引"):
            break
        if re.match(r"^V2-\d{8}.*修改.*", s) or re.match(r"^人纪系列针灸篇$", s) or re.match(r"^##\s*人纪系列针灸篇$", s):
            continue
        if re.match(r"^\d{1,3}$", s):
            continue
        if s.startswith("## "):
            body = s[3:].strip()
            has_struct = bool(structural_re.match(body))
            has_tc = bool(timecode_re.search(body))
            if not has_struct and not has_tc and (body.endswith("。") or "。" in body):
                line = body
            elif re.match(r"^（\s*\*?\*?\d+-\d{2}:\d{2}:\d{2}\*?\*?\s*）$", body):
                line = body
        kept.append(line)
    return "\n".join(kept)


def export_renji_acupuncture_split(raw: str, out_dir: Path) -> None:
    if out_dir.exists():
        shutil.rmtree(out_dir)
    body = clean_renji_acupuncture_body(raw)
    parts = re.split(r"(?m)(?=^## 第[一二三四五六]章)", body)
    chapters = [p.strip() for p in parts if p.strip().startswith("## 第")]
    if len(chapters) != 6:
        raise ValueError(f"人纪针灸分章异常，期望 6 章，实际 {len(chapters)} 章")

    # 第四章体量约 505KB，按经络群自然切分为 4a / 4b / 4c（100% 保留原文）
    ch4 = chapters[3]
    m_pi = re.search(r"(?m)^## 七、足太阴脾经", ch4)
    m_shen = re.search(r"(?m)^## 十一、足少阴肾经", ch4)
    if not (m_pi and m_shen):
        raise ValueError("无法定位第四章经络子节切分边界")
    ch4a = ch4[: m_pi.start()].strip()
    ch4b = ch4[m_pi.start() : m_shen.start()].strip()
    ch4c = ch4[m_shen.start() :].strip()

    banner = (
        LEARNING_BANNER_NI
        + "> **针灸研习提示**：本篇为课堂实录整理（保留原始时间码与讲解原貌），仅供中医经络与穴位理论研习，切勿在无执业资质指导下自行施针或施灸。\n\n"
    )

    files_spec = [
        ("01-针灸的使用时机与急救火罐.md", "第一章：针灸的使用时机、急救法与火罐", chapters[0]),
        ("02-针灸穴位丈量方法与针刺基础.md", "第二章：针灸穴位丈量方法与针刺基础", chapters[1]),
        ("03-十二经纳天干地支与井荣俞原经合.md", "第三章：十二经纳天干地支与井荣俞原经合", chapters[2]),
        ("04a-任督二脉与肺大肠胃经.md", "第四章（上）：任脉、督脉、肺经、大肠经与胃经", ch4a),
        ("04b-脾心小肠与膀胱经.md", "第四章（中）：脾经、心经、小肠经与膀胱经", ch4b),
        ("04c-肾心包三焦胆肝经.md", "第四章（下）：肾经、心包经、三焦经、胆经与肝经", ch4c),
        ("05-奇经八脉与针刺补泻法.md", "第五章：奇经八脉与针刺补泻法", chapters[4]),
        ("06-针灸治症系列.md", "第六章：针灸治症系列", chapters[5]),
    ]

    toc_rows = []
    for fname, title, content in files_spec:
        write_clean(out_dir / fname, f"# 人纪·针灸篇（课堂实录整理）— {title}\n\n" + banner + content)
        toc_rows.append(f"| [{fname}](./{fname}) | {title} |")

    readme = (
        "# 人纪·针灸篇（课堂实录整理）\n\n"
        + banner
        + "## 章节目录\n\n"
        + "| 文件 | 章节内容 |\n|------|----------|\n"
        + "\n".join(toc_rows)
        + "\n"
    )
    write_clean(out_dir / "README.md", readme)


def clean_zhenjiu_dacheng_body(raw: str) -> str:
    text = strip_picture_wrappers(raw)
    lines = text.splitlines()
    start_idx = 0
    for i, line in enumerate(lines):
        if "## 针 道 源 流" in line or "## 针道源流" in line or "仰 人 周 身 总 穴 图" in line:
            start_idx = i
            break
    kept = []
    cjk_space = re.compile(
        r"([\u4e00-\u9fff《》「」『』【】、，。；：？！（）①②③④⑤⑥⑦⑧⑨⑩])\s+(?=[\u4e00-\u9fff《》「」『』【】、，。；：？！（）①②③④⑤⑥⑦⑧⑨⑩])"
    )
    running_header_re = re.compile(
        r"^(?:##\s*)?(?:[０-９\d\s]{1,9}\s+)?(?:\*\*)?针\s*[炙灸]\s*大\s*成(?:\*\*)?(?:\s+[０-９\d\s]{1,9})?$"
    )
    garbled_header_tbl_re = re.compile(r"^\|+[^\n]*针\s*[炙灸]\s*大\s*成[^\n]*\|+$")
    inline_header_prefix_re = re.compile(
        r"^(?:[-•]\s*)?(?:(?:[０-９]\s*){1,4}\s+)?针\s*炙\s*大\s*成(?:\s*(?:[０-９]\s*){1,4})?\s*"
    )
    fullwidth_pagenum_re = re.compile(r"^(?:##\s*)?[０-９\s]{1,9}$")
    glued_heading_re = re.compile(r"^([^。！？\n]*[。！？])\s*((?:《[^》]+》)?[\u4e00-\u9fff《》]{2,14})$")
    for line in lines[start_idx:]:
        s = line.strip()
        if running_header_re.match(s) or garbled_header_tbl_re.match(s):
            continue
        if re.match(r"^[—\-]?\s*[０-９\d]+\s*[—\-]?$", s):
            continue
        if fullwidth_pagenum_re.match(s) and any(ch in s for ch in "０１２３４５６７８９"):
            continue
        m = re.match(r"^(\s*(?:#{1,6}\s+|-\s+)?)(.*)$", line)
        prefix, rest = m.group(1), m.group(2)
        rest = cjk_space.sub(r"\1", rest)
        rest = re.sub(r"<br>", " ", rest)
        if prefix.strip() == "":
            rest = inline_header_prefix_re.sub("", rest)
        if prefix.strip() == "-" and "针炙大成" in rest:
            rest = inline_header_prefix_re.sub("", rest)
        if prefix.strip() == "##":
            body = rest.strip()
            mg = glued_heading_re.match(body)
            if mg:
                kept.append(mg.group(1))
                kept.append("")
                kept.append(f"## {mg.group(2)}")
                continue
            if (
                any(p in body for p in ("。", "，", "！"))
                or len(body) <= 1
                or body in ("肾也", "《下经》灸五")
            ):
                kept.append(body)
                continue
        if not rest.strip() and prefix.strip() in ("-", "##"):
            continue
        kept.append(prefix + rest)
    return "\n".join(kept)


def export_zhenjiu_dacheng_split(raw: str, out_dir: Path) -> None:
    if out_dir.exists():
        shutil.rmtree(out_dir)
    body = clean_zhenjiu_dacheng_body(raw)
    lines = body.splitlines()

    def find_idx(pattern: str) -> int:
        rx = re.compile(pattern)
        for i, line in enumerate(lines):
            if rx.search(line.strip()):
                return i
        raise ValueError(f"针灸大成分卷未找到标记: {pattern}")

    cuts = [
        (0, "卷01-针道源流与刺法论.md", "卷一：针道源流、经络与刺法诸论"),
        (find_idx(r"^(?:##\s*)?周身经穴赋"), "卷02-周身经穴与赋文.md", "卷二：周身经穴赋、百症赋、标幽赋与玉龙赋"),
        (find_idx(r"^##\s*卷三$"), "卷03-歌诀与策论.md", "卷三：五运六气歌诀、十二经脉歌与针灸策论"),
        (find_idx(r"^卷四仰人尺寸图"), "卷04-尺寸图与针法补泻.md", "卷四：尺寸图、手法补泻与经络迎随问答"),
        (find_idx(r"^卷五$"), "卷05-井荥俞经合与子午流注.md", "卷五：十二经井荥俞经合与子午流注"),
        (find_idx(r"^##\s*卷六$"), "卷06-五脏六腑与经穴上.md", "卷六：五脏六腑与十二经穴（上）"),
        (find_idx(r"^##\s*卷七$"), "卷07-经穴下与奇经八脉.md", "卷七：十二经穴（下）与奇经八脉"),
        (find_idx(r"^卷八$"), "卷08-诸症治法上.md", "卷八：诸症针灸治法（上）"),
        (find_idx(r"^##\s*卷九$"), "卷09-诸症治法下与灸法.md", "卷九：诸症治法（下）、灸法与治症总要"),
        (find_idx(r"^卷十保婴神术"), "卷10-保婴神术与小儿按摩.md", "卷十：保婴神术与小儿按摩经"),
    ]

    toc_rows = []
    for idx, (start, fname, title) in enumerate(cuts):
        end = cuts[idx + 1][0] if idx + 1 < len(cuts) else len(lines)
        chunk = "\n".join(lines[start:end]).strip()
        write_clean(out_dir / fname, f"# 针灸大成（明·杨继洲）— {title}\n\n" + LEARNING_BANNER_CLASSIC + "\n" + chunk)
        toc_rows.append(f"| [{fname}](./{fname}) | {title} |")

    readme = (
        "# 针灸大成（明·杨继洲 · 十卷全本）\n\n"
        + LEARNING_BANNER_CLASSIC
        + "\n## 分卷目录\n\n"
        + "| 文件 | 卷次内容 |\n|------|----------|\n"
        + "\n".join(toc_rows)
        + "\n"
    )
    write_clean(out_dir / "README.md", readme)


def export_shennong_split(part1_path: Path, part2_path: Path, out_dir: Path) -> None:
    """从 Apple Vision OCR 校勘稿提取纯净正文，按上/中/下经分卷导出（完整保留原文与剂量原貌）。"""
    if out_dir.exists():
        shutil.rmtree(out_dir)

    combined = part1_path.read_text(encoding="utf-8") + "\n" + part2_path.read_text(encoding="utf-8")
    blocks = re.findall(r"### 第 (\d+) 页（([^）]+)）.*?```text\n(.*?)```", combined, re.S)
    pages_out = []
    for pg_str, _status, body in blocks:
        pg = int(pg_str)
        # P1-4 封面/空白/画像；P5 民间校勘序；P7-16 扫描目录数字；P146-156 拼音笔画索引与空白
        if pg != 6 and not (17 <= pg <= 145):
            continue
        lines = []
        for line in body.splitlines():
            s = line.strip()
            if s in ("倪注神农本草经", "V100415.01"):
                continue
            if re.match(r"^\d{1,3}$", s):
                continue
            lines.append(line.rstrip())
        cleaned = "\n".join(lines).strip()
        if cleaned:
            pages_out.append(cleaned)

    full_body = "\n\n".join(pages_out)
    lines = full_body.splitlines()

    def find_line(prefix: str) -> int:
        for i, line in enumerate(lines):
            if line.strip().startswith(prefix):
                return i
        raise ValueError(f"神农本草经未找到分卷标记: {prefix}")

    cuts = [
        (0, "00-自序前言与药性总义.md", "自序、前言与药性总义"),
        (find_line("壹、上经"), "01-上经.md", "壹、上经（上品诸药）"),
        (find_line("贰、中经"), "02-中经.md", "贰、中经（中品诸药）"),
        (find_line("叁、下经"), "03-下经.md", "叁、下经（下品诸药）"),
        (find_line("第三章 增补神农本草经不足部分"), "04-增补神农本草经不足部分.md", "第三章：增补神农本草经不足部分"),
    ]

    banner = (
        LEARNING_BANNER_NI
        + "> **药材文献与安全边界提示**：本卷保留《神农本草经》批注原文中的性味、用量、禁忌与附方原貌，"
        "仅供中医药理文献学习，严禁直接照方抓药或用于个人自诊自疗。\n\n"
    )

    toc_rows = []
    for idx, (start, fname, title) in enumerate(cuts):
        end = cuts[idx + 1][0] if idx + 1 < len(cuts) else len(lines)
        chunk = "\n".join(lines[start:end]).strip()
        write_clean(out_dir / fname, f"# 神农本草经（批注整理）— {title}\n\n" + banner + chunk)
        toc_rows.append(f"| [{fname}](./{fname}) | {title} |")

    readme = (
        "# 神农本草经（批注整理 · 分卷版）\n\n"
        + banner
        + "## 分卷目录\n\n"
        + "| 文件 | 内容范围 |\n|------|----------|\n"
        + "\n".join(toc_rows)
        + "\n"
    )
    write_clean(out_dir / "README.md", readme)


def clean_sources_public_book(book_dir: Path, title: str, min_page: int) -> str:
    """合并 sources-public 某部经典的可读章节，剔除目录页、页码注释与第三方校排页脚。"""
    chapter_files = sorted(book_dir.glob("chapter_*.md"))
    pages_text = []
    for ch in chapter_files:
        raw = ch.read_text(encoding="utf-8")
        if raw.startswith("---"):
            end = raw.find("---", 3)
            if end > 0:
                raw = raw[end + 3 :]
        raw = re.sub(r"^#\s*第\s*\d+\s*章[^\n]*\n*", "", raw.strip())
        chunks = re.split(r"<!--\s*第\s*(\d+)\s*页\s*-->", raw)
        for i in range(1, len(chunks), 2):
            pg = int(chunks[i])
            if pg < min_page:
                continue
            pbody = chunks[i + 1]
            kept_lines = []
            for line in pbody.splitlines():
                s = line.strip()
                if any(marker in s for marker in ("小桂枝·群龙无首", "博採眾方 勤求古訓", "勤求古訓博採眾方")):
                    continue
                if s in ("《黄帝内经》注解简体版", "《伤寒论》注解 简体版", "简体版 《伤寒论》注解", "倪海厦注《金匮》", "倪海廈注《金匮》", "倪海厦注《金遗》", "%", "−"):
                    continue
                if re.match(r"^第\s*\d+\s*页(?:/共\s*\d+\s*页)?$", s):
                    continue
                if re.match(r"^[IVX]+$", s):
                    continue
                kept_lines.append(line.rstrip())
            block = "\n".join(kept_lines).strip()
            if block:
                pages_text.append(block)

    notice = (
        f"# {title}\n\n"
        + LEARNING_BANNER_NI
        + "> **校勘状态说明**：本文件为已核验完成的前序可读章节（`public_ready`），完整保留原典条文与历史剂量原貌；"
        "其余篇章因原始扫描 OCR 质量尚待人工校勘，暂不盲目入库，后续校勘完成将持续补充。\n\n"
    )
    return notice + "\n\n".join(pages_text)


def export_library_texts(raw_ima_dir: Path, raw_ocr_dir: Path, sources_public_dir: Path) -> None:
    tianji_dir = KNOWLEDGE_DIR / "03-天纪学习资料"
    renji_dir = KNOWLEDGE_DIR / "04-人纪学习资料"

    if tianji_dir.exists():
        shutil.rmtree(tianji_dir)
    if renji_dir.exists():
        shutil.rmtree(renji_dir)

    # 1. 03-天纪学习资料
    t_ebooks = raw_ima_dir / "07_天纪资料" / "电子书"
    t_notes = raw_ima_dir / "07_天纪资料" / "笔记"
    write_clean(tianji_dir / "01-天机道.md", clean_tianji_dao((t_ebooks / "天机道终稿.md").read_text(encoding="utf-8")))
    write_clean(tianji_dir / "02-地脉道.md", clean_dimai_dao((t_ebooks / "地脉道.md").read_text(encoding="utf-8")))
    export_renjian_dao_split((t_ebooks / "人间道.md").read_text(encoding="utf-8"), tianji_dir / "03-人间道")
    write_clean(tianji_dir / "04-易经64卦图.md", clean_yijing_64((t_ebooks / "易经64卦图.md").read_text(encoding="utf-8")))

    write_clean(tianji_dir / "笔记与参考" / "天机道笔记.md", clean_tianji_note("天机道听课与盘面笔记", (t_notes / "天机道笔记个人整理.md").read_text(encoding="utf-8")))
    write_clean(tianji_dir / "笔记与参考" / "人间道听课笔记.md", clean_tianji_note("《天纪》人间道听课笔记", (t_notes / "人间道听课笔记.txt").read_text(encoding="utf-8")))
    write_clean(tianji_dir / "笔记与参考" / "地脉道听课笔记.md", clean_tianji_note("《天纪》地脉道听课笔记", (t_notes / "地脉道听课笔记.txt").read_text(encoding="utf-8")))
    write_clean(tianji_dir / "笔记与参考" / "易经推命批法.md", clean_tianji_note("易经推命批法笔记", (t_notes / "易经推命批法.txt").read_text(encoding="utf-8")))

    tianji_readme = """# 天纪学习资料

原著与讲授内容著作权归**倪海厦先生**及其权利继承人所有。这里保留原文，仅做去噪清洗和按卷拆分，供个人非商业学习。

## 目录

| 文件 / 文件夹 | 内容 | 对应图谱节点 |
|------------|------|-------------|
| [01-天机道.md](./01-天机道.md) | 天象、易理与紫微斗数 | `天机道` · `紫微斗数` |
| [02-地脉道.md](./02-地脉道.md) | 阳宅地理与环境法则 | `地脉道` · `风水堪舆` |
| [03-人间道/](./03-人间道/README.md) | 易经六十四卦与处世（分序言、上经、下经 3 卷） | `人间道` · `天纪与人纪` |
| [04-易经64卦图.md](./04-易经64卦图.md) | 六十四卦象解速查 | `易经` · `象数` |
| [笔记与参考/](./笔记与参考/README.md) | 天机道、人间道、地脉道听课笔记与易经推命批法 | 配套笔记 |

> 说明：已去掉编码损坏或带无关外链的旧草稿，只保留干净可读的版本。
"""
    write_clean(tianji_dir / "README.md", tianji_readme)

    # 2. 04-人纪学习资料
    r_zj = raw_ima_dir / "09_中医原始资料" / "针灸"
    export_zhenjiu_dacheng_split((r_zj / "针灸大成.md").read_text(encoding="utf-8"), renji_dir / "针灸大成")
    export_renji_acupuncture_split((r_zj / "人纪-简体针灸教程.md").read_text(encoding="utf-8"), renji_dir / "人纪-针灸篇")

    sn_dir = raw_ocr_dir / "06_中医经典与课程"
    export_shennong_split(
        sn_dir / "01_神农本草经_OCR校勘稿_part1.md",
        sn_dir / "01_神农本草经_OCR校勘稿_part2.md",
        renji_dir / "神农本草经",
    )

    if sources_public_dir.exists():
        classics_dir = sources_public_dir / "classics"
        write_clean(
            renji_dir / "经方与内经节选" / "黄帝内经注解-节选.md",
            clean_sources_public_book(classics_dir / "huangdi-neijing", "黄帝内经注解（节选·持续校勘中）", min_page=5),
        )
        write_clean(
            renji_dir / "经方与内经节选" / "伤寒论注解-节选.md",
            clean_sources_public_book(classics_dir / "shanghan-lun", "伤寒论注解（节选·持续校勘中）", min_page=7),
        )
        write_clean(
            renji_dir / "经方与内经节选" / "金匮要略注解-节选.md",
            clean_sources_public_book(classics_dir / "jin-kuei-yao-lue", "金匮要略注解（节选·持续校勘中）", min_page=8),
        )

    renji_readme = """# 人纪学习资料

古代医经原典属于公有领域；倪海厦先生的批注与课堂讲授著作权归**倪海厦先生**及其权利继承人所有。

> **阅读提醒**：古籍和课堂实录里保留的历史剂量、附方与灸法均为文献原貌，只供学习参考，**不要照方抓药或自行施治**。身体不适请找正规执业医师。

## 目录与校勘进度

| 文件 / 文件夹 | 进度 | 内容 |
|------------|------|------|
| [针灸大成/](./针灸大成/README.md) | 已全本分卷 | 明·杨继洲原著（公有领域），按卷一至卷十拆分 |
| [人纪-针灸篇/](./人纪-针灸篇/README.md) | 已完整分章 | 人纪·针灸篇课堂实录整理，保留时间码，拆为 8 章 |
| [神农本草经/](./神农本草经/README.md) | 已全本分卷 | 自序、药性总义、上/中/下三经与增补本草，共 5 卷 |
| [经方与内经节选/](./经方与内经节选/README.md) | 持续校勘中 | [黄帝内经注解](./经方与内经节选/黄帝内经注解-节选.md) · [伤寒论注解](./经方与内经节选/伤寒论注解-节选.md) · [金匮要略注解](./经方与内经节选/金匮要略注解-节选.md) |

## 这里没有的内容

- 扫描乱码还没校对完的章节暂不放入，校好后再补；
- 《汉唐方剂讲解》《人纪班闭门课》和具体患者医案全文不收录，只在知识图谱里保留辨证框架。
"""
    write_clean(renji_dir / "README.md", renji_readme)
    ensure_library_sub_readmes()


def ensure_library_sub_readmes() -> None:
    """为天纪笔记与人纪节选子目录补齐 GitHub 可点击索引 README.md。"""
    tianji_notes_dir = KNOWLEDGE_DIR / "03-天纪学习资料" / "笔记与参考"
    if tianji_notes_dir.exists():
        notes_readme = (
            "# 天纪听课笔记与推命参考\n\n"
            + LEARNING_BANNER_NI
            + "\n## 文件目录\n\n"
            + "| 文件 | 内容范围 | 对应图谱节点 |\n"
            + "|------|----------|-------------|\n"
            + "| [天机道笔记.md](./天机道笔记.md) | 紫微斗数星曜、十二宫位与盘面听课笔记 | `天机道` · `紫微斗数` |\n"
            + "| [人间道听课笔记.md](./人间道听课笔记.md) | 六十四卦人间处世与人事推演听课笔记 | `人间道` · `易经` |\n"
            + "| [地脉道听课笔记.md](./地脉道听课笔记.md) | 阳宅九宫方位、格局与堪舆听课笔记 | `地脉道` · `风水堪舆` |\n"
            + "| [易经推命批法.md](./易经推命批法.md) | 易经象数与三才综合推演笔记 | `象数` · `三才` |\n"
        )
        write_clean(tianji_notes_dir / "README.md", notes_readme)

    renji_excerpts_dir = KNOWLEDGE_DIR / "04-人纪学习资料" / "经方与内经节选"
    if renji_excerpts_dir.exists():
        excerpts_readme = (
            "# 经方与内经注解节选（持续校勘中）\n\n"
            + LEARNING_BANNER_NI
            + "> **校勘进度说明**：本目录仅收录已完成人工初校、无 OCR 乱码的前序可读章节（`public_ready`）；"
            + "其余扫描章节校勘完成后将分批补齐，不盲目入库未校勘乱码。\n\n"
            + "## 已校勘文件目录\n\n"
            + "| 文件 | 已收录内容范围 | 对应图谱节点 |\n"
            + "|------|---------------|-------------|\n"
            + "| [黄帝内经注解-节选.md](./黄帝内经注解-节选.md) | 素问序言、上古天真论等前序可读章节 | `黄帝内经` · `阴阳` · `五行` |\n"
            + "| [伤寒论注解-节选.md](./伤寒论注解-节选.md) | 伤寒论序言、辨太阳病脉证并治已核验章节 | `伤寒论` · `六经辨证` · `经方` |\n"
            + "| [金匮要略注解-节选.md](./金匮要略注解-节选.md) | 金匮前言、续伤寒篇与脏腑经络先后病脉证节选 | `金匮要略` · `方证对应` |\n"
        )
        write_clean(renji_excerpts_dir / "README.md", excerpts_readme)


def write_knowledge_top_docs() -> None:
    top_readme = """# 开源知识库

这里放着整个项目可以离线保存、直接阅读和喂给 AI 的资料，大部头文档都已经按卷或按章拆开（单文件不超过 186 KB），在 GitHub 网页上也能流畅翻看。

| 目录 | 适合干什么 | 里头有什么 |
|------|---------|-------------------|
| [`01-知识图谱笔记/`](./01-知识图谱笔记/README.md) | 在线查概念 / 导入 Obsidian | 与网站同步的 64 张节点卡 + 5 篇专题 + 2 条学习路径（Obsidian 用户打开 [`00-知识图谱总览-MOC.md`](./01-知识图谱笔记/00-知识图谱总览-MOC.md) 即可用双链） |
| [`02-AI知识库语料包/`](./02-AI知识库语料包/README.md) | 喂给 AI 陪读或搭 RAG | 合并单文件 `nihaixia-corpus-all.md`、`nodes/articles/edges.jsonl` 和 5 套天纪提示词 |
| [`03-天纪学习资料/`](./03-天纪学习资料/README.md) | 系统读《天纪》 | 《天机道》《地脉道》《人间道（3 卷）》《易经64卦图》和听课笔记 |
| [`04-人纪学习资料/`](./04-人纪学习资料/README.md) | 系统读《人纪》与经典 | 《针灸大成（10 卷）》《人纪·针灸篇（8 章）》《神农本草经（5 卷）》及内经/伤寒/金匮已校勘节选 |

## 数据同步

`01-知识图谱笔记/`、`02-AI知识库语料包/` 和离线数据包 `docs/data/offline-data.js` 均由 [`scripts/export_knowledge_assets.py`](../scripts/export_knowledge_assets.py) 自动生成：

```bash
python3 scripts/export_knowledge_assets.py            # 同步 01 / 02 与离线数据包
python3 scripts/export_knowledge_assets.py --validate # 校验链接、路径与排版
```

著作权与使用边界见 [LICENSE.md](./LICENSE.md)。
"""
    write_clean(KNOWLEDGE_DIR / "README.md", top_readme)
    ensure_library_sub_readmes()

    license_doc = """# 开源资料著作权与使用边界声明

本目录采用分层声明，确保知识分享清晰、诚实、安全：

1. **原著与课程著作权**：
   - 《天纪》（《天机道》《地脉道》《人间道》等）及《人纪》系列课程讲解、批注思想的著作权归**倪海厦先生**及其权利继承人所有。
   - 《针灸大成》（明·杨继洲著）及古代医经原典属于**公有领域（Public Domain）**。
   - 由本项目作者原创编写的知识图谱结构化卡片、专题文章、学习路径与现代化转译提示词采用 **CC BY-SA 4.0** 许可协议；网站与脚本代码采用 **MIT License**。
2. **文献原貌与非商业用途**：
   - 本目录整理的公开学习文本完整保留文献原貌，仅作去噪清洗与分章排版，**仅限个人学习、传统文化与知识工程研究使用，严禁用于任何商业售卖、付费打包或盈利性分发**。
3. **医疗与决策安全红线**：
   - 古籍原典、经典批注与课堂实录中出现的历史剂量、经方配伍、附方与灸法表述均为**文献原貌**，仅供理论与文献研习，**不构成任何个人用药指导、医疗诊断或治疗方案**。身体如有不适，请务必前往正规医疗机构咨询专业执业医师。
   - 术数与天纪分析仅作为思维框架参考，不构成医疗、投资、婚姻等重大决策的唯一依据。
4. **权利人异议下架机制**：
   - 若原著作权人或合法权利继承人认为本目录中任何整理内容存在不妥，请通过本仓库 **GitHub Issues** 提交说明，核实后将在 **7 个工作日内**彻底移除相关内容。
"""
    write_clean(KNOWLEDGE_DIR / "LICENSE.md", license_doc)


def parse_offline_site_bundle() -> dict:
    """解析 docs/data/offline-data.js 并返回其中的 JSON 对象。"""
    raw = OFFLINE_DATA_JS.read_text(encoding="utf-8")
    marker = "window.__NIHAIXIA_OFFLINE_DATA__ = "
    idx = raw.find(marker)
    if idx < 0:
        raise ValueError("docs/data/offline-data.js 缺少 window.__NIHAIXIA_OFFLINE_DATA__ 赋值")
    body = raw[idx + len(marker) :].strip()
    if body.endswith(";"):
        body = body[:-1].strip()
    body = body.replace("<\\/", "</")
    return json.loads(body)


def validate_knowledge() -> list[str]:
    errors = []
    graph = json.loads(GRAPH_JSON.read_text(encoding="utf-8"))
    prompts = json.loads(PROMPTS_JSON.read_text(encoding="utf-8"))
    nodes = graph.get("nodes", [])
    articles = graph.get("articles", [])
    expected_edges = sum(len(x.get("node_links") or []) for x in (nodes + articles))

    vault_dir = KNOWLEDGE_DIR / "01-知识图谱笔记"
    rag_dir = KNOWLEDGE_DIR / "02-AI知识库语料包"

    if not vault_dir.exists() or not rag_dir.exists():
        return ["knowledge/01-知识图谱笔记 或 02-AI知识库语料包 不存在，请先运行导出脚本"]

    # 0. 检查离线兜底数据包 docs/data/offline-data.js 与真源一致
    if not OFFLINE_DATA_JS.exists():
        errors.append("缺少离线直开数据包: docs/data/offline-data.js")
    else:
        try:
            offline = parse_offline_site_bundle()
            o_graph = offline.get("graph") or {}
            o_prompts = offline.get("prompts") or []
            if len(o_graph.get("nodes") or []) != len(nodes):
                errors.append(
                    f"offline-data.js nodes 数量不一致: 期望 {len(nodes)}，实际 {len(o_graph.get('nodes') or [])}"
                )
            if len(o_graph.get("articles") or []) != len(articles):
                errors.append(
                    f"offline-data.js articles 数量不一致: 期望 {len(articles)}，实际 {len(o_graph.get('articles') or [])}"
                )
            if len(o_prompts) != len(prompts):
                errors.append(
                    f"offline-data.js prompts 数量不一致: 期望 {len(prompts)}，实际 {len(o_prompts)}"
                )
        except Exception as exc:
            errors.append(f"offline-data.js 解析失败: {exc}")

    # 1. 收集 Obsidian Vault 中全部合法链接目标（文件 stem）
    stems = {p.stem for p in vault_dir.rglob("*.md")}
    if not (vault_dir / "00-知识图谱总览-MOC.md").exists():
        errors.append("01-知识图谱笔记 缺少无括号总览文件: 00-知识图谱总览-MOC.md")
    if not (vault_dir / "README.md").exists():
        errors.append("01-知识图谱笔记 缺少 GitHub 在线索引: README.md")
    for item in nodes + articles:
        if item["title"] not in stems:
            errors.append(f"01-知识图谱笔记 缺少条目文件: {item['title']}.md")

    for md in sorted(vault_dir.rglob("*.md")):
        content = md.read_text(encoding="utf-8")
        no_code = re.sub(r"```.*?```", "", content, flags=re.S)
        no_code = re.sub(r"`[^`\n]+`", "", no_code)
        for m in WIKILINK_RE.finditer(no_code):
            target = m.group(1).strip()
            if target not in stems:
                errors.append(f"Obsidian 死链 {md.relative_to(REPO_ROOT)}: [[{target}]]")

    # 2. 检查 JSONL 条数与 prompts 一致性
    for fname, expected_cnt in (
        ("nodes.jsonl", len(nodes)),
        ("articles.jsonl", len(articles)),
        ("edges.jsonl", expected_edges),
    ):
        fpath = rag_dir / fname
        if not fpath.exists():
            errors.append(f"缺少文件: {fpath.relative_to(REPO_ROOT)}")
            continue
        lines = [l for l in fpath.read_text(encoding="utf-8").splitlines() if l.strip()]
        if len(lines) != expected_cnt:
            errors.append(f"{fname} 行数不匹配: 期望 {expected_cnt}，实际 {len(lines)}")

    prompts_md = rag_dir / "tianji-prompts.md"
    if not prompts_md.exists():
        errors.append("缺少 02-AI知识库语料包/tianji-prompts.md")
    else:
        ptxt = prompts_md.read_text(encoding="utf-8")
        for p in prompts:
            if p["title"] not in ptxt:
                errors.append(f"tianji-prompts.md 缺少提示词: {p['title']}")

    # 2b. 检查仓库根 README 与 knowledge/ 下全部相对 Markdown 链接有效
    link_check_files = [REPO_ROOT / "README.md"] + sorted(KNOWLEDGE_DIR.rglob("*.md"))
    for md in link_check_files:
        if not md.exists():
            continue
        content = md.read_text(encoding="utf-8")
        no_code = re.sub(r"```.*?```", "", content, flags=re.S)
        for m in MD_REL_LINK_RE.finditer(no_code):
            raw_target = m.group(1).split("#", 1)[0]
            target_path = (md.parent / unquote(raw_target)).resolve()
            if not target_path.exists():
                errors.append(f"Markdown 相对死链 {md.relative_to(REPO_ROOT)}: {raw_target}")

    # 3. 扫描 knowledge/ 与 skills/ 全部文本文件质量与排版残留
    scan_roots = [KNOWLEDGE_DIR]
    skills_dir = REPO_ROOT / "skills"
    if skills_dir.exists():
        scan_roots.append(skills_dir)

    for root in scan_roots:
        for fpath in sorted(root.rglob("*")):
            if not fpath.is_file() or fpath.suffix not in (".md", ".jsonl", ".yaml", ".yml"):
                continue
            rel = fpath.relative_to(REPO_ROOT)
            raw_bytes = fpath.read_bytes()
            try:
                text = raw_bytes.decode("utf-8")
            except UnicodeDecodeError:
                errors.append(f"非 UTF-8 文件: {rel}")
                continue

            if "\r" in text:
                errors.append(f"存在 CRLF/CR 回车符: {rel}")
            if text and not text.endswith("\n"):
                errors.append(f"缺少末尾换行符: {rel}")
            for i, line in enumerate(text.splitlines(), 1):
                if line.endswith((" ", "\t")):
                    errors.append(f"行尾存在多余空白 {rel}:{i}")
                    break

            if "(" in fpath.name or ")" in fpath.name:
                errors.append(f"文件名含裸括号（易被 Markdown 解析器截断）: {rel}")

            if fpath.suffix == ".md":
                for ln, line_txt in enumerate(text.splitlines(), 1):
                    s_line = line_txt.strip()
                    if s_line.startswith("## ") and "**" in s_line:
                        if s_line.count("**") % 2 == 1:
                            errors.append(f"标题存在未闭合粗体 {rel}:{ln}: {s_line[:40]}")
                            break
                    if s_line.startswith("## ") and s_line[3:].strip() == "针炙大成":
                        errors.append(f"存在未清洗的印刷页眉 {rel}:{ln}: {s_line}")
                        break

            m_path = FORBIDDEN_PATH_RE.search(text)
            if m_path:
                errors.append(f"疑似泄露本机或内部路径 {rel}: {m_path.group(0)}")
            m_priv = FORBIDDEN_PRIVACY_RE.search(text)
            if m_priv:
                errors.append(f"疑似泄露隐私/网盘或无关第三方署名 {rel}: {m_priv.group(0)}")
            m_ocr = FORBIDDEN_OCR_RE.search(text)
            if m_ocr:
                errors.append(f"存在未清洗的 OCR/Word 残留标签 {rel}: {m_ocr.group(0)}")
            if fpath.suffix == ".md":
                m_pg = FORBIDDEN_PAGE_HEADER_RE.search(text)
                if m_pg:
                    errors.append(f"存在未清洗的印刷页码行 {rel}: {m_pg.group(0)}")
                m_dots = FORBIDDEN_TOC_DOTS_RE.search(text)
                if m_dots:
                    errors.append(f"存在未清洗的印刷目录点线 {rel}: {m_dots.group(0)[:20]}")

    # 4. 复核 docs/*.md 与 docs/sources-public/**/*.md 无个人隐私或第三方署名残留
    docs_md_targets = sorted((REPO_ROOT / "docs").glob("*.md"))
    docs_sources_dir = REPO_ROOT / "docs" / "sources-public"
    if docs_sources_dir.exists():
        docs_md_targets.extend(sorted(docs_sources_dir.rglob("*.md")))
    for fpath in docs_md_targets:
        text = fpath.read_text(encoding="utf-8", errors="ignore")
        m_priv = FORBIDDEN_PRIVACY_RE.search(text)
        if m_priv:
            errors.append(f"docs 文档疑似泄露隐私或第三方署名 {fpath.relative_to(REPO_ROOT)}: {m_priv.group(0)}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="导出与校验知识图谱开源知识库")
    parser.add_argument("--validate", action="store_true", help="仅执行质量与零死链校验")
    parser.add_argument("--raw-ima-dir", type=Path, help="可选：本地 IMA 原始整理包目录，用于刷新 03/04")
    parser.add_argument("--raw-ocr-dir", type=Path, help="可选：本地 OCR 校勘目录（含 06_中医经典与课程）")
    parser.add_argument("--sources-public-dir", type=Path, default=REPO_ROOT / "sources-public", help="可选：公开经典切分目录")
    args = parser.parse_args()

    if args.validate:
        errors = validate_knowledge()
        if errors:
            for err in errors[:30]:
                print(f"ERROR: {err}", file=sys.stderr)
            if len(errors) > 30:
                print(f"... 另有 {len(errors) - 30} 条错误", file=sys.stderr)
            return 1
        print("OK knowledge/ & skills/ validation passed (zero dangling links, clean paths/formatting)")
        return 0

    graph = json.loads(GRAPH_JSON.read_text(encoding="utf-8"))
    prompts = json.loads(PROMPTS_JSON.read_text(encoding="utf-8"))
    counts = export_graph_and_ai_packs(graph, prompts)
    export_offline_site_bundle(graph, prompts)
    write_knowledge_top_docs()
    print(f"Exported 01-知识图谱笔记, 02-AI知识库语料包 & docs/data/offline-data.js: {counts}")

    if args.raw_ima_dir and args.raw_ocr_dir:
        export_library_texts(args.raw_ima_dir, args.raw_ocr_dir, args.sources_public_dir)
        print("Exported cleaned & chaptered 03-天纪学习资料 & 04-人纪学习资料")
    elif args.raw_ima_dir or args.raw_ocr_dir:
        print("ERROR: --raw-ima-dir 与 --raw-ocr-dir 需成对传入", file=sys.stderr)
        return 2

    errors = validate_knowledge()
    if errors:
        for err in errors[:30]:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1
    print("OK validation passed after export.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
