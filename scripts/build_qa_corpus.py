#!/usr/bin/env python3
"""Build the sanitized 11-file QA corpus used by Tencent knowledge services."""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath


GROUP_QUALITY = {
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

LOCAL_PATH_RE = re.compile(r"/Users/zeno(?:/[^\s\]\[()<>\"'，。；：、]+)+")
WIKILINK_RE = re.compile(r"!?\[\s*\[\s*(.*?)\s*\]\s*\]")
BROKEN_WIKILINK_OPEN_RE = re.compile(r"(!?)\[\s*\[")
MOBILE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
ID_CARD_RE = re.compile(r"(?<!\d)(?:\d{17}[0-9Xx]|\d{15})(?!\d)")
EMAIL_RE = re.compile(
    r"(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w.-])"
)

HIGH_RISK_PATTERNS = {
    "mobile": MOBILE_RE,
    "id_card": ID_CARD_RE,
    "email": EMAIL_RE,
    "local_path": LOCAL_PATH_RE,
}


def logical_path(match):
    path = match.group(0).removeprefix("/Users/zeno/")
    for prefix in ("AI/人生知识库/", "AI/"):
        if path.startswith(prefix):
            path = path[len(prefix) :]
            break
    return path


def readable_wikilink(match):
    inner = match.group(1).strip()
    if "|" in inner:
        _, alias = inner.rsplit("|", 1)
        return alias.strip()

    target, _, heading = inner.partition("#")
    title = PurePosixPath(target.strip()).name
    if title.lower().endswith(".md"):
        title = title[:-3]
    if heading.strip():
        return f"{title} · {heading.strip()}" if title else heading.strip()
    return title or inner


def sanitize_text(text):
    transformations = {
        "local_path": len(LOCAL_PATH_RE.findall(text)),
        "wikilink": len(WIKILINK_RE.findall(text)),
        "mobile": len(MOBILE_RE.findall(text)),
        "id_card": len(ID_CARD_RE.findall(text)),
        "email": len(EMAIL_RE.findall(text)),
    }
    text = LOCAL_PATH_RE.sub(logical_path, text)
    text = WIKILINK_RE.sub(readable_wikilink, text)
    # OCR can leave an unclosed wikilink opener even after complete links are normalized.
    transformations["wikilink"] += len(BROKEN_WIKILINK_OPEN_RE.findall(text))
    text = BROKEN_WIKILINK_OPEN_RE.sub(r"\1[", text)
    # OCR noise can leave unmatched Obsidian link delimiters after valid links are normalized.
    text = text.replace("[[", "[").replace("]]", "]")
    text = MOBILE_RE.sub("[已脱敏手机号]", text)
    text = ID_CARD_RE.sub("[已脱敏身份证号]", text)
    text = EMAIL_RE.sub("[已脱敏邮箱]", text)
    return text.replace("\r\n", "\n").replace("\r", "\n"), transformations


def scan_generated_files(files):
    findings = {
        name: {"severity": "high", "count": 0, "files": 0}
        for name in HIGH_RISK_PATTERNS
    }
    for path in files:
        content = path.read_text(encoding="utf-8")
        for name, pattern in HIGH_RISK_PATTERNS.items():
            count = len(pattern.findall(content))
            if count:
                findings[name]["count"] += count
                findings[name]["files"] += 1
    high_risk = sum(item["count"] for item in findings.values())
    return findings, high_risk


def frontmatter(group, quality, corpus_version):
    return (
        "---\n"
        f'source_group: "{group}"\n'
        f"source_quality: {quality}\n"
        "learning_use: learning_research\n"
        "medical_safety: learning_only\n"
        f'corpus_version: "{corpus_version}"\n'
        "---\n\n"
    )


def validate_inputs(input_dir):
    files = sorted(input_dir.glob("*.txt"))
    actual = {path.stem for path in files}
    expected = set(GROUP_QUALITY)
    if len(files) != 11 or actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise ValueError(
            "expected exactly 11 named TXT inputs; "
            f"missing={missing or 'none'}, extra={extra or 'none'}"
        )
    return files


def build_corpus(input_dir, output_dir, corpus_version):
    input_files = validate_inputs(input_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    generated = []
    manifest_files = []
    total_transformations = {
        "local_path": 0,
        "wikilink": 0,
        "mobile": 0,
        "id_card": 0,
        "email": 0,
    }

    for input_path in input_files:
        group = input_path.stem
        quality = GROUP_QUALITY[group]
        sanitized, transformations = sanitize_text(
            input_path.read_text(encoding="utf-8", errors="replace")
        )
        for name, count in transformations.items():
            total_transformations[name] += count

        content = frontmatter(group, quality, corpus_version) + sanitized.strip() + "\n"
        output_path = output_dir / f"{group}.md"
        output_path.write_text(content, encoding="utf-8")
        generated.append(output_path)

        payload = output_path.read_bytes()
        manifest_files.append(
            {
                "filename": output_path.name,
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "source_group": group,
                "source_quality": quality,
            }
        )

    findings, high_risk = scan_generated_files(generated)
    privacy_report = {
        "corpus_version": corpus_version,
        "scanned_files": len(generated),
        "summary": {
            "high_risk": high_risk,
            "status": "pass" if high_risk == 0 else "blocked",
        },
        "findings": findings,
        "transformations": total_transformations,
    }
    (output_dir / "privacy-report.json").write_text(
        json.dumps(privacy_report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    manifest = {
        "corpus_version": corpus_version,
        "file_count": len(manifest_files),
        "total_bytes": sum(item["bytes"] for item in manifest_files),
        "files": manifest_files,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return privacy_report


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--corpus-version", default="2026-07-10-v1")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    try:
        report = build_corpus(args.input_dir, args.output_dir, args.corpus_version)
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if report["summary"]["high_risk"]:
        print(
            "ERROR: generated corpus still contains high-risk privacy findings; "
            "see privacy-report.json",
            file=sys.stderr,
        )
        return 1

    print(
        f"Built 11 Markdown files; privacy status={report['summary']['status']}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
