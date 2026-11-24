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
});
