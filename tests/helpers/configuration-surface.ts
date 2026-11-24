/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The configuration surface of `package-build`, read from the validators'
 * own behaviour.
 *
 * Every key list in `content-config.mjs` and `config.mjs` is module-private, so
 * the lists are read from the "expected one of: ..." refusal that
 * `rejectUnknownKeys` raises for an unrecognised key. The closed value sets
 * come from the validators' exported bindings. Every documentation guard works
 * from this one inventory.
 */

import {
    AUTHOR_ROLES,
    defineConfig,
    PACKAGE_KINDS,
    PACK_DOCUMENT_TYPES,
} from "../../content-config.mjs";
import { resolvePackageBuildConfig } from "../../config.mjs";

/** A minimal configuration `defineConfig` accepts without complaint. */
export function minimal(overrides: Record<string, unknown> = {}) {
    return {
        rootDir: "/repo",
        contentPackage: "acme",
        foundryPackage: "acme",
        packageKind: "systems",
        compatibility: { minimum: "14.359" },
        stats: { lastModifiedBy: "acmebuilder0000" },
        packs: [{ name: "items", type: "Item" }],
        ...overrides,
    };
}

/** The shared configuration `resolvePackageBuildConfig` accepts without complaint. */
export function sharedMinimal(packageBuild: Record<string, unknown> = {}) {
    return { rootDir: "/repo", packageKind: "systems", foundryPackage: "acme", packageBuild };
}

/**
 * The allowed-keys list `rejectUnknownKeys` reports when `build` declares one
 * key it does not recognise.
 *
 * @param build - A call expected to throw the "not a recognized option" message.
 * @returns The allowed keys, in the order the validator lists them.
 */
