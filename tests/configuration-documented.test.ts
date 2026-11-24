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
    AUTHOR_ROLES,
    defineConfig,
    PACKAGE_KINDS,
    PACK_DOCUMENT_TYPES,
} from "../content-config.mjs";
import { resolvePackageBuildConfig, DERIVED_MANIFEST_KEYS } from "../config.mjs";
import { createPackRouter } from "../engine/pack-router.mjs";
import { populationJournalPlan } from "../engine/population-journals.mjs";
import {
    configurationKeys,
    minimal,
    sharedMinimal,
    thrown,
} from "./helpers/configuration-surface.js";

const DOC = readFileSync(path.resolve(__dirname, "../docs/configuration.md"), "utf8");

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
        expect(PACK_DOCUMENT_TYPES.length).toBeGreaterThan(1);
    });

    it("`PACKAGE_KINDS`, in the summary table and the `packageKind` section", () => {
        assertValuesDocumented(PACKAGE_KINDS, (value) => `\`"${value}"\``);
    });

    it("`PACK_DOCUMENT_TYPES`, in the `packs[].type` row", () => {
        assertValuesDocumented(PACK_DOCUMENT_TYPES, (value) => `\`${value}\``);
    });
});

describe("every top-level key is documented", () => {
    const keys = configurationKeys("");

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
        assertDocuments("stats", configurationKeys("stats"));
    });

    it("`paths`", () => {
        assertDocuments("paths", configurationKeys("paths"));
    });

    it("`docs` and `docs.itemFields`", () => {
        assertDocuments("docs", configurationKeys("docs"));
        assertDocuments("docs.itemFields", configurationKeys("docs.itemFields"));
    });

    it("`site` and its nested shapes", () => {
        assertDocuments("site", configurationKeys("site"));
        assertDocuments("site.notfound", configurationKeys("site.notfound"));
    });

    it("`pdf` and its nested shapes", () => {
        assertDocuments("pdf", configurationKeys("pdf"));
        assertDocuments("pdf.fonts", configurationKeys("pdf.fonts"));
        assertDocuments("pdf.books[]", configurationKeys("pdf.books[]"));
    });

    it("`authors[]` and its closed `role` list", () => {
        assertDocuments("authors[]", configurationKeys("authors[]"));
        // The roles are read out of the validator's own refusal, so a role
        // added to the list and not to the document fails here.
        const message = thrown(() =>
            defineConfig(minimal({ authors: [{ name: "n", role: "__unrecognised__" }] })),
        );
        const roles = /must be one of: (.+)\.$/.exec(message)?.[1]?.split(", ") ?? [];
        expect(roles.length, message).toBeGreaterThan(1);
        expect(roles).toEqual([...AUTHOR_ROLES]);
        assertValuesDocumented(roles, (value) => `\`${value}\``);
    });

    it("`compatibility`", () => {
        assertDocuments("compatibility", configurationKeys("compatibility"));
    });

    it("`relationships`", () => {
        assertDocuments("relationships", configurationKeys("relationships"));
        assertDocuments("relationships.systems[]", configurationKeys("relationships.systems[]"));
    });

    it("`systems.<id>`", () => {
        assertDocuments("systems.<id>", configurationKeys("systems.<id>"));
    });

    it("`itemBuilders.<type>` and the list-of-registries form", () => {
        assertDocuments("itemBuilders.<type>", configurationKeys("itemBuilders.<type>"));
        assertDocuments("itemBuilders[]", configurationKeys("itemBuilders[]"));
    });

    it("`packs[]`", () => {
        assertDocuments("packs[]", configurationKeys("packs[]"));
    });

    it("`sql`", () => {
        assertDocuments("sql", configurationKeys("sql"));
    });

    it("`publish` and `publish.address`", () => {
        assertDocuments("publish", configurationKeys("publish"));
        assertDocuments("publish.address", configurationKeys("publish.address"));
    });

    it("`languages.<name>`", () => {
        assertDocuments("languages.<name>", configurationKeys("languages.<name>"));
    });
});

