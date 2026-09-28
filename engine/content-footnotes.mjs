/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * Separate top-level footnote definitions from prose while retaining line numbers.
 * Definitions belong to the note and can be used by any rendered page.
 * @param {string} source - Authored Markdown.
 * @returns {{markdown: string, definitions: string}} Body with blanked definitions and their source.
 */
export function separateFootnotes(source) {
    const lines = String(source ?? "").split("\n");
    const body = [...lines];
    const definitions = [];
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
        const marker = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
        if (fence) {
            if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length)
                fence = null;
            continue;
        }
        if (marker) {
            fence = marker[1];
            continue;
        }
        if (!/^\[\^[^\]\s]+\]:/.test(lines[i])) continue;
        const start = i;
        i++;
        while (i < lines.length && (!lines[i].trim() || /^(?: {4}|\t)/.test(lines[i]))) i++;
        definitions.push(lines.slice(start, i).join("\n").trimEnd());
        for (let at = start; at < i; at++) body[at] = "";
        i--;
    }
    return { markdown: body.join("\n"), definitions: definitions.join("\n\n") };
}
