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
 *   npx content-build links [root] [--manifests <dir>]
 *   npx content-build format [paths..] [--write]
 *   npx content-build markdown [paths..] [--fix]
 *   npx content-build manifest [root] [--out <dir>]
 *   npx content-build site [--out <dir>]
 *   npx content-build reachability <dir> [file] [--index <shortcode>]
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
import {
    compilePacks,
    cleanPacks,
    unpackPacks,
} from "../engine/compendiums.mjs";
import { loadPackConfig } from "../engine/pack-config.mjs";
import {
    fetchAllCatalogs,
    fetchCatalogFromPath,
    itemCatalogRelationships,
} from "../engine/foreign-catalog.mjs";
import { renderItemFieldReference } from "../engine/field-reference.mjs";
import { lintContentTree } from "../engine/content-lint.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
// The one vocabulary, loaded whole. Every content project authors the full type
// set — an adventure module ships skills, beings and magic swords — so no
// consumer gets a subset (#19, #20).
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { checkFormatting, lintMarkdown } from "../engine/prose-lint.mjs";
import { emitLinkManifest } from "../engine/manifest-emit.mjs";
import {
    buildSite,
    gatesFailed,
    formatUnaddressableFinding as formatUnaddressable,
} from "../engine/site-build.mjs";
import {
    auditLinks,
    buildLinkIndex,
    walkReachability,
} from "../engine/content-links.mjs";
import { emitDiagnostic, positionOfLiteral } from "../engine/diagnostics.mjs";
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
    return JSON.parse(
        fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ).version;
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

