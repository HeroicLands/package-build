/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `docs/configuration.md` is a transcription of `content-config.mjs` and
 * `config.mjs`, and this makes the transcription checkable.
 *
 * Every key list in the two validators is a module-private `const`, so it
 * cannot be imported and compared directly. What can be read is the
 * validators' own behaviour: `rejectUnknownKeys` reports an unrecognised key
 * with "expected one of: <the allowed list>", so triggering that path is a
 * key list read out of the running contract rather than out of a second,
 * hand-copied one. A key renamed, added or removed in either source file
 * changes what this test derives without anyone updating a fixture — the
 * fixture *is* the validator.
 *
 * The document represents a nested key as its dotted path in backticks
 * (`` `site.out` ``, `` `pdf.fonts.serif` ``) and a top-level one bare
 * (`` `contentPackage` ``), so the assertions below search for exactly that
 * shape. `packs[]` and similar list entries are documented with a bare `[]`
 * rather than a numeric index, matching how the validator's own error paths
 * would read with the index stripped.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
    defineConfig,
    PACKAGE_KINDS,
    SITE_MODES,
    PACK_DOCUMENT_TYPES,
} from "../content-config.mjs";
import { resolvePackageBuildConfig, DERIVED_MANIFEST_KEYS } from "../config.mjs";

const DOC = readFileSync(path.resolve(__dirname, "../docs/configuration.md"), "utf8");

/** A minimal configuration `defineConfig` accepts without complaint. */
function minimal(overrides: Record<string, unknown> = {}) {
    return {
        rootDir: "/repo",
        contentPackage: "acme",
        foundryPackage: "acme",
        packageKind: "systems",
        stats: { lastModifiedBy: "acmebuilder0000" },
        packs: [{ name: "items", type: "Item" }],
        ...overrides,
    };
}

/** The shared configuration `resolvePackageBuildConfig` accepts without complaint. */
function sharedMinimal(packageBuild: Record<string, unknown> = {}) {
    return { rootDir: "/repo", packageKind: "systems", foundryPackage: "acme", packageBuild };
}

/**
 * The allowed-keys list `rejectUnknownKeys` reports when `build` declares one
 * key it does not recognise.
 *
 * @param build - A call expected to throw the "not a recognized option" message.
 * @returns The allowed keys, in the order the validator lists them.
 */
function allowedKeys(build: () => unknown): string[] {
    try {
        build();
    } catch (err) {
        const message = (err as Error).message;
        const match = message.match(/expected one of: (.+)\)\.$/);
        if (!match) {
            throw new Error(`could not read an allowed-keys list from: ${message}`);
        }
        return match[1].split(", ");
    }
    throw new Error("expected the build to throw an unrecognised-key error");
}

/** The message a `build` throws, in full. */
function thrown(build: () => unknown): string {
    try {
        build();
    } catch (err) {
        return (err as Error).message;
    }
    throw new Error("expected the build to throw");
}

/** Every key of `keys`, documented under `prefix` as `` `prefix.key` `` (or bare when `prefix` is empty). */
function assertDocuments(prefix: string, keys: readonly string[]) {
    for (const key of keys) {
        const dotted = prefix ? `${prefix}.${key}` : key;
        expect(DOC, `docs/configuration.md should document \`${dotted}\``).toContain(
            `\`${dotted}\``,
        );
    }
}

/**
 * Every value of a closed, exported set, formatted the way the document
 * spells it and searched for verbatim.
 *
 * `rejectUnknownKeys` reads a key list out of the validator's own refusal
 * message, so a renamed or added *key* already fails
 * {@link assertDocuments}. A closed set's accepted *values* are never routed
 * through that message — `packageKind` rejects a bad value with "must be one
 * of: <the list>", not "not a recognized option" — so nothing previously
 * caught a member added to `PACKAGE_KINDS` while the document went on
 * listing the old ones. Reading the set from its own exported binding, the
 * same way {@link assertDocuments} reads a key list from the validator's
 * thrown message, is what closes that gap.
 *
 * @param values - The exported closed set, read from `content-config.mjs`.
 * @param format - How the document spells one member, e.g. `` `"content"` ``.
 */
