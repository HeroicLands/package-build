#!/usr/bin/env node
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
 * The `content-build` command line — compile / unpack / clean LevelDB packs.
 *
 * A thin `yargs` front end over `../engine/compendiums.mjs`. **Every side
 * effect the pack pipeline has lives here**: argv parsing, `loglevel`
 * configuration, directory creation, reading the shipped Foundry package
 * manifest, and the process exit code. The library itself is import-safe, so a
 * consuming repository's build — or a test — can call it without any of this
 * happening (#1507).
 *
 * The side effects that need *configuration* live inside the command handler,
 * not at module scope, so `--version` and `--help` answer in a directory that
 * has neither a `package-build.config.yaml` nor a package manifest (#2).
 * Running an actual command still resolves both, and still fails loudly when
 * either is missing.
 *
 * Every path and pack name it hands the library comes from the consuming
 * repository's `package-build.config.yaml` (#1508), located by
 * `engine/pack-config.mjs`; nothing about any one repository's layout is
 * written here.
 *
 * Usage:
 *   npx content-build package compile [pack]
 *   npx content-build package unpack [pack] [entry]
 *   npx content-build package clean [pack] [entry]
 *   npx content-build docs item-fields [--out <path>] [--title <title>]
 *   npx content-build lint [root] [--no-references]
 *   npx content-build content-format schema --schema <system>=<path>
 *   npx content-build content-format fields [--fields <system>]
 *   npx content-build content-format notes [root] [--strict]
 *   npx content-build links [root] [--manifests <dir>]
 *   npx content-build format [paths..] [--write]
 *   npx content-build markdown [paths..] [--fix]
 *   npx content-build manifest [root] [--out <dir>]
 *   npx content-build site [--out <dir>]
 *   npx content-build reachability <dir> [file] [--index <shortcode>]
 *   npx content-build addresses diff --from <zip|dir> [--strict]
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
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { compilePacks, cleanPacks, unpackPacks } from "../engine/compendiums.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import {
    fetchAllCatalogs,
    fetchCatalogFromPath,
    itemCatalogRelationships,
} from "../engine/foreign-catalog.mjs";
import { renderItemFieldReference } from "../engine/field-reference.mjs";
import { lintContentTree } from "../engine/content-lint.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { loadContentFormat } from "../engine/content-format.mjs";
import {
    checkDeclaredFields,
    checkSchemaTargets,
    measureCorpus,
} from "../engine/content-format-check.mjs";
import {
    compareFields,
    resolveSchemaArtifact,
    undeclaredMessage,
    unemittedMessage,
} from "../engine/schema-check.mjs";
// The one vocabulary, loaded whole. Every content project authors the full type
// set — an adventure module ships skills, beings and magic swords — so no
// consumer gets a subset (#19, #20).
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
// The shipped declarations, so this repository can check its own specification
// against them without standing up a consumer's configuration (#136).
import { ITEM_FIELDS } from "../sohl/item-fields.mjs";
import { HM3_ITEM_FIELDS } from "../hm3/item-fields.mjs";
// The engine's own types, merged under the registry's so the vocabulary stands
// in a package that configures no `itemBuilders` at all (#51).
import { ENGINE_NOTE_SCHEMAS } from "../engine/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { checkFormatting, lintMarkdown } from "../engine/prose-lint.mjs";
import { emitLinkManifest } from "../engine/manifest-emit.mjs";
import { emitContentIndex } from "../engine/content-index.mjs";
import {
    buildSite,
    gatesFailed,
    formatUnaddressableFinding as formatUnaddressable,
} from "../engine/site-build.mjs";
import { auditLinks, buildLinkIndex, walkReachability } from "../engine/content-links.mjs";
// The one place a link finding is worded, shared with both builds (#184).
import { linkFindingMessage } from "../engine/wikilink-syntax.mjs";
import {
    emitDiagnostic,
    positionInFrontmatter,
    positionOfLiteral,
} from "../engine/diagnostics.mjs";
import { reportFindings } from "./report.mjs";
import {
    readItemAddresses,
    diffItemAddresses,
    noteFilesById,
    locateAddressFinding,
    addressFindingMessage,
} from "../engine/address-diff.mjs";
import { itemPackJsonDirs } from "../engine/generate.mjs";
import { walkMarkdownTree } from "../engine/helpers.mjs";
import {
    formatUnaddressableFinding,
    unaddressableForeignPackages,
} from "../engine/foreign-manifests.mjs";

/**
 * The packs `unpack` extracts.
 *
 * From the configuration's own pack list, which is where the build already
 * knows them. It used to come out of the shipped manifest — a second
 * declaration of the same list, in a second format, with nothing checking that
 * the two agreed. The manifest is generated from this list now
 * (package-build#9), so reading it back would be a round trip through an
 * artifact that need not exist.
 *
 * Read on demand rather than at load, so `--version` and `--help` still answer
 * with no configuration present (#2).
 *
 * @returns {Array<{name: string}>}
 */
function configuredPacks() {
    return loadPackConfig().packDirectories.map((name) => ({ name }));
}

/**
 * This package's own version, for `--version`.
 *
 * Read from the package's `package.json` rather than left to yargs, which
 * defaults to the *nearest* `package.json` walking up from the working
 * directory — inside a consuming repository that is the consumer's manifest, so
 * `content-build --version` reported the consumer's version instead of the
 * toolchain's (#1557).
 *
 * @returns {string} The `version` field of this package's manifest.
 */
function ownVersion() {
    return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
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

/**
 * Report a command's failure.
 *
 * A configuration error carries its own `file:line:column: error: ` locator
 * (#95), and `loglevel`'s `[timestamp] [ERROR]:` prefix occupies exactly the
 * position a parser reads the path from — so a located failure is printed
 * unprefixed, as `emitDiagnostic` prints every other finding. Everything else
 * is ordinary prose and keeps the log line it always had.
 *
 * @param {unknown} err - What was thrown.
 * @returns {void}
 */
function reportFailure(err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/** @type {{located?: boolean}} */ (err)?.located) console.error(message);
    else log.error(message);
}

/**
 * A note's source text, or `""` when it cannot be read.
 *
 * Used only to turn a link finding into a position. A path that no longer
 * resolves — a page a build generated, a tree walked from somewhere else —
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

const argv = yargs(hideBin(process.argv))
    .command(packageCommand())
    .command(depsCommand())
    .command(docsCommand())
    .command(lintCommand())
    .command(contentFormatCommand())
    .command(linksCommand())
    .command(formatCommand())
    .command(markdownCommand())
    .command(manifestCommand())
    .command(contentIndexCommand())
    .command(siteCommand())
    .command(reachabilityCommand())
    .command(addressesCommand())
    .version(ownVersion())
    .help()
    .alias("help", "h")
    // Every invocation this CLI accepts must be one it performs (#57). yargs
    // gives neither guarantee by default: without `demandCommand` a bare
    // `content-build` exits 0 in silence, and without `strict` an unknown
    // command or option is ignored rather than reported. Both used to read as
    // success from a `run-s` chain, so a typo in a build script passed the step
    // it was meant to run. The sibling toolchain `@heroiclands/package-build`
    // opts into the same two.
    .demandCommand(1, "Name a command.")
    .strict().argv;

/**
 * `docs item-fields` — render this repository's item-frontmatter reference.
 *
 * The page is generated from the `fields` each `itemBuilders` entry declares,
 * so every consuming repository documents *its own* registry with the same
 * command (#22).
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
 * `--out` and `--title` still override, for a one-off render.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function docsCommand() {
    return {
        command: "docs <action>",
        describe: "Generate documentation from the configured registries",
        builder: (yargs) => {
            // Required and honoured. It used to be optional and never read:
            // the handler rendered the item-field reference whatever it was
            // given, so the positional constrained what could be typed and
            // selected nothing (#57).
            yargs.positional("action", {
                describe: "The document to render.",
                type: "string",
                choices: ["item-fields"],
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

                const page = `${renderItemFieldReference({
                    ...((title ?? spec.title) ? { title: title ?? spec.title } : {}),
                    ...(spec.preamble ? { preamble: spec.preamble } : {}),
                    generatedBy: "`content-build docs item-fields`",
                    config,
                })}\n`;

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
                        // cannot supply rather than guessing one.
                        log.error(
                            `${relative}: error: out of date with the ` +
                                `item-field declarations — run ` +
                                `\`content-build docs item-fields\` and commit ` +
                                `the regenerated file`,
                        );
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
 * `content-build content-format` — check the format specification itself (#130).
 *
 * Two checks, because the specification makes claims about two different
 * worlds, and they fail for different reasons and at different times:
 *
 * - `schema` compares every `system.*` target the document names against the
 *   naming system's published `schema.json`. A failure means the specification
 *   and the system disagree, which is a defect in one of the two.
 * - `fields` compares the per-type tables against the field declarations that
 *   compile them, so the hand-written half cannot drift from the generated one
 *   (#136).
 * - `notes` measures a content tree against the vocabulary the document
 *   declares per type. During #127 it is the migration's progress bar rather
 *   than a gate, so it **reports** by default and `--strict` makes it fatal —
 *   turned on one class at a time as each slice lands.
 *
 * Both read the committed document rather than a transcription of it, so
 * editing `docs/content-format.md` changes what they assert.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function contentFormatCommand() {
    return {
        command: "content-format <action>",
        describe: "Check the content format specification against schemas and notes",
        builder: (yargs) =>
            yargs
                .command(contentFormatSchemaCommand())
                .command(contentFormatFieldsCommand())
                .command(contentFormatNotesCommand())
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
                    "The specification to read. Defaults to the docs/content-format.md this package ships.",
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
 * to prevent, one document over (#136).
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
                    "The specification to read. Defaults to the docs/content-format.md this package ships.",
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
                    "List, per type, the fields only one side names. They are not findings — the two vocabularies differ by design until #127 lands.",
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
 * `content-format notes` — a content tree, against the declared vocabulary.
 *
 * **A report, not a gate.** Every authored note predates the format, so a
 * failing check would be red in every repository from the day it lands and
 * would stay red for the length of #127 — which is a check nobody can act on.
 * `--strict` raises the findings to errors, and #127 turns it on slice by
 * slice as each class of finding reaches zero.
 *
 * @returns {object} The yargs command module.
 */
function contentFormatNotesCommand() {
    return {
        command: "notes [root]",
        describe: "Measure a content tree against the vocabulary the format declares (a report)",
        builder: (yargs) => {
            yargs.positional("root", {
                describe: "Content tree to measure. Defaults to the configured contentBase.",
                type: "string",
            });
            yargs.option("spec", {
                describe:
                    "The specification to read. Defaults to the docs/content-format.md this package ships.",
                type: "string",
            });
            yargs.option("strict", {
                describe:
                    "Fail on the findings instead of reporting them. Turned on per slice of #127, as each class reaches zero.",
                type: "boolean",
                default: false,
            });
        },
        handler: (argv) => {
            try {
                const config = loadPackConfig();
                const root = argv.root ?? config.paths.content;
                const format = specFrom(argv);

                const notes = [];
                for (const { frontmatter, absPath } of walkMarkdownTree(root, {
                    skipDirectories: config.skipDirectories,
                })) {
                    if (!frontmatter || typeof frontmatter.type !== "string") continue;
                    notes.push({
                        file: absPath,
                        fm: frontmatter,
                        raw: fs.readFileSync(absPath, "utf8"),
                    });
                }

                const { findings, byClass } = measureCorpus(notes, format, {
                    strict: argv.strict,
                });
                for (const finding of findings) emitDiagnostic(finding);

                const counts = Object.entries(byClass).sort(([a], [b]) => (a < b ? -1 : 1));
                for (const [cls, count] of counts) log.info(`${cls}: ${count}`);
                log.info(
                    `${findings.length} finding(s) across ${notes.length} note(s) ` +
                        `measured against ${format.file}.`,
                );
                if (argv.strict && findings.length) process.exitCode = 1;
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `content-build lint` — check a content tree's addresses.
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
            yargs.option("manifests", {
                describe:
                    "Directory of vendored foreign link manifests, for the reference check. Defaults to the configured `paths.manifests`.",
                type: "string",
            });
        },
        handler: (argv) => {
            try {
                const config = loadPackConfig();
                const root = argv.root ?? config.paths.content;
                const manifestDir = argv.manifests ?? config.paths.manifests;

                // The package is passed for the homepage rule (#52), which
                // names the address a tree with no front page fails to serve.
                const addresses = lintContentTree(root, {
                    contentPackage: config.contentPackage,
                });
                // One index, built once, for the reference check. It is the
                // same resolver the wikilink audit uses, so a frontmatter
                // reference and a body link answer the same way.
                const index = buildLinkIndex(root, {
                    manifestDir,
                    skipDirectories: config.skipDirectories,
                });
                const frontmatter = lintFrontmatter(index, {
                    schemas: { ...ENGINE_NOTE_SCHEMAS, ...NOTE_SCHEMAS },
                    // The closed frontmatter regions (#128). Passed in rather
                    // than reached for, so the linter stays a checker of
                    // whatever it is handed and this stays the one place that
                    // decides which vocabulary a tree is held to.
                    vocabulary: NOTE_VOCABULARY,
                    references: argv.references,
                });

                // What the builders emit, against what the receiving system
                // declares (#60). Reported here rather than at compile: it is
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
                            `\`content-build deps fetch\`.`,
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

                const findings = [
                    ...addresses.findings,
                    ...frontmatter.findings,
                    ...schemaFindings,
                ];
                // Only an **error** fails the run. Every finding was an error
                // until #142, so this changed nothing on the day it landed —
                // but a field retired in favour of another is reported while
                // both spellings still compile, and failing a build over a note
                // that produces the correct document would red a tree that has
                // done nothing wrong. `reportFindings` already draws exactly
                // that line, so the rule is the shared one rather than a second
                // copy here. Each finding names its own file.
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
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `content-build format` — Prettier, with the shared configuration.
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
                    // used to discard them, so a run that had left files
                    // unformatted still reported success and exited 0 (#125).
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
 * `content-build markdown` — markdownlint, with the shared rule set.
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

/**
 * `content-build links` — check that every link in a content tree lands.
 *
 * Reports a dead `#anchor`, a dead qualified address, and a wikilink authored
 * in frontmatter, plus a vendored manifest that has drifted out of reach. All
 * of it is package-agnostic, so a consumer needs no script of its own: the
 * manifest directory is the only thing it might name, and that comes from its
 * configuration.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function linksCommand() {
    return {
        command: "links [root]",
        describe: "Check that every link in a content tree lands somewhere",
        builder: (yargs) => {
            yargs.positional("root", {
                describe: "Content tree to check. Defaults to the configured contentBase.",
                type: "string",
            });
            yargs.option("manifests", {
                describe:
                    "Directory of vendored foreign link manifests. Defaults " +
                    "to the configured `paths.manifests`.",
                type: "string",
            });
        },
        handler: (argv) => {
            try {
                const config = loadPackConfig();
                const contentBase = argv.root ?? config.paths.content;
                const manifestDir = argv.manifests ?? config.paths.manifests;

                const index = buildLinkIndex(contentBase, { manifestDir });

                // An unusable manifest would otherwise surface as a pile of
                // dead addresses pointing at the notes that cite it, rather
                // than at the file at fault.
                if (index.foreign.stale.length) {
                    for (const s of index.foreign.stale) {
                        emitDiagnostic({
                            file: path.join(manifestDir, `${s.package}.json`),
                            severity: "error",
                            message: `unusable link manifest: ${s.reason}`,
                        });
                    }
                    log.error("Refresh the vendored copy from that package's own build.");
                    process.exitCode = 1;
                    return;
                }

                // Readable is not the same as addressable: a key shape the
                // lookup cannot parse makes every cross-package link miss, and
                // the audit then blames the *notes*.
                const drifted = unaddressableForeignPackages(index.foreign.index);
                if (drifted.length) {
                    for (const f of drifted) {
                        console.error(formatUnaddressableFinding(f, manifestDir));
                    }
                    process.exitCode = 1;
                    return;
                }

                const {
                    deadAnchors,
                    deadAddresses,
                    unlabelledLinks,
                    frontmatterLinks,
                    homepageLinks,
                    usedManifest,
                } = auditLinks(index);

                for (const d of deadAnchors) {
                    emitDiagnostic({
                        file: d.note.file,
                        ...positionOfLiteral(d.note.raw, d.text, d.occurrence),
                        severity: "error",
                        message:
                            `link [[${d.link}]] points at an anchor no ` +
                            `heading in ${d.dest.rel} declares`,
                    });
                }
                // Every link is an address (#180) and every address must
                // resolve (#184), so all of these are errors — but they read
                // differently because the corrections differ. The wording comes
                // from the shared table, so the checker cannot describe a
                // defect differently from the build that also refuses it.
                for (const d of [...deadAddresses, ...unlabelledLinks]) {
                    emitDiagnostic({
                        file: d.note.file,
                        ...positionOfLiteral(d.note.raw, d.text, d.occurrence),
                        severity: "error",
                        message: linkFindingMessage(d),
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

                // The package homepage. Its addresses are markdown links and
                // `landing:` url/href fields rather than wikilinks — it is
                // published verbatim, so nothing resolves a wikilink on it —
                // and until #54 nothing looked at them at all.
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
                    unlabelledLinks.length +
                    frontmatterLinks.length +
                    homepageLinks.length;
                if (failures) {
                    log.error(`${failures} link problem(s) across ${index.notes.length} note(s).`);
                    process.exitCode = 1;
                } else {
                    log.info(
                        `${index.notes.length} notes: every link is a labelled ` +
                            `address, every anchor link lands and every ` +
                            `address resolves (${usedManifest.size} ` +
                            `cross-package reference(s) via manifest), no ` +
                            `wikilink in frontmatter, every homepage address ` +
                            `resolvable.`,
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
 * `content-build manifest` — emit this package's cross-package link manifest.
 *
 * The last capability the library exposed without a command (#58). Every
 * consumer that publishes a manifest had to write the walk, the address
 * derivation, the anchor pass and the entry assembly for itself, and the two
 * that did drifted apart: one routed its UUIDs through the pack router and one
 * did not, so a repository shipping several packs of a type published UUIDs
 * naming the wrong one.
 *
 * Takes no paths. The content tree, the output directory, the content and
 * Foundry package identities and the address scheme all come from
 * `package-build.config.yaml`; `[root]` and `--out` exist to point the same
 * derivation at a scratch tree, not because a build needs to name them.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function manifestCommand() {
    return {
        command: "manifest [root]",
        describe: "Emit this package's cross-package link manifest",
        builder: (yargs) => {
            yargs.positional("root", {
                describe: "Content tree to read. Defaults to the configured contentBase.",
                type: "string",
            });
            yargs.option("out", {
                describe:
                    "Directory to write into. Defaults to the configured " + "`paths.manifestOut`.",
                type: "string",
            });
        },
        handler: (argv) => {
            try {
                const config = loadPackConfig();
                const { written, notes, skipped } = emitLinkManifest({
                    config,
                    ...(argv.root ? { contentBase: argv.root } : {}),
                    ...(argv.out ? { outDir: argv.out } : {}),
                });

                for (const { package: pkg, file, count } of written) {
                    log.info(
                        `${pkg} → ${path.relative(process.cwd(), file)} ` +
                            `(${count} entries, from ${notes} addressable ` +
                            `note(s))`,
                    );
                }

                // Reported rather than fatal: a note with no address is
                // ordinary — a template, a stub, a `doc` with no category —
                // and failing the build on one would make the manifest
                // unemittable for a reason that is not about the manifest.
                // Silence is the thing to avoid, since a note that quietly
                // lost its address becomes a dead link in every consumer.
                for (const s of skipped) {
                    emitDiagnostic({
                        file: path.join(argv.root ?? config.paths.content, s.file),
                        severity: "warning",
                        message: `no address, so it is absent from the manifest: ${s.reason}`,
                    });
                }
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `content-build content-index` — emit this package's note index.
 *
 * Every build already walks the tree and parses every note's frontmatter, then
 * throws the result away, so nothing outside a build can ask a question about
 * the content (#224). This publishes that walk as JSON Lines: one record per
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
            yargs.option("out", {
                describe:
                    "Directory to write into. Defaults to the configured " +
                    "`paths.contentIndex`.",
                type: "string",
            });
        },
        handler: (argv) => {
            try {
                const config = loadPackConfig();
                const { file, notes, bytes } = emitContentIndex({
                    config,
                    ...(argv.root ? { contentBase: argv.root } : {}),
                    ...(argv.out ? { outDir: argv.out } : {}),
                });
                log.info(
                    `${config.contentPackage} → ${path.relative(process.cwd(), file)} ` +
                        `(${notes} notes, ${Math.round(bytes / 1024)} KiB)`,
                );
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `content-build site` — publish the content tree as a website.
 *
 * The sibling of `package compile`: the same tree, rendered as pages instead of
 * compiled into packs (#63). Everything a consumer used to write for itself —
 * the walk, the address derivation, the address index, table expansion,
 * wikilink resolution, code-fence protection, the foreign-manifest merge and
 * the section-landing backfill — happens here, from configuration.
 *
 * **Each gate is reported and the run stops at the first that fires.** They are
 * ordered so the report names the cause rather than its symptoms: an unusable
 * manifest, reported after the links that failed because of it, reads as a pile
 * of broken notes.
 *
 * @returns {object} The yargs command module.
 */
// eslint-disable-next-line
function siteCommand() {
    return {
        command: "site",
        describe: "Build a Hugo content tree from the content tree",
        builder: (yargs) => {
            yargs.option("out", {
                describe: "Write the mount here instead of the configured `site.out`.",
                type: "string",
            });
        },
        handler: (argv) => {
            try {
                const result = buildSite({
                    ...(argv.out ? { outRoot: argv.out } : {}),
                });
                const { gates } = result;

                // First, because it is decided before the tree is walked and
                // before the output is cleared: a package with no front page,
                // or two competing for it, has nothing to say about its pages
                // yet (#52).
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
                for (const s of gates.staleManifests) {
                    emitDiagnostic({
                        file: path.join(loadPackConfig().paths.manifests, `${s.package}.json`),
                        severity: "error",
                        message: `unusable link manifest: ${s.reason}`,
                    });
                }
                for (const f of gates.unaddressable) {
                    console.error(formatUnaddressable(f, loadPackConfig().paths.manifests));
                }
                for (const c of gates.conflicts) {
                    log.error(`address ${c.key} is also published by ${c.package}`);
                }
                if (gatesFailed(gates)) {
                    process.exitCode = 1;
                    return;
                }

                // Reported after the write rather than before it: both are
                // failures of individual notes, and stopping the whole build
                // before anything is emitted would make a single bad table
                // hide every other problem in the tree.
                for (const e of result.tableErrors) {
                    log.error(`bad content table: ${e.reason}  (${e.source})`);
                }
                // Reported the way the pack build reports the very same
                // finding: `file:line:column: error: message`, path first, and
                // the message from the shared table (#184). It used to be a
                // `log.error` whose timestamp prefix sat where a parser reads
                // the path from, and whose text named a `reason` code rather
                // than saying what to do — so one authored link produced a
                // machine-readable diagnostic from one build and prose from
                // another.
                for (const e of result.wikiErrors) {
                    emitDiagnostic({
                        file: e.file,
                        ...positionOfLiteral(readRawNote(e.file), e.link, e.occurrence),
                        severity: "error",
                        message: linkFindingMessage(e),
                    });
                }
                if (result.tableErrors.length || result.wikiErrors.length) {
                    process.exitCode = 1;
                    return;
                }

                if (result.manifests && !result.manifests.complete) {
                    // Not a softening any more (#184): an address into one of
                    // these packages fails like any other that resolves
                    // nowhere. The warning names them so an author meeting that
                    // failure knows the fix may be to vendor a manifest rather
                    // than to correct a shortcode.
                    log.warn(
                        `no link manifest vendored for ` +
                            `${result.manifests.missing.join(", ")} — an ` +
                            `address into one of those packages resolves ` +
                            `nowhere and fails the build.`,
                    );
                }

                const s = result.stats;
                log.info(
                    `wrote ${s.homepages ?? 0} homepage(s) + ` +
                        `${s.content ?? 0} content page(s) + ` +
                        `${s.tree ?? 0} tree page(s) + ${s.landings} ` +
                        `landing(s) to ${path.relative(process.cwd(), s.out)}`,
                );
            } catch (err) {
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}

/**
 * `content-build reachability <dir> [file]` — check that a corpus reads through.
 *
 * The corpus is named on the command line rather than declared in code, because
 * it never changes for a given repository: a consumer hardcodes the invocation
 * in `package.json` and gets the check without writing a script.
 *
 *   content-build reachability Rules --index glossary
 *   content-build reachability User_Guide --index glossary
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
        handler: (argv) => {
            try {
                const contentBase = argv.root ?? loadPackConfig().paths.content;
                const dir = String(argv.dir).replace(/\/+$/, "");
                const index = buildLinkIndex(contentBase);
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
 * `deps fetch` — fill the item-catalogue cache for every dependency that
 * declares `itemCatalog: true`.
 *
 * Its own command rather than a step of `package compile`, so that a compile
 * never reaches the network. A build that downloads silently is not
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
/**
 * Resolve which declared dependency `--from` supplies, and cache it.
 *
 * @param {object} config - The resolved build configuration.
 * @param {{from: string, id?: string}} argv - The parsed arguments.
 * @returns {Promise<void>}
 */
async function fetchFromLocalArtifact(config, argv) {
    const rels = itemCatalogRelationships(config);
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
                `no dependency "${argv.id}" declares \`itemCatalog: true\` (declared: ${named})`
            :   `--from needs --id when several dependencies declare \`itemCatalog: true\` (declared: ${named})`,
        );
    }
    await fetchCatalogFromPath(config, rel, argv.from);
}

function depsCommand() {
    return {
        command: "deps <action>",
        describe: "Manage build-time dependencies on other packages",
        builder: (yargs) => {
            // Required, for the reason `package <action>` is (#57): an optional
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
                    "when more than one declares `itemCatalog: true`.",
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
                const count = await fetchAllCatalogs(config);
                if (count) log.info(`Fetched ${count} dependency catalogue(s).`);
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
 * The address space is a published interface (see `engine/address-diff.mjs`),
 * and renaming a shortcode used to cost nothing and produce no signal. This is
 * the signal, emitted in the repository doing the renaming while the change is
 * still in front of the author.
 *
 * **Its own command rather than a step of `package compile`.** It reads a
 * *second* artifact that the compile knows nothing about and that has to be
 * obtained separately, and it is a question about a release rather than about a
 * build — a repository between releases has nothing to compare against.
 *
 * **The baseline is named, never derived, and never downloaded.** `--from`
 * takes the artifact — the `.zip` a release publishes, or a directory built
 * from one — for the same reason `deps fetch --from` does: a command that
 * reaches the network on its own is not reproducible and fails strangely
 * offline. In a release workflow the artifact is one line ahead of it:
 *
 * ```sh
 * gh release download v0.8.2 -p system.zip -D build/baseline
 * npx content-build addresses diff --from build/baseline/system.zip
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

    const findings = diffItemAddresses(
        readItemAddresses(baselineDirs),
        readItemAddresses(currentDirs),
        { baseline: label },
    );
    if (!findings.length) {
        log.info(`Every address ${label} published is still published.`);
        return;
    }

    // A rename is fixed in the note that made it, so findings are placed
    // against the tree rather than against the compiled output they were read
    // from.
    const noteFiles = noteFilesById(config.paths.content);
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
            // Required, for the reason every other action is (#57): an
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
        describe: "Manage packages",
        builder: (yargs) => {
            // Required, not optional: the action *is* the work, and an
            // optional one meant `content-build package` fell through the
            // switch below and exited 0 having compiled nothing (#57).
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
                // The one directory the pipeline creates rather than expects:
                // `unpack` writes the extracted JSON there and `compile` reads
                // it back. Created here rather than at module scope so that
                // asking the CLI its version needs no configuration (#2).
                fs.mkdirSync(loadPackConfig().paths.unpack, {
                    recursive: true,
                });
                switch (action) {
                    // Every path and pack list the library needs is defaulted
                    // from the resolved configuration, so nothing is restated
                    // here (#1508).
                    case "compile":
                        return await compilePacks({ packName: pack });
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
                reportFailure(err);
                process.exitCode = 1;
            }
        },
    };
}
