#!/usr/bin/env python3
"""Tests for scripts/export_knowledge_assets.py."""

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import export_knowledge_assets as exporter  # noqa: E402


class ExportKnowledgeAssetsTests(unittest.TestCase):
    def test_normalize_text_strips_trailing_whitespace_and_crlf(self):
        raw = "第一行   \r\n\r\n\r\n第二行\t \r\n"
        self.assertEqual(exporter.normalize_text(raw), "第一行\n\n第二行\n")

    def test_clean_source_section_removes_vault_wikilinks(self):
        raw = (
            "- [[倪海厦资料/中医/伤寒论/伤寒论注解B5|伤寒论注解B5]] — 太阳病篇\n"
            "- [[天机道笔记个人整理]]\n"
            "- ⚠️ `神农本草经.md` 为 0B 空文件，需重新转换"
        )
        out = exporter.clean_source_section(raw)
        self.assertIn("[伤寒论注解（节选）](../../04-人纪学习资料/经方与内经节选/伤寒论注解-节选.md) — 太阳病篇", out)
        self.assertIn("[天机道听课与盘面笔记](../../03-天纪学习资料/笔记与参考/天机道笔记.md)", out)
        self.assertNotIn("0B 空文件", out)

    def test_clean_public_lecture_text_strips_frontmatter_and_editor_notes(self):
        raw = (
            "---\ntype: raw_course_note\n---\n\n"
            "第一段原文。\n\n"
            "> 小编：第三方个人评论\n\n"
            "第二段原文。\n"
        )
        out = exporter.clean_public_lecture_text(raw)
        self.assertIn("第一段原文。", out)
        self.assertIn("第二段原文。", out)
        self.assertNotIn("小编", out)
        self.assertNotIn("raw_course_note", out)

    def test_strip_picture_wrappers_keeps_real_chart_and_drops_omitted(self):
        raw = (
            "前文\n"
            "**==> picture [42 x 14] intentionally omitted <==**\n\n"
            "**----- Start of picture text -----**<br>\n"
            "紫微旺 天厨 火星庙\n"
            "**----- End of picture text -----**<br>\n"
            "后文\n"
        )
        out = exporter.strip_picture_wrappers(raw)
        self.assertNotIn("intentionally omitted", out)
        self.assertNotIn("Start of picture text", out)
        self.assertIn("紫微旺 天厨 火星庙", out)
        self.assertIn("后文", out)

    def test_normalize_bold_parens_cleans_ocr_parentheses(self):
        raw = "坏人都开罪脱走。 **(** 二 **)** 、东宫\n## 安旬中空亡表 **(** 旬空 **)**"
        out = exporter.normalize_bold_parens(raw)
        self.assertNotIn("**(**", out)
        self.assertIn("（二）、东宫", out.replace(" （", "（").replace("） ", "）"))
        self.assertIn("（旬空）", out)

    def test_clean_renjian_dao_body_removes_running_headers_and_keeps_classic_quote(self):
        raw = (
            "## 校堪序\n民间中医爱好者\n"
            "## 自 序\n正文开始\n"
            "## **目录**\n|乾爲天|...................... 1|\n"
            "## 乾爲天\n第 5页 天行健君子以自強不息 地勢坤君子以厚德載物\n"
            "## 象曰：天行健，君子以自彊不息。\n"
        )
        out = exporter.clean_renjian_dao_body(raw)
        self.assertNotIn("校堪序", out)
        self.assertNotIn("......................", out)
        self.assertNotIn("第 5页", out)
        self.assertIn("## 象曰：天行健，君子以自彊不息。", out)

    def test_render_obsidian_item_includes_quotes_and_misconceptions(self):
        item = {
            "title": "阴阳",
            "layer": "底层框架",
            "definition": "对立统一",
            "quotes": [{"text": "阴阳不是两种东西。", "source": "人纪课堂"}],
            "misconceptions": [{"wrong": "阴阳就是好与坏", "correction": "阴阳是同一事物的两个面向。"}],
            "sections": {},
        }
        md = exporter.render_obsidian_item(item, {"阴阳"})
        self.assertIn("## 倪海厦原话", md)
        self.assertIn("> “阴阳不是两种东西。” —— 人纪课堂", md)
        self.assertIn("## 常见误区", md)
        self.assertIn("- **误区**：阴阳就是好与坏", md)
        self.assertIn("  - **正解**：阴阳是同一事物的两个面向。", md)

    def test_clean_dimai_dao_demotes_broken_ocr_headings_without_losing_text(self):
        raw = (
            "## **序 言**\n"
            "此必為\n\n## 「迷信」之人。\n\n"
            "## **一、乾為天䷀**\n"
        )
        out = exporter.clean_dimai_dao(raw)
        self.assertIn("## **序 言**", out)
        self.assertIn("## **一、乾為天䷀**", out)
        self.assertIn("「迷信」之人。", out)
        self.assertNotIn("## 「迷信」之人。", out)

    def test_clean_renjian_dao_closes_unmatched_bold_and_demotes_signature_heading(self):
        raw = (
            "## 自 序\n正文\n## 梵宇龍 八十三年九月十日\n"
            "## 乾爲天\n"
            "## 孟子學而篇： **學而不思則罔，思而不學則殆。\n"
        )
        out = exporter.clean_renjian_dao_body(raw)
        self.assertIn("梵宇龍 八十三年九月十日", out)
        self.assertNotIn("## 梵宇龍", out)
        self.assertNotIn("## 孟子學而篇", out)
        self.assertIn("**學而不思則罔，思而不學則殆。**", out)

    def test_clean_zhenjiu_dacheng_body_strips_running_headers_and_fixes_broken_headings(self):
        raw = (
            "## 针道源流\n"
            "## 针炙大成\n"
            "针炙大成 ３ ６ １\n"
            "３ １ ３\n"
            "## 壮。\n"
            "## 可浴洗毕，断脐带。便结\n"
        )
        out = exporter.clean_zhenjiu_dacheng_body(raw)
        self.assertIn("## 针道源流", out)
        self.assertNotIn("针炙大成", out)
        self.assertNotIn("３ １ ３", out)
        self.assertNotIn("## 壮。", out)
        self.assertIn("壮。", out)
        self.assertIn("可浴洗毕，断脐带。", out)
        self.assertIn("## 便结", out)

    def test_offline_bundle_and_github_vault_index_exist(self):
        offline = exporter.parse_offline_site_bundle()
        self.assertEqual(len(offline["graph"]["nodes"]), 64)
        self.assertEqual(len(offline["graph"]["articles"]), 5)
        self.assertEqual(len(offline["prompts"]), 5)
        vault_readme = (REPO_ROOT / "knowledge" / "01-知识图谱笔记" / "README.md").read_text(encoding="utf-8")
        self.assertIn("[阴阳](./02-底层框架/阴阳.md)", vault_readme)
        self.assertIn("[00-知识图谱总览-MOC.md](./00-知识图谱总览-MOC.md)", vault_readme)
        self.assertTrue((REPO_ROOT / "knowledge" / "00-倪海厦生平与三纪总览.md").exists())
        self.assertTrue((REPO_ROOT / "knowledge" / "02-AI知识库语料包" / "MANIFEST.json").exists())
        self.assertTrue((REPO_ROOT / "knowledge" / "05-公开讲座与访谈" / "README.md").exists())

    def test_validate_knowledge_passes_with_zero_errors(self):
        errors = exporter.validate_knowledge()
        self.assertEqual(errors, [], f"Unexpected knowledge validation errors: {errors[:5]}")

    def test_learning_paths_ssot_covers_all_69_items_and_resume_metrics(self):
        import json

        graph = json.loads((REPO_ROOT / "docs" / "data" / "graph.json").read_text(encoding="utf-8"))
        all_items = graph["nodes"] + graph["articles"]
        all_titles = {item["title"] for item in all_items}

        # 锁定简历口径四大核心指标：五层知识架构 · 231 项资料 · 69 个可视化节点 · 338 条关联
        self.assertEqual(len(graph["layers"]), 5)
        self.assertEqual(graph["stats"]["manifest_total"], 231)
        self.assertEqual(len(graph["nodes"]), 64)
        self.assertEqual(len(graph["articles"]), 5)
        self.assertEqual(graph["stats"]["nodes_total"], 69)
        self.assertEqual(len(all_titles), 69)
        self.assertEqual(sum(len(x.get("node_links") or []) for x in all_items), 338)

        # stats 分类之和严格等于 nodes_total
        stats = graph["stats"]
        self.assertEqual(
            stats["concept_nodes"]
            + stats["classic_course_nodes"]
            + stats["case_formula_nodes"]
            + stats["topic_articles"],
            stats["nodes_total"],
        )

        # 五层结构严格对齐，无“学习路径”孤岛层
        self.assertEqual(
            graph["layers"],
            ["底层框架", "辨证框架", "方法工具", "案例研读", "天纪体系"],
        )
        self.assertNotIn("学习路径", {n.get("layer") for n in graph["nodes"]})

        lp = graph["learning_paths"]
        covered = set()
        for key in ("renji", "tianji"):
            for stage in lp[key]["stages"]:
                covered.update(stage["nodes"])
        self.assertEqual(covered, all_titles)

        # 天纪 3·3·3 对称与边界 + 人纪第一步含《针灸大成》
        tianji_stages = {s["title"]: s["nodes"] for s in lp["tianji"]["stages"]}
        tianji_dao_nodes = next(v for k, v in tianji_stages.items() if "天机道" in k)
        dimai_dao_nodes = next(v for k, v in tianji_stages.items() if "地脉道" in k)
        renjian_dao_nodes = next(v for k, v in tianji_stages.items() if "人间道" in k)
        self.assertEqual(tianji_dao_nodes, ["天机道", "紫微斗数", "四柱命理"])
        self.assertEqual(dimai_dao_nodes, ["地脉道", "风水堪舆", "阳宅定位"])
        self.assertEqual(renjian_dao_nodes, ["人间道", "六十四卦", "以果决行"])
        renji_step1 = next(s["nodes"] for s in lp["renji"]["stages"] if "针灸大成" in s["title"])
        self.assertEqual(renji_step1, ["针灸大成", "针灸", "经络"])

        # node_links 与 upstream + downstream + related 100% 同源，0 悬空
        by_title = {item["title"]: item for item in all_items}
        for item in all_items:
            sem = set((item.get("upstream") or []) + (item.get("downstream") or []) + (item.get("related") or []))
            nl = {lk["alias"] for lk in (item.get("node_links") or [])}
            self.assertEqual(sem, nl, f"Link mismatch on {item['title']}")
            for ref in sem:
                self.assertIn(ref, by_title, f"Dangling semantic ref on {item['title']} -> {ref}")

        # 4 个重复壳节点已无损融合移除，且核心干货已吸收到主节点
        for merged_title in ("虚实", "望诊学习笔记", "扶阳学习笔记", "汉唐案例索引"):
            self.assertNotIn(merged_title, by_title)
        self.assertIn("真虚假实", by_title["寒热虚实"]["sections"]["核心理解"])
        self.assertIn("眼诊", by_title["望诊案例研读"]["sections"]["核心理解"])
        self.assertIn("眼诊", by_title["望闻问切"]["sections"]["核心理解"])
        self.assertIn("扶阳摘记", by_title["扶阳"]["sections"]["核心理解"])
        self.assertIn("方义结构讲解", by_title["临床案例索引"]["sections"]["核心理解"])

        # 关键事实纠偏断言
        self.assertNotIn("第一本经典", by_title["黄帝内经"]["definition"])
        self.assertNotIn("阳宅学", by_title["天机道"]["sections"]["核心理解"])
        for t_name in ("紫微斗数", "易经", "象数", "四柱命理"):
            self.assertNotIn("天机道终稿", by_title[t_name]["sections"]["学习路径"])
        self.assertNotIn("干预方式", by_title["针灸"]["sections"]["核心理解"])
        self.assertNotIn("干预方式", by_title["针灸"]["quotes"][0]["text"])
        self.assertNotIn("先教人纪", by_title["天人合一如何连接天纪和人纪"]["sections"]["核心理解"])
        self.assertIn("三道", by_title["天纪与人纪"]["sections"]["核心理解"])
        self.assertIn("金匮要略", by_title["天纪与人纪"]["sections"]["核心理解"])
        self.assertNotIn("0B 空文件", by_title["神农本草经"]["sections"]["原始出处"])
        self.assertNotIn("人间道", {lk["alias"] for lk in by_title["紫微斗数"]["node_links"]})
        self.assertNotIn("紫微斗数", {lk["alias"] for lk in by_title["人间道"]["node_links"]})


if __name__ == "__main__":
    unittest.main()