function assertValuesDocumented(values: readonly string[], format: (value: string) => string) {
    for (const value of values) {
        const formatted = format(value);
        expect(DOC, `docs/configuration.md should list the value ${formatted}`).toContain(
            formatted,
        );
    }
}

describe("every closed-set value is documented", () => {
    it("reads sets worth checking", () => {
        // Guards the guard: an empty or single-member export would let this
        // whole describe block pass by checking nothing.
        expect(PACKAGE_KINDS.length).toBeGreaterThan(1);
        expect(SITE_MODES.length).toBeGreaterThan(1);
        expect(PACK_DOCUMENT_TYPES.length).toBeGreaterThan(1);
    });

    it("`PACKAGE_KINDS`, in the summary table and the `packageKind` section", () => {
        assertValuesDocumented(PACKAGE_KINDS, (value) => `\`"${value}"\``);
    });

    it("`SITE_MODES`, in the `publish.site` row and section", () => {
        assertValuesDocumented(SITE_MODES, (value) => `\`"${value}"\``);
    });

    it("`PACK_DOCUMENT_TYPES`, in the `packs[].type` row", () => {
        assertValuesDocumented(PACK_DOCUMENT_TYPES, (value) => `\`${value}\``);
    });
});

describe("every top-level key is documented", () => {
    const keys = allowedKeys(() => defineConfig(minimal({ __unrecognised__: true })));

    it("reads a key list worth checking", () => {
        // Guards the guard: were the validator's message shape to change, the
        // regex above would throw instead of silently checking nothing.
        expect(keys.length).toBeGreaterThan(15);
        expect(keys).toContain("contentPackage");
    });

    it("documents every key `defineConfig` accepts, `rootDir` apart", () => {
        // `rootDir` is never authored in a data configuration (see the
        // "Derived values" section) and is documented there, not in the
        // top-level key table — checked separately below.
        assertDocuments(
            "",
            keys.filter((key) => key !== "rootDir"),
        );
    });

    it("documents `rootDir` as a derived value", () => {
        expect(DOC).toContain("`rootDir`");
    });
});

