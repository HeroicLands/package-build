/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * An image saying how wide it is and where it sits.
 *
 * A markdown image carries no indication of either, so each of the three
 * surfaces decides for itself and the author — who is the one who knows — has
 * no way to say. A directive in the curly-attribute convention Pandoc and
 * Kramdown use closes that:
 *
 *     ![Brànwâal Dôrgaar](images/beings/branwldrgr-portrait.webp){float: top-left}
 *     ![Map of Thalorna](images/map.webp){.full-width}
 *
 * ## Two closed vocabularies, and closed is the point
 *
 * **Width is a class**, and the ordinary width carries no marker at all — the
 * simple case needs no spelling. {@link IMAGE_CLASSES} holds the one class
 * there is. **Position is `float:`**, and {@link IMAGE_FLOATS} holds the five
 * values it takes.
 *
 * Both are closed, and an unrecognised value is **refused with a located
 * diagnostic** rather than ignored. Ignoring is the failure worth preventing:
 * `{.fullwidth}` rendering as an ordinary image looks exactly like a directive
 * that worked, so the author publishes a page that is not the one they asked
 * for and nothing says a word.
 *
 * ## No dimensions, and no general attribute plugin
 *
 * **No pixel values.** A number means something in a browser and nothing
 * coherent in print, and a directive carrying both a class and a dimension
 * gives one question two answers with no rule for which wins. A third width
 * joins the vocabulary as a name.
 *
 * **Not `markdown-it-attrs`.** It is a general attribute injector: it will set
 * `style`, `id` or `onclick`, and those reach emitted markup on the website and
 * inside Foundry journal content. This package holds that data is never
 * compiled into markup, so the rule here accepts a closed vocabulary on images
 * alone, carries no injection surface, and can refuse what it does not know.
 * The only author-supplied text that reaches markup is the address and the alt
 * text, both escaped, and the address is held to {@link imageSourceProblem}'s
 * schemes.
 *
 * ## An image is a block
 *
 * A directive states a width and a position, and neither means anything applied
 * to a word in the middle of a sentence. So an image stands alone in its
 * paragraph, every surface renders it as a figure, and an image sharing its
 * paragraph with prose is reported. That is also what lets the three renderers
 * agree: a figure is a block on all three, and nothing has to decide what a
 * floated run of text inside a paragraph would mean.
 *
 * **The alt text is the caption.** Print has no `alt` attribute and has to put
 * those words somewhere visible; rather than one surface showing them and two
 * hiding them, every surface draws them under the picture, and the HTML
 * surfaces carry them as `alt` as well.
 *
 * ## Where the address resolves
 *
 * An address is a pathname, and follows the one rule every pathname follows —
 * see {@link module:engine/pathnames}. The note states which package owns the
 * file, and each surface derives the address it serves: Foundry the path inside
 * the install, the website one on the asset host, the book a staged copy.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { matchAllOutsideCode } from "./code-fences.mjs";
import { positionInBody } from "./diagnostics.mjs";
import { foundryAddressProblem, pathnameProblem, servesFoundry } from "./pathnames.mjs";

/**
 * The width classes an image may carry, and what each means to a renderer.
 *
 * **The ordinary width is absent from this table on purpose.** It is what an
 * image with no marker gets, and giving it a name would invite a note to write
 * it — two spellings of one thing, one of which every existing note omits.
 *
 * `scope` is Typst's: a float placed with `scope: "parent"` spans every column
 * of the page, and one placed with `scope: "column"` occupies the column it
 * sits in. The book is set in one column, where the two measure the same, and
 * stays correct when it is set in two.
 *
 * `class` is the class the HTML surfaces put on the `<figure>`. Named rather
 * than reused from the authored spelling so a bare `full-width` in some other
 * stylesheet cannot claim it.
 *
 * @type {Readonly<Record<string, {class: string, scope: string, describe: string}>>}
 */
export const IMAGE_CLASSES = Object.freeze({
    "full-width": {
        class: "note-image-full-width",
        scope: "parent",
        describe: "the full page in the book, and the full content width elsewhere",
    },
});

