/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import crypto from "node:crypto";
import markdownit from "markdown-it";
import footnotePlugin from "markdown-it-footnote";
import deflistPlugin from "markdown-it-deflist";

const webMarkdown = markdownit({ html: true }).use(footnotePlugin).use(deflistPlugin);

/** A `:::` on its own line, which closes whichever block is innermost. */
const CLOSER = /^:::[ \t]*$/;

/** A `:::` naming a block, which opens one — `:::secret`, `:::info {#id}`. */
const OPENER = /^:::\S/;

/**
 * Render whole-line `:::secret` blocks for one publishing surface.
 * The source line of each syntax error is relative to the supplied body.
 *
 * **A `:::` is not assumed to be a secret's.** This pass runs first, before the
 * admonition and caption passes, so every `:::info`, `:::warn` and `:::caption`
 * in the note is still open when it reads them — and their closing `:::` lines
 * with them. Claiming each of those would report an error on correct markup and
 * fail the build, which is why the block a closer belongs to is tracked rather
 * than guessed: a closer is attributed to the innermost block still open, and
 * one belonging to another construct passes through untouched for the pass that
 * owns it.
 *
 * A `:::` with nothing open at all is still a finding, because nothing else
 * reports one — the admonition scanner ignores a closer it did not open, which
 * is correct for it and leaves this pass the only reader that can say so.
 *
 * @param {string} source - Markdown containing secret blocks.
 * @param {"foundry"|"web"|"book"} target - Publishing surface.
 * @param {(markdown: string) => string} [renderMarkdown] - Foundry's configured renderer.
 * @returns {{markdown: string, errors: Array<{line: number, column: number, message: string}>}}
 */
export function renderSecretBlocks(
    source,
    target,
    renderMarkdown = webMarkdown.render.bind(webMarkdown),
) {
    const lines = String(source ?? "").split("\n");
    const result = [];
    const errors = [];
    let opening = -1;
    let body = [];
    let codeFence = null;
    // Blocks of some other construct that are open, counted on the side of the
    // secret they are open on, so a closer is matched to the block it closes.
    let nested = 0;
    let outside = 0;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (codeFence) {
            if (fence && fence[1][0] === codeFence[0] && fence[1].length >= codeFence.length) {
                codeFence = null;
            }
            if (opening >= 0) body.push(line);
            else result.push(line);
            continue;
        }
        if (fence) {
            codeFence = fence[1];
            if (opening >= 0) body.push(line);
            else result.push(line);
            continue;
        }
        if (/^:::secret[ \t]*$/.test(line)) {
            if (opening >= 0) {
                errors.push({
                    line: index + 1,
                    column: 1,
                    message: "nested secret blocks are not supported",
                });
                // Not counted, unlike another construct's opener below. A
                // nested secret has already been reported, and counting it
                // would leave the outer block looking unclosed as well — two
                // findings for one mistake, both answered by the same edit.
                body.push(line);
            } else {
                opening = index;
                body = [];
            }
            continue;
        }
        // Another construct's opener. Counted, not claimed: the pass that owns
        // it reads it from the markdown this one passes through.
        if (OPENER.test(line)) {
            if (opening >= 0) {
                nested += 1;
                body.push(line);
            } else {
                outside += 1;
                result.push(line);
            }
            continue;
        }
        if (CLOSER.test(line)) {
            if (opening < 0) {
                if (outside > 0) {
                    outside -= 1;
                    result.push(line);
                    continue;
                }
                errors.push({
                    line: index + 1,
                    column: 1,
                    message:
                        "a ::: line here closes no block — open one above it with " +
                        ":::secret, :::info, :::warn or :::caption",
                });
                result.push(line);
                continue;
            }
            if (nested > 0) {
                nested -= 1;
                body.push(line);
                continue;
            }
            const inner = body.join("\n").trim();
            if (target === "book") {
                result.push("", "**GM note**", "", inner, "");
            } else {
                const html = renderMarkdown(inner).trim();
                if (target === "foundry") {
                    const id = crypto
                        .createHash("sha256")
                        .update(`${opening}:${inner}`)
                        .digest("hex")
                        .slice(0, 12);
                    result.push(
                        "",
                        `<section class="secret" id="secret-${id}">`,
                        html,
                        "</section>",
                        "",
                    );
                } else {
                    result.push("", "<details><summary>Spoiler</summary>", html, "</details>", "");
                }
            }
            opening = -1;
            body = [];
            continue;
        }
        if (opening >= 0) body.push(line);
        else result.push(line);
    }
    if (opening >= 0) {
        errors.push({
            line: opening + 1,
            column: 1,
            message: "secret block needs a closing ::: line",
        });
        result.push(":::secret", ...body);
    }
    return { markdown: result.join("\n"), errors };
}
