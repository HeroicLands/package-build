/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * The parity corpus, built once for every rendering target.
 *
 * `tests/fixtures/parity/` is a small package: one note holding every
 * construct the renderers handle, the notes its links reach, mapping notes,
 * script notes and language notes, and two pictures. Four more notes each
 * hold what the build refuses: a link no package publishes, emphasis in a
 * non-English span, a cartouche written as a block, and two
 * `scroll` fences, one with no characters to a column and one in a script
 * written in lines. {@link buildParity} copies it to a scratch directory and
 * renders the corpus the way each target renders a note.
 *
 * | Target | Route |
 * | ------ | ----- |
 * | `foundry` | `generatePacksJson` in a subprocess; the journal's pages |
 * | `web` | the site build `package-build site build` runs, written as HTML |
 * | `book` | `package-build pdf --no-compile`; the Typst source, never compiled |
 * | `preview` | `renderPreview` over the note's text, with no index |
 * | `indexed` | `renderPreview` over the note's text, with the package's content index |
 *
 * Nothing here compiles Typst or a PDF.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import YAML from "yaml";

import { configFromData } from "../../engine/pack-config.mjs";
import { indexRecordsFor } from "../../engine/content-index.mjs";
import { previewIndex } from "../../engine/preview-index.mjs";
import { renderPreview } from "../../engine/site-preview.mjs";
import { buildPackageSite } from "../../engine/site-render.mjs";
import { NAVIGATION_FILE, navigationCacheDir } from "../../engine/site-config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** This package's root. */
export const PACKAGE_ROOT = path.resolve(HERE, "..", "..");

/** The committed fixture package. */
export const PARITY_FIXTURE = path.join(PACKAGE_ROOT, "tests", "fixtures", "parity");

/** The installed-fonts fixture the marked-text runs are set in. */
const FONTS_FIXTURE = path.join(PACKAGE_ROOT, "tests", "fixtures", "script-fonts", "fonts");

/** The corpus note, relative to the package's content root. */
export const CORPUS_NOTE = "Lore/lore-corpus.md";

/** The note whose only content is a link no package publishes. */
export const LOST_NOTE = "Lore/lore-lost.md";

/** The note whose only content is emphasis in a non-English span. */
export const WORDED_NOTE = "Lore/lore-worded.md";
export const FENCED_NOTE = "Lore/lore-fenced.md";

/** The note whose only content is two `scroll` fences the build refuses. */
export const UNROLLED_NOTE = "Lore/lore-unrolled.md";

/** The note naming three subjects in a heading, a table and prose. */
export const NAMED_NOTE = "Lore/lore-named.md";

/** One note, rendered by one target. */
export interface Rendered {
    /** What the target produced for the corpus note. */
    corpus: string;
    /** What the target produced for the note holding an unresolved link. */
    lost: string;
    /** What the target produced for the note holding emphasis a language refuses. */
    worded: string;
    fenced: string;
    /** What the target produced for the note holding the refused scroll fences. */
    unrolled: string;
    /** What the target produced for the note naming three subjects. */
    named: string;
}

/** Everything the four targets produced. */
export interface Built {
    root: string;
    /** The corpus note exactly as authored, frontmatter included. */
    corpusSource: string;
    /** The corpus note's body. */
    corpusBody: string;
    /** The note holding the unresolved link, exactly as authored. */
    lostSource: string;
    /** The note holding the refused emphasis, exactly as authored. */
    wordedSource: string;
    fencedSource: string;
    /** The note holding the refused scroll fences, exactly as authored. */
    unrolledSource: string;
    /** The note naming three subjects, exactly as authored. */
    namedSource: string;
    foundry: Rendered & { findings: string };
    web: Rendered;
    book: Rendered & { findings: string };
    preview: Rendered;
    indexed: Rendered;
}

/** The body of a note, without its frontmatter. */
export function bodyOf(source: string): string {
    return source.replace(/^---\n[\s\S]*?\n---\n/, "");
}

/**
 * Every note of a fixture copy, as the content index's records carry it: its
 * frontmatter, with the canonical address its type and shortcode derive.
 */
export function noteRecords(root: string): Record<string, any>[] {
    const content = path.join(root, "assets", "content");
    return fs
        .readdirSync(content, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".md"))
        .map((file) => {
            const source = fs.readFileSync(path.join(content, file), "utf8");
            const fm = YAML.parse(/^---\n([\s\S]*?)\n---\n/.exec(source)?.[1] ?? "") ?? {};
            return { ...fm, address: { canonical: `parity-note-${fm.type}-${fm.shortcode}` } };
        });
}

/** The lines of a build's output that name one note of the content tree. */
function about(output: string, note: string): string[] {
    return output.split("\n").filter((line) => line.startsWith(`assets/content/${note}`));
}

