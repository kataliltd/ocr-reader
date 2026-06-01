# ocr-reader

This repository contains a standalone Python parser that can be pasted into an
n8n Code node to turn OCR'd invoice text into structured JSON. The parser makes
no use of external dependencies.

Usage from the command line:

```bash
python invoice_parser.py < raw_invoice.txt
```

Within n8n, paste the contents of `invoice_parser.py` into a Python Code node
and call either `parse_to_json(raw_text)` (for a stringified payload) or
`parse_to_items(raw_text)` (for proper n8n items). For example, if your OCR
text arrives in a field named `ocrText` on the incoming item, add something
like the following to the node:

```python
# `ocrText` is whatever key holds your raw invoice string
# Replace "ocrText" with the key that holds your incoming text
# (this is the exact spot to put your input string)
raw_text = $json.get("ocrText", "")

# For a single JSON string (e.g., when you plan to parse downstream):
json_string = parse_to_json(raw_text)

# For a proper n8n return value, wrap each document as an item:
return parse_to_items(raw_text)
```

`raw_text` just needs to be a plain string containing the entire invoice body,
including newlines.

## JavaScript (n8n Code node)

If you prefer the JavaScript Code node, paste `invoice_parser.js` and use the
same incoming field. Swap `"ocrText"` for your field name on the line that
pulls in the raw string:

```javascript
// Replace "ocrText" with the key that holds your incoming text
const rawText = $json.ocrText ?? "";

// For a single JSON string
const jsonString = parseToJson(rawText);

// For a proper n8n return value (one item per document)
return parseToItems(rawText);
```

Both parsers share the same output shape and are dependency free.

## Delivery note parser (JavaScript)

For delivery advice notes, paste `delivery_parser.js` into a JavaScript Code
node. Point `rawText` at the incoming field that contains the delivery note
string and return the parsed items:

```javascript
// Replace "deliveryText" with the key that holds your raw delivery note text
const rawText = $json.deliveryText ?? "";

// For a single JSON string (useful for logging)
const jsonString = parseToJson(rawText);

// For proper n8n items (one per delivery note)
return parseToItems(rawText);
```

You can also run it locally from the command line:

```bash
node delivery_parser.js < raw_delivery_note.txt
```
## Solar PV payback calculator

`index.html` is a standalone, client-ready solar PV payback calculator. Open it
in any browser, enter usable roof area and annual electricity bill, and it will
show an indicative system size, install cost, yearly savings, and simple payback
period. The page has no build step or third-party dependencies, so it can be
kept as a backup demo file or sent directly to clients.

