/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Content command modules registered by the `package-build` CLI.
 * Configuration is read in handlers, so help and version work without a
 * package configuration. Build inputs come from `package-build.config.yaml`.
 *
 * Usage:
 *   npx package-build package compile [pack]
 *   npx package-build package unpack [pack] [entry]
 *   npx package-build package clean [pack] [entry]
 *   npx package-build docs item-fields [--out <path>] [--title <title>]
 *   npx package-build lint [root] [--no-references]
 *   npx package-build content-format schema --schema <system>=<path>
 *   npx package-build content-format fields [--fields <system>]
 *   npx package-build links [root] [--manifests <dir>]
 *   npx package-build format [paths..] [--write]
 *   npx package-build markdown [paths..] [--fix]
 *   npx package-build site [--out <dir>]
 *   npx package-build map [--tree] [--from <shortcode>] [--chart <shortcode>] [--travel] [--out <dir>]
 *   npx package-build reachability <dir> [file] [--index <shortcode>]
 *   npx package-build transliterate <map> [--lang <language>] [--font <slug>] [--hex] [text..]
 *   npx package-build lexicon <language> [--map <map>] [--font <slug>] [--derived] [--json]
 *   npx package-build addresses diff --from <zip|dir> [--strict]
 *   npx package-build npc new (--spec <json> | --specfile <path>) [--seed <text>] [--out <path>]
 *
 * In a consuming repository, wrapped as npm scripts — SoHL spells them:
 *   npm run build:compiledb                // → … package compile (all packs)
 *   npm run build:unpackdb                 // → … package unpack
 *   npm run docs:item-fields               // → … docs item-fields --out …
 */

import fs from "fs";
import path from "node:path";
import log from "loglevel";
import prefix from "loglevel-plugin-prefix";
import { readStdin } from "../engine/read-stdin.mjs";
import { compilePacks, cleanPacks, unpackPacks } from "../engine/compendiums.mjs";
import { compilesFoundryDocuments, publishesContentPages, siteBase } from "../content-config.mjs";
import { loadPackConfig, packConfigPath } from "../engine/pack-config.mjs";
import { buildPdf, listBookAssets } from "../engine/pdf-build.mjs";
import { summaryLines } from "../engine/pdf-coverage.mjs";
import {
    fetchAllCatalogs,
    fetchCatalogFromPath,
    fetchAllMetadata,
    fetchMetadataFromPath,
    itemCatalogRelationships,
} from "../engine/foreign-catalog.mjs";
import {
    metadataRelationships,
    cachedMetadataIndexes,
    cachedIndexPath,
    unaddressableForeignPackages,
    formatUnaddressableFinding,
} from "../engine/metadata-index.mjs";
import { DEPLOY_ROOT, fetchNavigation } from "../engine/site-config.mjs";
import { renderItemFieldReference, renderItemFieldsPage } from "../engine/field-reference.mjs";
import { checkDocLinks, checkDocIndex } from "../engine/docs-checks.mjs";
import { checkArtSlotSizes } from "../engine/art-fields.mjs";
import { lintContentTree } from "../engine/content-lint.mjs";
import { lintNoteStates } from "../engine/stub-lint.mjs";
import { lintContentCharset } from "../engine/content-charset.mjs";
import { lintPathCharset } from "../engine/path-charset.mjs";
import { lintContentHtml } from "../engine/content-html.mjs";
import { lintContentIcons } from "../engine/content-icons.mjs";
import { lintContentImages } from "../engine/content-images.mjs";
import { lintContentTaskLists } from "../engine/content-tasklists.mjs";
import {
    declaredSystems,
    lintFrontmatter,
    systemAddressFindings,
    systemBlocksFor,
} from "../engine/frontmatter-lint.mjs";
import { loadContentFormat } from "../engine/content-format.mjs";
import { checkDeclaredFields, checkSchemaTargets } from "../engine/content-format-check.mjs";
import {
    compareFields,
    resolveSchemaArtifact,
    undeclaredMessage,
    unemittedMessage,
} from "../engine/schema-check.mjs";
// The one vocabulary, loaded whole. Every content project authors the full type
// set — an adventure module ships skills, beings and magic swords — so no
// consumer gets a subset.
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
// The shipped declarations, so this repository can check its own specification
// against them without standing up a consumer's configuration.
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { HM3_ITEM_FIELDS } from "../hm3/item-fields.mjs";
// The engine's own types, merged under the registry's so the vocabulary stands
// in a package that configures no `itemBuilders` at all.
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { schemaSubtypeOf } from "../engine/subtype-registry.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { markupFindings } from "../engine/markup-validation.mjs";
import { runContext } from "../engine/content-scripts.mjs";
import { coreReport, coreReportText } from "../engine/core-report.mjs";
import { checkScriptNoteFonts } from "../engine/script-emphasis.mjs";
import {
    checkLexiconNatives,
    checkMapFonts,
    languageNoteFindings,
    lexiconEntries,
    transliterate,
} from "../engine/map-lexicon.mjs";
import { checkFormatting, checkPrettierConventions, lintMarkdown } from "../engine/prose-lint.mjs";
import { lintProse, scoreProseTree } from "../engine/readability-lint.mjs";
import { loadPackageBuildConfig } from "../config.mjs";
import {
    emitContentIndex,
    prepareContentIndex,
    indexRecordsFor,
    isAssetRecord,
} from "../engine/content-index.mjs";
import {
    buildSite,
    gatesFailed,
    siteBuildFailed,
    formatUnaddressableFinding as formatUnaddressable,
} from "../engine/site-build.mjs";
import { buildPackageSite, siteDirectory } from "../engine/site-render.mjs";
import { serveSite } from "../engine/site-serve.mjs";
import { writeSiteRoot } from "../engine/site-root.mjs";
import { auditLinks, buildLinkIndex, walkReachability } from "../engine/content-links.mjs";
import { prepareLinkSqlTables, prepareTreeSqlTables } from "../engine/sql-tables.mjs";
import { createContentTimings } from "../engine/content-timings.mjs";
import { emitCalendarArtifacts } from "../engine/calendar-artifacts.mjs";
import { stagePackageBuildAssets } from "../engine/build-assets.mjs";
import { DEPLOYED_ASSET_TYPES } from "../engine/asset-types.mjs";
import { createContentSession, CONTENT_TARGETS } from "../engine/content-session.mjs";
import { createFirstUseChecker } from "../engine/first-use.mjs";
import { createNameCatalog, createNamesReport, namesReportFinding } from "../engine/names.mjs";
// The one place a link finding is worded, shared with both builds.
import { linkFindingMessage } from "../engine/wikilink-syntax.mjs";
import {
    emitDiagnostic,
    positionOfFrontmatterPath,
    positionOfLiteral,
    positionOfYamlPath,
} from "../engine/diagnostics.mjs";
import { reportFindings } from "./report.mjs";
import {
    readItemAddresses,
    diffItemAddresses,
    noteFilesById,
    locateAddressFinding,
    addressFindingMessage,
} from "../engine/address-diff.mjs";
import { emittedArtFor, itemPackJsonDirs } from "../engine/generate.mjs";
import { buildMaps, FROM_ALL, MAP_DIR } from "../engine/map-build.mjs";
import { CHART_HORIZON_DAYS } from "../engine/map-layout.mjs";
import { GRAPHVIZ_ENGINES } from "../engine/map-graphviz.mjs";
import { loadMapWorld } from "../engine/map-places.mjs";
import { encodeAddresses } from "../engine/address-values.mjs";
import YAML from "yaml";
import { reckoningContext } from "../engine/reckoning-markers.mjs";
import { BEING_LOOK_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { profileFindings } from "../engine/appearance-profile.mjs";
import { namesFindings } from "../engine/language-names.mjs";
import { parseAddress, renderAddress } from "../engine/address.mjs";
import { cultureKey, generateNpc, npcDefaults, npcSpecProblems } from "../engine/npc-generate.mjs";
import { cultureFieldSource, cultureHierarchyProblems } from "../engine/culture-parents.mjs";

/**
 * The packs `unpack` extracts.
 *
 * From the configuration's own pack list, which is where the build already
 * knows them. It does not come out of the shipped manifest — a second
 * declaration of the same list, in a second format, with nothing checking that
 * the two agreed. The manifest is generated from this list now
 *, so reading it back would be a round trip through an
 * artifact that need not exist.
 *
 * Read on demand rather than at load, so `--version` and `--help` still answer
 * with no configuration present.
 *
 * @returns {Array<{name: string}>}
 */
function configuredPacks() {
    return loadPackConfig().packDirectories.map((name) => ({ name }));
}

// Configure loglevel
log.setLevel("info"); // Set desired logging level

// Configure prefix
prefix.reg(log);
prefix.apply(log, {
    format(level, _name, timestamp) {
        return `[${timestamp}] [${level.toUpperCase()}]:`;
    },
    timestampFormatter(date) {
        return date.toISOString();
    },
});

const CONTENT_SESSION = Symbol("content session");
const CONTENT_CONFIG = Symbol("content configuration");
const PREPARATION_REPORTED = Symbol("preparation reported");
const REPORTED_FAILURES = Symbol("reported preparation failures");

/**
 * Report a command's failure.
 *
 * A configuration error carries its own `file:line:column: error: ` locator,
 * and `loglevel`'s `[timestamp] [ERROR]:` prefix occupies exactly the
 * position a parser reads the path from — so a located failure is printed
 * unprefixed, as `emitDiagnostic` prints every other finding. Everything else
 * is ordinary prose and keeps the log line it always had.
 *
 * @param {unknown} err - What was thrown.
 * @returns {void}
 */
function reportFailure(err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err?.file && err?.keyPath)
        emitDiagnostic({ file: err.file, ...(err.position ?? {}), severity: "error", message });
    else if (/** @type {{located?: boolean}} */ (err)?.located) console.error(message);
    else log.error(message);
}

/** Report one shared preparation failure once in a combined invocation. */
function reportContentFailure(err, argv) {
    const reported = argv[REPORTED_FAILURES];
    if (reported?.has(err)) return;
    reported?.add(err);
    reportFailure(err);
}

/** Apply the package command's existing eligibility rule before a selected writer.
 * @param {object} config - Resolved configuration.
 * @param {string} action - The requested package action.
 */
function assertCompendiumOperation(config, action) {
    if (!compilesFoundryDocuments(config)) {
        throw new Error(
            `\`packageKind: ${config.packageKind}\` compiles no ` +
                `compendium, so there is nothing to ${action}. Build ` +
                `its site with \`package-build site\` and its book ` +
                `with \`package-build pdf\`.`,
        );
    }
}

/**
 * A note's source text, or `""` when it cannot be read.
 *
 * Used only to turn a link finding into a position. A path that does not
 * resolve — a page a build generated, a tree walked from somewhere else —
 * yields `""`, and {@link positionOfLiteral} then reports nothing, so the
 * diagnostic drops the line and column rather than guessing them.
 *
 * @param {string|undefined} file - Absolute path to the note.
 * @returns {string} The file's contents, or `""`.
 */
function readRawNote(file) {
    if (!file) return "";
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return "";
    }
}

/**
 * The declaration sets this package ships, addressable by system id.
 *
 * @type {Record<string, Record<string, readonly object[]>>}
 */
const SHIPPED_ITEM_FIELDS = { sohl: ITEM_FIELDS, hm3: HM3_ITEM_FIELDS };

/** Register the content operations on the package command line. */
export function registerContentCommands(cli) {
    return cli
        .command(
            withIndexPreflight(
                withBodyPreflight(
                    packageCommand(),
                    (_config, argv) => argv.action === "compile",
                    undefined,
                    true,
                ),
                (_config, argv) => argv.action === "compile",
            ),
        )
        .command(depsCommand())
        .command(docsCommand())
        .command(withIndexPreflight(lintCommand()))
        .command(proseCommand())
        .command(contentFormatCommand())
        .command(withIndexPreflight(linksCommand()))
        .command(contentCommand())
        .command(formatCommand())
        .command(markdownCommand())
        .command(
            withBodyPreflight(
                contentIndexCommand(),
                () => true,
                (config, argv) => argv.root || config.paths.content,
                true,
            ),
        )
        .command(withIndexPreflight(withBodyPreflight(siteCommand()), publishesContentPages))
        .command(
            withIndexPreflight(
                withBodyPreflight(pdfCommand(), (config) => Boolean(config.pdf)),
                (config) => config.pdf && publishesContentPages(config),
            ),
        )
        .command(withIndexPreflight(mapCommand()))
        .command(withIndexPreflight(reachabilityCommand()))
        .command(transliterateCommand())
        .command(lexiconCommand())
        .command(coreCommand())
        .command(addressesCommand())
        .command(withIndexPreflight(npcCommand()));
}