export function allowedKeys(build: () => unknown): string[] {
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
export function thrown(build: () => unknown): string {
    try {
        build();
    } catch (err) {
        return (err as Error).message;
    }
    throw new Error("expected the build to throw");
}

/** One object in the configuration and the keys it accepts. */
export interface ConfigurationKeyGroup {
    /** Dotted path of the object; empty for the top level. List entries end in `[]`. */
    path: string;
    /** The keys the validator accepts there. */
    keys: string[];
}

/** One configuration key as a documentation guard needs it. */
export interface ConfigurationKey {
    /** Dotted path of the key, e.g. `pdf.fonts.serif`; a top-level key is bare. */
    path: string;
    /** The key's own name. */
    key: string;
    /** Dotted path of the object holding the key. */
    group: string;
}

/** A closed set of values the configuration accepts. */
export interface ConfigurationChoices {
    /** Dotted path of the setting the set constrains. */
    path: string;
    /** The accepted values. */
    values: string[];
}

const BOOK = { id: "core", title: "t", document: "d" };

/** Each probe provokes one unrecognised-key refusal and returns the allowed list. */
const KEY_PROBES: { path: string; probe: () => string[] }[] = [
    { path: "", probe: () => allowedKeys(() => defineConfig(minimal({ __unrecognised__: true }))) },
    {
        path: "stats",
        probe: () =>
            allowedKeys(() =>
                defineConfig(minimal({ stats: { lastModifiedBy: "x", __unrecognised__: true } })),
            ),
    },
    {
        path: "paths",
        probe: () =>
            allowedKeys(() => defineConfig(minimal({ paths: { __unrecognised__: true } }))),
    },
    {
        path: "docs",
        probe: () => allowedKeys(() => defineConfig(minimal({ docs: { __unrecognised__: true } }))),
    },
    {
        path: "docs.itemFields",
        probe: () =>
            allowedKeys(() =>
                defineConfig(minimal({ docs: { itemFields: { __unrecognised__: true } } })),
            ),
    },
    {
        path: "site",
        probe: () => allowedKeys(() => defineConfig(minimal({ site: { __unrecognised__: true } }))),
    },
    {
        path: "site.notfound",
        probe: () =>
            allowedKeys(() =>
                defineConfig(
                    minimal({
                        site: { notfound: { tagline: "t", sitenoun: "s", __unrecognised__: true } },
                    }),
                ),
            ),
    },
    {
        path: "pdf",
        probe: () =>
            allowedKeys(() =>
                defineConfig(minimal({ pdf: { __unrecognised__: true, books: [BOOK] } })),
            ),
    },
    {
        path: "pdf.fonts",
        probe: () =>
            allowedKeys(() =>
                defineConfig(
                    minimal({ pdf: { books: [BOOK], fonts: { __unrecognised__: true } } }),
                ),
            ),
    },
    {
        path: "pdf.books[]",
        probe: () =>
            allowedKeys(() =>
                defineConfig(minimal({ pdf: { books: [{ ...BOOK, __unrecognised__: true }] } })),
            ),
    },
    {
        path: "authors[]",
        probe: () =>
            allowedKeys(() =>
                defineConfig(minimal({ authors: [{ name: "n", __unrecognised__: true }] })),
            ),
    },
    {
        path: "compatibility",
        probe: () =>
            allowedKeys(() =>
                defineConfig(minimal({ compatibility: { minimum: "1", __unrecognised__: true } })),
            ),
    },
    {
        path: "relationships",
        probe: () =>
            allowedKeys(() => defineConfig(minimal({ relationships: { __unrecognised__: true } }))),
    },
    {
        path: "relationships.systems[]",
        probe: () =>
            allowedKeys(() =>
                defineConfig(
                    minimal({ relationships: { systems: [{ id: "x", __unrecognised__: true }] } }),
                ),
            ),
    },
    {
        path: "systems.<id>",
        probe: () =>
            allowedKeys(() =>
                defineConfig(
                    minimal({
                        packageKind: "modules",
                        systems: {
                            sohl: { __unrecognised__: true, compatibility: { verified: "1.0" } },
                        },
                    }),
                ),
            ),
    },
    {
        path: "itemBuilders.<type>",
        probe: () =>
            allowedKeys(() =>
                defineConfig(
                    minimal({
                        itemBuilders: { foo: { __unrecognised__: true, system: () => ({}) } },
                    }),
                ),
            ),
    },
    {
        path: "itemBuilders[]",
        probe: () =>
            allowedKeys(() =>
                defineConfig(
                    minimal({
                        itemBuilders: [{ __unrecognised__: true, system: "sohl", builders: {} }],
                    }),
                ),
            ),
    },
    {
        path: "packs[]",
        probe: () =>
            allowedKeys(() =>
                defineConfig(
                    minimal({ packs: [{ name: "x", type: "Item", __unrecognised__: true }] }),
                ),
            ),
    },
    {
        path: "sql",
        probe: () => allowedKeys(() => defineConfig(minimal({ sql: { __unrecognised__: true } }))),
    },
    {
        path: "publish",
        probe: () =>
            allowedKeys(() => defineConfig(minimal({ publish: { __unrecognised__: true } }))),
    },
    {
        path: "publish.address",
        probe: () =>
            allowedKeys(() =>
                defineConfig(minimal({ publish: { address: { __unrecognised__: true } } })),
            ),
    },
    {
        path: "languages.<name>",
        probe: () =>
            allowedKeys(() =>
                defineConfig(minimal({ languages: { vyl: { __unrecognised__: true } } })),
            ),
    },
    {
        path: "packageBuild",
        probe: () =>
            allowedKeys(() => resolvePackageBuildConfig(sharedMinimal({ __unrecognised__: true }))),
    },
    {
        path: "packageBuild.assets[]",
        probe: () =>
            allowedKeys(() =>
                resolvePackageBuildConfig(sharedMinimal({ assets: [{ __unrecognised__: true }] })),
            ),
    },
    ...["clean", "lang", "deploy", "release", "bundle", "container"].map((section) => ({
        path: `packageBuild.${section}`,
        probe: () =>
            allowedKeys(() =>
                resolvePackageBuildConfig(sharedMinimal({ [section]: { __unrecognised__: true } })),
            ),
    })),
    {
        path: "packageBuild.container.stages.<name>",
        probe: () =>
            allowedKeys(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({ container: { stages: { dev: { __unrecognised__: true } } } }),
                ),
            ),
    },
    {
        path: "art",
        probe: () => allowedKeys(() => defineConfig(minimal({ art: { __unrecognised__: true } }))),
    },
    {
        path: "art.archives[]",
        probe: () =>
            allowedKeys(() =>
                defineConfig(minimal({ art: { archives: [{ __unrecognised__: true }] } })),
            ),
    },
    {
        path: "art.packages[]",
        probe: () =>
            allowedKeys(() =>
                defineConfig(minimal({ art: { packages: [{ __unrecognised__: true }] } })),
            ),
    },
    {
        path: "packageBuild.proseLint",
        probe: () =>
            allowedKeys(() =>
                resolvePackageBuildConfig(sharedMinimal({ proseLint: { __unrecognised__: 1 } })),
            ),
    },
    {
        path: "packageBuild.proseScore",
        probe: () =>
            allowedKeys(() =>
                resolvePackageBuildConfig(sharedMinimal({ proseScore: { __unrecognised__: 1 } })),
            ),
    },
    {
        path: "packageBuild.proseScore.bands",
        probe: () =>
            allowedKeys(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({ proseScore: { bands: { __unrecognised__: {} } } }),
                ),
            ),
    },
    {
        path: "packageBuild.proseScore.bands.<metric>",
        probe: () =>
            allowedKeys(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({
                        proseScore: { bands: { flesch: { min: 1, __unrecognised__: 1 } } },
                    }),
                ),
            ),
    },
    {
        path: "packageBuild.settlementExemptions[]",
        probe: () =>
            allowedKeys(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({ settlementExemptions: [{ __unrecognised__: 1 }] }),
                ),
            ),
    },
    {
        path: "packageBuild.e2e",
        probe: () =>
            allowedKeys(() =>
                resolvePackageBuildConfig(sharedMinimal({ e2e: { __unrecognised__: true } })),
            ),
    },
    {
        path: "packageBuild.e2e.suite",
        probe: () =>
            allowedKeys(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({ e2e: { suite: { __unrecognised__: true, run: ["x"] } } }),
                ),
            ),
    },
    {
        path: "packageBuild.e2e.build.<name>",
        probe: () =>
            allowedKeys(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({
                        e2e: { build: { fast: { __unrecognised__: true, script: "x" } } },
                    }),
                ),
            ),
    },
    {
        path: "packageBuild.e2e.world",
        probe: () =>
            allowedKeys(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({ e2e: { world: { __unrecognised__: true } } }),
                ),
            ),
    },
    {
        path: "packageBuild.e2e.gm",
        probe: () =>
            allowedKeys(() =>
                resolvePackageBuildConfig(
                    sharedMinimal({ e2e: { gm: { __unrecognised__: true } } }),
                ),
            ),
    },
];

