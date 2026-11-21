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
        raw = "- [[倪海厦资料/中医/伤寒论/伤寒论注解B5|伤寒论注解B5]] — 太阳病篇\n- [[天机道笔记个人整理]]"
        self.assertEqual(
            exporter.clean_source_section(raw),
            "- 伤寒论注解B5 — 太阳病篇\n- 天机道听课与盘面笔记",
        )

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

    def test_validate_knowledge_passes_with_zero_errors(self):
        errors = exporter.validate_knowledge()
        self.assertEqual(errors, [], f"Unexpected knowledge validation errors: {errors[:5]}")


if __name__ == "__main__":
    unittest.main()