/** The pages of a compiled journal, as one string a reader's view can be matched against. */
function journalText(file: string): string {
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    return (doc.pages ?? [])
        .map((page: any) => {
            const head = [
                `page ${JSON.stringify(page.name)}`,
                `type=${page.type}`,
                `ownership=${page.ownership?.default ?? "inherit"}`,
                ...(page.src ? [`src=${page.src}`] : []),
                ...(page.image?.caption ? [`caption=${JSON.stringify(page.image.caption)}`] : []),
            ].join(" ");
            return `<!-- ${head} -->\n${page.text?.content ?? ""}`;
        })
        .join("\n");
}

/** The Typst source of one entry: from its heading to the next entry's. */
export function bookEntry(source: string, title: string): string {
    const marker = `#book-entry("Everything", ${JSON.stringify(title)}`;
    const start = source.indexOf(marker);
    if (start < 0) return "";
    const next = source.indexOf("#book-entry(", start + marker.length);
    const index = source.indexOf("#set page(columns", start + marker.length);
    const stops = [next, index].filter((n) => n >= 0);
    return source.slice(start, stops.length ? Math.min(...stops) : undefined);
}

/** The text inside a rendered page's body. */
function pageBody(html: string): string {
    const start = html.indexOf('<div class="single-body"');
    const stops = ['<section class="related"', '<nav class="single-nav"']
        .map((marker) => html.indexOf(marker, start))
        .filter((at) => at >= 0);
    return start < 0 ? "" : html.slice(start, stops.length ? Math.min(...stops) : undefined);
}

/** A subprocess run under the scratch package. */
function run(root: string, args: string[]) {
    const result = spawnSync(process.execPath, args, {
        cwd: root,
        env: {
            ...process.env,
            PACKAGE_BUILD_CONFIG: path.join(root, "package-build.config.yaml"),
        },
        encoding: "utf8",
    });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/** The scratch copy of the fixture package, with the installed fonts beside it. */
export function copyFixture(): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "parity-")));
    fs.cpSync(PARITY_FIXTURE, root, { recursive: true });
    fs.cpSync(FONTS_FIXTURE, path.join(root, "node_modules", "@heroiclands", "fonts"), {
        recursive: true,
    });
    fs.mkdirSync(path.join(root, "build", "cache", "metadata"), { recursive: true });
    return root;
}

/** Render the fixture for the Foundry packs; returns the journal text and the findings. */
function buildFoundry(root: string): Rendered & { findings: string } {
    const script = `
        const log = (await import(${JSON.stringify(pathToFileURL(path.join(PACKAGE_ROOT, "node_modules/loglevel/lib/loglevel.js")).href)})).default;
        log.setLevel("error");
        const { generatePacksJson } = await import(${JSON.stringify(
            pathToFileURL(path.join(PACKAGE_ROOT, "engine/generate.mjs")).href,
        )});
        console.log("ERRORS=" + (await generatePacksJson()));
    `;
    const findings = run(root, ["--input-type=module", "-e", script]);
    const dir = path.join(root, "build", "packs-json", "journals");
    const named = (prefix: string) => {
        const file =
            fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.startsWith(prefix)) : "";
        return file ? journalText(path.join(dir, file)) : "";
    };
    // A note the compile refuses has no journal, so what a reader of the
    // outcome sees is the finding that refused it.
    return {
        corpus: named("The_Corpus_"),
        lost: [named("The_Lost_Note_"), ...about(findings, LOST_NOTE)].join("\n"),
        worded: [named("The_Worded_Note_"), ...about(findings, WORDED_NOTE)].join("\n"),
        fenced: [named("The_Fenced_Note_"), ...about(findings, FENCED_NOTE)].join("\n"),
        unrolled: [named("The_Unrolled_Note_"), ...about(findings, UNROLLED_NOTE)].join("\n"),
        named: named("The_Named_Note_"),
        findings,
    };
}

/** Render the fixture as the book's Typst source. */
function buildBook(root: string): Rendered & { findings: string } {
    const findings = run(root, [
        path.join(PACKAGE_ROOT, "bin", "package-build.mjs"),
        "pdf",
        "--no-compile",
    ]);
    const dist = path.join(root, "build", "dist");
    const typ = fs.existsSync(dist) ? fs.readdirSync(dist).find((f) => f.endsWith(".typ")) : "";
    const source = typ ? fs.readFileSync(path.join(dist, typ), "utf8") : "";
    return {
        corpus: bookEntry(source, "The Corpus"),
        lost: [bookEntry(source, "The Lost Note"), ...about(findings, LOST_NOTE)].join("\n"),
        worded: [bookEntry(source, "The Worded Note"), ...about(findings, WORDED_NOTE)].join("\n"),
        fenced: [bookEntry(source, "The Fenced Note"), ...about(findings, FENCED_NOTE)].join("\n"),
        unrolled: [bookEntry(source, "The Unrolled Note"), ...about(findings, UNROLLED_NOTE)].join(
            "\n",
        ),
        named: bookEntry(source, "The Named Note"),
        findings,
    };
}

