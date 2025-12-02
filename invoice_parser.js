"use strict";

/**
 * Invoice parser for n8n Code node (JavaScript).
 *
 * Paste this file into an n8n Code node to convert raw OCR'd invoice text into
 * structured JSON. It is dependency free and mirrors the Python parser.
 */

const HEADER_SKIP = new Set([
  "CUSTOMER ORDER",
  "NUMBER",
  "DEL ADV",
  "DEL",
  "PRICE UNIT DISCOUNT TOTAL VALUE V",
  "C",
  "DESCRIPTION QTY",
  "CODE RATE% GOODS TAX",
  "TOTAL VALUE",
]);

function cleanValue(value) {
  return value.replace(/\s+/g, " ").replace(/[ \n:]+$/g, "").trim();
}

function parseMoney(value) {
  const normalized = value.replace(/,/g, "").trim();
  const num = Number.parseFloat(normalized);
  return Number.isNaN(num) ? null : num;
}

function parseHeader(lines) {
  const result = {};
  for (const line of lines) {
    if (line.startsWith("Customer Account No:")) {
      const idx = line.indexOf(":");
      if (idx !== -1) {
        result.customer_account = cleanValue(line.slice(idx + 1));
      }
    }
    if (line.startsWith("TAXPOINT/DATE:")) {
      const colonIdx = line.indexOf(":");
      const afterColon = colonIdx === -1 ? "" : line.slice(colonIdx + 1).trim();
      const parts = afterColon.split(/\s+/);
      if (parts.length > 0) {
        result.taxpoint_date = parts[0];
      }
      const match = line.match(/Doc\. Count:\s*(\d+)\s*of\s*(\d+)/);
      if (match) {
        result.doc_count = { index: Number(match[1]), total: Number(match[2]) };
      }
    }
    if (line.startsWith("INVOICE NO:")) {
      const idx = line.indexOf(":");
      if (idx !== -1) {
        result.invoice_no = cleanValue(line.slice(idx + 1));
      }
    }
  }
  return result;
}

function extractBlock(lines, startKey, endKey) {
  const block = [];
  let recording = false;
  for (const line of lines) {
    if (line === startKey) {
      recording = true;
      continue;
    }
    if (recording) {
      if (line === endKey) break;
      block.push(line);
    }
  }
  return block;
}

function findSectionIndex(lines, marker) {
  return lines.findIndex((line) => line === marker);
}

function parseAddresses(lines) {
  const invoiceAddress = extractBlock(lines, "INVOICE ADDRESS", "DELIVERY ADDRESS");
  const deliveryStart = findSectionIndex(lines, "DELIVERY ADDRESS");
  const deliveryAddress = [];
  if (deliveryStart !== -1) {
    for (let i = deliveryStart + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.startsWith("INVOICE NO:")) break;
      deliveryAddress.push(line);
    }
  }
  return {
    invoice_address: invoiceAddress.map((l) => cleanValue(l)).filter((l) => l.trim()),
    delivery_address: deliveryAddress.map((l) => cleanValue(l)).filter((l) => l.trim()),
  };
}

function isHeaderLine(line) {
  const normalized = cleanValue(line).toUpperCase();
  return HEADER_SKIP.has(normalized);
}

function parseItemValues(line) {
  const pattern = /^(\d+)\s+([0-9.]+)\s+([A-Z]+)\s+([0-9.]+)\s+([0-9.]+)\s+(\d+)/;
  const match = line.trim().match(pattern);
  if (!match) return null;
  return {
    quantity: Number(match[1]),
    unit_price: Number(match[2]),
    unit: match[3],
    discount: Number(match[4]),
    line_total: Number(match[5]),
    tax_code: Number(match[6]),
  };
}

function parseItems(lines) {
  const items = [];
  const descBuffer = [];
  let partNo = null;
  let i = 0;
  let itemsStarted = false;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
      continue;
    }
    if (line.startsWith("SUBTOTAL") || line.startsWith("CODE RATE%")) {
      break;
    }
    if (isHeaderLine(line)) {
      if (line.toUpperCase().includes("DESCRIPTION QTY")) {
        itemsStarted = true;
        descBuffer.length = 0;
      }
      i += 1;
      continue;
    }
    if (!itemsStarted) {
      i += 1;
      continue;
    }
    if (line.startsWith("Our part no.")) {
      partNo = cleanValue(line.split("Our part no.").pop() || "");
      let qtyLine = "";
      let j = i + 1;
      while (j < lines.length) {
        qtyLine = lines[j].trim();
        j += 1;
        if (qtyLine) break;
      }
      const parsedValues = parseItemValues(qtyLine);
      const description = cleanValue(descBuffer.join(" "));
      descBuffer.length = 0;
      if (parsedValues) {
        items.push({ description, part_number: partNo, ...parsedValues });
      }
      i = j;
      continue;
    }
    descBuffer.push(line);
    i += 1;
  }
  return items;
}

function parseSubtotal(lines) {
  for (const line of lines) {
    if (line.startsWith("SUBTOTAL")) {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) return parseMoney(parts[parts.length - 1]);
    }
  }
  return null;
}

function parseSummary(lines) {
  const codeIdx = findSectionIndex(lines, "CODE RATE% GOODS TAX");
  if (codeIdx === -1 || codeIdx + 1 >= lines.length) return null;
  const valuesLine = lines[codeIdx + 1].trim();
  const parts = valuesLine.split(/\s+/);
  if (parts.length < 4) return null;
  const summary = {
    code: parts[0],
    rate_percent: parseMoney(parts[1]),
    goods: parseMoney(parts[2]),
    tax: parseMoney(parts[3]),
  };
  const totalLine = lines.slice(codeIdx + 2).find((line) => line.startsWith("TOTAL TAX:"));
  if (totalLine) {
    const totalParts = totalLine.replace("TOTAL TAX:", "").trim().split(/\s+/);
    if (totalParts.length >= 3) {
      summary.total_ex_vat = parseMoney(totalParts[0]);
      summary.total_tax = parseMoney(totalParts[1]);
      summary.total_inc_vat = parseMoney(totalParts[2]);
    }
  }
  return summary;
}

function parseInvoiceText(rawText) {
  const documents = [];
  const blocks = rawText
    .split("SALES INVOICE")
    .map((block) => block.trim())
    .filter((block) => block);
  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => cleanValue(line))
      .filter((line) => line.trim());
    const header = parseHeader(lines);
    const addresses = parseAddresses(lines);
    const items = parseItems(lines);
    const subtotal = parseSubtotal(lines);
    const summary = parseSummary(lines);
    const document = {
      ...header,
      ...addresses,
      items,
    };
    if (subtotal !== null) document.subtotal = subtotal;
    if (summary) document.summary = summary;
    documents.push(document);
  }
  return documents;
}

function parseToJson(rawText) {
  return JSON.stringify(parseInvoiceText(rawText), null, 2);
}

function parseToItems(rawText) {
  return parseInvoiceText(rawText).map((doc) => ({ json: doc }));
}

if (require.main === module) {
  const fs = require("fs");
  const input = fs.readFileSync(0, "utf8");
  process.stdout.write(parseToJson(input));
}

module.exports = { parseInvoiceText, parseToJson, parseToItems };
