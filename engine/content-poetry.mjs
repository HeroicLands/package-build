/* SPDX-License-Identifier: GPL-3.0-or-later */

/** The authored verse lines, excluding stanza separators. */
export function verseLines(body) {
    return String(body ?? "")
        .split("\n")
        .filter((line) => line.trim());
}

/**
 * The least-indented verse is level zero. Every two additional leading spaces
 * add one level; a leftover space is discarded and the level stops at eight.
 * Blank lines divide stanzas rather than contributing to the baseline.
 */
export function poetryStanzas(body) {
    const lines = String(body ?? "").split("\n");
    const verses = verseLines(body);
    if (!verses.length) return [];
    const baseline = Math.min(...verses.map((line) => /^ */.exec(line)[0].length));
    const stanzas = [];
    let stanza = [];
    for (const line of lines) {
        if (!line.trim()) {
            if (stanza.length) stanzas.push(stanza);
            stanza = [];
            continue;
        }
        const spaces = /^ */.exec(line)[0].length;
        stanza.push({
            text: line.slice(spaces).trimEnd(),
            level: Math.min(8, Math.floor((spaces - baseline) / 2)),
        });
    }
    if (stanza.length) stanzas.push(stanza);
    return stanzas;
}

/** A verse is inline Markdown even when it starts with block syntax. */
export function inlineVerse(text) {
    return String(text)
        .replace(/^(#{1,6}\s|>\s|[-+*]\s|:{1,2}\s|`{3,}|~{3,}|-{3,}\s*$)/, "\\$1")
        .replace(/^(\d+)([.)])\s/, "$1\\$2 ");
}

/**
 * Keep stanzas as Markdown paragraphs and make every verse line a hard break.
 * The surrounding renderer still sees the entire note, so links and footnote
 * definitions remain in scope. The span carries the indent for each line.
 */
export function poetryMarkdown(body) {
    return poetryStanzas(body)
        .map((stanza) =>
            stanza
                .map(
                    ({ text, level }) =>
                        `<span class="poetry-line${level ? ` i${level}` : ""}">${inlineVerse(text)}</span>`,
                )
                .join("  \n"),
        )
        .join("\n\n");
}
