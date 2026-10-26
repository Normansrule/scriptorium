"""Insert blocks into a book.json without reformatting the rest of the file.

The sample books keep one short block per line, which a JSON round-trip would expand. This edits
the text in place instead: it finds the block (or the section's layer) by walking the JSON with a
string-aware scanner, then splices in the new block, written on one line in the same style.

    from book_insert import insert_after, append_to_layer
    text = insert_after(text, "fig-energy", {...})
    text = append_to_layer(text, "sec-energy", "limits", {...})
"""

import json


def _spans(text):
    """(start, end) of every JSON object and array, string-aware; end is inclusive."""
    out, stack, i, n = [], [], 0, len(text)
    while i < n:
        c = text[i]
        if c == '"':
            i += 1
            while text[i] != '"':
                i += 2 if text[i] == "\\" else 1
        elif c in "{[":
            stack.append(i)
        elif c in "}]":
            out.append((stack.pop(), i))
        i += 1
    return out


def _one_line(block):
    s = json.dumps(block, ensure_ascii=False, separators=(", ", ": "))
    # the house style puts spaces inside one-line object braces
    return _pad(s)


def _pad(s):
    out, i, depth_str = [], 0, False
    while i < len(s):
        c = s[i]
        if c == '"':
            j = i + 1
            while s[j] != '"':
                j += 2 if s[j] == "\\" else 1
            out.append(s[i : j + 1])
            i = j + 1
            continue
        if c == "{" and i + 1 < len(s) and s[i + 1] != "}":
            out.append("{ ")
        elif c == "}" and i > 0 and s[i - 1] != "{":
            out.append(" }")
        else:
            out.append(c)
        i += 1
    return "".join(out)


def _indent_of(text, pos):
    line_start = text.rfind("\n", 0, pos) + 1
    return text[line_start : line_start + len(text[line_start:]) - len(text[line_start:].lstrip())]


def _find_object(text, key, value):
    for a, b in _spans(text):
        if text[a] != "{":
            continue
        chunk = text[a : b + 1]
        if f'"{key}": "{value}"' not in chunk:
            continue
        try:
            if json.loads(chunk).get(key) == value:
                return a, b
        except json.JSONDecodeError:
            pass
    raise KeyError(value)


def insert_after(text, block_id, block):
    a, b = _find_object(text, "id", block_id)
    ind = _indent_of(text, a)
    return text[: b + 1] + ",\n" + ind + _one_line(block) + text[b + 1 :]


def append_to_layer(text, section_id, layer, block):
    sa, sb = _find_object(text, "id", section_id)
    key = f'"{layer}": ['
    k = text.index(key, sa, sb) + len(key) - 1
    end = next(b for a, b in _spans(text) if a == k)
    body = text[k + 1 : end]
    ind = _indent_of(text, k) + "  "
    if body.strip():
        tail = body.rstrip()
        return text[: k + 1] + tail + ",\n" + ind + _one_line(block) + "\n" + _indent_of(text, end) + text[end:]
    return text[: k + 1] + "\n" + ind + _one_line(block) + "\n" + _indent_of(text, k) + text[end:]


def insert_before(text, block_id, block):
    a, _ = _find_object(text, "id", block_id)
    ind = _indent_of(text, a)
    return text[:a] + _one_line(block) + ",\n" + ind + text[a:]
