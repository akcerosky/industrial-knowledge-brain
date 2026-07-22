from __future__ import annotations

import csv
import html
import json
import mailbox
import re
import shutil
import subprocess
import tempfile
from email import policy
from email.parser import BytesParser
from pathlib import Path
from typing import Any

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
TEXT_SUFFIXES = {".md", ".txt", ".svg"}
SPREADSHEET_SUFFIXES = {".csv", ".xlsx", ".xlsm"}
EMAIL_SUFFIXES = {".mbox", ".eml", ".json"}


def load_pdf(path: str | Path) -> str:
    import pdfplumber

    pdf_path = Path(path)
    with pdfplumber.open(pdf_path) as pdf:
        extracted_pages = [page.extract_text() or "" for page in pdf.pages]
    extracted_text = "\n".join(part.strip() for part in extracted_pages if part.strip())
    if extracted_text.strip():
        return extracted_text
    return _ocr_pdf(pdf_path)


def load_scanned_image(path: str | Path) -> str:
    import pytesseract
    from PIL import Image

    image_path = Path(path)
    with Image.open(image_path) as image:
        return pytesseract.image_to_string(image)


def load_spreadsheet(path: str | Path) -> list[dict[str, Any]]:
    spreadsheet_path = Path(path)
    if spreadsheet_path.suffix.lower() == ".csv":
        with spreadsheet_path.open(newline="", encoding="utf-8") as handle:
            return list(csv.DictReader(handle))

    import openpyxl

    workbook = openpyxl.load_workbook(spreadsheet_path, data_only=True)
    rows: list[dict[str, Any]] = []
    for sheet in workbook.worksheets:
        values = list(sheet.iter_rows(values_only=True))
        if not values:
            continue
        headers = [str(value).strip() if value is not None else "" for value in values[0]]
        for row in values[1:]:
            if not any(value is not None and str(value).strip() for value in row):
                continue
            rows.append({headers[index]: row[index] for index in range(min(len(headers), len(row))) if headers[index]})
    return rows


def load_email_archive(path: str | Path) -> list[dict[str, str]]:
    email_path = Path(path)
    suffix = email_path.suffix.lower()

    if suffix == ".mbox":
        archive = mailbox.mbox(email_path)
        return [_message_to_dict(message) for message in archive]

    if suffix == ".eml":
        with email_path.open("rb") as handle:
            message = BytesParser(policy=policy.default).parse(handle)
        return [_message_to_dict(message)]

    if suffix == ".json":
        payload = json.loads(email_path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return [dict(item) for item in payload]
        if isinstance(payload, dict):
            return [dict(payload)]
        raise ValueError(f"Unsupported JSON email archive shape in {email_path}")

    raise ValueError(f"Unsupported email archive format: {email_path}")


def load_text(path: str | Path) -> str:
    text_path = Path(path)
    raw_text = text_path.read_text(encoding="utf-8")
    if text_path.suffix.lower() == ".svg":
        no_tags = re.sub(r"<[^>]+>", " ", raw_text)
        return re.sub(r"\s+", " ", html.unescape(no_tags)).strip()
    return raw_text


def load_any(path: str | Path) -> tuple[str, str]:
    file_path = Path(path)
    suffix = file_path.suffix.lower()

    if suffix == ".pdf":
        doc_type, text = "pdf", load_pdf(file_path)
    elif suffix in IMAGE_SUFFIXES:
        doc_type, text = "scan", load_scanned_image(file_path)
    elif suffix in SPREADSHEET_SUFFIXES:
        rows = load_spreadsheet(file_path)
        doc_type, text = "spreadsheet", json.dumps(rows, ensure_ascii=True, indent=2, default=str)
    elif suffix in EMAIL_SUFFIXES:
        messages = load_email_archive(file_path)
        doc_type, text = "email", json.dumps(messages, ensure_ascii=True, indent=2, default=str)
    elif suffix in TEXT_SUFFIXES:
        # SVGs in this corpus are always P&ID-style diagrams, regardless of which
        # folder they land in (e.g. a freshly uploaded file goes to data/uploads/,
        # not a folder named "pids") — classify by extension too, not just path,
        # so PIDVisionExtractor still triggers for uploaded diagrams.
        is_pid = suffix == ".svg" or "pid" in file_path.parts or "pids" in file_path.parts
        doc_type, text = ("pid" if is_pid else "text"), load_text(file_path)
    else:
        raise ValueError(f"Unsupported file format: {file_path}")

    # Postgres text/JSONB columns reject NUL bytes outright; PDF/OCR extraction
    # occasionally embeds them as artifacts, which would otherwise crash every
    # downstream write (staging, graph merge, vector index).
    return doc_type, text.replace("\x00", "")


def _ocr_pdf(path: Path) -> str:
    import pytesseract
    from PIL import Image

    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        return ""

    with tempfile.TemporaryDirectory() as temp_dir:
        output_prefix = Path(temp_dir) / "page"
        subprocess.run(
            [pdftoppm, "-png", str(path), str(output_prefix)],
            check=True,
            capture_output=True,
            text=True,
        )
        text_parts: list[str] = []
        for image_path in sorted(Path(temp_dir).glob("page-*.png")):
            with Image.open(image_path) as image:
                text_parts.append(pytesseract.image_to_string(image))
    return "\n".join(part.strip() for part in text_parts if part.strip())


def _message_to_dict(message: Any) -> dict[str, str]:
    body = ""
    if message.is_multipart():
        for part in message.walk():
            if part.get_content_type() == "text/plain":
                body = part.get_content()
                break
    else:
        body = message.get_content()

    return {
        "subject": str(message.get("subject", "")),
        "sender": str(message.get("from", "")),
        "date": str(message.get("date", "")),
        "body": body,
    }