/** Optional sentence findings and note-level readability reports. */
function proseCommand() {
    return {
        command: "prose <action> [path]",
        describe: "Analyze note prose on demand",
        builder: (yargs) =>
            yargs
                .positional("action", { choices: ["lint", "score"], describe: "Analyze prose" })
                .positional("path", {
                    type: "string",
                    describe: "One Markdown file or a content tree",
                })
                .option("age", { type: "number", describe: "Reader age" })
                .option("threshold", {
                    type: "number",
                    describe: "Readability algorithms required (1–7)",
                })
                .option("min-words", {
                    type: "number",
                    describe: "Minimum words per sentence or note",
                })
                .option("rules", {
                    choices: ["readability", "simplify", "all"],
                    describe: "Lint rule set",
                })
                .option("fail-on-warning", {
                    type: "boolean",
                    default: false,
                    describe: "Exit unsuccessfully when lint reports suggestions",
                })
                .option("fail-outside", {
                    type: "boolean",
                    default: false,
                    describe: "Exit unsuccessfully when a scored note is outside a configured band",
                }),
        handler: async (argv) => {
            try {
                const config = loadPackConfig();
                const defaults = loadPackageBuildConfig();
                const root = argv.path ?? config.paths.content;
                const displayFile = (file) => path.relative(process.cwd(), path.resolve(file));
                if (argv.action === "score") {
                    if (
                        argv.age !== undefined ||
                        argv.threshold !== undefined ||
                        argv.rules !== undefined ||
                        argv.failOnWarning
                    ) {
                        throw new Error(
                            "--age, --threshold, --rules, and --fail-on-warning apply only to prose lint",
                        );
                    }
                    const minWords = argv.minWords ?? defaults.proseScore.minWords;
                    if (!Number.isInteger(minWords) || minWords < 1) {
                        throw new Error("minWords must be a positive integer");
                    }
                    const result = await scoreProseTree(
                        root,
                        { ...defaults.proseScore, minWords },
                        config.skipDirectories,
                    );
                    const fixed = (number, places = 1) => number.toFixed(places);
                    for (const note of result.notes) {
                        if (note.insufficient) {
                            console.log(
                                `${displayFile(note.file)}: insufficient prose (${note.words}/${minWords} words; coverage=${fixed(note.coveragePercent)}%)`,
                            );
                            continue;
                        }
                        const metrics = note.metrics;
                        const detail =
                            `flesch=${fixed(metrics.flesch)} syl/word=${fixed(metrics.syllablesPerWord, 2)} ` +
                            `mean=${fixed(metrics.meanSentenceWords)}w longest=${note.longestSentenceWords}w ` +
                            `unfamiliar=${fixed(metrics.unfamiliarWordPercent)}% ` +
                            `nominalizations/1k=${fixed(metrics.nominalizationsPer1000Words)} ` +
                            `words=${note.words} coverage=${fixed(note.coveragePercent)}%`;
                        if (note.violations.length) {
                            emitDiagnostic({
                                file: displayFile(note.file),
                                severity: "warning",
                                message: `prose-score/band: ${detail}; ${note.violations.join(", ")}`,
                            });
                        } else {
                            console.log(`${displayFile(note.file)}: ${detail}`);
                        }
                    }
                    const aggregate = result.summary;
                    console.log(
                        `Total: ${aggregate.scored} scored, ${aggregate.insufficient} insufficient, ` +
                            `${aggregate.outside} outside band; ${aggregate.words} words; ` +
                            `pooled flesch=${aggregate.flesch === null ? "n/a" : fixed(aggregate.flesch)} ` +
                            `syl/word=${aggregate.words ? fixed(aggregate.syllables / aggregate.words, 2) : "n/a"} ` +
                            `mean=${aggregate.sentences ? fixed(aggregate.words / aggregate.sentences) : "n/a"}w ` +
                            `unfamiliar=${aggregate.words ? fixed((100 * aggregate.unfamiliar) / aggregate.words) : "n/a"}% ` +
                            `nominalizations/1k=${aggregate.words ? fixed((1000 * aggregate.nominalizations) / aggregate.words) : "n/a"}`,
                    );
                    if (argv.failOutside && aggregate.outside) process.exitCode = 1;
                    return;
                }
                if (argv.failOutside) throw new Error("--fail-outside applies only to prose score");
                const options = {
                    age: argv.age ?? defaults.proseLint.age,
                    threshold: argv.threshold ?? defaults.proseLint.threshold,
                    minWords: argv.minWords ?? defaults.proseLint.minWords,
                    rules: argv.rules ?? defaults.proseLint.rules,
                };
                for (const [key, value] of Object.entries(options)) {
                    if (key === "rules") continue;
                    if (
                        !Number.isInteger(value) ||
                        value < 1 ||
                        (key === "threshold" && value > 7)
                    ) {
                        throw new TypeError(
                            `${key} must be ${key === "threshold" ? "an integer from 1 to 7" : "a positive integer"}`,
                        );
                    }
                }
                const findings = await lintProse(root, options, config.skipDirectories);
                for (const finding of findings) {
                    emitDiagnostic({ ...finding, file: displayFile(finding.file) });
                }
                log.info(`${findings.length} prose suggestion(s).`);
                if (argv.failOnWarning && findings.length) process.exitCode = 1;
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/** Refuse invalid note bodies before emitting metadata, packs, pages or a book. */
function withBodyPreflight(
    command,
    shouldCheck = () => true,
    contentRoot = (config) => config.paths.content,
    shareCapture = false,
) {
    const handler = command.handler;
    return {
        ...command,
        handler: async (argv) => {
            let owned;
            try {
                const config = argv[CONTENT_CONFIG] ?? loadPackConfig();
                let next = argv;
                if (shouldCheck(config, argv)) {
                    const contentBase = contentRoot(config, argv);
                    if (!fs.existsSync(contentBase)) return handler(argv);
                    const session =
                        shareCapture ?
                            (argv[CONTENT_SESSION] ??
                            (owned = await createContentSession({ config, contentBase })))
                        :   undefined;
                    const records = session?.records ?? indexRecordsFor({ config, contentBase });
                    if (session?.problems.length) {
                        for (const problem of session.problems) emitDiagnostic(problem);
                        process.exitCode = 1;
                        return;
                    }
                    const { findings } = lintNoteStates(contentBase, {
                        records,
                        parsed: session?.parsed,
                        contentPackage: config.contentPackage,
                    });
                    const errors = findings.filter((finding) => finding.severity === "error");
                    if (errors.length) {
                        for (const finding of errors) emitDiagnostic(finding);
                        process.exitCode = 1;
                        return;
                    }
                    if (session) next = { ...argv, [CONTENT_SESSION]: session };
                }
                return await handler(next);
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
                return;
            } finally {
                owned?.dispose();
            }
        },
    };
}

/** Check declared dependency indexes before an index-consuming command does any work. */
function withIndexPreflight(command, shouldCheck = () => true) {
    const handler = command.handler;
    return {
        ...command,
        handler: async (argv) => {
            let config;
            try {
                config = loadPackConfig();
                if (shouldCheck(config, argv)) cachedMetadataIndexes(config);
            } catch (err) {
                if (config) {
                    emitDiagnostic({
                        file: packConfigPath(),
                        severity: "error",
                        message: err instanceof Error ? err.message : String(err),
                    });
                } else reportFailure(err);
                process.exitCode = 1;
                return;
            }
            return handler({ ...argv, [CONTENT_CONFIG]: config });
        },
    };
}

/**
 * `docs item-fields` — render this repository's item-frontmatter reference.
 *
 * The page is generated from the `fields` each `itemBuilders` entry declares,
 * so every consuming repository documents *its own* registry with the same
 * command.
 *
 * **The framing comes from configuration**, because the tables are the only
 * part that is the same everywhere. A repository's `docs.itemFields` says what
 * the page is called, where it is filed, and what a reader is told before the
 * tables start — the "See also" line its section carries, the paragraph
 * explaining what the page covers. Those were the whole reason a consumer wrote
 * a script around this renderer instead of calling the command.
 *
 * `--check` compares against the file already there rather than writing it, so
 * a repository can gate on the page being current without a temporary file or a
 * second implementation of the comparison. Staleness is a property of the whole
 * generated file, so there is no line to name.
 *
 * **A destination under the content tree gets a note envelope**, so the walk
 * that collects every note by its `type:` picks this one up too, rather than
 * silently dropping it — `type: doc`, `subType: reference`, a `shortcode`
 * derived from the destination's basename, `name.full` from the title, and
 * `pack: none`; `docs.itemFields.frontmatter` deep-merges over it. `--check`
 * compares the whole file, envelope included. A destination outside the
 * content tree gets the page body alone, as before.
 *
 * `--out` and `--title` still override, for a one-off render.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function docsCommand() {
    return {
        command: "docs <action>",
        describe: "Generate and check project documentation",
        builder: (yargs) => {
            // Required and honoured, not optional and unread:
            // the handler rendered the item-field reference whatever it was
            // given, so the positional constrained what could be typed and
            // selected nothing.
            yargs.positional("action", {
                describe: "The documentation action.",
                type: "string",
                choices: ["item-fields", "links", "index"],
            });
            yargs.option("root", {
                describe: "Documentation root for the links and index checks.",
                type: "string",
                default: "docs",
            });
            yargs.option("seed", {
                describe:
                    "Text that seeds generation beside the spec, to draw a different person " +
                    "from the same spec.",
                type: "string",
            });
            yargs.option("out", {
                describe: "Write to this file instead of the configured location.",
                type: "string",
            });
            yargs.option("check", {
                describe: "Compare against the file already there; write nothing.",
                type: "boolean",
                default: false,
            });
            yargs.option("title", {
                describe: "The page's H1.",
                type: "string",
            });
        },
        handler: (argv) => {
            try {
                const { action, title, check } = argv;
                if (action === "links" || action === "index") {
                    const requestedRoot = path.resolve(argv.root);
                    const root =
                        fs.existsSync(requestedRoot) ?
                            fs.realpathSync(requestedRoot)
                        :   requestedRoot;
                    const findings = action === "links" ? checkDocLinks(root) : checkDocIndex(root);
                    for (const finding of findings) {
                        emitDiagnostic({
                            ...finding,
                            file: path.relative(process.cwd(), finding.file),
                        });
                    }
                    if (findings.length) process.exitCode = 1;
                    else
                        log.info(
                            `Documentation ${action} check passed for ${path.relative(process.cwd(), root) || "."}.`,
                        );
                    return;
                }
                // Dispatched on, so a second document added here cannot
                // silently render the first. yargs' `choices` has already
                // rejected anything unlisted, so the default is unreachable by
                // a caller — it guards a choice added above without a branch.
                if (action !== "item-fields") {
                    throw new Error(`docs: unhandled document "${action}".`);
                }

                const config = loadPackConfig();
                const spec = config.docs?.itemFields ?? {};
                const destination =
                    argv.out ?? (spec.out ? path.resolve(config.rootDir, spec.out) : null);
                const pageTitle = title ?? spec.title ?? "Item Note Frontmatter";

                const body = `${renderItemFieldReference({
                    title: pageTitle,
                    ...(spec.preamble ? { preamble: spec.preamble } : {}),
                    generatedBy: "`package-build docs item-fields`",
                    config,
                })}\n`;
                // A page filed under the content tree is walked for its
                // `type:` like any other note, so it needs the envelope; one
                // filed anywhere else — a repository's own `docs/` — is not,
                // and gets exactly the body it always did.
                const page =
                    destination ?
                        renderItemFieldsPage(body, {
                            title: pageTitle,
                            destination,
                            contentRoot: config.paths.content,
                            frontmatter: spec.frontmatter,
                        })
                    :   body;

                if (check) {
                    if (!destination) {
                        throw new Error(
                            "docs: --check needs a file to compare against. " +
                                "Declare `docs.itemFields.out` in " +
                                "package-build.config.yaml, or pass --out.",
                        );
                    }
                    const relative = path.relative(config.rootDir, destination);
                    const current =
                        fs.existsSync(destination) ? fs.readFileSync(destination, "utf8") : "";
                    if (current !== page) {
                        // Staleness belongs to the whole file, so no line is
                        // named — the diagnostics contract drops a field it
                        // cannot supply rather than guessing one. Routed
                        // through `emitDiagnostic`, not `log.error`, so the
                        // path starts the line unprefixed by loglevel's
                        // `[timestamp] [ERROR]:` banner — the same reason
                        // every other located failure in this file uses it.
                        emitDiagnostic({
                            file: relative,
                            severity: "error",
                            message:
                                "out of date with the item-field declarations " +
                                "— run `package-build docs item-fields` and " +
                                "commit the regenerated file",
                        });
                        process.exitCode = 1;
                        return;
                    }
                    log.info(`${relative} is up to date.`);
                    return;
                }

                if (destination) {
                    fs.mkdirSync(path.dirname(destination), {
                        recursive: true,
                    });
                    fs.writeFileSync(destination, page);
                    log.info(`Wrote ${path.relative(config.rootDir, destination)}`);
                } else {
                    process.stdout.write(page);
                }
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `package-build content-format` — check the format specification itself.
 *
 * Two checks, because the specification makes claims about two different
 * worlds, and they fail for different reasons and at different times:
 *
 * - `schema` compares every `system.*` target the document names against the
 *   naming system's published `schema.json`. A failure means the specification
 *   and the system disagree, which is a defect in one of the two.
 * - `fields` compares declared field mappings with compiler declarations.
 *
 * The shipped contract is `engine/content-format.yaml`; guide layout does not
 * participate in validation.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function contentFormatCommand() {
    return {
        command: "content-format <action>",
        describe: "Check the content format specification against schemas and field declarations",
        builder: (yargs) =>
            yargs
                .command(contentFormatSchemaCommand())
                .command(contentFormatFieldsCommand())
                .demandCommand(1, "Name an action.")
                .strict(),
        handler: () => {},
    };
}

/**
 * The parsed specification a `content-format` action should read.
 *
 * @param {object} argv - The parsed command line.
 * @returns {import("../engine/content-format.mjs").ContentFormat} The document.
 */
function specFrom(argv) {
    return argv.spec ? loadContentFormat(path.resolve(argv.spec)) : loadContentFormat();
}

/**
 * `content-format schema` — every `system.*` target, against a published schema.
 *
 * The schemas are named on the command line as `<system>=<path>`, because a
 * consumer holds one and this repository holds a committed fixture, and neither
 * arrangement should be the one the other has to pretend to. A system the
 * document maps onto but no schema was supplied for is reported as unchecked —
 * HM3 publishes no artifact today, so that is the ordinary case for a fifth of
 * the claims, and a check that quietly skipped them would read as one that
 * passed.
 *
 * @returns {object} The yargs command module.
 */
function contentFormatSchemaCommand() {
    return {
        command: "schema",
        describe: "Check every `system.*` target the format names against a published schema.json",
        builder: (yargs) => {
            yargs.option("spec", {
                describe:
                    "The format contract to read. Defaults to the engine/content-format.yaml this package ships.",
                type: "string",
            });
            yargs.option("schema", {
                describe:
                    "A published schema, as `<system>=<path>`. Repeatable; a system with none is reported unchecked.",
                type: "string",
                array: true,
                demandOption: true,
            });
        },
        handler: (argv) => {
            try {
                const format = specFrom(argv);
                /** @type {Record<string, object>} */
                const schemas = {};
                for (const entry of argv.schema) {
                    const at = String(entry).indexOf("=");
                    if (at <= 0) {
                        log.error(`--schema takes \`<system>=<path>\`, not "${entry}".`);
                        process.exitCode = 1;
                        return;
                    }
                    const system = entry.slice(0, at);
                    const file = path.resolve(entry.slice(at + 1));
                    schemas[system] = JSON.parse(fs.readFileSync(file, "utf8"));
                }

                const { findings, checked, unchecked } = checkSchemaTargets({ format, schemas });
                for (const finding of findings) emitDiagnostic(finding);
                for (const [system, count] of Object.entries(unchecked)) {
                    log.info(
                        `${count} claim(s) about ${system} are unchecked — no ` +
                            `schema was supplied for it, so nothing here confirms them.`,
                    );
                }
                if (findings.length) {
                    log.error(
                        `${findings.length} of ${checked} checked claim(s) name a ` +
                            `field no schema declares.`,
                    );
                    process.exitCode = 1;
                } else {
                    log.info(`${checked} mapping claim(s) confirmed against the supplied schemas.`);
                }
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * The field declarations a `content-format fields` run should compare against.
 *
 * Either this package's own shipped registry, named on the command line, or the
 * consuming repository's resolved configuration. Both are real arrangements and
 * neither should have to pretend to be the other: this repository ships the
 * specification *and* the SoHL declarations and configures no content tree,
 * while a consumer configures `itemBuilders` and resolves the specification
 * from its toolchain.
 *
 * @param {object} argv - The parsed command line.
 * @returns {{itemFields: Record<string, readonly object[]>, system: string}}
 *   The declarations, and the system column of the mapping tables they compile.
 */
function declarationsFrom(argv) {
    if (argv.fields) return { itemFields: SHIPPED_ITEM_FIELDS[argv.fields], system: argv.fields };
    const config = loadPackConfig();
    const system = config.stats?.systemId;
    if (!system) {
        throw new Error(
            "package-build: this repository's configuration names no system, so " +
                "nothing says which column of the format's mapping tables its " +
                "`itemBuilders` declarations compile. Name a shipped set with " +
                "`--fields <system>` instead.",
        );
    }
    return { itemFields: config.itemFields ?? {}, system };
}

/**
 * `content-format fields` — the per-type tables, against the declarations.
 *
 * The specification hand-writes a `data` table under most of its type sections,
 * covering ground {@link module:engine/field-reference} already generates from
 * the `fields` on each `itemBuilders` entry — the duplication that module exists
 * to prevent, one document over.
 *
 * **Checked, not merged.** The document's vocabulary spans note types that
 * produce Scenes, Macros and JournalEntries, which no item registry covers, so
 * there is no wholesale generation to fall back on. What the two *can* be held
 * to is agreement where they both speak: a mapping row saying `data.weight`
 * reaches `system.weightBase` and a declaration writing `weight` to `weightBase`
 * are one statement made twice, and a rename that moves only one of them is a
 * defect. A type only one side describes is named as out of reach rather than
 * skipped in silence.
 *
 * @returns {object} The yargs command module.
 */
function contentFormatFieldsCommand() {
    return {
        command: "fields",
        describe: "Check the format's per-type tables against the field declarations",
        builder: (yargs) => {
            yargs.option("spec", {
                describe:
                    "The format contract to read. Defaults to the engine/content-format.yaml this package ships.",
                type: "string",
            });
            yargs.option("fields", {
                describe:
                    "A declaration set this package ships, by system id. Defaults to the consuming repository's own `itemBuilders`.",
                type: "string",
                choices: Object.keys(SHIPPED_ITEM_FIELDS),
            });
            yargs.option("coverage", {
                describe:
                    "List, per type, the fields only one side names. They are not findings — the two vocabularies differ by design until the corpus moves.",
                type: "boolean",
                default: false,
            });
        },
        handler: (argv) => {
            try {
                const format = specFrom(argv);
                const { itemFields, system } = declarationsFrom(argv);
                const result = checkDeclaredFields({ format, itemFields, system });
                for (const finding of result.findings) emitDiagnostic(finding);

                // Named rather than left implicit: a check that silently
                // compared nine of twenty-two types would read as one that
                // covered them all.
                log.info(
                    `${result.checked.length} type(s) compared against ${system}'s ` +
                        `declarations (${result.fields} field pair(s)).`,
                );
                log.info(
                    `${result.skipped.spec.length} type(s) the format declares are ` +
                        `out of reach — no \`itemBuilders\` entry covers them: ` +
                        `${result.skipped.spec.join(", ")}.`,
                );
                if (result.skipped.registry.length) {
                    log.info(
                        `${result.skipped.registry.length} declared type(s) the ` +
                            `format names no section for: ` +
                            `${result.skipped.registry.join(", ")}.`,
                    );
                }
                if (argv.coverage) {
                    for (const entry of result.coverage) {
                        log.info(
                            `${entry.type}: format only [${entry.specOnly.join(", ")}], ` +
                                `declaration only [${entry.registryOnly.join(", ")}]`,
                        );
                    }
                }

                if (result.findings.length) {
                    log.error(
                        `${result.findings.length} of ${result.fields} compared field ` +
                            `pair(s) disagree between the specification and the ` +
                            `declaration that compiles them.`,
                    );
                    process.exitCode = 1;
                }
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `package-build lint` — check a content tree's addresses.
 *
 * Deliberately independent of the pack pipeline: it compiles nothing, opens no
 * LevelDB and needs no Foundry manifest, so it runs in a second and can gate a
 * commit. The content root comes from the consuming repository's
 * `package-build.config.yaml` unless one is named on the command line, so the
 * usual invocation takes no arguments at all.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function lintCommand() {
    return {
        command: "lint [root]",
        describe: "Check a content tree's addresses and frontmatter",
        builder: (yargs) => {
            yargs.positional("root", {
                describe: "Content tree to lint. Defaults to the configured contentBase.",
                type: "string",
            });
            yargs.option("references", {
                describe:
                    "Check that a frontmatter shortcode reference lands. Turn off for a tree whose cross-package references it cannot see.",
                type: "boolean",
                default: true,
            });
        },
        handler: async (argv) => {
            let session;
            try {
                const config =
                    argv[CONTENT_SESSION]?.config ?? argv[CONTENT_CONFIG] ?? loadPackConfig();
                const root = argv.root ?? config.paths.content;

                // The corpus, enumerated once for this command and handed to
                // every pass below, rather than derived again by each.
                // The address lint reads it, the `sql` tables select over it
                // and the link index is built from it, so no two findings this
                // command reports can be drawn from different ideas of which
                // files the content is.
                //
                // A note the index cannot record is reported like any other
                // finding rather than thrown: one malformed note must
                // not take every other finding in the tree with it, and the
                // reader needs a line to open, not a stack.
                const indexStarted = performance.now();
                session =
                    argv[CONTENT_SESSION] ??
                    (await createContentSession({ config, contentBase: root }));
                session.assertContext({ config, contentBase: root });
                const { problems: corpusProblems, parsed, records } = session;
                const indexMs = performance.now() - indexStarted;
                if (!argv[PREPARATION_REPORTED])
                    for (const problem of corpusProblems) emitDiagnostic(problem);
                // An error whatever the command's own strictness: the note is
                // absent from every answer below, so reporting it and exiting 0
                // would call the tree clean while silently omitting a note.
                if (corpusProblems.length) process.exitCode = 1;

                const sqlStarted = performance.now();
                const sqlTables = await session.sqlTables("all");
                const sqlMs = performance.now() - sqlStarted;
                const validationStarted = performance.now();

                // The package is passed for the homepage rule, which
                // names the address a tree with no front page fails to serve.
                const addresses = lintContentTree(root, {
                    contentPackage: config.contentPackage,
                    skipDirectories: config.skipDirectories,
                    config,
                    records,
                });
                // One index, built once, for the reference check. It is the
                // same resolver the wikilink audit uses, so a frontmatter
                // reference and a body link answer the same way.
                const index = await session.audit("lint");
                const catalog = createNameCatalog({ records, index });
                const firstUseChecker = createFirstUseChecker({
                    records,
                    index,
                    parsed: session.parsed,
                    syntax: session.syntax,
                    catalog,
                });
                const names = namesReportFinding(
                    createNamesReport({ package: config.contentPackage, records, catalog }),
                    { contentBase: root },
                );
                // Which system blocks this tree carries, derived from what it
                // declares it ships for. Read before the lint so the
                // systems it will *not* check can be said out loud below.
                // `schemaSystem` names whose vocabulary the `schemas` below
                // are. They are `sohl/note-schemas.mjs`, imported here
                // unconditionally, so this states a fact about this file rather
                // than introducing one — and it is what lets a type no item
                // registry declares, `being` above all, be checked at all.
                const systemBlocks = systemBlocksFor(config, { schemaSystem: "sohl" });
                const uncheckedSystems = declaredSystems(config).filter(
                    (system) => !(system in systemBlocks),
                );
                if (uncheckedSystems.length) {
                    // Said out loud for the reason the missing schema artifact
                    // is: a check that quietly does nothing is indistinguishable
                    // from one that passed, and the thing going unchecked here
                    // is a closed region whose unknown keys the compiler drops
                    // without a word. `harn-ensemble` is the tree this names —
                    // two systems declared through its packs and an
                    // `itemBuilders` registry for neither.
                    log.info(
                        `No \`itemBuilders\` registry declares the vocabulary of ` +
                            `${uncheckedSystems.map((s) => `\`${s}\``).join(" or ")}, so ` +
                            `${
                                uncheckedSystems.length === 1 ?
                                    "that system's block is"
                                :   "those systems' blocks are"
                            } unchecked — a key inside one is discarded at ` +
                            `compile with no warning. Declare ` +
                            `\`itemBuilders: [${declaredSystems(config).join(", ")}]\`.`,
                    );
                }
                const frontmatter = lintFrontmatter(index, {
                    currentDate: config.currentDate,
                    schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                    // The closed frontmatter regions. Passed in rather
                    // than reached for, so the linter stays a checker of
                    // whatever it is handed and this stays the one place that
                    // decides which vocabulary a tree is held to.
                    vocabulary: NOTE_VOCABULARY,
                    // The pack names, for a `data:` field keyed by pack — a
                    // folder's `parent` is one. Companions included:
                    // the compile asks the map for whichever pack it is
                    // writing, and a companion is a pack it writes.
                    packs: config.packDirectories,
                    // What art each type actually reaches its document through,
                    // asked of the passes rather than listed here. This
                    // is the one place that decides what a tree is held to, so
                    // it is where the derivation is handed over — the linter
                    // states no list of iconless types of its own.
                    emittedArt: emittedArtFor,
                    // Handed over for the same reason the vocabulary is: the
                    // linter checks the blocks it is given and names no system
                    // itself. Until this it was given none, so every tree was
                    // held to a `sohl:` whatever system it ships for — and an
                    // `hm3:` block went unread, which is a key discarded at
                    // compile in silence.
                    systems: systemBlocks,
                    references: argv.references,
                });

                // What the builders emit, against what the receiving system
                // declares. Reported here rather than at compile: it is
                // a property of the *declarations*, not of any one note, so it
                // is the same answer for every document and belongs where a
                // reader is already being told about the vocabulary.
                const schema = resolveSchemaArtifact(config);
                const schemaFindings = [];
                if (!schema && config.stats?.systemId) {
                    // Said out loud, because a check that quietly does nothing
                    // is indistinguishable from one that passed — and this
                    // whole issue exists because a defect went unnoticed for a
                    // release. A system before its first schema build, or a
                    // module pinning a version released before the artifact
                    // existed, lands here.
                    log.info(
                        `No published schema for ${config.stats.systemId}` +
                            `@${config.stats.systemVersion ?? "?"}, so emitted ` +
                            `\`system\` fields are unchecked. A system ` +
                            `generates its own; a module gets one from ` +
                            `\`package-build deps fetch\`.`,
                    );
                }
                const fieldSpecs = config.itemFields ?? {};
                const comparable = Object.keys(fieldSpecs).length > 0;
                if (schema && !comparable) {
                    // A schema, and nothing to compare it against. The emitted
                    // side of this check is the `fields:` of `itemBuilders`, so
                    // a package whose compendium content is committed JSON
                    // rather than built from field declarations has an empty
                    // one — and every field the system declares would be
                    // reported as unemitted. That is hundreds of findings whose
                    // only content is that this package does not build
                    // documents this way, which is not news and not a defect.
                    //
                    // Said out loud rather than skipped in silence, for the
                    // same reason the absent-schema case is: a check that
                    // quietly does nothing reads exactly like one that passed.
                    log.info(
                        `Read ${config.stats?.systemId ?? "the system"}'s ` +
                            `schema, but this package declares no ` +
                            `\`itemBuilders\` field specifications — so there ` +
                            `is nothing to compare it against and the ` +
                            `emitted-versus-declared check does not apply.`,
                    );
                }
                if (schema && comparable) {
                    const { undeclared, unemitted } = compareFields({
                        builders: fieldSpecs,
                        artifact: schema.artifact,
                        // A schema is keyed by document subtype and a field
                        // declaration by note type, and the two can differ, so
                        // joining them by name would drop findings without
                        // saying so — the seam exists for exactly this.
                        subtypeOf: (type) => schemaSubtypeOf(config.stats?.systemId, type),
                    });
                    for (const f of undeclared) {
                        schemaFindings.push({
                            file: schema.source,
                            severity: "error",
                            message: undeclaredMessage(f),
                        });
                    }
                    for (const f of unemitted) {
                        // Advisory: a field the system fills at runtime, or one
                        // added ahead of the content that will use it, is not a
                        // defect.
                        emitDiagnostic({
                            file: schema.source,
                            severity: "warning",
                            message: unemittedMessage(f),
                        });
                    }
                }

                // The charset the tree is held to, so a book can pick its face.
                // Run over the raw files rather than the parsed notes:
                // the subject is every character authored, including the ones
                // that stopped a note parsing at all.
                const charset = lintContentCharset(root, {
                    sources: session.sources,
                    skipDirectories: config.skipDirectories,
                });

                // The spelling of every content and picture path, held to
                // printable ASCII. Walked from the directory entries rather
                // than the parsed notes, so a picture, which has no note,
                // is covered by the same rule.
                const pathCharset = lintPathCharset({
                    inventory: session.inventory,
                    contentBase: root,
                    assetsBase: config.paths.assets,
                    skipDirectories: config.skipDirectories,
                });

                // The names the charset check leaves room for. An icon
                // the registry does not declare renders as its own literal
                // text, which is visible but easy to publish, so it is reported
                // here rather than left for a reader to notice.
                //
                // The configured registry — the shipped table with this
                // package's own entries merged over it, which is where a
                // Game-Icons glyph becomes a name a note may write.
                const icons = lintContentIcons(root, {
                    sources: session.sources,
                    skipDirectories: config.skipDirectories,
                    registry: config.icons,
                });

                // The markup the charset check cannot see. Class names are
                // ASCII, so a page of `<i class="fa-…">` is allowlist-clean and
                // still unrenderable in a book — the character rule one level
                // up.
                const html = lintContentHtml(root, {
                    sources: session.sources,
                    skipDirectories: config.skipDirectories,
                });

                // The width and position an image states. Refused rather than
                // reported, because an unrecognised value rendering as the
                // ordinary width looks exactly like a directive that worked —
                // so these are errors and they fail the run.
                const images = lintContentImages(root, {
                    sources: session.sources,
                    skipDirectories: config.skipDirectories,
                    // Which packages this build can reach is configuration, and
                    // an address naming one it cannot reaches a journal as a
                    // path that resolves against nothing.
                    config,
                });

                // A list item opened with `[ ]` or `[x]` — nothing here is
                // miscompiled, since every surface sets the marker as the
                // item's own text and all three agree, so this is advisory.
                const taskLists = lintContentTaskLists(root, {
                    sources: session.sources,
                    skipDirectories: config.skipDirectories,
                });

                // Whether every note has a body, and how
                // finished the tree is. The counts and the oldest drafts are
                // prose rather than findings: a note nobody has finished is not
                // wrong, and 464 warnings a reader cannot clear is how a report
                // teaches its reader to stop looking at it.
                const states = lintNoteStates(root, {
                    parsed,
                    records,
                    contentPackage: config.contentPackage,
                });
                for (const line of states.summary) log.info(line);

                // Generated art, when this package declares it carries none.
                // `records` already holds every asset of this build, so the
                // check is a filter over the corpus already in hand rather
                // than a second enumeration of the asset trees.
                const generatedArt =
                    config.forbidGeneratedArt ?
                        records
                            .filter(isAssetRecord)
                            .filter((record) => record.asset.ai === true)
                            .map((record) => ({
                                file: path.join(config.paths.assets, record.asset.path),
                                severity: "error",
                                message:
                                    `\`${encodeAddresses(record.address.canonical)}\` is ` +
                                    "machine-generated art (`ai: true`), and " +
                                    "`forbidGeneratedArt` refuses it in this package",
                            }))
                    :   [];

                // A hero image against the size its slot is cut to, read
                // from the records already in hand.
                const artSizes = checkArtSlotSizes(records, {
                    config,
                    assetsBase: config.paths.assets,
                });

                // Text marked with a language, a font or a map, checked against
                // the languages this package declares, the faces it installed
                // and the maps its notes declare.
                const runs = runContext(config, records);
                const findings = [
                    ...index.notes.flatMap((note) =>
                        markupFindings(note.raw, note.file, session.syntax, runs),
                    ),
                    // Each mapping note's faces, each language's native forms
                    // and each language's `note`, against the faces and maps.
                    ...index.notes.flatMap((note) => checkMapFonts(note, runs)),
                    ...index.notes.flatMap((note) => checkScriptNoteFonts(note, runs)),
                    ...index.notes.flatMap((note) => checkLexiconNatives(note, runs)),
                    ...languageNoteFindings({ ...config, configFile: packConfigPath() }, records),
                    ...index.notes.flatMap(firstUseChecker),
                    ...(names ? [names] : []),
                    ...addresses.findings,
                    ...frontmatter.findings,
                    ...schemaFindings,
                    ...charset.findings,
                    ...pathCharset.findings,
                    ...icons.findings,
                    ...html.findings,
                    ...images.findings,
                    ...taskLists.findings,
                    ...states.findings,
                    ...generatedArt,
                    ...artSizes,
                ];
                // Only an **error** fails the run. `reportFindings` draws that
                // line, so the rule is the shared one rather than a second
                // copy here. Each finding names its own file.
                const validationMs = performance.now() - validationStarted;
                const errors = reportFindings(findings, {});
                if (errors) {
                    log.error(`${findings.length} finding(s) across ${addresses.notes} note(s).`);
                    process.exitCode = 1;
                } else if (findings.length) {
                    log.warn(
                        `${findings.length} advisory finding(s) across ` +
                            `${addresses.notes} note(s); none fails the build.`,
                    );
                } else {
                    log.info(
                        `Addresses and frontmatter are well-formed ` +
                            `(${addresses.keys} address(es) across ` +
                            `${addresses.notes} note(s)).`,
                    );
                }
                log.info(
                    `Stage timings: index ${indexMs.toFixed(1)} ms; ` +
                        `SQL ${sqlMs.toFixed(1)} ms; validation ${validationMs.toFixed(1)} ms.`,
                );
            } catch (err) {
                reportContentFailure(err, argv);
                process.exitCode = 1;
            } finally {
                if (!argv[CONTENT_SESSION]) session?.dispose();
            }
        },
    };
}

/**
 * `package-build format` — Prettier, with the shared configuration.
 *
 * Deliberately **not** scoped to the content tree, and deliberately free of the
 * pack configuration: a repository's formatting covers everything it holds, and
 * a repository that has not configured this package at all must still be able
 * to format itself. The root is therefore the working directory, not
 * `paths.content`.
 *
 * What ships here is a default. A consumer's own Prettier config wins wherever
 * it has one, and its `.prettierignore` is the only place a path is excluded —
 * which paths a repository skips is knowledge about that repository's layout,
 * and it stays there.
 *
 * It is a default that **says when it is not in force**, though. Every run first
 * reports, as warnings, each shared convention the repository's own
 * configuration resolves differently — or that it declares no configuration at
 * all, which guarantees an editor and a bare `npx prettier` disagree with this
 * command about the same tree. Nothing there fails the run: the point is
 * that a local choice is deliberate rather than silent.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function formatCommand() {
    return {
        command: "format [paths..]",
        describe: "Check formatting with the shared Prettier configuration",
        builder: (yargs) => {
            yargs.positional("paths", {
                describe: "Files or directories to check. Defaults to the whole repository.",
                type: "string",
            });
            yargs.option("write", {
                describe: "Rewrite unformatted files in place instead of reporting them.",
                type: "boolean",
                default: false,
            });
            yargs.option("check", {
                describe: "Report unformatted files without rewriting them (the default).",
                type: "boolean",
            });
        },
        handler: async (argv) => {
            try {
                // `--check` is the default, so it only has to be honoured when
                // it contradicts `--write`; naming both is a mistake worth
                // saying out loud rather than silently resolving.
                if (argv.check === true && argv.write) {
                    log.error("--check and --write ask for opposite things; name one.");
                    process.exitCode = 1;
                    return;
                }
                const root = process.cwd();
                // Before the per-file report, because it is the context for it:
                // which rules this run applied, and whether anything else in
                // the repository applies the same ones. Warnings only —
                // a consumer's config wins by design, so none of this touches
                // the exit code.
                const conventions = await checkPrettierConventions(root);
                for (const finding of conventions.findings) emitDiagnostic(finding);
                if (conventions.findings.length && conventions.configFile) {
                    log.warn(
                        `${conventions.findings.length} shared Prettier convention(s) are not ` +
                            "what this repository resolves; a deliberate local choice wins on " +
                            "purpose, so this is a warning and not a failure.",
                    );
                }
                const { findings, checked, written } = await checkFormatting(root, {
                    paths: argv.paths,
                    write: argv.write,
                });
                if (argv.write) {
                    log.info(
                        written.length ?
                            `Formatted ${written.length} of ${checked} file(s).`
                        :   `Already formatted (${checked} file(s)).`,
                    );
                    // `--write` collects findings too — a file Prettier cannot
                    // parse, or one that will not format to a fixpoint — and
                    // a run that leaves files unformatted must not report
                    // success.
                    for (const finding of findings) emitDiagnostic(finding);
                    if (findings.length) {
                        log.error(
                            `${findings.length} of ${checked} file(s) could not be formatted.`,
                        );
                        process.exitCode = 1;
                    }
                    return;
                }
                for (const finding of findings) emitDiagnostic(finding);
                if (findings.length) {
                    log.error(`${findings.length} of ${checked} file(s) are not formatted.`);
                    process.exitCode = 1;
                } else {
                    log.info(`Formatting is clean (${checked} file(s)).`);
                }
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `package-build markdown` — markdownlint, with the shared rule set.
 *
 * The structural checks Prettier cannot make: a heading level that skips, two
 * sibling headings claiming one anchor, a reversed link, an emphasis marker
 * that is not the one these repositories write. Like `format`, it runs over the
 * repository rather than the content tree, and takes its rules from this
 * package unless the consumer declares its own.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function markdownCommand() {
    return {
        command: "markdown [paths..]",
        describe: "Lint markdown with the shared markdownlint rule set",
        builder: (yargs) => {
            yargs.positional("paths", {
                describe: "Globs to lint. Defaults to every markdown file in the repository.",
                type: "string",
            });
            yargs.option("fix", {
                describe: "Apply the fixes markdownlint can make.",
                type: "boolean",
                default: false,
            });
        },
        handler: async (argv) => {
            try {
                const { findings } = await lintMarkdown(process.cwd(), {
                    paths: argv.paths,
                    fix: argv.fix,
                });
                for (const finding of findings) emitDiagnostic(finding);
                if (findings.length) {
                    log.error(`${findings.length} markdown finding(s).`);
                    process.exitCode = 1;
                } else {
                    log.info("Markdown is clean.");
                }
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/** Content operations with a shared invocation-local capture. */
function contentCommand() {
    return {
        command: "content",
        describe: "Run content operations in one in-memory session",
        builder: (yargs) =>
            yargs
                .command(withIndexPreflight(contentRunCommand()))
                .command(contentBuildCommand())
                .demandCommand(1, "Choose content run or content build."),
        handler: () => {},
    };
}

/** The complete build writes only outside the captured input roots. */
function contentBuildOutputs(config, packaging) {
    const roots = [
        config.paths.content,
        ...DEPLOYED_ASSET_TYPES.map((entry) => path.resolve(config.paths.assets, entry.root)),
    ];
    const stage = path.resolve(packaging.rootDir, packaging.stageDir);
    const outputs = [
        config.paths.contentIndex,
        config.paths.packJson,
        config.paths.stage,
        stage,
        path.join(config.rootDir, "build/calendars"),
    ];
    const contains = (parent, child) => {
        const relative = path.relative(path.resolve(parent), path.resolve(child));
        return (
            relative === "" ||
            (!relative.startsWith(`..${path.sep}`) &&
                relative !== ".." &&
                !path.isAbsolute(relative))
        );
    };
    for (const output of [...outputs, ...packaging.assets.map(({ to }) => path.resolve(stage, to))])
        for (const root of roots)
            if (contains(root, output) || contains(output, root))
                throw new Error(
                    `content build output ${output} overlaps captured input ${root}; keep build outputs outside source roots`,
                );
    return [
        ...new Set([
            config.paths.contentIndex,
            config.paths.packJson,
            path.join(config.rootDir, "build/calendars"),
            ...config.packDirectories.map((name) => path.join(config.paths.stage, name)),
        ]),
    ];
}

/** Publish, generate calendars, stage assets and check/compile one live session. */
function contentBuildCommand() {
    return {
        command: "build",
        describe:
            "Publish fresh indexes, emit calendars, stage assets, lint, check links and compile",
        builder: (yargs) =>
            yargs
                .option("calendaria-version", {
                    type: "string",
                    demandOption: true,
                    describe: "Calendaria import format version",
                })
                .check((argv) => {
                    if (!/^\d+\.\d+\.\d+$/.test(argv.calendariaVersion))
                        throw new Error("--calendaria-version requires a version such as 1.4.2");
                    return true;
                }),
        handler: async (argv) => {
            const timings = createContentTimings();
            let session;
            const shared = {
                ...argv,
                references: true,
                [PREPARATION_REPORTED]: true,
                [REPORTED_FAILURES]: new Set(),
            };
            const fail = (error) => {
                reportContentFailure(error, shared);
                process.exitCode = 1;
            };
            try {
                const config = loadPackConfig();
                const marker = path.join(config.paths.contentIndex, ".publication-ready");
                fs.rmSync(marker, { force: true });
                const packaging = loadPackageBuildConfig();
                const outputs = contentBuildOutputs(config, packaging);
                for (const output of outputs) fs.rmSync(output, { recursive: true, force: true });
                cachedMetadataIndexes(config);
                session = await createContentSession({ config, timings, trackChanges: true });
                shared[CONTENT_SESSION] = session;
                let prepared = false;
                const reportedProblems = new Set();
                try {
                    assertCompendiumOperation(config, "compile");
                    await session.prepare(["index"]);
                    prepared = true;
                } catch (error) {
                    if (error.findings) {
                        for (const finding of error.findings) {
                            emitDiagnostic(finding);
                            reportedProblems.add(finding);
                        }
                        shared[REPORTED_FAILURES].add(error);
                        process.exitCode = 1;
                    } else fail(error);
                }
                for (const problem of session.problems) {
                    if (!reportedProblems.has(problem)) emitDiagnostic(problem);
                    process.exitCode = 1;
                }
                let staged = false;
                if (
                    prepared &&
                    (await timings.measure("index publication", () =>
                        contentIndexCommand().handler(shared),
                    ))
                ) {
                    fs.writeFileSync(marker, `${config.contentPackage}\n`);
                    try {
                        await timings.measure("calendars", () => {
                            const result = emitCalendarArtifacts({
                                config,
                                calendariaVersion: argv.calendariaVersion,
                                sources: session.sources,
                            });
                            log.info(
                                `${result.calendars} calendars emitted (${result.files} files).`,
                            );
                        });
                        await timings.measure("assets", () =>
                            stagePackageBuildAssets({
                                config: packaging,
                                packConfig: config,
                                session,
                            }),
                        );
                        staged = true;
                    } catch (error) {
                        fail(error);
                    }
                    try {
                        session.assertUnchanged();
                    } catch (error) {
                        fs.rmSync(marker, { force: true });
                        throw error;
                    }
                }
                await timings.measure("validation", () => lintCommand().handler(shared));
                await timings.measure("links", () => linksCommand().handler(shared));
                if (staged)
                    await timings.measure("compile", () =>
                        packageCommand().handler({ ...shared, action: "compile" }),
                    );
            } catch (error) {
                fail(error);
            } finally {
                const summary = timings.snapshot();
                log.info(
                    `Content timings (exclusive): ${Object.entries(summary.stages)
                        .map(([name, ms]) => `${name} ${Number(ms).toFixed(1)} ms`)
                        .join("; ")}; total ${summary.totalMs.toFixed(1)} ms.`,
                );
                log.info(
                    `Content work: ${session?.sources.size ?? 0} sources; ${session?.parsed.size ?? 0} parsed notes; ${session?.records.length ?? 0} records; reuse ${JSON.stringify(summary.hits)}; peak RSS ${(process.resourceUsage().maxRSS / 1024).toFixed(1)} MiB.`,
                );
                session?.dispose();
            }
        },
    };
}

function contentRunCommand() {
    return {
        command: "run <targets..>",
        describe: "Run selected content operations with one in-memory source capture",
        builder: (yargs) =>
            yargs
                .positional("targets", { type: "string", array: true, choices: CONTENT_TARGETS })
                .option("references", {
                    type: "boolean",
                    default: true,
                    describe: "Check frontmatter references during lint",
                })
                .option("pack", {
                    type: "string",
                    describe: "Select one pack for the compile target",
                })
                .option("out", {
                    type: "string",
                    describe: "Output directory for the index target",
                }),
        handler: async (argv) => {
            let session;
            const failures = new Set();
            const problems = new Set();
            const shared = { ...argv, [PREPARATION_REPORTED]: true, [REPORTED_FAILURES]: failures };
            try {
                const config = argv[CONTENT_CONFIG] ?? loadPackConfig();
                session = await createContentSession({ config });
                shared[CONTENT_SESSION] = session;
                const targets = CONTENT_TARGETS.filter((target) => argv.targets.includes(target));
                let preparationFailed = false;
                try {
                    if (targets.includes("compile")) assertCompendiumOperation(config, "compile");
                    await session.prepare(targets);
                } catch (error) {
                    preparationFailed = true;
                    process.exitCode = 1;
                    if (error.findings) {
                        for (const finding of error.findings) {
                            emitDiagnostic(finding);
                            problems.add(finding);
                        }
                        failures.add(error);
                    } else reportContentFailure(error, shared);
                }
                for (const problem of session.problems) {
                    if (!problems.has(problem)) emitDiagnostic(problem);
                    process.exitCode = 1;
                }
                for (const target of targets) {
                    if (preparationFailed && (target === "index" || target === "compile")) continue;
                    if (target === "index") await contentIndexCommand().handler(shared);
                    else if (target === "lint") await lintCommand().handler(shared);
                    else if (target === "links") await linksCommand().handler(shared);
                    else await packageCommand().handler({ ...shared, action: "compile" });
                }
            } catch (error) {
                reportContentFailure(error, shared);
                process.exitCode = 1;
            } finally {
                session?.dispose();
            }
        },
    };
}

function linksCommand() {
    return {
        command: "links [root]",
        describe: "Check that every link in a content tree lands somewhere",
        builder: (yargs) => {
            yargs.positional("root", {
                describe: "Content tree to check. Defaults to the configured contentBase.",
                type: "string",
            });
        },
        handler: async (argv) => {
            let session;
            try {
                const config =
                    argv[CONTENT_SESSION]?.config ?? argv[CONTENT_CONFIG] ?? loadPackConfig();
                const contentBase = argv.root ?? config.paths.content;

                const scope = { skipDirectories: config.skipDirectories };
                // Enumerated once and shared, as in `lint`, and a note
                // it cannot record is reported rather than thrown.
                session =
                    argv[CONTENT_SESSION] ?? (await createContentSession({ config, contentBase }));
                session.assertContext({ config, contentBase });
                const { problems: corpusProblems } = session;
                if (!argv[PREPARATION_REPORTED])
                    for (const problem of corpusProblems) emitDiagnostic(problem);
                if (corpusProblems.length) process.exitCode = 1;
                const index = await session.audit("links");

                // An unusable manifest would otherwise surface as a pile of
                // dead addresses pointing at the notes that cite it, rather
                // than at the file at fault.
                if (index.foreign.stale.length) {
                    for (const s of index.foreign.stale) {
                        emitDiagnostic({
                            file: cachedIndexPath(config, s.package),
                            severity: "error",
                            message: `unusable content index: ${s.reason}`,
                        });
                    }
                    log.error("Re-run `package-build deps fetch`.");
                    process.exitCode = 1;
                    return;
                }

                // Readable is not the same as addressable: a key shape the
                // lookup cannot parse makes every cross-package link miss, and
                // the audit then blames the *notes*.
                const drifted = unaddressableForeignPackages(index.foreign.index);
                if (drifted.length) {
                    for (const f of drifted) {
                        console.error(formatUnaddressableFinding(f, config));
                    }
                    process.exitCode = 1;
                    return;
                }

                const {
                    deadAnchors,
                    deadAddresses,
                    deadEmbeds,
                    unlabelledLinks,
                    frontmatterLinks,
                    homepageLinks,
                    usedManifest,
                } = auditLinks(index);
                const systemReferences = index.notes.flatMap((note) =>
                    systemAddressFindings(note, {
                        index,
                        schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                        systems: systemBlocksFor(config, { schemaSystem: "sohl" }),
                    }),
                );

                // Worded by the shared table, like every finding below it: a
                // sentence written here is free to describe the same defect
                // differently from the build that also refuses it, which is the
                // drift the table exists to prevent.
                for (const d of deadAnchors) {
                    emitDiagnostic({
                        file: d.note.file,
                        ...positionOfLiteral(d.note.raw, d.text, d.occurrence),
                        severity: "error",
                        message: linkFindingMessage({
                            reason: d.reason,
                            target: d.target,
                            anchor: d.anchor,
                        }),
                    });
                }
                // Every link is an address and every address must
                // resolve, so all of these are errors — but they read
                // differently because the corrections differ. The wording comes
                // from the shared table, so the checker cannot describe a
                // defect differently from the build that also refuses it.
                for (const d of [...deadAddresses, ...unlabelledLinks, ...deadEmbeds]) {
                    emitDiagnostic({
                        file: d.note.file,
                        ...positionOfLiteral(d.note.raw, d.text, d.occurrence),
                        severity: "error",
                        // An embed's directive speaks the image vocabulary and
                        // carries its own sentence; everything else is worded
                        // by the shared table.
                        message: d.message ?? linkFindingMessage(d),
                    });
                }
                for (const f of frontmatterLinks) {
                    emitDiagnostic({
                        file: f.note.file,
                        ...positionOfLiteral(f.note.raw, f.link),
                        severity: "error",
                        message:
                            `wikilink ${f.link} authored in frontmatter at ` +
                            `${f.path} — frontmatter is data and is never resolved`,
                    });
                }
                for (const finding of systemReferences) emitDiagnostic(finding);

                // The package homepage. Its addresses are markdown links and
                // `landing:` url/href fields rather than wikilinks — it is
                // published verbatim, so nothing resolves a wikilink on it —
                // and nothing else looks at them.
                for (const h of homepageLinks) {
                    emitDiagnostic({
                        file: h.note.file,
                        ...positionOfLiteral(h.note.raw, h.text, h.occurrence),
                        severity: "error",
                        message: `${h.field}: ${h.message}`,
                    });
                }

                const failures =
                    deadAnchors.length +
                    deadAddresses.length +
                    deadEmbeds.length +
                    unlabelledLinks.length +
                    frontmatterLinks.length +
                    systemReferences.length +
                    homepageLinks.length;
                if (failures) {
                    log.error(`${failures} link problem(s) across ${index.notes.length} note(s).`);
                    process.exitCode = 1;
                } else {
                    log.info(
                        `${index.notes.length} notes: every link is a labelled ` +
                            `address, every embed names a file, every anchor ` +
                            `link lands and every address resolves ` +
                            `(${usedManifest.size} ` +
                            `cross-package reference(s) via manifest), no ` +
                            `wikilink in frontmatter, every homepage address ` +
                            `resolvable.`,
                    );
                }
            } catch (err) {
                reportContentFailure(err, argv);
                process.exitCode = 1;
            } finally {
                if (!argv[CONTENT_SESSION]) session?.dispose();
            }
        },
    };
}

/**
 * `package-build content-index` — emit this package's note index.
 *
 * Every build already walks the tree and parses every note's frontmatter, then
 * throws the result away, so nothing outside a build can ask a question about
 * the content. This publishes that walk as JSON Lines: one record per
 * note, carrying the whole frontmatter plus the note's place in the tree.
 *
 * It is a command of its own rather than only a build step because the point of
 * the artifact is that anyone can regenerate it at will — it costs a
 * frontmatter parse, not a build. That is also what lets it stay uncommitted:
 * something reproducible in under a second does not need to be kept.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function contentIndexCommand() {
    return {
        command: "content-index [root]",
        describe: "Emit this package's note index as JSON Lines",
        builder: (yargs) => {
            yargs.positional("root", {
                describe: "Content tree to read. Defaults to the configured contentBase.",
                type: "string",
            });
            yargs.option("seed", {
                describe:
                    "Text that seeds generation beside the spec, to draw a different person " +
                    "from the same spec.",
                type: "string",
            });
            yargs.option("out", {
                describe:
                    "Directory to write into. Defaults to the configured " +
                    "`paths.contentIndex`.",
                type: "string",
            });
        },
        handler: async (argv) => {
            let session;
            try {
                const config =
                    argv[CONTENT_SESSION]?.config ?? argv[CONTENT_CONFIG] ?? loadPackConfig();
                const contentBase = argv.root ?? config.paths.content;
                session =
                    argv[CONTENT_SESSION] ?? (await createContentSession({ config, contentBase }));
                session.assertContext({ config, contentBase });
                const publication = await session.publication();
                const { file, notes, bytes, full, draft, stub, dictionary, terms } =
                    emitContentIndex({
                        config,
                        publication,
                        ...(argv.root ? { contentBase: argv.root } : {}),
                        ...(argv.out ? { outDir: argv.out } : {}),
                    });
                log.info(
                    `${config.contentPackage} → ${path.relative(process.cwd(), file)} ` +
                        `(${notes} notes — ${full} full, ${draft} draft, ` +
                        `${stub} stub — ${Math.round(bytes / 1024)} KiB)`,
                );
                for (const [relation, written] of Object.entries({ dictionary, terms }))
                    log.info(
                        `${config.contentPackage} → ${path.relative(process.cwd(), written.file)} ` +
                            `(${written.rows} ${relation} rows)`,
                    );
                return true;
            } catch (err) {
                reportContentFailure(err, argv);
                process.exitCode = 1;
                return false;
            } finally {
                if (!argv[CONTENT_SESSION]) session?.dispose();
            }
        },
    };
}

/**
 * `package-build pdf` — build the books the content tree publishes as.
 *
 * The third surface, beside `package compile` and `site`. It builds every book
 * `pdf.books` declares, or the one `--book <id>` names, and takes the same
 * `--out` override the site command does, and reports what it found in the same
 * `file:line:column: severity: message` shape every other pass here uses — so
 * one editor, one CI annotator and one `grep` read all three.
 *
 * **Not building is a normal outcome, and it exits 0.** A package publishing
 * only a homepage, a package with no `pdf:` block and a package with no content
 * tree have each said they publish no book; saying so on stderr and failing the
 * command would break the release of every package that is not a book.
 *
 * @returns {object} The yargs command module.
 */
function pdfCommand() {
    return {
        command: "pdf",
        describe: "Build the content tree as one PDF per declared book",
        builder: (yargs) => {
            yargs
                .option("book", {
                    describe: "Build only the book with this `id`. Every declared book by default.",
                    type: "string",
                })
                .option("out", {
                    describe: "Write the books here instead of the configured `pdf.out`.",
                    type: "string",
                })
                .option("book-version", {
                    describe: "Stamp this version on the title page and in the file name.",
                    type: "string",
                })
                .option("list-assets", {
                    describe:
                        "Print each book's output path as JSON, in configuration order, and build nothing.",
                    type: "boolean",
                    default: false,
                })
                // Declared positively so yargs derives `--no-compile` from it;
                // an option literally named `no-compile` is rejected as unknown
                // when it is actually passed.
                .option("compile", {
                    describe: "Run the Typst compiler. `--no-compile` emits the source and stops.",
                    type: "boolean",
                    default: true,
                });
        },
        handler: async (argv) => {
            try {
                if (argv.listAssets) {
                    const assets = listBookAssets({
                        ...(argv.out ? { out: argv.out } : {}),
                        ...(argv.bookVersion ? { version: String(argv.bookVersion) } : {}),
                    });
                    console.log(JSON.stringify(assets, null, 2));
                    return;
                }
                const result = await buildPdf({
                    ...(argv.book !== undefined ? { book: String(argv.book) } : {}),
                    ...(argv.out ? { out: argv.out } : {}),
                    ...(argv.bookVersion ? { version: String(argv.bookVersion) } : {}),
                    compile: argv.compile !== false,
                });

                // The shared line, not a second copy of it: an **error** fails
                // the run and a **warning** does not. A picture the book cannot
                // carry is a warning — the entry still prints, with its caption
                // where the image would be — and a pathname no surface can
                // resolve is an error, because the same statement is wrong in
                // Foundry and on the website too.
                const errors = reportFindings(result.findings, {});
                for (const report of result.imageReports ?? []) {
                    log.info(`${report.file}: ${report.message}`);
                }

                // A reason is a deliberate no-op — the fence, an absent block,
                // an absent tree. No reason means the findings above say what
                // went wrong, and those decide the exit code.
                if (result.reason) {
                    log.info(`No book built: ${result.reason}`);
                    return;
                }

                for (const book of result.books) {
                    const { stats } = book;
                    log.info(
                        `${book.id}: ${stats.notes} entr(ies) and ${stats.prose} prose ` +
                            `file(s) across ${stats.sections} section(s)` +
                            (stats.repeated ?
                                `, ${stats.repeated} of them printed more than once`
                            :   ""),
                    );
                    log.info(`${book.id}: Typst source: ${book.typ}`);
                    if (book.pdf) log.info(`${book.id}: Book: ${book.pdf}`);
                }
                if (result.summary) {
                    for (const line of summaryLines(result.summary)) log.info(line);
                }
                if (!result.built) process.exitCode = 1;
                if (errors) process.exitCode = 1;
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * Report what a site build found, in the order {@link siteCommand} sets out:
 * the gates first, stopping at the first that fired, then each note's findings,
 * then what drawing the maps found.
 *
 * @param {object} result - From `buildSite`.
 * @returns {boolean} Whether the build may be written: no gate fired and no
 *   note is in error.
 */
function reportSiteBuild(result) {
    const { gates } = result;

    // First, because it is decided before the tree is walked and
    // before the output is cleared: a package with no front page,
    // or two competing for it, has nothing to say about its pages
    // yet.
    for (const f of gates.homepages) emitDiagnostic(f);
    for (const f of gates.frontmatterLinks) {
        emitDiagnostic({
            file: f.file,
            severity: "error",
            message:
                `wikilink ${f.link} authored in frontmatter at ` +
                `${f.path} — frontmatter is data, is copied to the ` +
                `page verbatim, and reaches the reader as brackets`,
        });
    }
    for (const f of gates.addressErrors) {
        emitDiagnostic({
            file: f.file,
            severity: "error",
            message: `cannot derive a URL: ${f.reason}`,
        });
    }
    reportSiteFindings(gates.sections ?? []);
    for (const s of gates.staleManifests) {
        emitDiagnostic({
            file: cachedIndexPath(loadPackConfig(), s.package),
            severity: "error",
            message: `unusable content index: ${s.reason}`,
        });
    }
    for (const f of gates.unaddressable) {
        console.error(formatUnaddressable(f, loadPackConfig()));
    }
    if (gatesFailed(gates)) {
        return false;
    }

    // Every note's findings are reported together: stopping at the first
    // would make a single bad table hide every other problem in the tree.
    // Each is `file:line:column: error: message`, path first — the shape
    // the pack build reports the same findings in.
    for (const e of result.tableErrors) {
        emitDiagnostic({
            file: e.source,
            line: typeof e.line === "number" ? e.line + 1 : undefined,
            column: e.column,
            severity: "error",
            message: e.reason,
        });
    }
    for (const e of result.expressionErrors) {
        emitDiagnostic(e);
    }
    for (const e of result.secretErrors) {
        emitDiagnostic({ ...e, severity: "error" });
    }
    for (const e of result.captionErrors) {
        emitDiagnostic({ ...e, severity: "error" });
    }
    for (const e of result.headingErrors) {
        emitDiagnostic({ ...e, severity: "error" });
    }
    for (const e of result.footnoteErrors) {
        emitDiagnostic({ ...e, severity: "error" });
    }
    for (const e of result.embedErrors) {
        emitDiagnostic({ ...e, severity: "error" });
    }
    // Worded by the shared table the pack build words the same finding
    // with, and located by searching the note for the link.
    for (const e of result.wikiErrors) {
        emitDiagnostic({
            file: e.file,
            ...positionOfLiteral(readRawNote(e.file), e.link, e.occurrence),
            severity: "error",
            // An embed's directive speaks the image vocabulary
            // rather than the link one, and carries its own
            // sentence; everything else is worded by the shared
            // table.
            message: e.message ?? linkFindingMessage(e),
        });
    }
    // An image whose pathname the site cannot resolve, located the
    // way a wikilink finding is: by searching the note for the
    // literal the resolver was handed.
    for (const e of result.imageErrors) {
        emitDiagnostic({
            file: e.file,
            ...positionOfLiteral(readRawNote(e.file), e.src, e.occurrence),
            severity: "error",
            message: e.message,
        });
    }
    if (siteBuildFailed(result)) return false;

    // Relation warnings do not fail a site build.
    for (const f of result.mapFindings) emitDiagnostic(f);
    return true;
}

/**
 * `package-build site` — the website commands.
 *
 * The sibling of `package compile`: the same tree, rendered as pages instead of
 * compiled into packs. `site build` renders the tree and `site serve` serves it
 * with live rebuilds; a bare `site` names them.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function siteCommand() {
    return {
        command: "site",
        describe: "Render the content tree as a website",
        builder: (yargs) =>
            yargs
                .command(
                    withIndexPreflight(
                        withBodyPreflight(siteBuildCommand()),
                        publishesContentPages,
                    ),
                )
                .command(
                    withIndexPreflight(
                        withBodyPreflight(siteServeCommand()),
                        publishesContentPages,
                    ),
                )
                .demandCommand(1, "Name a site command: build or serve."),
    };
}

/**
 * Report what the layouts, or the build's section gate, found about a site.
 *
 * A finding about a site parameter is located at the configuration's
 * `site.<param>` entry; one about a page, at the note the page was written
 * from.
 *
 * @param {readonly object[]} findings - The findings.
 */
function reportSiteFindings(findings) {
    const configFile = packConfigPath();
    const configText = fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8") : "";
    for (const finding of findings) {
        if (finding.param) {
            emitDiagnostic({
                file: path.relative(process.cwd(), configFile),
                ...positionOfYamlPath(configText, ["site", ...finding.param]),
                severity: finding.severity,
                message: finding.message,
            });
        } else {
            emitDiagnostic({
                file: finding.file ?? finding.page,
                severity: finding.severity,
                message: finding.message,
            });
        }
    }
}

/**
 * `package-build site build` — render the content tree as a website.
 *
 * Every page is drawn by the site theme from the shared renderer's HTML and
 * written under `<out>/<package>/`, with `404.html`, `sitemap.xml`, the
 * theme's stylesheets, scripts and fonts and the package's script fonts.
 * `_headers` is then written beside it and the search index built inside it,
 * as `package-build site-root` does. The site's settings and cached menu are
 * read before the tree, so a site that cannot be described fails with the
 * last good one still in place.
 *
 * @returns {object} The yargs command module.
 */
function siteBuildCommand() {
    return {
        command: "build",
        describe: "Render the content tree as a website and index it for search",
        builder: (yargs) =>
            yargs.option("out", {
                type: "string",
                describe: `The directory that is deployed (default: ${DEPLOY_ROOT})`,
            }),
        handler: async (argv) => {
            try {
                const config = argv[CONTENT_CONFIG] ?? loadPackConfig();
                const root = path.resolve(config.rootDir, argv.out ?? DEPLOY_ROOT);
                const out = siteDirectory(config, root);
                const result = await buildPackageSite({ config, out });
                // A note in error is written as its page shows it, and the
                // build fails without indexing a site that is not to be
                // deployed.
                if (!reportSiteBuild(result.built) || !result.written) {
                    process.exitCode = 1;
                    return;
                }
                reportSiteFindings(result.written.findings);
                for (const finding of result.fonts.findings) emitDiagnostic(finding);
                if (result.fonts.findings.length) {
                    process.exitCode = 1;
                    return;
                }
                log.info(
                    `wrote ${result.written.pages.length} page(s) to ` +
                        `${path.relative(process.cwd(), out)}`,
                );
                if (result.fonts.count)
                    log.info(
                        `wrote ${result.fonts.count} script font file(s) to ` +
                            `${path.relative(process.cwd(), result.fonts.dest)}`,
                    );
                const { search } = await writeSiteRoot({
                    pkg: config.contentPackage,
                    base: siteBase(config),
                    out: root,
                    search: config.site.search,
                });
                if (search) {
                    log.info(
                        `indexed ${search.pages} page(s) for search into ` +
                            `${path.relative(process.cwd(), search.dir)}`,
                    );
                }
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `package-build site serve` — serve the website, and keep it current.
 *
 * The site is built as `site build` builds it, served from the deployed root,
 * and written again as the content tree or the theme changes; every open page
 * reloads when it is. Runs until interrupted.
 *
 * @returns {object} The yargs command module.
 */
function siteServeCommand() {
    return {
        command: "serve",
        describe: "Serve the website, and rebuild and reload it as its sources change",
        builder: (yargs) =>
            yargs
                .option("port", {
                    type: "number",
                    default: 1313,
                    describe: "The port to listen on",
                })
                .option("host", {
                    type: "string",
                    default: "127.0.0.1",
                    describe: "The address to listen on",
                })
                .option("out", {
                    type: "string",
                    describe: `The directory the site is written to (default: ${DEPLOY_ROOT})`,
                }),
        handler: async (argv) => {
            try {
                const config = argv[CONTENT_CONFIG] ?? loadPackConfig();
                const root = path.resolve(config.rootDir, argv.out ?? DEPLOY_ROOT);
                const served = await serveSite({
                    config,
                    root,
                    out: siteDirectory(config, root),
                    host: argv.host,
                    port: argv.port,
                    report: (event) => {
                        if (event.kind === "error") reportFailure(event.error);
                        else if (event.kind === "failed") {
                            if (event.built) reportSiteBuild(event.built);
                            for (const finding of event.findings ?? []) emitDiagnostic(finding);
                        } else {
                            reportSiteFindings(event.findings ?? []);
                            log.info(
                                event.kind === "built" ? "built the site"
                                : event.kind === "theme" ? "drew every page again"
                                : `wrote ${event.files.map((f) => path.relative(process.cwd(), f)).join(", ")}`,
                            );
                        }
                    },
                });
                log.info(`serving ${served.url} — interrupt to stop`);
                await new Promise((resolve) => {
                    process.once("SIGINT", resolve);
                    process.once("SIGTERM", resolve);
                });
                await served.close();
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `package-build map` — draw what the place notes state.
 *
 * Reads the content index — this package's and every declared dependency's —
 * so a consumer's map draws its dependencies' places beside its own, and
 * writes under `build/map/`, always the `.dot` beside the `.svg`. Four
 * drawings: the containment tree from `parents` (`--tree`, the author's
 * check, whose anomalies are reported as findings), the map from a place
 * from its `borders` and `routes` (`--from`), the chart from a place — the
 * same drawing at a larger horizon (`--chart`, `--horizon`) — and the whole
 * route graph (`--travel`). The installed Graphviz runtime draws each map.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function mapCommand() {
    return {
        command: "map",
        describe:
            "Draw the containment tree, the map or the chart from a place, or the route graph",
        builder: (yargs) => {
            yargs
                .option("tree", {
                    describe:
                        "Draw the containment tree from `parents`: `tree.svg`, and one " +
                        "`tree-<shortcode>.svg` per continent. Reports the anomalies.",
                    type: "boolean",
                    default: false,
                })
                .option("root", {
                    describe:
                        "With --tree, draw the subtree beneath this place as " +
                        "`tree-<shortcode>.svg` and report nothing.",
                    type: "string",
                })
                .option("from", {
                    describe:
                        "Draw the map from this place as `from-<shortcode>.svg`; repeatable, " +
                        `or \`${FROM_ALL}\` for every place with a border or a route.`,
                    type: "string",
                    array: true,
                })
                .option("chart", {
                    describe:
                        "Draw the chart from this place as `chart-<shortcode>.svg` — the map " +
                        "from it at a larger horizon, the hops chaining on; repeatable, " +
                        `or \`${FROM_ALL}\` for every place with a border or a route.`,
                    type: "string",
                    array: true,
                })
                .option("horizon", {
                    describe:
                        "The charts' horizon in days, a marker of the scale: rings are " +
                        "drawn to it, and a place farther than it is left out.",
                    type: "number",
                    default: CHART_HORIZON_DAYS,
                })
                .option("travel", {
                    describe: "Draw the whole route graph as `travel.svg`.",
                    type: "boolean",
                    default: false,
                })
                .option("engine", {
                    describe: "The tree's layout engine. `twopi` is the radial one.",
                    choices: [...GRAPHVIZ_ENGINES],
                    default: "dot",
                })
                .option("rankdir", {
                    describe: "The tree's rank direction; `dot` engine only.",
                    choices: ["TB", "LR", "BT", "RL"],
                    default: "TB",
                })
                .option("nodesep", {
                    describe: "The tree's GraphViz `nodesep`, in inches.",
                    type: "number",
                })
                .option("ranksep", {
                    describe: "The tree's GraphViz `ranksep`, in inches.",
                    type: "number",
                })
                .option("scale", {
                    describe: "Multiply every node's size, font and border weight.",
                    type: "number",
                    default: 1,
                })
                // Declared positively so yargs derives `--no-polities` from it.
                .option("polities", {
                    describe:
                        "Draw polities beside their regions in the tree. `--no-polities` " +
                        "drops them.",
                    type: "boolean",
                    default: true,
                })
                .option("base", {
                    describe:
                        "The site base this package's pages are served under, ending in " +
                        "a slash; given, every name is a link to its page.",
                    type: "string",
                })
                .option("out", {
                    describe: `Directory to write into. Defaults to \`${MAP_DIR}\`.`,
                    type: "string",
                });
        },
        handler: (argv) => {
            try {
                const config = loadPackConfig();
                const outDir = argv.out ?? path.join(config.rootDir, ...MAP_DIR.split("/"));
                const problems = [];
                const world = loadMapWorld({ config, base: argv.base, problems });
                for (const problem of problems) emitDiagnostic(problem);
                if (problems.length) process.exitCode = 1;
                for (const s of world.stale) {
                    emitDiagnostic({
                        file: cachedIndexPath(config, s.package),
                        severity: "error",
                        message: `unusable content index: ${s.reason}`,
                    });
                }
                if (world.stale.length) {
                    log.error("Re-run `package-build deps fetch`.");
                    process.exitCode = 1;
                    return;
                }

                const result = buildMaps({
                    world,
                    outDir,
                    tree: argv.tree,
                    root: argv.root,
                    from: argv.from ?? [],
                    chart: argv.chart ?? [],
                    horizon: argv.horizon,
                    travel: argv.travel,
                    engine: argv.engine,
                    rankdir: argv.rankdir,
                    nodesep: argv.nodesep,
                    ranksep: argv.ranksep,
                    scale: argv.scale,
                    polities: argv.polities !== false,
                });
                const errors = reportFindings(result.findings, {});
                const svgs = result.written.filter((f) => f.endsWith(".svg"));
                log.info(
                    `${world.places.size} place(s) → ${svgs.length} drawing(s) under ` +
                        `${path.relative(process.cwd(), outDir) || "."}`,
                );
                if (errors) process.exitCode = 1;
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * The run context a mapping command reads: the content index's maps and
 * lexicons, and the configured languages and installed faces, exactly as the
 * build has them.
 *
 * @returns {{config: object, ctx: object}|undefined} The context, or
 *   `undefined` when the content tree could not be read whole, which is
 *   reported.
 */
function mappingContext() {
    const config = loadPackConfig();
    const problems = [];
    const records = indexRecordsFor({
        contentBase: config.paths.content,
        config,
        skipDirectories: config.skipDirectories,
        problems,
    });
    for (const problem of problems) emitDiagnostic(problem);
    if (problems.length) return undefined;
    return { config, ctx: runContext(config, records) };
}

/**
 * Report what a mapping command was given that names nothing: an unknown
 * language at the configuration's `languages`, and an unknown map or face at
 * the content tree, where mapping notes are. A word the rows cannot
 * capitalise is in the passage given, so it has no file.
 *
 * @param {object} config - The resolved configuration.
 * @param {{problem: string, about: string}} found - What is wrong.
 * @param {string} [lang] - The language asked for.
 */
function reportMapping(config, found) {
    if (found.about === "lang") {
        const file = packConfigPath();
        let text;
        try {
            text = fs.readFileSync(file, "utf8");
        } catch {
            text = undefined;
        }
        emitDiagnostic({
            file,
            ...(text ? positionOfYamlPath(text, ["languages"], { key: true }) : {}),
            severity: "error",
            message: found.problem,
        });
    } else if (found.about === "word")
        // A word of the passage given, which sits in no file.
        emitDiagnostic({ severity: "error", message: found.problem });
    else emitDiagnostic({ file: config.paths.content, severity: "error", message: found.problem });
    process.exitCode = 1;
}

/**
 * `package-build transliterate <map> [text..]` — map a passage exactly as the
 * build maps a run marked with the same `map=`, `lang=` and `font=`.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function transliterateCommand() {
    return {
        command: "transliterate <map> [text..]",
        describe: "Map a passage into a script exactly as the build maps a marked run",
        builder: (yargs) =>
            yargs
                .positional("map", {
                    type: "string",
                    describe: "The `data.map.name` of a mapping note",
                })
                .positional("text", {
                    type: "string",
                    array: true,
                    describe: "The passage; `-` or nothing reads it from stdin",
                })
                .option("lang", {
                    type: "string",
                    describe: "A declared language, whose lexicon is read first",
                })
                .option("font", {
                    type: "string",
                    describe:
                        "The face; the language's `data.writtenIn` face where the map is drawn in it, and required when neither it nor the map gives one",
                })
                .option("hex", {
                    type: "boolean",
                    default: false,
                    describe: "Print the code points, as `U+XXXX` separated by spaces",
                }),
        handler: async (argv) => {
            try {
                const read = mappingContext();
                if (!read) {
                    process.exitCode = 1;
                    return;
                }
                const words = (argv.text ?? []).map(String);
                const text =
                    !words.length || (words.length === 1 && words[0] === "-") ?
                        (await readStdin()).replace(/\r?\n$/, "")
                    :   words.join(" ");
                const mapped = transliterate(
                    read.ctx,
                    { map: String(argv.map), lang: argv.lang, font: argv.font },
                    text,
                );
                if ("problem" in mapped) {
                    reportMapping(read.config, mapped);
                    return;
                }
                console.log(
                    argv.hex ?
                        Array.from(
                            mapped.text,
                            (char) =>
                                `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
                        ).join(" ")
                    :   mapped.text,
                );
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `package-build lexicon <language> [--map <map>]` — every word of a language's
 * lexicon with its native form under a map, as the build writes it; with
 * `--derived`, the forms its rules derive follow, each naming its word in a
 * sixth column. Under a logographic map the third column says where a
 * word's writing comes from, `own` or `parts`, or marks it `none` or
 * `ambiguous`.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function lexiconCommand() {
    return {
        command: "lexicon <language>",
        describe: "List a language's words with their native forms under a map",
        builder: (yargs) =>
            yargs
                .positional("language", {
                    type: "string",
                    describe: "A declared language whose `note` names its language note",
                })
                .option("map", {
                    type: "string",
                    describe:
                        "The `data.map.name` of a mapping note; the language's `data.writtenIn` map where left out",
                })
                .option("font", {
                    type: "string",
                    describe:
                        "The face; the language's `data.writtenIn` face where the map is drawn in it, and required when neither it nor the map gives one",
                })
                .option("derived", {
                    type: "boolean",
                    default: false,
                    describe:
                        "Also list the forms the language's rules derive, each beside its lexicon word",
                })
                .option("json", {
                    type: "boolean",
                    default: false,
                    describe: "Print a JSON array rather than tab-separated lines",
                }),
        handler: (argv) => {
            try {
                const read = mappingContext();
                if (!read) {
                    process.exitCode = 1;
                    return;
                }
                const listed = lexiconEntries(read.ctx, {
                    lang: String(argv.language),
                    map: argv.map === undefined ? undefined : String(argv.map),
                    font: argv.font,
                    derived: Boolean(argv.derived),
                });
                if ("problem" in listed) {
                    reportMapping(read.config, listed);
                    return;
                }
                if (argv.json) console.log(JSON.stringify(listed.entries, null, 2));
                else
                    for (const entry of listed.entries)
                        console.log(
                            [
                                entry.form,
                                entry.native,
                                entry.source === undefined ?
                                    entry.exception ?
                                        "exception"
                                    :   "rows"
                                : entry.ambiguous ? "ambiguous"
                                : entry.source,
                                entry.class ?? "",
                                entry.gloss ?? "",
                                ...(argv.derived ? [entry.from ?? ""] : []),
                            ].join("\t"),
                        );
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `package-build core [--language <name>] [--json]` — the concepts of the core
 * vocabulary each covering language has no word for, by group.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function coreCommand() {
    return {
        command: "core",
        describe: "List the core concepts each covering language has no word for",
        builder: (yargs) =>
            yargs
                .option("language", {
                    type: "string",
                    describe:
                        "Report this language alone, by its name, shortcode or reference, whether or not it states `data.core`",
                })
                .option("json", {
                    type: "boolean",
                    default: false,
                    describe: "Print the report as JSON",
                }),
        handler: (argv) => {
            try {
                const config = loadPackConfig();
                const problems = [];
                const records = indexRecordsFor({
                    contentBase: config.paths.content,
                    config,
                    skipDirectories: config.skipDirectories,
                    problems,
                });
                for (const problem of problems) emitDiagnostic(problem);
                if (problems.length) {
                    process.exitCode = 1;
                    return;
                }
                const report = coreReport(records, { language: argv.language });
                if ("problem" in report) {
                    emitDiagnostic({
                        file: config.paths.content,
                        severity: "error",
                        message: report.problem,
                    });
                    process.exitCode = 1;
                    return;
                }
                if (argv.json) console.log(JSON.stringify(report, null, 2));
                else process.stdout.write(coreReportText(report));
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `package-build reachability <dir> [file]` — check that a corpus reads through.
 *
 * The corpus is named on the command line rather than declared in code, because
 * it never changes for a given repository: a consumer hardcodes the invocation
 * in `package.json` and gets the check without writing a script.
 *
 *   package-build reachability Rules --index glossary
 *   package-build reachability User_Guide --index glossary
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function reachabilityCommand() {
    return {
        command: "reachability <dir> [file]",
        describe: "Check that every document in a corpus is reachable",
        builder: (yargs) => {
            yargs.positional("dir", {
                describe: "The corpus directory, relative to the content tree root.",
                type: "string",
            });
            yargs.positional("file", {
                describe: "The corpus's entry page within that directory.",
                type: "string",
                default: "README.md",
            });
            yargs.option("index", {
                describe:
                    "Shortcode of a page walked *to* but not *through*. " +
                    "Repeatable. An index links to nearly everything it " +
                    "covers, so walking one makes the check vacuous.",
                type: "string",
                array: true,
                default: [],
            });
            yargs.option("root", {
                describe: "Content tree to read. Defaults to the configured contentBase.",
                type: "string",
            });
        },
        handler: async (argv) => {
            try {
                // Resolved once and passed on, so every pass below runs
                // against the configuration this command resolved rather than
                // whichever one the working directory answers with.
                const config = loadPackConfig();
                const contentBase = argv.root ?? config.paths.content;
                const dir = String(argv.dir).replace(/\/+$/, "");
                const scope = { skipDirectories: config.skipDirectories };
                const corpusProblems = [];
                const parsed = new Map();
                const records = indexRecordsFor({
                    contentBase,
                    config,
                    ...scope,
                    problems: corpusProblems,
                    parsed,
                });
                for (const problem of corpusProblems) emitDiagnostic(problem);
                // An error whatever the command's own strictness: the note is
                // absent from every answer below, so reporting it and exiting 0
                // would call the tree clean while silently omitting a note.
                if (corpusProblems.length) process.exitCode = 1;
                const index = buildLinkIndex(contentBase, {
                    config,
                    records,
                    ...scope,
                    sqlTables: await prepareTreeSqlTables(contentBase, {
                        config,
                        records,
                        parsed,
                        ...scope,
                    }),
                });
                const indexes = new Set(argv.index.map(String));

                const { orphans } = walkReachability(index, {
                    root: `${dir}/${argv.file}`,
                    scope: (n) => n.rel.startsWith(`${dir}/`),
                    stopAt: (n) => indexes.has(String(n.fm.shortcode)),
                });

                const total = index.notes.filter((n) => n.rel.startsWith(`${dir}/`)).length;

                for (const o of orphans) {
                    // Unreachability is a property of the whole document, so
                    // there is no line to name.
                    emitDiagnostic({
                        file: o.file,
                        severity: "error",
                        message:
                            `unreachable from ${dir}/${argv.file} — nothing ` +
                            `in ${dir} links to it`,
                    });
                }

                if (orphans.length) {
                    log.error(
                        `${orphans.length} of ${total} document(s) in ${dir} ` +
                            `cannot be arrived at by reading. A corpus is a ` +
                            `book, not a pile of notes: link each one from the ` +
                            `chapter or section that owns it.`,
                    );
                    process.exitCode = 1;
                } else {
                    log.info(
                        `All ${total} document(s) in ${dir} are reachable ` + `from ${argv.file}.`,
                    );
                }
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

// eslint-disable-next-line
/**
 * Resolve which declared dependency `--from` supplies, and cache it.
 *
 * @param {object} config - The resolved build configuration.
 * @param {{from: string, id?: string}} argv - The parsed arguments.
 * @returns {Promise<void>}
 */
async function fetchFromLocalArtifact(config, argv) {
    // Two caches, two dependency sets: an index is fetched for every declared
    // dependency, a catalogue only for those declaring `itemCatalog: true`.
    // `--from` fills whichever of them this dependency belongs to, so
    // that testing against an unreleased build behaves like a release would.
    const rels = metadataRelationships(config);
    const named = rels.map((r) => r.id).join(", ") || "none";
    const rel =
        argv.id ? rels.find((r) => r.id === argv.id)
        : rels.length === 1 ? rels[0]
        : undefined;
    if (!rel) {
        // Name the choices: the id must match a declared relationship, and the
        // config is the only place that says which those are.
        throw new Error(
            argv.id ?
                `no declared dependency "${argv.id}" (declared: ${named})`
            :   `--from needs --id when a package declares several dependencies (declared: ${named})`,
        );
    }
    await fetchMetadataFromPath(config, rel, argv.from);
    if (itemCatalogRelationships(config).some((r) => r.id === rel.id)) {
        await fetchCatalogFromPath(config, rel, argv.from);
    }
}

/**
 * `deps fetch` — fill the caches this build resolves other packages through:
 * the **content index** of every declared dependency, the **item catalogue**
 * of those additionally declaring `itemCatalog: true`, and the **site navigation** heroiclands.org
 * publishes, which the site build writes its menu from.
 *
 * The dependency sets differ deliberately. Citing another package's
 * *addresses* and embedding its *items* are separate edges, and a package may
 * declare either without the other —
 * `harn-ensemble` cites no foreign address and embeds 324,016 item
 * references. The navigation is fetched for every package, because every
 * package publishes a site.
 *
 * Its own command rather than a step of `package compile` or `site`, so that
 * neither reaches the network. A build that downloads silently is not
 * reproducible, breaks offline, and hides a dependency's version change behind
 * a passing run.
 *
 * `--from` fills the cache from a locally built artifact instead of a release,
 * which is what makes iterating across packages possible: change the system,
 * build it, and see the effect on every consumer **before** any of it ships.
 * Otherwise testing a dependency change against its consumers costs a release
 * round-trip, which makes releasing a debugging tool rather than a publishing
 * decision.
 *
 * @returns {object} The yargs command module.
 */
function depsCommand() {
    return {
        command: "deps <action>",
        describe: "Manage build-time dependencies on other packages",
        builder: (yargs) => {
            // Required, for the reason `package <action>` is: an optional
            // action exits 0 having done nothing.
            yargs.positional("action", {
                describe: "The action to perform.",
                type: "string",
                choices: ["fetch"],
            });
            yargs.option("from", {
                describe:
                    "Fill the cache from a locally built artifact — a package " +
                    "zip or the directory it was built from — instead of a " +
                    "release. Use it to test a consumer against changes that " +
                    "have not shipped.",
                type: "string",
            });
            yargs.option("id", {
                describe:
                    "Which declared dependency `--from` supplies. Only needed " +
                    "when a package declares more than one.",
                type: "string",
            });
        },
        handler: async (argv) => {
            try {
                const config = loadPackConfig();
                if (argv.from) {
                    await fetchFromLocalArtifact(config, argv);
                    return;
                }
                // First, because every package needs it and it depends on
                // nothing a repository declares: a dependency whose release
                // cannot be read stops the run after the navigation is cached,
                // not before.
                const navigation = await fetchNavigation(config);
                log.info(
                    `Fetched the site navigation to ${path.relative(process.cwd(), navigation)}.`,
                );
                const indexes = await fetchAllMetadata(config);
                if (indexes) log.info(`Fetched ${indexes} dependency content index(es).`);
                const count = await fetchAllCatalogs(config);
                if (count) log.info(`Fetched ${count} dependency catalogue(s).`);
                if (!indexes && !count) {
                    // Distinguished from a package declaring nothing at all: a
                    // relationship may still be declared, just narrowed to the
                    // Foundry manifest by `contentIndex: false` — reporting
                    // "no dependencies" there would read as though the
                    // declaration itself had gone missing.
                    const declared = Object.values(config.relationships ?? {}).some(
                        (entries) => entries?.length,
                    );
                    log.info(
                        declared ?
                            "No declared dependency needs a fetched content index or item " +
                                "catalogue."
                        :   "This package declares no dependencies.",
                    );
                }
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `addresses diff` — report every published `(type, shortcode)` this build no
 * longer publishes, against a released artifact.
 *
 * Compare this package's compiled Item addresses with the release artifact
 * named by `--from`. The command reports departed addresses and locates
 * findings against the current content tree or baseline artifact.
 *
 * `--from` accepts a release `.zip` or a directory built from one:
 *
 * ```sh
 * gh release download v0.8.2 -p system.zip -D build/baseline
 * npx package-build addresses diff --from build/baseline/system.zip
 * ```
 *
 * @param {object} config - The resolved build configuration.
 * @param {{from: string, strict?: boolean}} argv - The parsed arguments.
 * @returns {Promise<void>}
 */
async function diffAddresses(config, argv) {
    // The baseline is this package's own earlier self, so it is cached beside
    // the dependency catalogues rather than among them — a release of `sohl`
    // is not a dependency of `sohl`, and filing it as one would collide with a
    // genuine relationship of the same id.
    const cacheConfig = {
        ...config,
        paths: {
            ...config.paths,
            foreignCache: path.join(path.dirname(config.paths.foreignCache), "baseline"),
        },
    };
    const dir = await fetchCatalogFromPath(cacheConfig, { id: config.foundryPackage }, argv.from);
    // `<id>@<version>`, which is what the diagnostics name the baseline by.
    const label = path.basename(dir);

    const itemsRoot = path.join(dir, "items");
    const baselineDirs = fs.readdirSync(itemsRoot).map((name) => path.join(itemsRoot, name));
    const currentDirs = itemPackJsonDirs(config);
    if (!currentDirs.length) {
        throw new Error(
            'this repository declares no pack of type "Item", so it ' +
                "publishes no item addresses to diff",
        );
    }

    // Stated by the caller, like every other corpus read in this file:
    // the two tree reads below must agree with each other and with the compile
    // about which files are the corpus. They now do so by construction — the
    // corpus is derived once, here, and handed to both.
    const scope = { skipDirectories: config.skipDirectories };
    const corpusProblems = [];
    const records = indexRecordsFor({
        contentBase: config.paths.content,
        config,
        ...scope,
        problems: corpusProblems,
    });
    for (const problem of corpusProblems) emitDiagnostic(problem);
    // An error whatever `--strict` says: the note is in none of the answers
    // below, so exiting 0 would call the tree clean while omitting a note.
    if (corpusProblems.length) process.exitCode = 1;
    const corpus = { config, records, ...scope };

    const findings = diffItemAddresses(
        readItemAddresses(baselineDirs),
        readItemAddresses(currentDirs),
        {
            baseline: label,
        },
    );
    if (!findings.length) {
        log.info(`Every address ${label} published is still published.`);
        return;
    }

    // The tree locates a matched document; otherwise the baseline locates the
    // departed address.
    const noteFiles = noteFilesById(config.paths.content, corpus);
    const severity = argv.strict ? "error" : "warning";
    for (const finding of findings) {
        emitDiagnostic({
            ...locateAddressFinding(finding, noteFiles),
            severity,
            message: addressFindingMessage(finding),
        });
    }
    const renamed = findings.filter((f) => f.kind === "renamed").length;
    log.info(
        `${findings.length} address(es) ${label} published are no longer ` +
            `published (${renamed} renamed, ${findings.length - renamed} ` +
            `withdrawn).`,
    );
    // Retiring content is legitimate and so is renaming; neither fails a build
    // unless the caller asked for a gate.
    if (argv.strict) process.exitCode = 1;
}

function addressesCommand() {
    return {
        command: "addresses <action>",
        describe: "Compare the addresses this build publishes against a release's",
        builder: (yargs) => {
            // Required, for the reason every other action is: an
            // optional one exits 0 having compared nothing.
            yargs.positional("action", {
                describe: "The action to perform.",
                type: "string",
                choices: ["diff"],
            });
            yargs.option("from", {
                describe:
                    "The released artifact to compare against — a package " +
                    "zip, or the directory it was built from.",
                type: "string",
            });
            yargs.option("strict", {
                describe:
                    "Report findings as errors and exit non-zero, for a " +
                    "release workflow that gates on them.",
                type: "boolean",
                default: false,
            });
            // Checked while parsing, so it fails in a repository whose
            // configuration a handler would never get far enough to resolve.
            yargs.check((parsed) => {
                if (parsed.action === "diff" && !parsed.from) {
                    throw new Error(
                        "`addresses diff` needs `--from <zip|dir>`: the " +
                            "release to compare against. There is nothing to " +
                            "derive it from — a repository between releases " +
                            "has no previous artifact on disk.",
                    );
                }
                return true;
            });
        },
        handler: async (argv) => {
            try {
                await diffAddresses(loadPackConfig(), argv);
            } catch (err) {
                log.error(err.message);
                process.exitCode = 1;
            }
        },
    };
}

function packageCommand() {
    return {
        command: "package <action> [pack] [entry]",
        describe: "Compile, unpack, or clean compendium packs",
        builder: (yargs) => {
            // Required, not optional: the action *is* the work, and an
            // optional one meant `package-build package` fell through the
            // switch below and exited 0 having compiled nothing.
            yargs.positional("action", {
                describe: "The action to perform.",
                type: "string",
                choices: ["compile", "unpack", "clean"],
            });
            yargs.positional("pack", {
                describe: "Name of the pack upon which to work.",
                type: "string",
            });
            yargs.positional("entry", {
                describe:
                    "Name of any entry within a pack upon which to work. Only applicable to extract & clean commands.",
                type: "string",
            });
        },
        handler: async (argv) => {
            const { action, pack, entry } = argv;
            // yargs does not await this handler, so a rejection would surface as
            // an unhandled-rejection stack trace. Report the message and set a
            // failing exit code, so a build guard reads as a build failure.
            try {
                const config =
                    argv[CONTENT_SESSION]?.config ?? argv[CONTENT_CONFIG] ?? loadPackConfig();
                // The compile passes do not run for a package that declares no
                // packs by rule. Refused rather than exiting 0 having compiled
                // nothing: a build that succeeds and produces no documents is
                // the quiet failure this toolchain reports everywhere else.
                assertCompendiumOperation(config, action);
                // The one directory the pipeline creates rather than expects:
                // `unpack` writes the extracted JSON there and `compile` reads
                // it back. Created here rather than at module scope so that
                // asking the CLI its version needs no configuration.
                fs.mkdirSync(config.paths.unpack, {
                    recursive: true,
                });
                switch (action) {
                    // Every path and pack list the library needs is defaulted
                    // from the resolved configuration, so nothing is restated
                    // here.
                    case "compile":
                        return await compilePacks({
                            packName: pack,
                            config,
                            session: argv[CONTENT_SESSION],
                            reportPreparation: !argv[PREPARATION_REPORTED],
                        });
                    case "clean":
                        return await cleanPacks({
                            packName: pack,
                            entryName: entry,
                        });
                    case "unpack":
                        return await unpackPacks({
                            packs: configuredPacks(),
                            packName: pack,
                            entryName: entry,
                        });
                }
            } catch (err) {
                reportContentFailure(err, argv);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * Read an `npc new` spec from `--spec` or `--specfile`.
 *
 * @param {{spec?: string, specfile?: string}} argv
 * @returns {{spec: unknown, file?: string, text?: string}} The spec as parsed,
 *   and the file and text it was read from where it came from a file.
 */
function readNpcSpec(argv) {
    if (argv.spec !== undefined) {
        try {
            return { spec: JSON.parse(argv.spec) };
        } catch (err) {
            throw new Error(`\`--spec\` is not JSON: ${err.message}`);
        }
    }
    const file = argv.specfile;
    const ext = path.extname(file).toLowerCase();
    if (![".json", ".yaml", ".yml"].includes(ext))
        throw new Error(`\`--specfile\` ${file} must be a .json, .yaml or .yml file`);
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (err) {
        throw new Error(`\`--specfile\` ${file} cannot be read: ${err.message}`);
    }
    try {
        return { spec: ext === ".json" ? JSON.parse(text) : YAML.parse(text), file, text };
    } catch (err) {
        throw Object.assign(new Error(`${file}: error: ${err.message.split("\n")[0]}`), {
            located: true,
        });
    }
}

/**
 * An error located at a note, or at one key of its frontmatter where the note
 * states it.
 *
 * @param {{file?: string, raw?: string}} note - Where the note is.
 * @param {Array<string|number>} keyPath - The frontmatter key at fault, or the
 *   map a missing key belongs in.
 * @param {string} message - What is wrong.
 * @returns {Error} The error, for `reportFailure` to print as a diagnostic.
 */
function noteError(note, keyPath, message) {
    if (!note.file) return new Error(message);
    return Object.assign(new Error(message), {
        file: note.file,
        keyPath,
        position: positionOfFrontmatterPath(note.raw ?? "", keyPath, { key: true }),
    });
}

/**
 * `npc new`: resolve the spec's culture through the content tree, then the
 * culture's appearance profile, its language and the language's name lists,
 * and write the note. A missing link at any step is an error naming the note
 * to fix.
 *
 * @param {object} config - The resolved pack configuration.
 * @param {{spec?: string, specfile?: string, seed?: string, out?: string}} argv
 */
function newNpc(config, argv) {
    const { spec, file: specFile, text: specText } = readNpcSpec(argv);
    const problems = npcSpecProblems(spec);
    if (problems.length) throw new Error(`npc new: ${problems.join("; ")}`);
    if (argv.out && fs.existsSync(argv.out))
        throw new Error(`${argv.out} already exists, and \`npc new\` never overwrites a note`);

    const root = config.paths.content;
    const corpusProblems = [];
    const records = indexRecordsFor({
        contentBase: root,
        config,
        skipDirectories: config.skipDirectories,
        problems: corpusProblems,
    });
    const index = buildLinkIndex(root, {
        config,
        records,
        skipDirectories: config.skipDirectories,
    });
    const located = (hit) => ({
        file: hit.file ? path.relative(process.cwd(), hit.file) : undefined,
        raw: hit.raw,
    });

    const written = spec.data.culture;
    const key = cultureKey(written, index);
    const hit = key ? index.addressHit(key) : undefined;
    if (!hit)
        throw new Error(
            `\`data.culture\` ${JSON.stringify(written)} names no note in this package or ` +
                "its dependencies",
        );
    const culture = hit.fm ?? hit;
    if (String(culture.type ?? hit.type) !== "lore" || culture.subType !== "culture")
        throw new Error(
            `\`data.culture\` ${JSON.stringify(written)} is not a culture: it names a ` +
                `${culture.type ?? hit.type ?? "note"} of subType ${culture.subType ?? "none"}`,
        );
    const hierarchyProblems = cultureHierarchyProblems(records, key);
    for (const problem of hierarchyProblems) emitDiagnostic(problem);
    if (hierarchyProblems.some((problem) => problem.severity === "error")) {
        process.exitCode = 1;
        return;
    }
    const cultureNote = located(hit);
    const profile = culture.data?.appearanceProfile;
    if (profile === undefined || profile === null)
        throw noteError(
            cultureNote,
            ["data"],
            `${key} states no \`data.appearanceProfile\`, so \`npc new\` cannot draw its ` +
                "people's look",
        );
    const profileSource = cultureFieldSource(records, key, "appearanceProfile") ?? hit;
    const profileErrors = profileFindings(
        {
            file: located(profileSource).file,
            raw: profileSource.raw,
            fm: profileSource.fm ?? profileSource,
        },
        BEING_LOOK_VOCABULARY,
    );
    if (profileErrors.length) {
        for (const finding of profileErrors) emitDiagnostic(finding);
        throw new Error(`${key}'s appearance profile has ${profileErrors.length} problem(s)`);
    }

    const tongue = culture.data?.language;
    if (tongue === undefined || tongue === null)
        throw noteError(
            cultureNote,
            ["data"],
            `${key} states no \`data.language\`, so \`npc new\` has no name lists to draw ` +
                "from; name the language skill note its people speak",
        );
    const languageSource = cultureFieldSource(records, key, "language") ?? hit;
    const languageSourceNote = located(languageSource);
    const tuple = parseAddress(tongue, {
        package: index.contentPackage,
        system: "note",
        type: "skill",
        types: index.types,
        packages: index.packages,
    });
    const languageKey = tuple.reason ? undefined : renderAddress(tuple);
    const languageHit = languageKey ? index.addressHit(languageKey) : undefined;
    if (!languageHit)
        throw noteError(
            languageSourceNote,
            ["data", "language"],
            `${key}'s \`data.language\` names no note in this package or its dependencies`,
        );
    const language = languageHit.fm ?? languageHit;
    if (String(language.type ?? languageHit.type) !== "skill" || language.subType !== "language")
        throw noteError(
            languageSourceNote,
            ["data", "language"],
            `${key}'s \`data.language\` ${languageKey} is not a language: it names a ` +
                `${language.type ?? languageHit.type ?? "note"} of subType ` +
                `${language.subType ?? "none"}`,
        );
    const languageNote = located(languageHit);
    const names = language.data?.names;
    if (names === undefined || names === null)
        throw noteError(
            languageNote,
            ["data"],
            `${languageKey} states no \`data.names\`, so \`npc new\` has no name lists to ` +
                `draw ${key}'s names from`,
        );
    const namesErrors = namesFindings(
        { file: languageNote.file, raw: languageHit.raw, fm: language },
        BEING_LOOK_VOCABULARY,
    );
    if (namesErrors.length) {
        for (const finding of namesErrors) emitDiagnostic(finding);
        throw new Error(`${languageKey}'s name lists have ${namesErrors.length} problem(s)`);
    }

    const { taken, ...defaults } = npcDefaults(index, key);
    if (typeof spec.shortcode === "string" && taken.has(spec.shortcode))
        throw new Error(`\`shortcode: ${spec.shortcode}\` already names a being in this package`);
    let text;
    try {
        ({ text } = generateNpc(spec, {
            profile,
            names,
            language: languageKey,
            seed: argv.seed,
            currentDate: config.currentDate,
            dateContext: reckoningContext(index),
            defaults,
            taken,
        }));
    } catch (err) {
        // A name that does not fit is the spec's fault, so a spec file
        // locates it at the name it states.
        if (specFile && Array.isArray(err?.keyPath))
            Object.assign(err, {
                file: specFile,
                position: positionOfYamlPath(specText ?? "", err.keyPath),
            });
        throw err;
    }
    if (!argv.out) {
        process.stdout.write(text);
        return;
    }
    fs.mkdirSync(path.dirname(argv.out), { recursive: true });
    try {
        fs.writeFileSync(argv.out, text, { flag: "wx" });
    } catch (err) {
        if (err?.code === "EEXIST")
            throw new Error(`${argv.out} already exists, and \`npc new\` never overwrites a note`);
        throw err;
    }
}

/**
 * `package-build npc new` — a complete NPC being note from a spec, its
 * appearance drawn from its culture's profile.
 *
 * @returns {object} The yargs command module.
 */
function npcCommand() {
    return {
        command: "npc <action>",
        describe:
            "Write a new NPC being note from a spec, its culture's appearance profile and " +
            "its language's name lists",
        builder: (yargs) => {
            yargs.positional("action", {
                describe: "The action to perform.",
                type: "string",
                choices: ["new"],
            });
            yargs.option("spec", {
                describe:
                    "The spec as a JSON string: frontmatter fields, with `data.culture` and " +
                    "`data.gender` required.",
                type: "string",
            });
            yargs.option("specfile", {
                describe: "The spec as a .json, .yaml or .yml file.",
                type: "string",
            });
            yargs.option("seed", {
                describe:
                    "Text that seeds generation beside the spec, to draw a different person " +
                    "from the same spec.",
                type: "string",
            });
            yargs.option("out", {
                describe:
                    "Write the note to this new file instead of standard output. An " +
                    "existing file is never overwritten.",
                type: "string",
            });
            yargs.check((parsed) => {
                if ((parsed.spec === undefined) === (parsed.specfile === undefined))
                    throw new Error("`npc new` takes exactly one of `--spec` and `--specfile`");
                return true;
            });
        },
        handler: async (argv) => {
            try {
                newNpc(loadPackConfig(), argv);
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}