const argv = yargs(hideBin(process.argv))
    .command(packageCommand())
    .command(depsCommand())
    .command(docsCommand())
    .command(lintCommand())
    .command(linksCommand())
    .command(formatCommand())
    .command(markdownCommand())
    .command(manifestCommand())
    .command(siteCommand())
    .command(reachabilityCommand())
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
                describe:
                    "Write to this file instead of the configured location.",
                type: "string",
            });
            yargs.option("check", {
                describe:
                    "Compare against the file already there; write nothing.",
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
                    argv.out ??
                    (spec.out ? path.resolve(config.rootDir, spec.out) : null);

                const page = `${renderItemFieldReference({
                    ...((title ?? spec.title) ?
                        { title: title ?? spec.title }
                    :   {}),
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
                        fs.existsSync(destination) ?
                            fs.readFileSync(destination, "utf8")
                        :   "";
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
                    log.info(
                        `Wrote ${path.relative(config.rootDir, destination)}`,
                    );
                } else {
                    process.stdout.write(page);
                }
            } catch (err) {
                log.error(err.message);
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
                describe:
                    "Content tree to lint. Defaults to the configured contentBase.",
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

                const addresses = lintContentTree(root);
                // One index, built once, for the reference check. It is the
                // same resolver the wikilink audit uses, so a frontmatter
                // reference and a body link answer the same way.
                const index = buildLinkIndex(root, {
                    manifestDir,
                    skipDirectories: config.skipDirectories,
                });
                const frontmatter = lintFrontmatter(index, {
                    schemas: NOTE_SCHEMAS,
                    references: argv.references,
                });

                const findings = [
                    ...addresses.findings,
                    ...frontmatter.findings,
                ];
                for (const finding of findings) emitDiagnostic(finding);
                if (findings.length) {
                    log.error(
                        `${findings.length} finding(s) across ${addresses.notes} note(s).`,
                    );
                    process.exitCode = 1;
                } else {
                    log.info(
                        `Addresses and frontmatter are well-formed ` +
                            `(${addresses.keys} across ${addresses.notes} note(s)).`,
                    );
                }
            } catch (err) {
                log.error(err.message);
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
                describe:
                    "Files or directories to check. Defaults to the whole repository.",
                type: "string",
            });
            yargs.option("write", {
                describe:
                    "Rewrite unformatted files in place instead of reporting them.",
                type: "boolean",
                default: false,
            });
            yargs.option("check", {
                describe:
                    "Report unformatted files without rewriting them (the default).",
                type: "boolean",
            });
        },
        handler: async (argv) => {
            try {
                // `--check` is the default, so it only has to be honoured when
                // it contradicts `--write`; naming both is a mistake worth
                // saying out loud rather than silently resolving.
                if (argv.check === true && argv.write) {
                    log.error(
                        "--check and --write ask for opposite things; name one.",
                    );
                    process.exitCode = 1;
                    return;
                }
                const root = process.cwd();
                const { findings, checked, written } = await checkFormatting(
                    root,
                    { paths: argv.paths, write: argv.write },
                );
                if (argv.write) {
                    log.info(
                        written.length ?
                            `Formatted ${written.length} of ${checked} file(s).`
                        :   `Already formatted (${checked} file(s)).`,
                    );
                    return;
                }
                for (const finding of findings) emitDiagnostic(finding);
                if (findings.length) {
                    log.error(
                        `${findings.length} of ${checked} file(s) are not formatted.`,
                    );
                    process.exitCode = 1;
                } else {
                    log.info(`Formatting is clean (${checked} file(s)).`);
                }
            } catch (err) {
                log.error(err.message);
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
                describe:
                    "Globs to lint. Defaults to every markdown file in the repository.",
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
                log.error(err.message);
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
                describe:
                    "Content tree to check. Defaults to the configured contentBase.",
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
                    log.error(
                        "Refresh the vendored copy from that package's own build.",
                    );
                    process.exitCode = 1;
                    return;
                }

                // Readable is not the same as addressable: a key shape the
                // lookup cannot parse makes every cross-package link miss, and
                // the audit then blames the *notes*.
                const drifted = unaddressableForeignPackages(
                    index.foreign.index,
                );
                if (drifted.length) {
                    for (const f of drifted) {
                        console.error(
                            formatUnaddressableFinding(f, manifestDir),
                        );
                    }
                    process.exitCode = 1;
                    return;
                }

                const {
                    deadAnchors,
                    deadAddresses,
                    frontmatterLinks,
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
                for (const d of deadAddresses) {
                    emitDiagnostic({
                        file: d.note.file,
                        ...positionOfLiteral(d.note.raw, d.text, d.occurrence),
                        severity: "error",
                        message: `dead address [[${d.target}]] — no document has that identity`,
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

                const failures =
                    deadAnchors.length +
                    deadAddresses.length +
                    frontmatterLinks.length;
                if (failures) {
                    log.error(
                        `${failures} link problem(s) across ${index.notes.length} note(s).`,
                    );
                    process.exitCode = 1;
                } else {
                    log.info(
                        `${index.notes.length} notes: every anchor link lands ` +
                            `and every qualified address resolves ` +
                            `(${usedManifest.size} cross-package reference(s) ` +
                            `via manifest), no wikilink in frontmatter.`,
                    );
                }
            } catch (err) {
                log.error(err.message);
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
                describe:
                    "Content tree to read. Defaults to the configured contentBase.",
                type: "string",
            });
            yargs.option("out", {
                describe:
                    "Directory to write into. Defaults to the configured " +
                    "`paths.manifestOut`.",
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
                        file: path.join(
                            argv.root ?? config.paths.content,
                            s.file,
                        ),
                        severity: "warning",
                        message: `no address, so it is absent from the manifest: ${s.reason}`,
                    });
                }
            } catch (err) {
                log.error(err.message);
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
                describe:
                    "Write the mount here instead of the configured `site.out`.",
                type: "string",
            });
        },
        handler: (argv) => {
            try {
                const result = buildSite({
                    ...(argv.out ? { outRoot: argv.out } : {}),
                });
                const { gates } = result;

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
                for (const f of gates.slugErrors) {
                    emitDiagnostic({
                        file: f.file,
                        severity: "error",
                        message: `cannot derive a URL: ${f.reason}`,
                    });
                }
                for (const c of gates.collisions) {
                    log.error(`${c.url} claimed by ${c.sources.join(", ")}`);
                }
                for (const s of gates.staleManifests) {
                    emitDiagnostic({
                        file: path.join(
                            loadPackConfig().paths.manifests,
                            `${s.package}.json`,
                        ),
                        severity: "error",
                        message: `unusable link manifest: ${s.reason}`,
                    });
                }
                for (const f of gates.unaddressable) {
                    console.error(
                        formatUnaddressable(
                            f,
                            loadPackConfig().paths.manifests,
                        ),
                    );
                }
                for (const c of gates.conflicts) {
                    log.error(
                        `address ${c.key} is also published by ${c.package}`,
                    );
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
                for (const e of result.wikiErrors) {
                    log.error(
                        `bad wikilink [[${e.target}]]: ${e.reason}  (${e.file})`,
                    );
                }
                if (result.tableErrors.length || result.wikiErrors.length) {
                    process.exitCode = 1;
                    return;
                }

                if (result.manifests && !result.manifests.complete) {
                    log.warn(
                        `cross-package address checking is OFF — no manifest ` +
                            `for ${result.manifests.missing.join(", ")}. ` +
                            `Unresolved addresses are tolerated until every ` +
                            `package publishes one.`,
                    );
                }

                const s = result.stats;
                log.info(
                    `wrote ${s.content ?? 0} content page(s) + ` +
                        `${s.tree ?? 0} tree page(s) + ${s.landings} ` +
                        `landing(s) to ${path.relative(process.cwd(), s.out)}`,
                );
            } catch (err) {
                log.error(err.message);
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
                describe:
                    "The corpus directory, relative to the content tree root.",
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
                describe:
                    "Content tree to read. Defaults to the configured contentBase.",
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

                const total = index.notes.filter((n) =>
                    n.rel.startsWith(`${dir}/`),
                ).length;

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
                        `All ${total} document(s) in ${dir} are reachable ` +
                            `from ${argv.file}.`,
                    );
                }
            } catch (err) {
                log.error(err.message);
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
                if (count)
                    log.info(`Fetched ${count} dependency catalogue(s).`);
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
                log.error(err.message);
                process.exitCode = 1;
            }
        },
    };
}
