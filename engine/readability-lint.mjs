/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Optional Markdown prose analysis with source positions preserved. */
import fs from "node:fs";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkRetext from "remark-retext";
import retextEnglish from "retext-english";
import retextReadability from "retext-readability";
import retextSimplify from "retext-simplify";
import retextStringify from "retext-stringify";
import { flesch } from "flesch";
import { syllable } from "syllable";
import { daleChall } from "dale-chall";

const FAMILIAR_WORDS = new Set(daleChall);
const NOMINALIZATION = /(?:tion|sion|ment|ness|ity|ance|ence|ism)$/i;

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
    return source
        .replace(/!?\[\[[^\]\n]+\]\]|\{\{[^}\n]+\}\}/g, (match) => match.replace(/[^\n]/g, " "))
        .replace(/^:::sql[^\n]*\n[\s\S]*?^:::[ \t]*$/gm, (match) => match.replace(/[^\n]/g, " "))
        .replace(/^:::[^\n]*$/gm, (match) => match.replace(/[^\n]/g, " "));
}

/** Select complete paragraphs while keeping their original source positions. */
function proseTree(source) {
    const processor = unified().use(remarkParse).use(remarkFrontmatter).use(remarkGfm);
    const tree = processor.parse(maskMarkup(source));
    const keepInline = (node) => {
        if (
            ["inlineCode", "image", "imageReference", "html", "footnoteReference"].includes(
                node.type,
            )
        ) {
            return false;
        }
        if (node.children) node.children = node.children.filter(keepInline);
        return true;
    };
    const paragraphs = [];
    const collect = (node) => {
        if (node.type === "paragraph") paragraphs.push(node);
        else if (node.type === "blockquote")
            for (const child of node.children ?? []) collect(child);
    };
    for (const node of tree.children) collect(node);
    tree.children = paragraphs;
    for (const paragraph of tree.children)
        paragraph.children = paragraph.children.filter(keepInline);
    return tree;
}

/** Count readable body words, including headings and lists, for score coverage. */
function bodyWordCount(source) {
    const tree = unified()
        .use(remarkParse)
        .use(remarkFrontmatter)
        .use(remarkGfm)
        .parse(maskMarkup(source));
    const visit = (node) => {
        if (
            ["yaml", "code", "table", "html", "inlineCode", "image", "imageReference"].includes(
                node.type,
            )
        ) {
            return 0;
        }
        if (node.type === "text")
            return (node.value.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
        return (node.children ?? []).reduce((sum, child) => sum + visit(child), 0);
    };
    return visit(tree);
}

/** Bridge selected Markdown paragraphs to retext for lint and scoring. */
async function retextProse(file, source, options = {}, inspect) {
    const virtualFile = { value: maskMarkup(source), path: file, messages: [] };
    const analysis = unified().use(retextEnglish);
    if (options.rules !== "simplify" && options.rules !== "none") {
        analysis.use(retextReadability, {
            age: options.age ?? 21,
            threshold: (options.threshold ?? 5) / 7,
            minWords: options.minWords ?? 8,
        });
    }
    if (options.rules === "simplify" || options.rules === "all") analysis.use(retextSimplify);
    if (inspect) analysis.use(() => (tree) => inspect(tree));
    analysis.use(retextStringify);
    await unified().use(remarkRetext, analysis).run(proseTree(source), virtualFile);
    return virtualFile.messages;
}

/** Source-aligned findings for one Markdown note. */
export async function analyzeProse(file, source, options = {}) {
    const messages = await retextProse(file, source, options);
    return messages.map((message) => {
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

/** Concatenate the text leaves in a retext word. */
function wordText(node) {
    return node.value ?? (node.children ?? []).map(wordText).join("");
}

/** Count the words and syllables in one retext sentence. */
function sentenceCounts(sentence) {
    const words = [];
    const visit = (node) => {
        if (node.type === "WordNode") words.push(wordText(node));
        else for (const child of node.children ?? []) visit(child);
    };
    visit(sentence);
    return {
        words: words.length,
        syllables: words.reduce((sum, word) => sum + syllable(word), 0),
        unfamiliar: words.filter((word) => !FAMILIAR_WORDS.has(word.toLowerCase())).length,
        nominalizations: words.filter((word) => NOMINALIZATION.test(word)).length,
    };
}

/** Score the complete prose paragraphs in one note. */
export async function scoreProse(file, source, { minWords = 80, bands = {} } = {}) {
    const sentences = [];
    await retextProse(file, source, { rules: "none" }, (tree) => {
        const visit = (node) => {
            if (node.type === "SentenceNode") sentences.push(sentenceCounts(node));
            else for (const child of node.children ?? []) visit(child);
        };
        visit(tree);
    });
    const totals = sentences.reduce(
        (sum, sentence) => ({
            words: sum.words + sentence.words,
            syllables: sum.syllables + sentence.syllables,
            unfamiliar: sum.unfamiliar + sentence.unfamiliar,
            nominalizations: sum.nominalizations + sentence.nominalizations,
        }),
        { words: 0, syllables: 0, unfamiliar: 0, nominalizations: 0 },
    );
    const longestSentenceWords = Math.max(0, ...sentences.map((sentence) => sentence.words));
    const count = sentences.filter((sentence) => sentence.words > 0).length;
    const metrics =
        count && totals.words ?
            {
                flesch: flesch({ sentence: count, word: totals.words, syllable: totals.syllables }),
                syllablesPerWord: totals.syllables / totals.words,
                meanSentenceWords: totals.words / count,
                longestSentenceWords,
                unfamiliarWordPercent: (100 * totals.unfamiliar) / totals.words,
                nominalizationsPer1000Words: (1000 * totals.nominalizations) / totals.words,
            }
        :   null;
    const insufficient = totals.words < minWords;
    const violations = [];
    if (!insufficient) {
        for (const [metric, band] of Object.entries(bands)) {
            if (band.min !== undefined && metrics[metric] < band.min) {
                violations.push(`${metric} below ${band.min}`);
            }
            if (band.max !== undefined && metrics[metric] > band.max) {
                violations.push(`${metric} above ${band.max}`);
            }
        }
    }
    const bodyWords = bodyWordCount(source);
    return {
        file,
        ...totals,
        bodyWords,
        coveragePercent: bodyWords ? (100 * totals.words) / bodyWords : 0,
        sentences: count,
        longestSentenceWords,
        metrics,
        insufficient,
        violations,
    };
}

/** Score a note or content tree and pool counts for its aggregate. */
export async function scoreProseTree(root, options, skipDirectories = []) {
    const notes = [];
    for (const file of proseFiles(root, skipDirectories)) {
        notes.push(await scoreProse(file, fs.readFileSync(file, "utf8"), options));
    }
    const scored = notes.filter((note) => !note.insufficient);
    const totals = scored.reduce(
        (sum, note) => ({
            words: sum.words + note.words,
            syllables: sum.syllables + note.syllables,
            sentences: sum.sentences + note.sentences,
            unfamiliar: sum.unfamiliar + note.unfamiliar,
            nominalizations: sum.nominalizations + note.nominalizations,
        }),
        { words: 0, syllables: 0, sentences: 0, unfamiliar: 0, nominalizations: 0 },
    );
    return {
        notes,
        summary: {
            ...totals,
            scored: scored.length,
            insufficient: notes.length - scored.length,
            outside: scored.filter((note) => note.violations.length).length,
            flesch:
                totals.words && totals.sentences ?
                    flesch({
                        sentence: totals.sentences,
                        word: totals.words,
                        syllable: totals.syllables,
                    })
                :   null,
        },
    };
}