/**
 * The `float:` positions an image may take, and where each puts it.
 *
 * `align` is the Typst alignment the float is placed at. **Print cannot wrap
 * text around an arbitrary shape**: a Typst float occupies the column measure,
 * so the horizontal half of a position has no effect on the page and only the
 * vertical half — top of the column, or bottom of it — does. The website and a
 * Foundry journal get true CSS wrap from the same directive. Same statement,
 * different fidelity, which is stated in the specification rather than left for
 * a reader to discover by comparing two outputs.
 *
 * @type {Readonly<Record<string, {class: string, align: string, describe: string}>>}
 */
export const IMAGE_FLOATS = Object.freeze({
    "top-left": {
        class: "note-image-float-top-left",
        align: "top + left",
        describe: "the top left of the text it sits in",
    },
    "bottom-left": {
        class: "note-image-float-bottom-left",
        align: "bottom + left",
        describe: "the bottom left of the text it sits in",
    },
    "top-right": {
        class: "note-image-float-top-right",
        align: "top + right",
        describe: "the top right of the text it sits in",
    },
    "bottom-right": {
        class: "note-image-float-bottom-right",
        align: "bottom + right",
        describe: "the bottom right of the text it sits in",
    },
    center: {
        class: "note-image-float-center",
        align: "top + center",
        describe: "the middle of the measure, with no text beside it",
    },
});

/**
 * The class every figure carries, whatever its width or position.
 *
 * One hook a stylesheet can reach every authored image through, so the two
 * vocabularies stay about what differs between images rather than what they
 * share.
 *
 * @type {string}
 */
export const IMAGE_FIGURE_CLASS = "note-image";

/**
 * A markdown image, with the directive it may carry.
 *
 * The alt text admits no `]`, and the address no whitespace or `)`, which is
 * the shape markdown-it itself accepts for the common case and the only shape
 * this format asks anyone to write. A title — `![alt](src "title")` — is
 * matched so it can be reported rather than silently dropped.
 *
 * The directive is `{…}` immediately after the closing parenthesis, holding no
 * newline: a brace that opens and never closes on its line is prose, not a
 * directive, and reading on to the next paragraph to find its `}` would make
 * one stray character swallow a page.
 *
 * @type {RegExp}
 */
export const IMAGE_PATTERN = /!\[([^\]\n]*)\]\(\s*([^\s)]*)(?:\s+"([^"\n]*)")?\s*\)(\{[^}\n]*\})?/g;

/** The URI schemes an address may carry. Anything else is not an image. */
const IMAGE_SCHEMES = Object.freeze(["http:", "https:"]);

/**
 * What is wrong with an image's address, or `""` when nothing is.
 *
 * The address is the one piece of author-supplied text that has to reach an
 * `src` attribute, so it is the one piece that has to be held to a shape. A
 * scheme this does not name — `javascript:`, `data:`, `vbscript:` — is refused
 * rather than escaped, because escaping makes it inert markup and this makes it
 * a finding the author can act on.
 *
 * @param {string} src - The address, exactly as authored.
 * @returns {string} The problem, as a finding's sentence, or `""`.
 */
