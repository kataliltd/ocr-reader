"use strict";

/**
 * Delivery note parser for n8n Code nodes (JavaScript).
 *
 * Paste this file into an n8n Code node to convert raw OCR'd delivery note text into
 * structured JSON. It is dependency-free and uses heuristics to pull out the delivery
 * note number, account, depot, print timestamp, and line items.
 */

function clean(line) {
  return line.replace(/\s+/g, " ").trim();
}

function normalizeLines(rawText) {
  return rawText
    .split(/\r?\n/)
    .map((line) => clean(line))
    .filter((line) => line.length > 0);
}

function parseHeader(lines) {
  const header = {};
  for (const line of lines) {
    if (!header.delivery_note_no) {
      const m = line.match(/\bIMS[-\s]*([0-9A-Za-z]+)/i);
      if (m) header.delivery_note_no = `IMS-${m[1].toUpperCase()}`;
    }
    if (!header.account_no) {
      const acc = line.match(/\bWE\s*([0-9]{3,})/i);
      if (acc) header.account_no = `WE${acc[1]}`;
    }
    if (!header.depot) {
      const depot = line.match(/Depot\s+(\S+)/i);
      if (depot) header.depot = depot[1];
    }
    if (!header.customer_name) {
      const isCustomer = /FASTENERS|LIMITED/i.test(line) || /ACCOUNT\*\*\*/i.test(line);
      if (isCustomer) header.customer_name = line;
    }
    if (!header.printed_at) {
      const printed = line.match(/Printed\s+(.+)/i);
      if (printed) header.printed_at = printed[1];
    }
  }
  return header;
}

function isCodeLine(line) {
  return /^[A-Z]{2}\d{2}-\d+/i.test(line.trim());
}

function extractBranchBin(text) {
  const token = text.split(/\s+/).find((part) => /WSF\d+/i.test(part));
  return token || null;
}

function extractQuantity(text) {
  const m = text.match(/(^|\s)(\d+(?:\.\d+)?)(?=\s|$)/);
  return m ? Number.parseFloat(m[2]) : null;
}

function extractPartNumber(text) {
  const m = text.match(/\b[A-Z]{2,}[0-9][A-Z0-9-]*/);
  if (!m) return null;
  const value = m[0];
  if (/WSF\d+/i.test(value)) return null;
  return value;
}

function parseItems(lines) {
  const items = [];
  let inTable = false;
  let current = null;

  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;

    if (!inTable && /(Part\s+No|Code|Qtv|Qty)\b/i.test(line) && /Description/i.test(line)) {
      inTable = true;
      continue;
    }

    // Some OCR captures miss the header row entirely. If we see a line code,
    // treat it as the start of the items table so we still capture the rows.
    if (!inTable && isCodeLine(line)) {
      inTable = true;
    }

    if (!inTable) continue;
    if (/Signature/i.test(line) || /shortages/i.test(line)) break;

    if (isCodeLine(line)) {
      if (current && Object.keys(current).length > 0) {
        current.description = (current.description_lines || []).join(" ").trim() || null;
        delete current.description_lines;
        items.push(current);
      }
      current = { code: line };
      continue;
    }

    if (!current) current = {};

    const qty = extractQuantity(line);
    const part = extractPartNumber(line);
    const bin = extractBranchBin(line);

    if (qty !== null && current.quantity == null) current.quantity = qty;
    if (part && !current.part_number) current.part_number = part;
    if (bin && !current.branch_bin) current.branch_bin = bin;

    current.description_lines = current.description_lines || [];
    current.description_lines.push(line);
  }

  if (current && Object.keys(current).length > 0) {
    current.description = (current.description_lines || []).join(" ").trim() || null;
    delete current.description_lines;
    items.push(current);
  }

  return items;
}

function parseDeliveryNotes(rawText) {
  const documents = [];
  const blocks = rawText
    .split(/DELIVERY\s+ADVICE\s+NOTE/i)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  for (const block of blocks) {
    const lines = normalizeLines(block);
    if (lines.length === 0) continue;
    const header = parseHeader(lines);
    const items = parseItems(lines);
    documents.push({ ...header, items });
  }
  return documents;
}

function parseToJson(rawText) {
  return JSON.stringify(parseDeliveryNotes(rawText), null, 2);
}

function parseToItems(rawText) {
  return parseDeliveryNotes(rawText).map((doc) => ({ json: doc }));
}

if (require.main === module) {
  const fs = require("fs");
  const input = fs.readFileSync(0, "utf8");
  process.stdout.write(parseToJson(input));
}

module.exports = { parseDeliveryNotes, parseToJson, parseToItems };