describe("every nested key list is documented", () => {
    it("`stats`", () => {
        assertDocuments(
            "stats",
            allowedKeys(() =>
                defineConfig(minimal({ stats: { lastModifiedBy: "x", __unrecognised__: true } })),
            ),
        );
    });

    it("`paths`", () => {
        assertDocuments(
            "paths",
            allowedKeys(() => defineConfig(minimal({ paths: { __unrecognised__: true } }))),
        );
    });

    it("`docs` and `docs.itemFields`", () => {
        assertDocuments(
            "docs",
            allowedKeys(() => defineConfig(minimal({ docs: { __unrecognised__: true } }))),
        );
        assertDocuments(
            "docs.itemFields",
            allowedKeys(() =>
                defineConfig(minimal({ docs: { itemFields: { __unrecognised__: true } } })),
            ),
        );
    });

    it("`site` and its nested shapes", () => {
        assertDocuments(
            "site",
            allowedKeys(() => defineConfig(minimal({ site: { __unrecognised__: true } }))),
        );
        assertDocuments(
            "site.notfound",
            allowedKeys(() =>
                defineConfig(
                    minimal({
                        site: { notfound: { tagline: "t", sitenoun: "s", __unrecognised__: true } },
                    }),
                ),
            ),
        );
    });

    it("`pdf` and its nested shapes", () => {
        assertDocuments(
            "pdf",
            allowedKeys(() =>
                defineConfig(
                    minimal({ pdf: { __unrecognised__: true, title: "t", document: "d" } }),
                ),
            ),
        );
        assertDocuments(
            "pdf.fonts",
            allowedKeys(() =>
                defineConfig(
                    minimal({
                        pdf: { title: "t", document: "d", fonts: { __unrecognised__: true } },
                    }),
                ),
            ),
        );
    });

    it("`compatibility`", () => {
        assertDocuments(
            "compatibility",
            allowedKeys(() =>
                defineConfig(minimal({ compatibility: { minimum: "1", __unrecognised__: true } })),
            ),
        );
    });

    it("`relationships`", () => {
        assertDocuments(
            "relationships",
            allowedKeys(() => defineConfig(minimal({ relationships: { __unrecognised__: true } }))),
        );
        assertDocuments(
            "relationships.systems[]",
            allowedKeys(() =>
                defineConfig(
                    minimal({
                        relationships: { systems: [{ id: "x", __unrecognised__: true }] },
                    }),
                ),
            ),
        );
    });

    it("`systems.<id>`", () => {
        assertDocuments(
            "systems.<id>",
            allowedKeys(() =>
                defineConfig(
                    minimal({
                        packageKind: "modules",
                        systems: {
                            sohl: {
                                __unrecognised__: true,
                                compatibility: { verified: "1.0" },
                            },
                        },
                    }),
                ),
            ),
        );
    });

    it("`itemBuilders.<type>` and the list-of-registries form", () => {
        assertDocuments(
            "itemBuilders.<type>",
            allowedKeys(() =>
                defineConfig(
                    minimal({
                        itemBuilders: { foo: { __unrecognised__: true, system: () => ({}) } },
                    }),
                ),
            ),
        );
        assertDocuments(
            "itemBuilders[]",
            allowedKeys(() =>
                defineConfig(
                    minimal({
                        itemBuilders: [{ __unrecognised__: true, system: "sohl", builders: {} }],
                    }),
                ),
            ),
        );
    });

    it("`packs[]`", () => {
        assertDocuments(
            "packs[]",
            allowedKeys(() =>
                defineConfig(
                    minimal({ packs: [{ name: "x", type: "Item", __unrecognised__: true }] }),
                ),
            ),
        );
    });

    it("`publish` and `publish.address`", () => {
        assertDocuments(
            "publish",
            allowedKeys(() => defineConfig(minimal({ publish: { __unrecognised__: true } }))),
        );
        assertDocuments(
            "publish.address",
            allowedKeys(() =>
                defineConfig(minimal({ publish: { address: { __unrecognised__: true } } })),
            ),
        );
    });

    it("`changelog`", () => {
        assertDocuments(
            "changelog",
            allowedKeys(() => defineConfig(minimal({ changelog: { __unrecognised__: true } }))),
        );
    });
});