export function imageSourceProblem(src) {
    const s = String(src ?? "").trim();
    if (!s) return "names no file — an image with no address shows nothing on any surface";
    if (/[\s<>"']/.test(s)) {
        return (
            `\`${s}\` is not an address — an image's address carries no whitespace, ` +
            "angle bracket or quote"
        );
    }
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
    if (scheme && !IMAGE_SCHEMES.includes(scheme[0].toLowerCase())) {
        return (
            `\`${scheme[0]}\` is not an address this format serves — an image is ` +
            `${IMAGE_SCHEMES.join(" or ")} or a path inside a package`
        );
    }
    return "";
}

/**
 * Read the directive on an image.
 *
 * Values are validated here rather than at the point of rendering, so a mistake
 * is one finding with a position rather than three surfaces quietly drawing
 * something else. A directive that holds a problem yields **no** class and no
 * float: a half-honoured directive is the silent failure in a smaller costume.
 *
 * @param {string} [raw] - The text between the braces, braces included or not.
 * @returns {{classes: string[], float: string, problems: string[]}} What was
 *   written, and what cannot be honoured.
 */
export function parseImageDirective(raw) {
    /** @type {string[]} */
    const classes = [];
    let float = "";
    /** @type {string[]} */
    const problems = [];

    const inner = String(raw ?? "")
        .replace(/^\{/, "")
        .replace(/\}$/, "");
    if (!inner.trim()) return { classes, float, problems };

    // Split on commas, not whitespace: `float: top-left` is one pair with a
    // space in it, and the space after the colon is the spelling people write.
    for (const part of inner
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (part.startsWith(".")) {
            const name = part.slice(1);
            if (!Object.prototype.hasOwnProperty.call(IMAGE_CLASSES, name)) {
                problems.push(
                    `\`.${name}\` is not a width an image has — the width there is ` +
                        `is \`.${Object.keys(IMAGE_CLASSES).join("`, `.")}\`, and an image ` +
                        "with no class at all is the ordinary width",
                );
                continue;
            }
            if (classes.includes(name)) {
                problems.push(`\`.${name}\` is written twice, and an image has one width`);
                continue;
            }
            classes.push(name);
            continue;
        }

        const colon = part.indexOf(":");
        if (colon === -1) {
            problems.push(
                `\`${part}\` is neither a width class nor \`float: <position>\` — an ` +
                    "image states its width as a class and its position as `float:`, " +
                    "and it states no dimensions at all",
            );
            continue;
        }
        const key = part.slice(0, colon).trim();
        const value = part.slice(colon + 1).trim();
        if (key !== "float") {
            problems.push(
                `\`${key}\` is not an image attribute — \`float\` is the only one, ` +
                    "and width is a class rather than an attribute",
            );
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(IMAGE_FLOATS, value)) {
            problems.push(
                `\`float: ${value}\` is not a position — the ones there are: ` +
                    `${Object.keys(IMAGE_FLOATS).join(", ")}`,
            );
            continue;
        }
        if (float) {
            problems.push("`float:` is written twice, and an image sits in one place");
            continue;
        }
        float = value;
    }

    if (classes.length > 1) {
        problems.push("an image states one width, and this states more than one");
    }
    // Nothing partial: a directive with a problem in it is not honoured at all.
    if (problems.length) return { classes: [], float: "", problems };
    return { classes, float, problems };
}

/**
 * The classes a figure carries, from a parsed directive.
 *
 * @param {{classes?: string[], float?: string}} [directive] - As parsed.
 * @returns {string} A space-separated class list, always naming
 *   {@link IMAGE_FIGURE_CLASS} first.
 */
export function figureClasses({ classes = [], float = "" } = {}) {
    const names = [IMAGE_FIGURE_CLASS];
    for (const name of classes) {
        const spec = IMAGE_CLASSES[/** @type {keyof typeof IMAGE_CLASSES} */ (name)];
        if (spec) names.push(spec.class);
    }
    const position = IMAGE_FLOATS[/** @type {keyof typeof IMAGE_FLOATS} */ (float)];
    if (position) names.push(position.class);
    return names.join(" ");
}

/**
 * Text going inside an HTML attribute or between tags.
 *
 * @param {string} text - The raw value.
 * @returns {string} The same value, safe in markup.
 */
export function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * One image as the `<figure>` both HTML surfaces render.
 *
 * The website and a Foundry journal page get the identical string, from one
 * function, so the two cannot drift into styling the same directive through
 * different class names.
 *
 * @param {object} image - The image.
 * @param {string} image.src - The address, resolved for the surface.
 * @param {string} [image.alt] - The alt text, which is also the caption.
 * @param {string[]} [image.classes] - Width classes, from the directive.
 * @param {string} [image.float] - The float position, from the directive.
 * @returns {string} The figure, as one HTML block.
 */
export function imageFigureHtml({ src, alt = "", classes = [], float = "" }) {
    const caption = alt ? `\n<figcaption>${escapeHtml(alt)}</figcaption>` : "";
    return (
        `<figure class="${figureClasses({ classes, float })}">\n` +
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">${caption}\n` +
        `</figure>`
    );
}

/**
 * Whether a match sits alone in its own paragraph.
 *
 * "Alone" is the whole of a block: nothing else on its line, and a blank line
 * or the end of the body either side of it. A leading `>` or list marker
 * disqualifies it for the same reason a word does — the paragraph it belongs to
 * holds something the figure would have to be lifted out of.
 *
 * @param {string} text - The body the match indexes into.
 * @param {number} start - Where the match begins.
 * @param {number} end - Where it ends.
 * @returns {boolean} Whether the match is a block of its own.
 */
export function standsAlone(text, start, end) {
    const src = String(text ?? "");
    const lineStart = src.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    // Up to three leading spaces is still a paragraph in markdown; a fourth
    // makes it an indented code block, which `matchAllOutsideCode` skips.
    if (!/^[ \t]*$/.test(src.slice(lineStart, start))) return false;
    const lineEnd = src.indexOf("\n", end);
    if (!/^[ \t]*$/.test(src.slice(end, lineEnd === -1 ? src.length : lineEnd))) return false;

    const before = src.slice(0, lineStart);
    if (before.trim() && !/\n[ \t]*\n[ \t]*$/.test(before)) return false;
    const after = lineEnd === -1 ? "" : src.slice(lineEnd);
    if (after.trim() && !/^\n[ \t]*\n/.test(after)) return false;
    return true;
}

/**
 * Every image in one body, with its directive and its position.
 *
 * Code is skipped, because an image shown as an example is prose *about* an
 * image and resolving it would make this very module impossible to document.
 *
 * @param {string} body - The note's markdown, without its frontmatter.
 * @returns {Array<{alt: string, src: string, title: string, directive: string,
 *   index: number, length: number, block: boolean}>} One entry per image, in
 *   source order.
 */
export function imagesIn(body) {
    const text = String(body ?? "");
    return matchAllOutsideCode(text, IMAGE_PATTERN).map((match) => {
        const index = /** @type {number} */ (match.index);
        return {
            alt: match[1] ?? "",
            src: match[2] ?? "",
            title: match[3] ?? "",
            directive: match[4] ?? "",
            index,
            length: match[0].length,
            block: standsAlone(text, index, index + match[0].length),
        };
    });
}

/**
 * Every image address one body names, in order of appearance.
 *
 * What a build reads to know which files it has to stage before a compiler can
 * see them.
 *
 * @param {string} body - The note's markdown.
 * @returns {string[]} The addresses, with repeats.
 */
export function imageSourcesIn(body) {
    return imagesIn(body)
        .map((image) => image.src)
        .filter(Boolean);
}

/**
 * Every defect in one note's images.
 *
 * **Errors, not warnings.** A refusal that does not fail the build is not a
 * refusal: `reportFindings` fails on an error and not on a warning, so a
 * directive reported as advisory publishes anyway, looking exactly like one
 * that worked.
 *
 * @param {string} body - The note's markdown, without its frontmatter.
 * @param {string} file - The note's path, for the finding.
 * @param {object} [opts]
 * @param {number} [opts.bodyLine=1] - The 1-based file line the body starts on.
 * @param {number} [opts.bodyColumn=1] - The 1-based file column it starts at.
 * @param {object} [opts.config] - The resolved build configuration. Supplied,
 *   an address is also held to the one surface a pathname can be dead on
 *   without any other pass noticing — see the Foundry address below. Omitted,
 *   the config-free checks run alone, which is what lets a caller with no
 *   repository to resolve still read a body.
 * @returns {Array<{file: string, line: number, column: number|undefined,
 *   severity: "error", message: string}>} One finding per defect, in source
 *   order.
 */
export function checkImages(body, file, { bodyLine = 1, bodyColumn = 1, config } = {}) {
    const text = String(body ?? "");
    if (!text) return [];

    /** @type {Array<{file: string, line: number, column: number|undefined, severity: "error", message: string}>} */
    const findings = [];
    /**
     * @param {number} offset - Where in the body the finding is.
     * @param {string} message - What is wrong.
     */
    const report = (offset, message) => {
        const { line, column } = positionInBody(text, offset, { bodyLine, bodyColumn });
        findings.push({ file, line, column, severity: /** @type {"error"} */ ("error"), message });
    };

    // The Foundry address is the one form a pathname can lack while every other
    // surface resolves it, and the renderer that hands a journal its markup has
    // no channel to say so — so it is asked here, where a line and a column are
    // at hand. A build that installs nothing in Foundry has no such surface and
    // is not asked.
    const foundry = config && servesFoundry(config);
    for (const image of imagesIn(text)) {
        const problem =
            imageSourceProblem(image.src) ||
            pathnameProblem(image.src) ||
            (foundry ? foundryAddressProblem(image.src, config) : "");
        if (problem) report(image.index, problem);
        if (image.title) {
            report(
                image.index,
                `\`"${image.title}"\` is a title on an image, and no surface here draws ` +
                    "one — an image's alt text is its caption",
            );
        }
        if (!image.block) {
            report(
                image.index,
                `\`![${image.alt}](…)\` shares its paragraph with other text — an image ` +
                    "is a block, standing alone with a blank line either side of it, " +
                    "because a width and a position mean nothing applied to a word in a " +
                    "sentence",
            );
        }
        if (!image.directive) continue;
        const { problems } = parseImageDirective(image.directive);
        // Located on the brace rather than the image: the brace is what the
        // author has to edit, and an image with two problems in one directive
        // should not send them to the same column twice.
        const at = image.index + image.length - image.directive.length;
        for (const message of problems) report(at, message);
    }
    return findings;
}

/**
 * A file's body, its path, and where the body starts in the file.
 *
 * The same split {@link module:engine/helpers.parseMarkdownFile} makes, without
 * parsing the YAML: this check has no use for the frontmatter's *values*, and
 * reading them would make an unparseable note silently unscanned.
 *
 * @param {string} content - The whole file.
 * @param {string} file - Its path, for the finding.
 * @returns {[string, string, {bodyLine: number, bodyColumn: number}]} The
 *   arguments {@link checkImages} takes.
 */
function bodyOf(content, file) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return [content, file, { bodyLine: 1, bodyColumn: 1 }];

    const raw = match[2];
    const body = raw.trim();
    const bodyStart = content.length - raw.length + (raw.length - raw.trimStart().length);
    const before = content.slice(0, bodyStart);
    return [
        body,
        file,
        {
            bodyLine: before.split("\n").length,
            bodyColumn: bodyStart - before.lastIndexOf("\n"),
        },
    ];
}

