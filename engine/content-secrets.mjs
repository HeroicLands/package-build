/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import crypto from "node:crypto";
import markdownit from "markdown-it";

const webMarkdown = markdownit({ html: true });

/**
 * Render whole-line `:::secret` blocks for one publishing surface.
 * The source line of each syntax error is relative to the supplied body.
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
                body.push(line);
            } else {
                opening = index;
                body = [];
            }
            continue;
        }
        if (/^:::[ \t]*$/.test(line)) {
            if (opening < 0) {
                errors.push({
                    line: index + 1,
                    column: 1,
                    message: "secret block has no opening :::secret line",
                });
                result.push(line);
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
