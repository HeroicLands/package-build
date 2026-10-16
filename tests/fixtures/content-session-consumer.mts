/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contentSession } from "@heroiclands/package-build/engine";
import type { ContentBuildConfig } from "@heroiclands/package-build/content-config";
import {
    parseMarkdownFile,
    walkMarkdownTree,
    buildContentLinkIndex,
} from "@heroiclands/package-build/engine/helpers";
import {
    indexRecordsFor,
    indexRecordsForNote,
    buildIndexRecord,
    collectContentIndex,
    prepareContentIndex,
    emitContentIndex,
} from "@heroiclands/package-build/engine/content-index";
import { buildLinkIndex } from "@heroiclands/package-build/engine/content-links";
import { buildCompileCorpus } from "@heroiclands/package-build/engine/compile-corpus";
import { generatePacksJson } from "@heroiclands/package-build/engine/generate";
import { compilePacks } from "@heroiclands/package-build/engine/compendiums";
import { lintContentCharset } from "@heroiclands/package-build/engine/content-charset";
import { lintContentHtml } from "@heroiclands/package-build/engine/content-html";
import { lintContentIcons } from "@heroiclands/package-build/engine/content-icons";
import { lintContentImages } from "@heroiclands/package-build/engine/content-images";
import { lintContentTaskLists } from "@heroiclands/package-build/engine/content-tasklists";
import { lintPathCharset } from "@heroiclands/package-build/engine/path-charset";
import { lintNoteStates } from "@heroiclands/package-build/engine/stub-lint";
import {
    prepareTreeSqlTables,
    prepareLinkSqlTables,
} from "@heroiclands/package-build/engine/sql-tables";
import { collectAnchors, markupAnchorFindings } from "@heroiclands/package-build/engine/anchors";
import { markupFindings } from "@heroiclands/package-build/engine/markup-validation";
import { anchorsOf, entriesForNote } from "@heroiclands/package-build/engine/foundry-entries";
import { splitPages, buildJournalEntry } from "@heroiclands/package-build/engine/journals";
import { insertLexicalSections } from "@heroiclands/package-build/engine/lexical-sections";
import { buildSiteIndex } from "@heroiclands/package-build/engine/site-index";
import {
    captureContentSources,
    capturedSources,
} from "@heroiclands/package-build/engine/content-sources";
import { createFirstUseChecker } from "@heroiclands/package-build/engine/first-use";
import { parseExtensionAttributes } from "@heroiclands/package-build/engine/extension-attributes";
import { scanSpans } from "@heroiclands/package-build/engine/content-spans";
import { inlineText, rebaseNameSpans } from "@heroiclands/package-build/engine/name-markup";
import { NAME_COLUMNS, namesRows, type NameRow } from "@heroiclands/package-build/engine/name-rows";
import {
    normalizeName,
    nameForms,
    createNameCatalog,
    collectUnwrittenNames,
    analyzeNameSpans,
    createNamesReport,
    namesReportFinding,
    type ParsedNameSpan,
} from "@heroiclands/package-build/engine/names";
import { NOTE_VOCABULARY } from "@heroiclands/package-build/engine/note-vocabulary";

type IsAny<T> = 0 extends 1 & T ? true : false;
type RequireFalse<T extends false> = T;

declare const config: ContentBuildConfig;
const session = await contentSession.createContentSession({ config });
const {
    contentBase,
    assetsBase,
    skipDirectories,
    records,
    parsed,
    sources,
    syntax,
    foreign,
    router,
} = session;
const raw: string = parsed.get("note.md")?.raw ?? "";
const inventory = captureContentSources(contentBase, assetsBase, skipDirectories);
for (const [file, text] of capturedSources(
    contentBase,
    sources,
    skipDirectories,
    new Set([".md"]),
)) {
    parseMarkdownFile(file, { raw: text, renderDescription: false });
}
const walked = [
    ...walkMarkdownTree(contentBase, { skipDirectories, sources, renderDescription: false }),
];
const body: string = walked[0]?.body ?? "";
const nameTypes = new Set(["weapongear"]);
indexRecordsFor({ config, sources, syntax, foreignIndex: foreign.index, nameTypes });
indexRecordsForNote({
    frontmatter: {},
    contentPackage: config.contentPackage,
    relPath: "note.md",
    body,
    raw,
    bodyLine: 1,
    bodyColumn: 1,
    nameTypes,
    syntax,
});
buildIndexRecord({
    frontmatter: {},
    contentPackage: config.contentPackage,
    relPath: "note.md",
    raw,
    body,
    bodyLine: 1,
    bodyColumn: 1,
    nameTypes,
    syntax,
});
collectContentIndex(contentBase, {
    contentPackage: config.contentPackage,
    skipDirectories,
    sources,
    syntax,
    nameTypes,
});
const sqlTables = await session.sqlTables("all");
await session.linkTables();
await session.audit("links");
await session.audit("lint");
const auditIndex = await session.audit("lint");
const catalog = createNameCatalog({ records, index: auditIndex });
const firstUse = createFirstUseChecker({ records, index: auditIndex, catalog, parsed, syntax });
const nameFindings = firstUse({ file: "note.md", raw });
const rule: string = nameFindings[0]?.rules[0] ?? "";
const severity: "warning" = nameFindings[0]?.severity ?? "warning";
const scannedNames = scanSpans(body);
type CapturedNameIsTyped = RequireFalse<IsAny<(typeof scannedNames.names)[number]>>;
type CapturedVisibleIsTyped = RequireFalse<IsAny<(typeof scannedNames.names)[number]["visible"]>>;
type CapturedAttributeSiteIsTyped = RequireFalse<
    IsAny<(typeof scannedNames.names)[number]["attributePositions"][string]["key"]>