/**
 * Walk a content tree and report every image it cannot render as authored.
 *
 * Its own walk, like the icon and HTML checks beside it, so all three stay
 * leaves with nothing imported between them.
 *
 * A finding names its file **relative to the working directory**, which is
 * where a reader is standing and what `formatDiagnostic` emits. The content
 * root is where the walk starts, not what a path is measured from.
 *
 * @param {string} contentBase - Root of the content tree.
 * @param {object} [opts]
 * @param {readonly string[]} [opts.skipDirectories] - Directory names to ignore
 *   in addition to the dot-directories always skipped.
 * @param {object} [opts.config] - The resolved build configuration, passed to
 *   {@link checkImages} so an address is held to the Foundry surface too.
 * @returns {{findings: Array<{file: string, line: number, column: number|undefined,
 *   severity: "error", message: string}>, files: number}} The findings, and how
 *   many files were read.
 */
export function lintContentImages(contentBase, { skipDirectories = [], config } = {}) {
    const skip = new Set(skipDirectories);
    /** @type {Array<{file: string, line: number, column: number|undefined, severity: "error", message: string}>} */
    const findings = [];
    let files = 0;

    /** @param {string} dir - Directory to descend into. */
    const walk = (dir) => {
        /** @type {import("node:fs").Dirent[]} */
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!/\.(md|markdown)$/i.test(entry.name)) continue;
            let content;
            try {
                content = fs.readFileSync(full, "utf8");
            } catch {
                continue;
            }
            files += 1;
            const [body, rel, at] = bodyOf(content, path.relative(process.cwd(), full));
            findings.push(...checkImages(body, rel, { ...at, config }));
        }
    };

    walk(contentBase);
    return { findings, files };
}