describe("the `packageBuild` section is documented", () => {
    it("its own keys", () => {
        assertDocuments("packageBuild", configurationKeys("packageBuild"));
    });

    it("`packageBuild.assets[]`", () => {
        assertDocuments("packageBuild.assets[]", configurationKeys("packageBuild.assets[]"));
    });

    it("`packageBuild.clean`", () => {
        assertDocuments("packageBuild.clean", configurationKeys("packageBuild.clean"));
    });

    it("`packageBuild.lang`", () => {
        assertDocuments("packageBuild.lang", configurationKeys("packageBuild.lang"));
    });

    it("`packageBuild.deploy`", () => {
        assertDocuments("packageBuild.deploy", configurationKeys("packageBuild.deploy"));
    });

    it("`packageBuild.release`", () => {
        assertDocuments("packageBuild.release", configurationKeys("packageBuild.release"));
    });

    it("`packageBuild.bundle`", () => {
        assertDocuments("packageBuild.bundle", configurationKeys("packageBuild.bundle"));
    });

    it("`packageBuild.container` and `packageBuild.container.stages.<name>`", () => {
        assertDocuments("packageBuild.container", configurationKeys("packageBuild.container"));
        assertDocuments(
            "packageBuild.container.stages.<name>",
            configurationKeys("packageBuild.container.stages.<name>"),
        );
    });

    it("`packageBuild.e2e` and its nested shapes", () => {
        assertDocuments("packageBuild.e2e", configurationKeys("packageBuild.e2e"));
        assertDocuments("packageBuild.e2e.suite", configurationKeys("packageBuild.e2e.suite"));
        assertDocuments(
            "packageBuild.e2e.build.<name>",
            configurationKeys("packageBuild.e2e.build.<name>"),
        );
        assertDocuments("packageBuild.e2e.world", configurationKeys("packageBuild.e2e.world"));
        assertDocuments("packageBuild.e2e.gm", configurationKeys("packageBuild.e2e.gm"));
    });

    it("`packageBuild.proseLint`, `packageBuild.proseScore` and its bands", () => {
        assertDocuments("packageBuild.proseLint", configurationKeys("packageBuild.proseLint"));
        assertDocuments("packageBuild.proseScore", configurationKeys("packageBuild.proseScore"));
        assertDocuments(
            "packageBuild.proseScore.bands",
            configurationKeys("packageBuild.proseScore.bands"),
        );
        assertDocuments(
            "packageBuild.proseScore.bands.<metric>",
            configurationKeys("packageBuild.proseScore.bands.<metric>"),
        );
    });

    it("`packageBuild.settlementExemptions[]` and its closed `scope` list", () => {
        assertDocuments(
            "packageBuild.settlementExemptions[]",
            configurationKeys("packageBuild.settlementExemptions[]"),
        );
        const message = thrown(() =>
            resolvePackageBuildConfig(
                sharedMinimal({ settlementExemptions: [{ scope: "__unrecognised__" }] }),
            ),
        );
        expect(message).toContain("must be all or urban-share");
        assertValuesDocumented(["all", "urban-share"], (value) => `\`${value}\``);
    });

    it("`packageBuild.settlementPopulation` and its closed `mode` list", () => {
        // This validator does not list its keys in its refusal, so they are
        // read from behaviour: each accepted key passes and any other is refused.
        const keys = ["mode", "urbanShare"];
        for (const key of keys) {
            const value = key === "mode" ? "ceiling" : 0.2;
            expect(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({ settlementPopulation: { [key]: value } }),
                ),
            ).not.toThrow();
        }
        expect(
            thrown(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({ settlementPopulation: { __unrecognised__: 1 } }),
                ),
            ),
        ).toContain("is not a recognised key");
        assertDocuments("packageBuild.settlementPopulation", keys);
        const mode = thrown(() =>
            resolvePackageBuildConfig(
                sharedMinimal({ settlementPopulation: { mode: "__unrecognised__" } }),
            ),
        );
        expect(mode).toContain("must be ceiling or complete");
        assertValuesDocumented(["ceiling", "complete"], (value) => `\`${value}\``);
    });

    it("`packageBuild.converterData` and `packageBuild.shippingLicenses`", () => {
        assertDocuments("packageBuild", ["converterData", "shippingLicenses"]);
    });

    it("the `art` keys and the `art.archives[]` and `art.packages[]` entry keys", () => {
        assertDocuments("art", configurationKeys("art"));
        assertDocuments("art.archives[]", configurationKeys("art.archives[]"));
        assertDocuments("art.packages[]", configurationKeys("art.packages[]"));
    });

    it("the `packageBuild` sections sit under their own heading, ahead of the forbidden-key table", () => {
        const forbidden = DOC.indexOf("## Every forbidden key, in one place");
        const section = DOC.indexOf("## The `packageBuild` section");
        expect(forbidden).toBeGreaterThan(section);
        for (const heading of [
            "### `packageBuild.converterData`",
            "### Settlement exemptions",
            "### Settlement population",
            "### `packageBuild.proseLint`",
            "### `packageBuild.proseScore`",
        ]) {
            const at = DOC.indexOf(heading);
            expect(at, `${heading} is missing`).toBeGreaterThan(section);
            expect(at, `${heading} belongs above the forbidden-key table`).toBeLessThan(forbidden);
        }
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

    it("`sql.memoryLimit`", () => {
        assertQuoted(
            thrown(() => defineConfig(minimal({ sql: { memoryLimit: "lots" } }))).replace(
                /^package-build config: `sql\.memoryLimit` /,
                "",
            ),
        );
        assertQuoted(
            thrown(() => defineConfig(minimal({ sql: { memoryLimit: "0 GB" } }))).replace(
                /^package-build config: `sql\.memoryLimit` /,
                "",
            ),
        );
        assertQuoted(
            thrown(() => defineConfig(minimal({ sql: { memoryLimit: "20000000 TB" } }))).replace(
                /^package-build config: `sql\.memoryLimit` /,
                "",
            ),
        );
    });

    it("`publish.site`", () => {
        assertQuoted(
            thrown(() => defineConfig(minimal({ publish: { site: true } }))).replace(
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

    it("an unrecognized `site` key", () => {
        assertQuoted(
            thrown(() => defineConfig(minimal({ site: { trees: [] } }))).replace(
                /^package-build config: `site\.trees` /,
                "",
            ),
        );
    });

    it("an unrecognized `publish.address` key", () => {
        assertQuoted(
            thrown(() =>
                defineConfig(minimal({ publish: { address: { prefix: "kb/", landing: true } } })),
            ).replace(/^package-build config: `publish\.address\.landing` /, ""),
        );
    });

    it("an unrecognized pack key", () => {
        assertQuoted(
            thrown(() =>
                defineConfig(minimal({ packs: [{ name: "x", type: "Item", folders: {} }] })),
            ).replace(/^package-build config: `packs\[0\]\.folders` /, ""),
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

    it("`compatibility.minimum`, when a Foundry package does not declare one", () => {
        assertQuoted(thrown(() => defineConfig(minimal({ compatibility: undefined }))));
    });

    /** Assert the document quotes the whole refusal, its list indexes written `<index>`. */
    function assertQuotedWhole(build: () => unknown, placeholders: [string, string][] = []) {
        let message = thrown(build).replace(/\[\d+\]/g, "[<index>]");
        for (const [written, placeholder] of placeholders) {
            message = message.replace(written, placeholder);
        }
        assertQuoted(message);
    }

    it("`art` and the `art.archives` entries", () => {
        const archive = {
            url: "https://example.invalid/originals.zip",
            sha256: "a".repeat(64),
        };
        const art = (value: unknown) => () => defineConfig(minimal({ art: value }));
        assertQuotedWhole(art({ archives: "x" }));
        assertQuotedWhole(art({ archives: ["x"] }));
        assertQuotedWhole(art({ archives: [{ ...archive, url: "" }] }));
        assertQuotedWhole(art({ archives: [{ ...archive, url: "http://example.invalid/a.zip" }] }));
        assertQuotedWhole(
            art({ archives: [{ ...archive, url: "https://user@example.invalid/a.zip" }] }),
        );
        assertQuotedWhole(art({ archives: [{ ...archive, sha256: "ABC" }] }));
        assertQuotedWhole(art({ archives: [archive, archive] }));
        assertQuotedWhole(art({ archives: [archive], masterRoots: ["masters"] }));
    });

    it("`art.packages` entries", () => {
        const entry = {
            package: "artsample",
            url: "https://example.invalid/index.jsonl",
            sha256: "a".repeat(64),
        };
        const art = (value: unknown) => () => defineConfig(minimal({ art: value }));
        assertQuotedWhole(art({ packages: "x" }));
        assertQuotedWhole(art({ packages: ["x"] }));
        // The `url` and `sha256` refusals read as the `art.archives` ones, with
        // the entry's own path.
        assertQuotedWhole(
            art({ packages: [{ ...entry, url: "http://example.invalid/i.jsonl" }] }),
            [["art.packages[<index>]", "art.archives[<index>]"]],
        );
        assertQuotedWhole(art({ packages: [{ ...entry, sha256: "ABC" }] }), [
            ["art.packages[<index>]", "art.archives[<index>]"],
        ]);
    });

    it("`packageBuild.proseLint`", () => {
        const lint = (value: unknown) => () =>
            resolvePackageBuildConfig(sharedMinimal({ proseLint: value }));
        assertQuotedWhole(lint("x"));
        assertQuotedWhole(lint({ rules: "everything" }));
        assertQuotedWhole(lint({ age: 0 }));
        assertQuotedWhole(lint({ threshold: 8 }));
    });

    it("`packageBuild.proseScore`", () => {
        const score = (value: unknown) => () =>
            resolvePackageBuildConfig(sharedMinimal({ proseScore: value }));
        assertQuotedWhole(score("x"));
        assertQuotedWhole(score({ minWords: 0 }));
        assertQuotedWhole(score({ bands: "x" }));
        assertQuotedWhole(score({ bands: { flesch: "x" } }), [
            [".bands.flesch", ".bands.<metric>"],
        ]);
        assertQuotedWhole(score({ bands: { flesch: {} } }), [[".bands.flesch", ".bands.<metric>"]]);
        assertQuotedWhole(score({ bands: { flesch: { min: "x" } } }), [
            [".bands.flesch", ".bands.<metric>"],
        ]);
        assertQuotedWhole(score({ bands: { flesch: { min: 9, max: 1 } } }), [
            [".bands.flesch", ".bands.<metric>"],
        ]);
    });

    it("`packageBuild.settlementExemptions`", () => {
        const exempt = (value: unknown, population?: unknown) => () =>
            resolvePackageBuildConfig(
                sharedMinimal({ settlementExemptions: value, settlementPopulation: population }),
            );
        const good = { address: "affiliation-council", reason: "r" };
        assertQuotedWhole(exempt("x"));
        assertQuotedWhole(exempt(["x"]));
        assertQuotedWhole(exempt([{ ...good, scope: "some" }]));
        assertQuotedWhole(exempt([{ ...good, scope: "urban-share" }], { mode: "complete" }));
        assertQuotedWhole(exempt([{ address: "affiliation-council" }]));
        assertQuotedWhole(exempt([{ ...good, prefix: "place-" }]));
        assertQuotedWhole(exempt([{ reason: "r" }]));
        assertQuotedWhole(exempt([{ ...good, address: "Not An Address" }]));
        assertQuotedWhole(exempt([{ reason: "r", prefix: "Place" }]));
        assertQuotedWhole(exempt([good, good]));
        assertQuotedWhole(exempt([{ address: "", reason: "r" }]));
        assertQuotedWhole(exempt([{ prefix: "", reason: "r" }]));
    });

    it("`packageBuild.settlementPopulation`", () => {
        const population = (value: unknown) => () =>
            resolvePackageBuildConfig(sharedMinimal({ settlementPopulation: value }));
        assertQuotedWhole(population("x"));
        assertQuotedWhole(population({ mode: "partial" }));
        assertQuotedWhole(population({ mode: "complete", urbanShare: 0.2 }));
        assertQuotedWhole(population({ urbanShare: 1.2 }));
        assertQuotedWhole(population({ density: 1 }), [[".density", ".<key>"]]);
    });

    it("`packageBuild.converterData`", () => {
        const data = (value: unknown) => () =>
            resolvePackageBuildConfig(sharedMinimal({ converterData: value }));
        assertQuotedWhole(data(""));
        assertQuotedWhole(data("../converter.json"));
    });

    it("the private JournalEntry pack that differing population figures need", () => {
        const packs = [{ name: "journals", type: "JournalEntry", default: true }];
        const record = {
            package: "demo",
            type: "affiliation",
            subType: "polity",
            shortcode: "hidden",
            name: { full: "Hidden Realm" },
            file: { path: "hidden.md" },
            address: { canonical: "demo-note-affiliation-hidden", slug: "affiliation-hidden" },
            data: { population: { actual: 230, apparent: 0 } },
        };
        let findings: { message: string }[] = [];
        try {
            populationJournalPlan([record], {
                config: { contentPackage: "demo", packs },
                router: createPackRouter(packs),
            });
        } catch (error) {
            findings = (error as { findings: { message: string }[] }).findings;
        }
        expect(findings, "the plan should refuse a package with no private pack").toHaveLength(1);
        assertQuoted(findings[0].message);
    });

    it("`packageBuild.schema`, whose authored default is an empty mapping", () => {
        expect(resolvePackageBuildConfig(sharedMinimal()).schema).toEqual([]);
        expect(DOC).toMatch(
            /\| \[`packageBuild\.schema`\][^\n]*\| no\s+\| none \(an empty mapping\)/,
        );
    });
});