>;
const visible: string = scannedNames.names[0]?.visible ?? "";
const attributeLine: number = scannedNames.names[0]?.attributePositions["data-type"]?.key.line ?? 0;
const attributeColumn: number =
    scannedNames.names[0]?.attributePositions["data-type"]?.key.column ?? 0;
const rebasedNames = rebaseNameSpans(scannedNames.names, { raw, bodyLine: 1, bodyColumn: 1 });
type RebasedNameIsTyped = RequireFalse<IsAny<(typeof rebasedNames)[number]>>;
const rebasedVisible: string = rebasedNames[0]?.visible ?? "";
const rebasedStart: number = rebasedNames[0]?.start ?? 0;
const rebasedContentEnd: number = rebasedNames[0]?.contentEnd ?? 0;
const rebasedAttributeStart: number =
    rebasedNames[0]?.attributePositions["data-type"]?.key.start ?? 0;
const semanticSpan: ParsedNameSpan | undefined = rebasedNames[0];
const analyzed = analyzeNameSpans(rebasedNames, {
    file: "note.md",
    vocabulary: NOTE_VOCABULARY,
    types: new Set(["weapongear"]),
});
const suppliedType: string | null = analyzed.names[0]?.type ?? null;
const kindSeverity: "error" = analyzed.findings[0]?.severity ?? "error";
const row: NameRow | undefined = namesRows([{ names: analyzed.names }])[0];
const owner: string | null = row?.owner ?? null;
const rowLine: number = row?.line ?? 0;
const columns: readonly string[] = NAME_COLUMNS;
const normalized: string = normalizeName(visible);
const forms: string[] = nameForms(normalized);
const tokenText: string = inlineText([{ type: "text", content: "Ravenmoor" }]);
const attributes = parseExtensionAttributes('data-type="being"', { positions: true });
const keyOffset: number = attributes.positions?.["data-type"]?.key.start ?? 0;
const unwritten = collectUnwrittenNames({ records, catalog });
const firstOwner: string | null | undefined = unwritten.firstUse?.owner;
const report = createNamesReport({ package: config.contentPackage, records, catalog });
const conflictType: string | undefined = report.conflicts[0]?.kinds[0]?.type;
const packageFinding = namesReportFinding(report, { contentBase });
const packageSeverity: "warning" = packageFinding?.severity ?? "warning";
await session.prepare(contentSession.CONTENT_TARGETS);
session.assertContext({ config, contentBase, assetsBase, skipDirectories, router });
const publication = await prepareContentIndex({ config, session });
emitContentIndex({ config, publication });
await session.publication();
await session.compileCorpus();
buildContentLinkIndex(contentBase, router, { config, records, sqlTables, foreign });
buildLinkIndex(contentBase, { config, records, parsed, sqlTables, foreign });
await buildCompileCorpus({ config, contentBase, assetsBase, skipDirectories, router, session });
await generatePacksJson({ config, session, reportPreparation: false });
await compilePacks({ config, session, reportPreparation: false });
lintContentCharset(contentBase, { sources, skipDirectories });
lintContentHtml(contentBase, { sources, skipDirectories });
lintContentIcons(contentBase, { sources, skipDirectories });
lintContentImages(contentBase, { sources, skipDirectories, config });
lintContentTaskLists(contentBase, { sources, skipDirectories });
lintPathCharset({ contentBase, assetsBase, skipDirectories, inventory });
lintNoteStates(contentBase, { records, parsed });
await prepareTreeSqlTables(contentBase, {
    config,
    records,
    parsed,
    syntax,
    foreignIndex: foreign.index,
});
await prepareLinkSqlTables(contentBase, {
    config,
    records,
    parsed,
    prepareAudience: (audience) => session.sqlTables(audience),
});
collectAnchors(body, 1, undefined, syntax);
markupAnchorFindings(body, syntax);
markupFindings(raw, "note.md", syntax);
anchorsOf("entry-uuid", "entry-id", body, "Note", syntax);
if (config.foundryPackage) {
    entriesForNote({}, "Note", "lore-note", body, {
        contentPackage: config.contentPackage,
        foundryPackageId: config.foundryPackage,
        packRouter: router,
        syntax,
    });
}
splitPages(body, "Note", undefined, syntax);
buildJournalEntry({ id: "entry-id", name: "Note", markdown: body, syntax });
insertLexicalSections(body, [], { syntax });
buildSiteIndex([], { syntax });
// @ts-expect-error The target vocabulary is closed.
await session.prepare(["watch"]);
// @ts-expect-error Captured source text must be a string.
parseMarkdownFile("note.md", { raw: 42 });
// @ts-expect-error Additional name kinds must be an iterable of type strings.
indexRecordsFor({ nameTypes: 42 });
session.dispose();
