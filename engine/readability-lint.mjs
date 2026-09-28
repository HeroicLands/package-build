/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Optional Markdown prose analysis with source positions preserved. */
import fs from "node:fs";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkRetext from "remark-retext";
import retextEnglish from "retext-english";
import retextReadability from "retext-readability";
import retextSimplify from "retext-simplify";
import retextStringify from "retext-stringify";

/** Files in a content tree, excluding configured directory names. */
export function proseFiles(root, skipDirectories = []) {
    if (fs.statSync(root).isFile()) return [root];
    const files = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory() && !skipDirectories.includes(entry.name)) walk(file);
            else if (entry.isFile() && entry.name.endsWith(".md")) files.push(file);
        }
    };
    walk(root);
    return files.sort();
}

/** Keep source offsets while excluding HeroicLands inline addresses and expressions. */
function maskMarkup(source) {
    return source.replace(/!?\[\[[^\]\n]+\]\]|\{\{[^}\n]+\}\}/g, (match) =>
        match.replace(/[^\n]/g, " "),
    );
}

/** Source-aligned findings for one Markdown note. */
export async function analyzeProse(file, source, { age = 21, threshold = 5, minWords = 8 } = {}) {
    const text = maskMarkup(source);
    const virtualFile = { value: text, path: file, messages: [] };
    const processor = unified()
        .use(remarkParse)
        .use(remarkFrontmatter)
        .use(
            remarkRetext,
            unified()
                .use(retextEnglish)
                .use(retextReadability, { age, threshold: threshold / 7, minWords })
                .use(retextSimplify)
                .use(retextStringify),
        );
    await processor.run(processor.parse(virtualFile), virtualFile);
    return virtualFile.messages.map((message) => {
        const position = message.place?.start;
        const sentence = message.ancestors?.find((node) => node.type === "SentenceNode");
        const span = sentence?.position;
        const offending =
            span?.start?.offset !== undefined && span?.end?.offset !== undefined ?
                source.slice(span.start.offset, span.end.offset)
            :   (message.actual ?? "");
        const match = /according to (\d+) out of 7 algorithms/.exec(message.reason);
        const confidence =
            match ? `${match[1]}/7`
            : message.source === "retext-readability" && /all 7 algorithms/.test(message.reason) ?
                "7/7"
            :   "unscored";
        return {
            file,
            line: position?.line,
            column: position?.column,
            severity: "warning",
            message: `${message.source}/${message.ruleId}: confidence=${confidence}; sentence=${JSON.stringify(offending.trim())}; expected=${JSON.stringify(message.expected ?? [])}; ${message.reason}`,
        };
    });
}

/** Analyze one note or the configured corpus without changing source files. */
export async function lintProse(root, options, skipDirectories = []) {
    const findings = [];
    for (const file of proseFiles(root, skipDirectories)) {
        findings.push(...(await analyzeProse(file, fs.readFileSync(file, "utf8"), options)));
    }
    return findings;
}
