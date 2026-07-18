import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build_qa_corpus.py"

GROUPS = [
    "01_知识卡片",
    "02_主题文章",
    "03_经文原文-公开版",
    "04_经文原文-完整版",
    "05_汉唐方剂讲解",
    "06_补充资料",
    "07_天纪资料",
    "08_补充课程",
    "09_中医原始资料",
    "10_课程字幕",
    "11_玄学体系",
]

EXPECTED_QUALITY = {
    "01_知识卡片": "core",
    "02_主题文章": "core",
    "03_经文原文-公开版": "verified",
    "04_经文原文-完整版": "verified",
    "05_汉唐方剂讲解": "verified",
    "06_补充资料": "verified",
    "07_天纪资料": "verified",
    "08_补充课程": "reference",
    "09_中医原始资料": "reference",
    "10_课程字幕": "verified",
    "11_玄学体系": "verified",
}


class CorpusBuilderTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.base = Path(self.tempdir.name)
        self.input_dir = self.base / "input"
        self.output_dir = self.base / "output"
        self.input_dir.mkdir()
        for group in GROUPS:
            body = f"# {group}\n\n来源：/Users/zeno/AI/倪海厦-IMA上传包/{group}\n\n[[资料/核心概念|核心概念]]"
            (self.input_dir / f"{group}.txt").write_text(body, encoding="utf-8")

    def tearDown(self):
        self.tempdir.cleanup()

    def run_builder(self):
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--input-dir",
                str(self.input_dir),
                "--output-dir",
                str(self.output_dir),
                "--corpus-version",
                "test-v1",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_builds_eleven_markdown_files_with_metadata_and_manifest(self):
        result = self.run_builder()
        self.assertEqual(result.returncode, 0, result.stderr)

        markdown_files = sorted(self.output_dir.glob("*.md"))
        self.assertEqual(len(markdown_files), 11)
        manifest = json.loads((self.output_dir / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["file_count"], 11)
        self.assertEqual(len(manifest["files"]), 11)

        for item in manifest["files"]:
            output_file = self.output_dir / item["filename"]
            group = output_file.stem
            content = output_file.read_text(encoding="utf-8")
            self.assertIn(f'source_group: "{group}"', content)
            self.assertIn(f"source_quality: {EXPECTED_QUALITY[group]}", content)
            self.assertIn("learning_use: learning_research", content)
            self.assertIn("medical_safety: learning_only", content)
            self.assertIn('corpus_version: "test-v1"', content)
            self.assertEqual(item["bytes"], output_file.stat().st_size)
            self.assertEqual(item["sha256"], hashlib.sha256(output_file.read_bytes()).hexdigest())
            self.assertEqual(item["source_quality"], EXPECTED_QUALITY[group])

    def test_sanitizes_paths_wikilinks_and_personal_identifiers_without_echoing_them(self):
        secret_phone = "13812345678"
        sample = self.input_dir / "01_知识卡片.txt"
        sample.write_text(
            "# 测试\n\n/Users/zeno/AI/人生知识库/资料/测试.md\n"
            "[[资料/阴阳|阴阳]] ![[资料/五行.md]]\n"
            f"联系方式：{secret_phone}\n",
            encoding="utf-8",
        )

        result = self.run_builder()
        self.assertEqual(result.returncode, 0, result.stderr)
        content = (self.output_dir / "01_知识卡片.md").read_text(encoding="utf-8")
        report_text = (self.output_dir / "privacy-report.json").read_text(encoding="utf-8")
        report = json.loads(report_text)

        self.assertNotIn("/Users/zeno", content)
        self.assertNotIn("[[", content)
        self.assertIn("阴阳", content)
        self.assertIn("五行", content)
        self.assertNotIn(secret_phone, content + report_text + result.stdout + result.stderr)
        self.assertIn("[已脱敏手机号]", content)
        self.assertEqual(report["summary"]["high_risk"], 0)
        self.assertGreaterEqual(report["transformations"]["local_path"], 1)
        self.assertGreaterEqual(report["transformations"]["mobile"], 1)

    def test_sanitizes_wikilinks_with_whitespace_between_opening_brackets(self):
        sample = self.input_dir / "03_经文原文-公开版.txt"
        sample.write_text(
            "# 测试\n\n[ [资料/伤寒论.md|伤寒论]]\n",
            encoding="utf-8",
        )

        result = self.run_builder()
        self.assertEqual(result.returncode, 0, result.stderr)
        content = (self.output_dir / "03_经文原文-公开版.md").read_text(encoding="utf-8")

        self.assertNotIn("[ [", content)
        self.assertIn("伤寒论", content)

    def test_sanitizes_spaced_wikilinks_with_brackets_inside_the_target(self):
        sample = self.input_dir / "03_经文原文-公开版.txt"
        sample.write_text(
            "# 测试\n\n[ [DSR] | 伤寒论]]\n",
            encoding="utf-8",
        )

        result = self.run_builder()
        self.assertEqual(result.returncode, 0, result.stderr)
        content = (self.output_dir / "03_经文原文-公开版.md").read_text(encoding="utf-8")

        self.assertNotIn("[ [", content)
        self.assertIn("伤寒论", content)

    def test_normalizes_unclosed_spaced_wikilink_fragments(self):
        sample = self.input_dir / "09_中医原始资料.txt"
        sample.write_text(
            "# 测试\n\n[ [DSR] | 伤寒论]\n",
            encoding="utf-8",
        )

        result = self.run_builder()
        self.assertEqual(result.returncode, 0, result.stderr)
        content = (self.output_dir / "09_中医原始资料.md").read_text(encoding="utf-8")

        self.assertNotIn("[ [", content)
        self.assertIn("伤寒论", content)

    def test_missing_or_extra_input_groups_are_rejected(self):
        (self.input_dir / "11_玄学体系.txt").unlink()
        result = self.run_builder()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("expected exactly 11", result.stderr.lower())

    def test_main_returns_nonzero_when_generated_output_still_has_high_risk_hits(self):
        if not SCRIPT.exists():
            self.fail(f"missing production script: {SCRIPT}")
        spec = importlib.util.spec_from_file_location("build_qa_corpus", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        unsafe_report = {
            "summary": {"high_risk": 1},
            "findings": {"mobile": {"count": 1, "files": 1}},
            "transformations": {},
        }
        with mock.patch.object(module, "build_corpus", return_value=unsafe_report):
            exit_code = module.main(
                [
                    "--input-dir",
                    str(self.input_dir),
                    "--output-dir",
                    str(self.output_dir),
                ]
            )
        self.assertNotEqual(exit_code, 0)

    def test_redacts_contextual_patient_names_but_preserves_historical_figures(self):
        sample = self.input_dir / "05_汉唐方剂讲解.txt"
        sample.write_text(
            "# 测试\n\n"
            "患者：张三来诊，主诉头痛。\n"
            "倪海厦在讲解中提到张仲景的伤寒论。\n"
            "姓名：李四五，家属：王五。\n",
            encoding="utf-8",
        )

        result = self.run_builder()
        self.assertEqual(result.returncode, 0, result.stderr)
        content = (self.output_dir / "05_汉唐方剂讲解.md").read_text(encoding="utf-8")
        report = json.loads(
            (self.output_dir / "privacy-report.json").read_text(encoding="utf-8")
        )

        # Patient names should be redacted
        self.assertNotIn("张三", content)
        self.assertNotIn("李四五", content)
        self.assertNotIn("王五", content)
        self.assertIn("[已脱敏姓名]", content)
        # Historical figures should be preserved
        self.assertIn("倪海厦", content)
        self.assertIn("张仲景", content)
        self.assertIn("伤寒论", content)
        self.assertGreaterEqual(report["transformations"]["name_label"], 3)

    def test_redacts_medical_record_numbers(self):
        sample = self.input_dir / "09_中医原始资料.txt"
        sample.write_text(
            "# 测试\n\n"
            "病历号：BL2023123456\n"
            "住院号: ZY-2023-001\n"
            "门诊号：MZ001\n"
            "第1234号方剂不在脱敏范围\n",
            encoding="utf-8",
        )

        result = self.run_builder()
        self.assertEqual(result.returncode, 0, result.stderr)
        content = (self.output_dir / "09_中医原始资料.md").read_text(encoding="utf-8")

        self.assertNotIn("BL2023123456", content)
        self.assertNotIn("ZY-2023-001", content)
        self.assertIn("[已脱敏病历号]", content)
        # "第1234号方剂" should not be redacted (no medical record label)
        self.assertIn("第1234号方剂", content)

    def test_redacts_structured_addresses(self):
        sample = self.input_dir / "06_补充资料.txt"
        sample.write_text(
            "# 测试\n\n"
            "广东省广州市天河区天河北路123号\n"
            "北京市海淀区中关村大街1号\n"
            "地址：上海市浦东新区张江路100号\n"
            "太阳经主一身之表\n",
            encoding="utf-8",
        )

        result = self.run_builder()
        self.assertEqual(result.returncode, 0, result.stderr)
        content = (self.output_dir / "06_补充资料.md").read_text(encoding="utf-8")

        self.assertNotIn("天河北路123号", content)
        self.assertNotIn("中关村大街1号", content)
        self.assertNotIn("张江路100号", content)
        self.assertIn("[已脱敏地址]", content)
        # Classical TCM content should not be affected
        self.assertIn("太阳经主一身之表", content)

    def test_scans_medical_institutions_as_medium_risk(self):
        sample = self.input_dir / "08_补充课程.txt"
        sample.write_text(
            "# 测试\n\n"
            "某患者在广州市中医院就诊。\n"
            "同仁堂诊所也有记录。\n",
            encoding="utf-8",
        )

        result = self.run_builder()
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(
            (self.output_dir / "privacy-report.json").read_text(encoding="utf-8")
        )

        # Medical institutions are medium risk (scan-only, not auto-redacted)
        self.assertGreaterEqual(report["summary"]["medium_risk"], 2)
        self.assertEqual(report["summary"]["high_risk"], 0)
        self.assertEqual(report["summary"]["status"], "pass")
        self.assertGreaterEqual(
            report["findings"]["medical_institution"]["count"], 2
        )


if __name__ == "__main__":
    unittest.main()