/**
 * The keys one configuration object accepts, read from the validator.
 *
 * @param groupPath - Dotted path of the object; empty for the top level.
 * @returns The allowed keys, in the validator's order.
 */
export function configurationKeys(groupPath: string): string[] {
    const entry = KEY_PROBES.find((candidate) => candidate.path === groupPath);
    if (!entry) throw new Error(`no configuration probe for \`${groupPath}\``);
    return entry.probe();
}

/**
 * Every probed configuration object with its accepted keys.
 *
 * @returns One group per object.
 */
export function configurationKeyGroups(): ConfigurationKeyGroup[] {
    return KEY_PROBES.map(({ path, probe }) => ({ path, keys: probe() }));
}

/**
 * Every probed configuration key, flat, with its dotted path.
 *
 * @returns One entry per key of every group.
 */
export function configurationSurface(): ConfigurationKey[] {
    return configurationKeyGroups().flatMap(({ path, keys }) =>
        keys.map((key) => ({ path: path ? `${path}.${key}` : key, key, group: path })),
    );
}

/**
 * The closed value sets of the configuration, read from the validators'
 * exported bindings.
 *
 * @returns One entry per constrained setting.
 */
export function configurationChoices(): ConfigurationChoices[] {
    return [
        { path: "packageKind", values: [...PACKAGE_KINDS] },
        { path: "packs[].type", values: [...PACK_DOCUMENT_TYPES] },
        { path: "authors[].role", values: [...AUTHOR_ROLES] },
    ];
}