describe("the `packageBuild` section is documented", () => {
    it("its own keys", () => {
        assertDocuments(
            "packageBuild",
            allowedKeys(() => resolvePackageBuildConfig(sharedMinimal({ __unrecognised__: true }))),
        );
    });

    it("`packageBuild.assets[]`", () => {
        assertDocuments(
            "packageBuild.assets[]",
            allowedKeys(() =>
                resolvePackageBuildConfig(sharedMinimal({ assets: [{ __unrecognised__: true }] })),
            ),
        );
    });

    it("`packageBuild.clean`", () => {
        assertDocuments(
            "packageBuild.clean",
            allowedKeys(() =>
                resolvePackageBuildConfig(sharedMinimal({ clean: { __unrecognised__: true } })),
            ),
        );
    });

    it("`packageBuild.lang`", () => {
        assertDocuments(
            "packageBuild.lang",
            allowedKeys(() =>
                resolvePackageBuildConfig(sharedMinimal({ lang: { __unrecognised__: true } })),
            ),
        );
    });

    it("`packageBuild.deploy`", () => {
        assertDocuments(
            "packageBuild.deploy",
            allowedKeys(() =>
                resolvePackageBuildConfig(sharedMinimal({ deploy: { __unrecognised__: true } })),
            ),
        );
    });

    it("`packageBuild.release`", () => {
        assertDocuments(
            "packageBuild.release",
            allowedKeys(() =>
                resolvePackageBuildConfig(sharedMinimal({ release: { __unrecognised__: true } })),
            ),
        );
    });

    it("`packageBuild.bundle`", () => {
        assertDocuments(
            "packageBuild.bundle",
            allowedKeys(() =>
                resolvePackageBuildConfig(sharedMinimal({ bundle: { __unrecognised__: true } })),
            ),
        );
    });

    it("`packageBuild.container` and `packageBuild.container.stages.<name>`", () => {
        assertDocuments(
            "packageBuild.container",
            allowedKeys(() =>
                resolvePackageBuildConfig(sharedMinimal({ container: { __unrecognised__: true } })),
            ),
        );
        assertDocuments(
            "packageBuild.container.stages.<name>",
            allowedKeys(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({ container: { stages: { dev: { __unrecognised__: true } } } }),
                ),
            ),
        );
    });

    it("`packageBuild.e2e` and its nested shapes", () => {
        assertDocuments(
            "packageBuild.e2e",
            allowedKeys(() =>
                resolvePackageBuildConfig(sharedMinimal({ e2e: { __unrecognised__: true } })),
            ),
        );
        assertDocuments(
            "packageBuild.e2e.suite",
            allowedKeys(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({ e2e: { suite: { __unrecognised__: true, run: ["x"] } } }),
                ),
            ),
        );
        assertDocuments(
            "packageBuild.e2e.build.<name>",
            allowedKeys(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({
                        e2e: { build: { fast: { __unrecognised__: true, script: "x" } } },
                    }),
                ),
            ),
        );
        assertDocuments(
            "packageBuild.e2e.world",
            allowedKeys(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({ e2e: { world: { __unrecognised__: true } } }),
                ),
            ),
        );
        assertDocuments(
            "packageBuild.e2e.gm",
            allowedKeys(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({ e2e: { gm: { __unrecognised__: true } } }),
                ),
            ),
        );
    });

    it("the manifest keys the build derives, which a repository may not author", () => {
        for (const key of Object.keys(DERIVED_MANIFEST_KEYS)) {
            expect(
                DOC,
                `docs/configuration.md should document \`packageBuild.manifest.${key}\` as derived`,
            ).toContain(`\`packageBuild.manifest.${key}\``);
        }
    });
});

