/* SPDX-License-Identifier: GPL-3.0-or-later */

/** The authored verse lines, excluding stanza separators. */
export function verseLines(body) {
    return String(body ?? "")
        .split("\n")
        .filter((line) => line.trim());
}

/**
 * Keep stanzas as Markdown paragraphs and make every verse line a hard break.
 * The surrounding renderer still sees the entire note, so links and footnote
 * definitions remain in scope.
 */
export function poetryMarkdown(body) {
    return String(body ?? "")
        .trim()
        .split(/\n(?:[ \t]*\n)+/)
        .map((stanza) =>
            stanza
                .split("\n")
                .map((line) =>
                    line
                        .trim()
                        // A verse line is inline Markdown, even when its first
                        // words look like a heading, list, quote, or code fence.
                        .replace(/^(#{1,6}\s|>\s|[-+*]\s|:{1,2}\s|`{3,}|~{3,}|-{3,}\s*$)/, "\\$1")
                        .replace(/^(\d+)([.)])\s/, "$1\\$2 "),
                )
                .join("  \n"),
        )
        .join("\n\n");
}