/**
 * Rewrite every block image in a body into the figure the website publishes.
 *
 * **Hugo is handed markdown, not a rendered page.** The site emitter writes a
 * note's body through verbatim, so a `{…}` directive left in it reaches the
 * page as its own literal braces: Goldmark's block-attribute parser is off, and
 * turning it on would accept `style` and `id` alongside the two vocabularies,
 * which is the injection surface this rule exists to avoid. So the directive is
 * resolved here, into markup Goldmark passes through.
 *
 * An image whose directive does not parse is left exactly as written, so the
 * page shows the braces and the lint says why — the same visible degradation an
 * unknown icon name gets.
 *
 * Call this **inside** {@link module:engine/code-fences.protectCode}: an image
 * in a fence is an example of one.
 *
 * @param {string} body - The note's markdown.
 * @param {(src: string) => string} [resolveSrc] - Translates an authored
 *   pathname into the address this surface serves. The default is the identity,
 *   for a caller rendering the format rather than publishing it.
 * @returns {string} The same body, with each block image as a `<figure>`.
 */
export function renderImageFigures(body, resolveSrc = (src) => src) {
    const text = String(body ?? "");
    let out = "";
    let last = 0;
    for (const image of imagesIn(text)) {
        if (!image.block || imageSourceProblem(image.src) || image.title) continue;
        const { classes, float, problems } = parseImageDirective(image.directive);
        if (problems.length) continue;
        out += text.slice(last, image.index);
        out += imageFigureHtml({ src: resolveSrc(image.src), alt: image.alt, classes, float });
        last = image.index + image.length;
    }
    return out + text.slice(last);
}

