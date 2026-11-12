/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Resource references and comments in a public SVG drawing. @module */

/** Accept a fragment or an absolute HTTP(S) resource without publishing local paths. */
export function checkSvgResource(value) {
    const uri = value.trim();
    if (uri === "" || uri.startsWith("#")) return;
    if (/^https?:\/\//i.test(uri)) {
        try {
            const parsed = new URL(uri);
            if ((parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname)
                return;
        } catch {
            // The resource is refused below.
        }
    }
    throw new Error(
        "SVG derivative resource references must be fragments or absolute HTTP(S) URLs; embedded data and local paths are not supported",
    );
}

/** Decode one CSS escape, advancing past its optional terminating whitespace. */
function cssEscape(text, at) {
    let end = at + 1;
    if (end >= text.length) return { end, value: "" };
    if (text[end] === "\n" || text[end] === "\f") return { end: end + 1, value: "" };
    if (text[end] === "\r") return { end: end + (text[end + 1] === "\n" ? 2 : 1), value: "" };
    let hex = "";
    while (end < text.length && hex.length < 6 && /[0-9a-f]/i.test(text[end])) hex += text[end++];
    if (!hex) return { end: end + 1, value: text[end] };
    if (/\s/.test(text[end] ?? "")) {
        if (text[end] === "\r" && text[end + 1] === "\n") end++;
        end++;
    }
    const point = parseInt(hex, 16);
    return {
        end,
        value:
            point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff) ?
                "\ufffd"
            :   String.fromCodePoint(point),
    };
}

/** Read a CSS identifier with decoded escapes. */
function cssIdentifier(text, at) {
    let end = at;
    let value = "";
    while (end < text.length) {
        if (text[end] === "\\") {
            const escaped = cssEscape(text, end);
            value += escaped.value;
            end = escaped.end;
        } else if (/[\w-]/u.test(text[end]) || text.codePointAt(end) >= 0x80) {
            value += text[end++];
        } else break;
    }
    return { end, value };
}

/** Read a quoted CSS string, preserving its source and decoding escapes for URI checks. */
function cssString(text, at) {
    const quote = text[at];
    let end = at + 1;
    let value = "";
    while (end < text.length && text[end] !== quote) {
        if (text[end] === "\\") {
            const escaped = cssEscape(text, end);
            value += escaped.value;
            end = escaped.end;
        } else value += text[end++];
    }
    return { end: end < text.length ? end + 1 : end, value };
}

/** Replace comment contents with empty CSS token separators. */
function stripCssComments(text) {
    let out = "";
    let at = 0;
    while (at < text.length) {
        if (text[at] === '"' || text[at] === "'") {
            const quoted = cssString(text, at);
            out += text.slice(at, quoted.end);
            at = quoted.end;
        } else if (text.startsWith("/*", at)) {
            const end = text.indexOf("*/", at + 2);
            out += "/**/";
            at = end < 0 ? text.length : end + 2;
        } else if (/[a-z_-]/i.test(text[at]) || text[at] === "\\" || text.codePointAt(at) >= 0x80) {
            const ident = cssIdentifier(text, at);
            const begin = at;
            at = ident.end;
            if (ident.value.toLowerCase() === "url" && text[at] === "(") {
                let next = at + 1;
                while (/\s/.test(text[next] ?? "")) next++;
                if (text[next] !== '"' && text[next] !== "'") {
                    at = next;
                    while (at < text.length && text[at] !== ")") {
                        at = text[at] === "\\" ? cssEscape(text, at).end : at + 1;
                    }
                    if (text[at] === ")") at++;
                }
            }
            out += text.slice(begin, at);
        } else out += text[at++];
    }
    return out;
}

/**
 * Redact CSS comment contents and check resource references without changing tokens.
 *
 * @param {string} text - CSS stylesheet, declaration list or presentation value.
 * @returns {string} The CSS with empty comment separators.
 */
export function cleanSvgCss(text) {
    text = stripCssComments(text);
    let out = "";
    let at = 0;
    let importPending = false;
    const functions = [];
    while (at < text.length) {
        if (text.startsWith("/**/", at)) {
            out += "/**/";
            at += 4;
            continue;
        }
        const c = text[at];
        if (c === '"' || c === "'") {
            const quoted = cssString(text, at);
            const imageContext = functions.findLastIndex((name) =>
                ["image", "image-set", "-webkit-image-set"].includes(name),
            );
            const typeContext = functions.findLastIndex((name) => name === "type");
            if (importPending || (imageContext >= 0 && typeContext < imageContext)) {
                checkSvgResource(quoted.value);
            }
            out += text.slice(at, quoted.end);
            at = quoted.end;
            importPending = false;
            continue;
        }
        if (c === "@") {
            const ident = cssIdentifier(text, at + 1);
            importPending = ident.value.toLowerCase() === "import";
            out += text.slice(at, ident.end);
            at = ident.end;
            continue;
        }
        if (/[a-z_-]/i.test(c) || c === "\\" || c.codePointAt(0) >= 0x80) {
            const ident = cssIdentifier(text, at);
            const start = at;
            at = ident.end;
            let functionStart = at;
            while (/\s/.test(text[functionStart] ?? "")) functionStart++;
            if (ident.value.toLowerCase() === "url" && text[functionStart] === "(") {
                at = functionStart + 1;
                while (/\s/.test(text[at] ?? "")) at++;
                let value = "";
                if (text[at] === '"' || text[at] === "'") {
                    const quoted = cssString(text, at);
                    value = quoted.value;
                    at = quoted.end;
                    while (at < text.length) {
                        if (/\s/.test(text[at])) at++;
                        else if (text.startsWith("/**/", at)) at += 4;
                        else break;
                    }
                } else {
                    while (at < text.length && text[at] !== ")") {
                        if (text[at] === "\\") {
                            const escaped = cssEscape(text, at);
                            value += escaped.value;
                            at = escaped.end;
                        } else value += text[at++];
                    }
                }
                checkSvgResource(value);
                if (text[at] === ")") at++;
                out += text.slice(start, at);
                importPending = false;
            } else {
                out += text.slice(start, at);
                if (text[at] === "(") {
                    functions.push(ident.value.toLowerCase());
                    out += text[at++];
                }
            }
            continue;
        }
        if (c === "(") functions.push("");
        else if (c === ")") functions.pop();
        if (!/\s/.test(c)) importPending = false;
        out += c;
        at++;
    }
    return out;
}
