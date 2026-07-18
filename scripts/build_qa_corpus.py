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

# Contextual personal-name redaction: only redact names that follow an explicit
# label, to avoid stripping legitimate historical figures (倪海厦, 张仲景, etc.).
# Pattern matches the label plus the following 2-4 Chinese characters.
NAME_LABEL_RE = re.compile(
    r"(患者|病人|患名|姓名|名字|家属|联系人|就诊人|主诉人|主诉患者|首诊患者)"
    r"[：:\s]+"
    r"([\u4e00-\u9fa5]{2,4})"
)

# Medical record numbers — only redact when explicit label is present.
MEDICAL_RECORD_RE = re.compile(
    r"(病历号|住院号|门诊号|档案号|病案号|就诊号|保健号|医保号|社保号|卡号)"
    r"[：:\s]*"
    r"([A-Za-z0-9\-]{4,30})"
)

# Full structured Chinese addresses (province + city + road + number).
# Conservative: requires a province-level prefix to avoid false positives in
# classical TCM texts where words like 路/方 may appear frequently.
# Combines municipality (直辖市) and province patterns via alternation.
ADDRESS_FULL_RE = re.compile(
    r"(?:"
    r"(?:北京|上海|天津|重庆)(?:市)?"
    r"[\u4e00-\u9fa5]{0,10}(?:区|县)"
    r"|"
    r"[\u4e00-\u9fa5]{2,6}(?:省|自治区|特别行政区)"
    r"[\u4e00-\u9fa5]{1,10}(?:市|地区|盟|自治州)"
    r"[\u4e00-\u9fa5]{0,10}(?:区|县|旗|市)?"
    r")"
    r"[\u4e00-\u9fa5]{0,30}(?:路|街|巷|弄|村|镇|乡|大道|大街)"
    r"[\u4e00-\u9fa5\d]{0,20}"
    r"(?:号|室|楼|栋|单元)?"
    r"[\d\-]*"
)

# Contextual address redaction: only when an explicit label precedes the value.
ADDRESS_LABEL_RE = re.compile(
    r"(地址|住址|家庭住址|现住址|联系地址|通讯地址|居住地)"
    r"[：:\s]+"
    r"([^\n，。；！？,;:!?\u4e00-\u9fa5]{0,5}[\u4e00-\u9fa5\d]{4,80})"
)

# Modern medical institutions — scan-only (severity medium), since legitimate
# TCM teaching materials may reference historical/educational institutions.
MEDICAL_INSTITUTION_RE = re.compile(
    r"[\u4e00-\u9fa5]{2,15}(?:医院|卫生院|门诊部|诊所|中医馆|国医馆|医馆|疗养院|康复中心)"
)

HIGH_RISK_PATTERNS = {
    "mobile": MOBILE_RE,
    "id_card": ID_CARD_RE,
    "email": EMAIL_RE,
    "local_path": LOCAL_PATH_RE,
    "medical_record": MEDICAL_RECORD_RE,
    "address_full": ADDRESS_FULL_RE,
    "address_label": ADDRESS_LABEL_RE,
}

MEDIUM_RISK_PATTERNS = {
    "name_label": NAME_LABEL_RE,
    "medical_institution": MEDICAL_INSTITUTION_RE,
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
        "name_label": len(NAME_LABEL_RE.findall(text)),
        "medical_record": len(MEDICAL_RECORD_RE.findall(text)),
        "address_full": len(ADDRESS_FULL_RE.findall(text)),
        "address_label": len(ADDRESS_LABEL_RE.findall(text)),
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
    # Contextual name redaction: keep the label, redact only the name value.
    text = NAME_LABEL_RE.sub(r"\1：[已脱敏姓名]", text)
    # Medical record numbers: keep the label, redact the number.
    text = MEDICAL_RECORD_RE.sub(r"\1：[已脱敏病历号]", text)
    # Structured addresses: redact the entire matched address.
    text = ADDRESS_FULL_RE.sub("[已脱敏地址]", text)
    # Contextual address redaction: keep the label, redact the value.
    text = ADDRESS_LABEL_RE.sub(r"\1：[已脱敏地址]", text)
    return text.replace("\r\n", "\n").replace("\r", "\n"), transformations


REDACTION_MARKER_RE = re.compile(r"\[已脱敏[^\]]*\]")


def scan_generated_files(files):
    findings = {
        name: {"severity": "high", "count": 0, "files": 0}
        for name in HIGH_RISK_PATTERNS
    }
    findings.update(
        {
            name: {"severity": "medium", "count": 0, "files": 0}
            for name in MEDIUM_RISK_PATTERNS
        }
    )
    all_patterns = {**HIGH_RISK_PATTERNS, **MEDIUM_RISK_PATTERNS}
    for path in files:
        content = path.read_text(encoding="utf-8")
        # Strip redaction markers before scanning so patterns don't match
        # their own output (e.g., "地址：[已脱敏地址]" would otherwise
        # re-trigger the address_label pattern).
        scan_content = REDACTION_MARKER_RE.sub("", content)
        for name, pattern in all_patterns.items():
            count = len(pattern.findall(scan_content))
            if count:
                findings[name]["count"] += count
                findings[name]["files"] += 1
    high_risk = sum(
        item["count"] for item in findings.values() if item["severity"] == "high"
    )
    medium_risk = sum(
        item["count"] for item in findings.values() if item["severity"] == "medium"
    )
    return findings, high_risk, medium_risk


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
        "name_label": 0,
        "medical_record": 0,
        "address_full": 0,
        "address_label": 0,
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

    findings, high_risk, medium_risk = scan_generated_files(generated)
    privacy_report = {
        "corpus_version": corpus_version,
        "scanned_files": len(generated),
        "summary": {
            "high_risk": high_risk,
            "medium_risk": medium_risk,
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