describe("failure messages a developer can trigger are quoted verbatim", () => {
    /** Assert the document contains the given message text exactly. */
    function assertQuoted(message: string) {
        expect(DOC, `docs/configuration.md should quote: ${message}`).toContain(message);
    }

    it("retired keys", () => {
        assertQuoted(
            thrown(() =>
                defineConfig(minimal({ packs: [{ name: "x", type: "Item", folders: {} }] })),
            ).replace(/^package-build config: `packs\[0\]\.folders` /, ""),
        );
        assertQuoted(
            thrown(() =>
                defineConfig(minimal({ publish: { address: { prefix: "kb/", landing: true } } })),
            ).replace(/^package-build config: `publish\.address\.landing` /, ""),
        );
    });

    it("`contentPackage`", () => {
        assertQuoted(
            thrown(() => defineConfig(minimal({ contentPackage: "harn-adventures" }))).replace(
                /^package-build config: `contentPackage` /,
                "",
            ),
        );
        assertQuoted(
            thrown(() => defineConfig(minimal({ contentPackage: "macro" }))).replace(
                /^package-build config: `contentPackage` /,
                "",
            ),
        );
    });

    it("derived `stats` fields", () => {
        assertQuoted(
            thrown(() =>
                defineConfig(minimal({ stats: { lastModifiedBy: "x", systemId: "acme" } })),
            ).replace(/^package-build config: `stats\.systemId` /, ""),
        );
        assertQuoted(
            thrown(() =>
                defineConfig(minimal({ stats: { lastModifiedBy: "x", systemVersion: "1.0.0" } })),
            ).replace(/^package-build config: `stats\.systemVersion` /, ""),
        );
    });

    it("`publish.site`", () => {
        assertQuoted(
            thrown(() => defineConfig(minimal({ publish: { site: true } }))).replace(
                /^package-build config: `publish\.site` /,
                "",
            ),
        );
        assertQuoted(
            thrown(() => defineConfig(minimal({ publish: { site: "public" } }))).replace(
                /^package-build config: `publish\.site` /,
                "",
            ),
        );
    });

    it("`publish.address.prefix`", () => {
        assertQuoted(
            thrown(() => defineConfig(minimal({ publish: { address: { prefix: "kb" } } }))).replace(
                /^package-build config: `publish\.address\.prefix` /,
                "",
            ),
        );
        assertQuoted(
            thrown(() =>
                defineConfig(minimal({ publish: { address: { prefix: "/kb/" } } })),
            ).replace(/^package-build config: `publish\.address\.prefix` /, ""),
        );
    });

    it("`rootDir`, when authored in a data configuration", () => {
        // Exercised through `defineConfig` directly, since the throw for an
        // authored `rootDir` actually lives in `engine/pack-config.mjs`
        // (`configFromData`) — see the "Derived values" section.
        assertQuoted("declares `rootDir`, which a data configuration may not");
    });

    it("`packageKind`", () => {
        assertQuoted(
            thrown(() => defineConfig(minimal({ packageKind: "worlds" }))).replace(
                /^package-build config: `packageKind` /,
                "",
            ),
        );
    });

    it("`packs`", () => {
        assertQuoted(
            thrown(() =>
                defineConfig(
                    minimal({
                        packs: [
                            { name: "x", type: "Item" },
                            { name: "x", type: "JournalEntry" },
                        ],
                    }),
                ),
            ).replace(/^package-build config: `packs` /, ""),
        );
        assertQuoted(
            thrown(() =>
                defineConfig(
                    minimal({
                        packs: [
                            { name: "a", type: "Item", default: true },
                            { name: "b", type: "Item", default: true },
                        ],
                    }),
                ),
            ).replace(/^package-build config: `packs` /, ""),
        );
        assertQuoted(
            thrown(() => defineConfig(minimal({ packs: [{ name: "x", type: "Widget" }] }))).replace(
                /^package-build config: `packs\[0\]\.type` /,
                "",
            ),
        );
    });

    it("a pack's `system`", () => {
        assertQuoted(
            thrown(() =>
                defineConfig(minimal({ packs: [{ name: "x", type: "Item", system: "sohl" }] })),
            )
                .replace(/^package-build config: `packs\.x\.system` /, "")
                .split(". Every document")[0] + ".",
        );
    });

    it("`requiresSystem`", () => {
        assertQuoted(
            thrown(() =>
                defineConfig(minimal({ packageKind: "modules", requiresSystem: "sohl" })),
            ).replace(/^package-build config: `requiresSystem` /, ""),
        );
    });

    it("companion and prebuilt pack conflicts", () => {
        assertQuoted(
            thrown(() =>
                defineConfig(
                    minimal({
                        packs: [
                            {
                                name: "x",
                                type: "Item",
                                companions: [{ name: "y", type: "Item", default: true }],
                            },
                        ],
                    }),
                ),
            ).replace(/^package-build config: `packs\[0\]\.companions\[0\]\.default` /, ""),
        );
        assertQuoted(
            thrown(() =>
                defineConfig(
                    minimal({
                        packs: [{ name: "x", type: "Item", prebuilt: "build/x", default: true }],
                    }),
                ),
            ).replace(/^package-build config: `packs\[0\]\.default` /, ""),
        );
    });

    it("relationships `itemCatalog`", () => {
        assertQuoted(
            thrown(() =>
                defineConfig(
                    minimal({ relationships: { systems: [{ id: "sohl", itemCatalog: true }] } }),
                ),
            ).replace(/^package-build config: `relationships\.systems\[0\]\.itemCatalog` /, ""),
        );
    });

    it("relationships `contentIndex`", () => {
        assertQuoted(
            thrown(() =>
                defineConfig(
                    minimal({ relationships: { systems: [{ id: "sohl", contentIndex: "yes" }] } }),
                ),
            ).replace(/^package-build config: `relationships\.systems\[0\]\.contentIndex` /, ""),
        );
        assertQuoted(
            thrown(() =>
                defineConfig(
                    minimal({
                        relationships: {
                            systems: [
                                {
                                    id: "sohl",
                                    manifest: "https://example.invalid/system.json",
                                    itemCatalog: true,
                                    contentIndex: false,
                                },
                            ],
                        },
                    }),
                ),
            ).replace(/^package-build config: `relationships\.systems\[0\]\.contentIndex` /, ""),
        );
    });

    it("`icons`", () => {
        assertQuoted(
            thrown(() => defineConfig(minimal({ icons: "" }))).replace(
                /^package-build config: `icons` /,
                "",
            ),
        );
        assertQuoted(
            thrown(() => defineConfig(minimal({ icons: { icons: { Bad_Name: {} } } }))).replace(
                /^package-build config: `icons\.icons\.Bad_Name` /,
                "",
            ),
        );
    });

    it("`paths`", () => {
        assertQuoted(
            thrown(() => defineConfig(minimal({ paths: { content: "/abs/path" } }))).replace(
                /^package-build config: `paths\.content` /,
                "",
            ),
        );
    });

    it("`docs.itemFields.preamble`", () => {
        assertQuoted(
            thrown(() =>
                defineConfig(minimal({ docs: { itemFields: { preamble: "not a list" } } })),
            ).replace(/^package-build config: `docs\.itemFields\.preamble` /, ""),
        );
    });

    it("`site.sections`, `site.landing`, `site.backfillSections` and `site.list`", () => {
        for (const site of [
            { sections: { foo: { title: "t" } } },
            { landing: { title: "t" } },
            { backfillSections: true },
            { list: { shortcodes: true } },
        ]) {
            assertQuoted(
                thrown(() => defineConfig(minimal({ site }))).replace(
                    /^package-build config: `site\.\w+` /,
                    "",
                ),
            );
        }
    });

    it("`site.trees` and `site.readmeSections`", () => {
        assertQuoted(
            thrown(() => defineConfig(minimal({ site: { trees: [] } }))).replace(
                /^package-build config: `site\.trees` /,
                "",
            ),
        );
    });

    it("`packageBuild.manifest`, when a derived key is authored", () => {
        assertQuoted(
            thrown(() =>
                resolvePackageBuildConfig(sharedMinimal({ manifest: { version: "1.0.0" } })),
            ).replace(/^package-build config: `packageBuild\.manifest\.version` /, ""),
        );
    });

    it("`packageBuild.container.name`", () => {
        assertQuoted(
            thrown(() =>
                resolvePackageBuildConfig(sharedMinimal({ container: { name: "not a name!" } })),
            ).replace(/^package-build config: `packageBuild\.container\.name` /, ""),
        );
    });

    it("`changelog.labels`", () => {
        assertQuoted(
            thrown(() => defineConfig(minimal({ changelog: { labels: "Compendiums" } }))).replace(
                /^package-build config: `changelog\.labels` /,
                "",
            ),
        );
        assertQuoted(
            thrown(() =>
                defineConfig(minimal({ changelog: { labels: ["Compendiums", "Compendiums"] } })),
            ).replace(/^package-build config: `changelog\.labels` /, ""),
        );
    });

    it("`compatibility.minimum`, when a document is compiled without one", () => {
        assertQuoted(
            "the configuration declares no `compatibility.minimum`, so compiled " +
                "documents have no honest core version to stamp",
        );
    });
});