/**
 * A markdown-it plugin that reads an image's directive and renders its figure.
 *
 * **A core rule, not an inline one.** markdown-it's own `image` rule consumes
 * `![alt](src)` and leaves `{float: top-left}` behind as text, and a rule
 * running before it would have to re-implement link parsing to find the brace.
 * Reading the token stream afterwards costs one pass and re-implements nothing.
 *
 * Two things happen to a paragraph holding one image and nothing else: the
 * directive is lifted off the text token that follows it, and the paragraph's
 * own tokens are hidden, so the figure is a block rather than a `<figure>`
 * nested inside a `<p>`. The Typst renderer reads the same `meta`, which is
 * what keeps the book and the two HTML surfaces honouring one statement.
 *
 * An image whose directive does not parse keeps its braces and renders as its
 * own literal text, which is how the author sees the mistake without reading a
 * log.
 *
 * @param {(src: string) => string} [resolveSrc] - Translates an authored
 *   address into the one this surface serves. Foundry is handed the path inside
 *   the install; a renderer that resolves the address itself — the book stages
 *   its own copy — passes nothing and gets the address as authored.
 * @returns {(md: object) => void} A markdown-it plugin.
 */
export function imagePlugin(resolveSrc = (src) => src) {
    return (md) => {
        /** @type {any} */ (md).core.ruler.push("heroiclands_image", (state) => {
            attachImageDirectives(state.tokens);
        });
        const base = /** @type {any} */ (md).renderer.rules.image;
        /** @type {any} */ (md).renderer.rules.image = (
            /** @type {any[]} */ tokens,
            /** @type {number} */ idx,
            /** @type {any} */ options,
            /** @type {any} */ env,
            /** @type {any} */ self,
        ) => {
            const token = tokens[idx];
            if (!token.meta?.block) return base(tokens, idx, options, env, self);
            return `${imageFigureHtml({
                src: resolveSrc(token.attrGet("src") ?? ""),
                alt: token.content ?? "",
                classes: token.meta.classes,
                float: token.meta.float,
            })}\n`;
        };
    };
}

/**
 * Mark every paragraph that is one image, and lift its directive onto it.
 *
 * @param {any[]} tokens - A markdown-it block token stream.
 * @returns {void}
 */
function attachImageDirectives(tokens) {
    for (let i = 0; i + 2 < tokens.length; i += 1) {
        if (tokens[i].type !== "paragraph_open") continue;
        if (tokens[i + 1].type !== "inline") continue;
        if (tokens[i + 2].type !== "paragraph_close") continue;

        const children = tokens[i + 1].children ?? [];
        const meaningful = children.filter(
            (/** @type {any} */ child) => child.type !== "text" || child.content.trim(),
        );
        const image = meaningful[0];
        if (!image || image.type !== "image") continue;

        // At most one thing may follow the image, and only if it is the
        // directive: anything else means the paragraph holds prose too.
        const trailing = meaningful[1];
        if (meaningful.length > 2) continue;
        let directive = "";
        if (trailing) {
            if (trailing.type !== "text") continue;
            const brace = /^\{[^}\n]*\}/.exec(trailing.content);
            if (!brace || trailing.content.slice(brace[0].length).trim()) continue;
            directive = brace[0];
        }

        const { classes, float, problems } = parseImageDirective(directive);
        // Not ours to consume: leaving the braces in place is what makes an
        // unrecognised value visible on the page instead of passing as ordinary.
        if (problems.length) continue;

        image.meta = { ...(image.meta ?? {}), block: true, classes, float };
        if (trailing) trailing.content = trailing.content.slice(directive.length);
        // The figure is a block, so the paragraph that held it renders nothing.
        tokens[i].hidden = true;
        tokens[i + 2].hidden = true;
    }
}
