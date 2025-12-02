"""
Invoice parser for n8n Code node.

This module turns raw OCR'd invoice text into structured JSON. It is written
without external dependencies so it can be copied directly into an n8n Python
Code node.
"""

import json
import re
from typing import Any, Dict, List, Optional


HEADER_SKIP = {
    "CUSTOMER ORDER",
    "NUMBER",
    "DEL ADV",
    "DEL",
    "PRICE UNIT DISCOUNT TOTAL VALUE V",
    "C",
    "DESCRIPTION QTY",
    "CODE RATE% GOODS TAX",
    "TOTAL VALUE",
}


def _clean_value(value: str) -> str:
    """Normalize whitespace and strip trailing punctuation."""
    return re.sub(r"\s+", " ", value).strip(" \n:")


def _parse_money(value: str) -> Optional[float]:
    value = value.replace(",", "").strip()
    try:
        return float(value)
    except ValueError:
        return None


def _parse_header(lines: List[str]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for line in lines:
        if line.startswith("Customer Account No:"):
            result["customer_account"] = _clean_value(line.split(":", 1)[1])
        if line.startswith("TAXPOINT/DATE:"):
            parts = line.split(":", 1)[1].strip().split()
            if parts:
                result["taxpoint_date"] = parts[0]
            match = re.search(r"Doc\. Count:\s*(\d+)\s*of\s*(\d+)", line)
            if match:
                result["doc_count"] = {
                    "index": int(match.group(1)),
                    "total": int(match.group(2)),
                }
        if line.startswith("INVOICE NO:"):
            result["invoice_no"] = _clean_value(line.split(":", 1)[1])
    return result


def _extract_block(lines: List[str], start_key: str, end_key: str) -> List[str]:
    block: List[str] = []
    recording = False
    for line in lines:
        if line == start_key:
            recording = True
            continue
        if recording:
            if line == end_key:
                break
            block.append(line)
    return block


def _find_section_index(lines: List[str], marker: str) -> int:
    for idx, line in enumerate(lines):
        if line == marker:
            return idx
    return -1


def _parse_addresses(lines: List[str]) -> Dict[str, List[str]]:
    invoice_address = _extract_block(lines, "INVOICE ADDRESS", "DELIVERY ADDRESS")
    delivery_start = _find_section_index(lines, "DELIVERY ADDRESS")
    delivery_address: List[str] = []
    if delivery_start != -1:
        for line in lines[delivery_start + 1 :]:
            if line.startswith("INVOICE NO:"):
                break
            delivery_address.append(line)
    return {
        "invoice_address": [_clean_value(l) for l in invoice_address if l.strip()],
        "delivery_address": [_clean_value(l) for l in delivery_address if l.strip()],
    }


def _is_header_line(line: str) -> bool:
    normalized = _clean_value(line).upper()
    return normalized in HEADER_SKIP


def _parse_item_values(line: str) -> Optional[Dict[str, Any]]:
    pattern = r"^(\d+)\s+([0-9.]+)\s+([A-Z]+)\s+([0-9.]+)\s+([0-9.]+)\s+(\d+)"
    match = re.match(pattern, line.strip())
    if not match:
        return None
    return {
        "quantity": int(match.group(1)),
        "unit_price": float(match.group(2)),
        "unit": match.group(3),
        "discount": float(match.group(4)),
        "line_total": float(match.group(5)),
        "tax_code": match.group(6),
    }


def _parse_items(lines: List[str]) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    desc_buffer: List[str] = []
    part_no: Optional[str] = None
    i = 0
    items_started = False
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith("SUBTOTAL") or line.startswith("CODE RATE%"):
            break
        if _is_header_line(line):
            if "DESCRIPTION QTY" in line.upper():
                items_started = True
                desc_buffer.clear()
            i += 1
            continue
        if not items_started:
            i += 1
            continue
        if line.startswith("Our part no."):
            part_no = _clean_value(line.split("Our part no.", 1)[1])
            # find quantity line
            qty_line = ""
            j = i + 1
            while j < len(lines):
                qty_line = lines[j].strip()
                j += 1
                if qty_line:
                    break
            parsed_values = _parse_item_values(qty_line)
            description = _clean_value(" ".join(desc_buffer))
            desc_buffer.clear()
            if parsed_values:
                item = {
                    "description": description,
                    "part_number": part_no,
                    **parsed_values,
                }
                items.append(item)
            i = j
            continue
        desc_buffer.append(line)
        i += 1
    return items


def _parse_subtotal(lines: List[str]) -> Optional[float]:
    for line in lines:
        if line.startswith("SUBTOTAL"):
            parts = line.split()
            if len(parts) >= 2:
                return _parse_money(parts[-1])
    return None


def _parse_summary(lines: List[str]) -> Optional[Dict[str, Any]]:
    code_line_idx = _find_section_index(lines, "CODE RATE% GOODS TAX")
    if code_line_idx == -1:
        return None
    if code_line_idx + 1 >= len(lines):
        return None
    values_line = lines[code_line_idx + 1].strip()
    parts = values_line.split()
    if len(parts) < 4:
        return None
    summary = {
        "code": parts[0],
        "rate_percent": _parse_money(parts[1]),
        "goods": _parse_money(parts[2]),
        "tax": _parse_money(parts[3]),
    }
    total_line = None
    for line in lines[code_line_idx + 2 :]:
        if line.startswith("TOTAL TAX:"):
            total_line = line
            break
    if total_line:
        total_parts = total_line.replace("TOTAL TAX:", "").split()
        if len(total_parts) >= 3:
            summary["total_ex_vat"] = _parse_money(total_parts[0])
            summary["total_tax"] = _parse_money(total_parts[1])
            summary["total_inc_vat"] = _parse_money(total_parts[2])
    return summary


def parse_invoice_text(raw_text: str) -> List[Dict[str, Any]]:
    """
    Parse the supplied invoice text into a list of document dictionaries.
    This function is dependency free and safe to paste into an n8n Code node.
    """
    documents: List[Dict[str, Any]] = []
    blocks = [block.strip() for block in raw_text.split("SALES INVOICE") if block.strip()]
    for block in blocks:
        lines = [_clean_value(line) for line in block.splitlines() if line.strip()]
        header = _parse_header(lines)
        addresses = _parse_addresses(lines)
        items = _parse_items(lines)
        subtotal = _parse_subtotal(lines)
        summary = _parse_summary(lines)
        document: Dict[str, Any] = {
            **header,
            **addresses,
            "items": items,
        }
        if subtotal is not None:
            document["subtotal"] = subtotal
        if summary:
            document["summary"] = summary
        documents.append(document)
    return documents


def parse_to_json(raw_text: str) -> str:
    """Helper for n8n: returns a JSON string."""
    return json.dumps(parse_invoice_text(raw_text), indent=2)


def parse_to_items(raw_text: str) -> List[Dict[str, Any]]:
    """
    Helper for n8n: wraps each parsed document in the shape `{"json": ...}`
    that Code nodes expect when returning multiple items.
    """

    return [{"json": doc} for doc in parse_invoice_text(raw_text)]


if __name__ == "__main__":
    import sys

    if sys.stdin.isatty():
        print("Paste or pipe invoice text into stdin.")
    input_text = sys.stdin.read()
    print(parse_to_json(input_text))