/** The resolved configuration of a fixture copy. */
export function fixtureConfig(root: string) {
    const configPath = path.join(root, "package-build.config.yaml");
    return configFromData(YAML.parse(fs.readFileSync(configPath, "utf8")), configPath);
}

/** The site menu a fixture copy is built with, cached as `deps fetch` caches it. */
export function cacheNavigation(config: any) {
    const cache = navigationCacheDir(config);
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(
        path.join(cache, NAVIGATION_FILE),
        JSON.stringify([{ name: "Home", url: "https://www.heroiclands.org/" }]),
    );
    fs.writeFileSync(path.join(cache, ".complete"), "");
}

/**
 * Build the fixture's site as `package-build site build` does.
 *
 * @returns The directory the site was written to, and what the build returned.
 */
export async function buildHtmlSite(root: string) {
    const config = fixtureConfig(root);
    cacheNavigation(config);
    const out = path.join(root, "build", "site", config.contentPackage);
    const result = await buildPackageSite({ config, out, year: 2026 });
    if (!result.written) throw new Error("the parity site build failed");
    return { out, result };
}

/** Render the fixture as web pages, through the site build. */
async function buildWeb(root: string): Promise<Rendered> {
    const { out } = await buildHtmlSite(root);
    const page = (slug: string) =>
        pageBody(fs.readFileSync(path.join(out, slug, "index.html"), "utf8"));
    return {
        corpus: page("lore-corpus"),
        lost: page("lore-lost"),
        worded: page("lore-worded"),
        fenced: page("lore-fenced"),
        unrolled: page("lore-unrolled"),
        named: page("lore-named"),
    };
}

/** Render the notes as the editor preview does: from their text alone. */
function buildPreview(root: string): Rendered {
    const content = path.join(root, "assets", "content");
    const html = (note: string) =>
        renderPreview(fs.readFileSync(path.join(content, note), "utf8"), { infobox: false }).html;
    return {
        corpus: html(CORPUS_NOTE),
        lost: html(LOST_NOTE),
        worded: html(WORDED_NOTE),
        fenced: html(FENCED_NOTE),
        unrolled: html(UNROLLED_NOTE),
        named: html(NAMED_NOTE),
    };
}

/** The content index of the fixture package, as an editor holding one gives it to the preview. */
export function previewIndexFor(root: string) {
    const configPath = path.join(root, "package-build.config.yaml");
    const config = configFromData(YAML.parse(fs.readFileSync(configPath, "utf8")), configPath);
    const records = indexRecordsFor({
        contentBase: config.paths.content,
        config,
        skipDirectories: config.skipDirectories,
    });
    return previewIndex({ config, records });
}

/** Render the notes as the editor preview does with a content index. */
function buildIndexed(root: string): Rendered {
    const index = previewIndexFor(root);
    const content = path.join(root, "assets", "content");
    const html = (note: string) =>
        renderPreview(fs.readFileSync(path.join(content, note), "utf8"), {
            infobox: false,
            index,
            file: note,
        }).html;
    return {
        corpus: html(CORPUS_NOTE),
        lost: html(LOST_NOTE),
        worded: html(WORDED_NOTE),
        fenced: html(FENCED_NOTE),
        unrolled: html(UNROLLED_NOTE),
        named: html(NAMED_NOTE),
    };
}

/**
 * Build the fixture for every target.
 *
 * @returns The scratch root and what each target produced.
 */
export async function buildParity(): Promise<Built> {
    const root = copyFixture();
    const corpusSource = fs.readFileSync(path.join(root, "assets", "content", CORPUS_NOTE), "utf8");
    const foundry = buildFoundry(root);
    const book = buildBook(root);
    const web = await buildWeb(root);
    const preview = buildPreview(root);
    const indexed = buildIndexed(root);
    return {
        root,
        corpusSource,
        corpusBody: bodyOf(corpusSource),
        lostSource: fs.readFileSync(path.join(root, "assets", "content", LOST_NOTE), "utf8"),
        wordedSource: fs.readFileSync(path.join(root, "assets", "content", WORDED_NOTE), "utf8"),
        fencedSource: fs.readFileSync(path.join(root, "assets", "content", FENCED_NOTE), "utf8"),
        unrolledSource: fs.readFileSync(
            path.join(root, "assets", "content", UNROLLED_NOTE),
            "utf8",
        ),
        namedSource: fs.readFileSync(path.join(root, "assets", "content", NAMED_NOTE), "utf8"),
        foundry,
        web,
        book,
        preview,
        indexed,
    };
}
