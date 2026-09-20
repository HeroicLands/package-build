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
 * The Hugo configuration a site build generates.
 *
 * `content-build site` writes the whole Hugo source tree under `build/hugo/`
 * — `hugo.toml`, the content mount, Hugo's own cache — as a sibling of the
 * deployment root `build/site/`, so nothing Hugo reads lands in what is
 * published. The consumer's script runs Hugo over it; the toolchain never
 * does.
 *
 * Every value in the generated file has one source. The package's identity
 * (`baseURL`, `title`, `params.description`, `params.author`) is read from
 * `package.json` and `package-build.config.yaml`, where it is already stated.
 * The organisation's constants — the brand links, the locale — are stated once
 * here, because they are the same on every site and a copy per repository is
 * a copy that drifts. The navigation is neither: it is the list of packages
 * the organisation publishes, which lives in one place, heroiclands-site's
 * roster, and reaches every site as the `nav.json` that site publishes.
 * package-build carries no package list; `deps fetch` caches the navigation
 * and the site build writes `[menu.main]` from the cache.
 *
 * What a repository still says for itself is the residue that is genuinely
 * its own — the wording of its "page not found" page, whether its listings
 * show shortcodes — and, through `site.hugo`, the one key nobody anticipated.
 * {@link module:content-config.DERIVED_HUGO_KEYS} refuses everything the
 * generator writes from being authored there too.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { stringify as stringifyToml } from "smol-toml";

import { checkHomepage } from "../config.mjs";
import { slugify } from "./content-slug.mjs";

/** The Hugo source directory, relative to the repository root. */
export const HUGO_SOURCE = "build/hugo";

/** The content mount `content-build site` writes, relative to the repository root. */
export const HUGO_CONTENT = `${HUGO_SOURCE}/content`;

/**
 * The directory that is deployed, relative to the repository root.
 *
 * Hugo renders into `<DEPLOY_ROOT>/<contentPackage>/`; `package-build
 * site-root` writes `_headers` and `_redirects` beside it.
 */
export const DEPLOY_ROOT = "build/site";

/** The npm package the shared theme arrives as. */
export const THEME_PACKAGE = "@heroiclands/hugo-theme";

/** The theme's name under `themesDir`, which is the package's unscoped name. */
export const THEME = "hugo-theme";

/** The locale every site renders in. */
export const LOCALE = "en-us";

/**
 * The brand chrome's own links, the same on every site.
 *
 * `logo` is resolved through the theme's `cdn-url.html`, so it is a path on
 * the asset host rather than an address.
 */
export const BRAND = Object.freeze({
    logo: "images/brand/sohl-icon-white.webp",
    licenseURL: "https://www.heroiclands.org/license/",
    discordURL: "https://discord.gg/EwMfkNd3az",
});

/**
 * The kinds no site renders.
 *
 * A section exists only where `site.sections` declares one, so a tree holding
 * only the homepage emits nothing beyond it; taxonomies and feeds would be
 * empty shells on every site.
 */
export const DISABLE_KINDS = Object.freeze(["taxonomy", "term", "RSS"]);

/**
 * The markup settings the toolchain's own output requires.
 *
 * Pages are written with raw HTML in them — a `<figure>` for every image, a
 * `<span>` marking an unresolved link — and Goldmark drops raw HTML unless
 * told otherwise. A theme cannot supply this: Hugo does not merge a theme's
 * `markup` block.
 */
export const MARKUP = Object.freeze({
    goldmark: Object.freeze({ renderer: Object.freeze({ unsafe: true }) }),
});

/** Where the navigation is published. */
export const NAVIGATION_URL = "https://www.heroiclands.org/nav.json";

/** The cached navigation's file name. */
export const NAVIGATION_FILE = "nav.json";

/**
 * Written once a fetch completes, so a half-finished cache is never used —
 * the convention every cache under `build/cache` follows.
 */
const STAMP = ".complete";

/**
 * A navigation entry, as `nav.json` states one.
 *
 * @typedef {object} NavigationEntry
 * @property {string} name - The entry's label.
 * @property {string} url - Where it links, absolute.
 * @property {NavigationEntry[]} [children] - A dropdown's entries.
 */

/**
 * A Hugo menu entry, as `[[menu.main]]` states one.
 *
 * @typedef {object} MenuEntry
 * @property {string} name
 * @property {string} url
 * @property {number} weight
 * @property {string} [identifier] - Set on an entry that has children.
 * @property {string} [parent] - Set on a child, naming its parent's identifier.
 */

/**
 * @param {unknown} value - Anything.
 * @returns {value is Record<string, unknown>} Whether it is a plain mapping.
 */
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value - Anything.
 * @param {string} where - Dotted path, for the error.
 * @returns {string} The value.
 */
function requireNonEmptyString(value, where) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new TypeError(`${where} must be a non-empty string`);
    }
    return value;
}

/**
 * Check a navigation's shape, and return it.
 *
 * `[{name, url, children?: [{name, url}]}]`, every `url` absolute. Checked
 * on fetch and again on read: a file that is not a navigation would otherwise
 * reach the generated menu as `undefined` labels and links.
 *
 * @param {unknown} value - The parsed document.
 * @param {string} where - What is being checked, for the error.
 * @returns {NavigationEntry[]} The navigation.
 * @throws {TypeError} When the shape is not a navigation.
 */
export function checkNavigation(value, where = "the navigation") {
    if (!Array.isArray(value)) {
        throw new TypeError(`${where} must be a list of \`{name, url, children?}\` entries`);
    }
    /**
     * @param {unknown} entry - One entry.
     * @param {string} at - Its dotted path.
     * @param {boolean} nested - Whether it is a child, which may not nest.
     * @returns {NavigationEntry} The checked entry.
     */
    const check = (entry, at, nested) => {
        if (!isPlainObject(entry)) throw new TypeError(`${at} must be a mapping`);
        const out = {
            name: requireNonEmptyString(entry.name, `${at}.name`),
            url: requireNonEmptyString(entry.url, `${at}.url`),
        };
        if (entry.children === undefined) return out;
        if (nested) throw new TypeError(`${at}.children: a dropdown's entry may not nest`);
        if (!Array.isArray(entry.children)) throw new TypeError(`${at}.children must be a list`);
        return {
            ...out,
            children: entry.children.map((child, i) => check(child, `${at}.children[${i}]`, true)),
        };
    };
    return value.map((entry, i) => check(entry, `${where}[${i}]`, false));
}

/**
 * The `[[menu.main]]` entries a navigation renders as.
 *
 * Entry for entry, in order; a dropdown is an entry with an `identifier` and
 * its children are entries naming it as `parent`, which is how the theme's
 * header partial draws one. Weights count from one within each level, so the
 * order is the navigation's and not Hugo's alphabetical fallback.
 *
 * @param {readonly NavigationEntry[]} navigation - The navigation.
 * @returns {MenuEntry[]} The menu entries.
 */
export function menuEntries(navigation) {
    /** @type {MenuEntry[]} */
    const out = [];
    navigation.forEach((entry, index) => {
        const children = entry.children ?? [];
        if (!children.length) {
            out.push({ name: entry.name, url: entry.url, weight: index + 1 });
            return;
        }
        const identifier = slugify(entry.name);
        out.push({ name: entry.name, url: entry.url, weight: index + 1, identifier });
        children.forEach((child, i) => {
            out.push({ name: child.name, url: child.url, weight: i + 1, parent: identifier });
        });
    });
    return out;
}

/**
 * Where the fetched navigation sits.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {string} The cache directory.
 */
export function navigationCacheDir(config) {
    return config.paths.navigationCache;
}

/**
 * The cached navigation.
 *
 * **Reads the cache only.** A cold cache is an error naming the command that
 * fills it, rather than a download nobody asked for: a site build that reaches
 * the network is not reproducible and fails strangely offline. That is the
 * content index's rule, and it holds here for the same reason. A half-finished
 * fetch counts as cold.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {NavigationEntry[]} The navigation.
 * @throws {Error} When it has not been fetched, or is not a navigation.
 */
export function readCachedNavigation(config) {
    const dir = navigationCacheDir(config);
    const file = path.join(dir, NAVIGATION_FILE);
    if (!fs.existsSync(path.join(dir, STAMP)) || !fs.existsSync(file)) {
        throw new Error(
            "the site navigation has not been fetched. Run `content-build deps fetch` first.",
        );
    }
    return checkNavigation(JSON.parse(fs.readFileSync(file, "utf8")), file);
}

/**
 * Fetch the navigation into the cache, and stamp it complete.
 *
 * Rebuilt from empty on every call rather than kept when present: the
 * navigation carries no version to key a cache on, and a package added to the
 * roster reaches a site on its next `deps fetch`.
 *
 * @param {object} config - The resolved build configuration.
 * @param {object} [options] - Options.
 * @param {string} [options.url] - Where to fetch from. Defaults to
 *   {@link NAVIGATION_URL}.
 * @param {typeof globalThis.fetch} [options.fetch] - The fetch to use.
 * @returns {Promise<string>} The cached file.
 * @throws {Error} When the download fails, or the document is not a navigation.
 */
export async function fetchNavigation(
    config,
    { url = NAVIGATION_URL, fetch = globalThis.fetch } = {},
) {
    const dir = navigationCacheDir(config);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
        throw new Error(
            `could not download the site navigation at ${url}: HTTP ${res.status} ${res.statusText}`,
        );
    }
    const navigation = checkNavigation(await res.json(), url);
    const file = path.join(dir, NAVIGATION_FILE);
    fs.writeFileSync(file, `${JSON.stringify(navigation, null, 4)}\n`);
    fs.writeFileSync(path.join(dir, STAMP), "");
    return file;
}

/**
 * The `themesDir` for a repository, as the path from `build/hugo/` to the
 * directory holding the installed theme.
 *
 * Resolved the way Node resolves a package — `node_modules/` in the
 * repository root, then in each parent — and written as a path rather than
 * assumed, so a worktree that resolves its parent's install says so in the
 * generated file.
 *
 * @param {string} rootDir - The repository root.
 * @returns {string} The relative path, POSIX-separated.
 * @throws {Error} When the theme is installed nowhere above the root.
 */
export function resolveThemesDir(rootDir) {
    let dir = path.resolve(rootDir);
    for (;;) {
        const scope = path.join(dir, "node_modules", path.dirname(THEME_PACKAGE));
        if (fs.existsSync(path.join(scope, path.basename(THEME_PACKAGE), "theme.toml"))) {
            const rel = path.relative(path.resolve(rootDir, HUGO_SOURCE), scope);
            return rel.split(path.sep).join("/");
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error(
        `${THEME_PACKAGE} is not installed anywhere above ${rootDir} — add it to ` +
            "`devDependencies` and run `npm ci`",
    );
}

/**
 * Deep-merge `overrides` over `base`, arrays replaced whole.
 *
 * @param {Record<string, unknown>} base - The generated configuration.
 * @param {Record<string, unknown>} overrides - What `site.hugo` declares.
 * @returns {Record<string, unknown>} A new object.
 */
function deepMerge(base, overrides) {
    /** @type {Record<string, unknown>} */
    const out = { ...base };
    for (const [key, value] of Object.entries(overrides)) {
        const current = out[key];
        out[key] =
            isPlainObject(current) && isPlainObject(value) ?
                deepMerge(current, value)
            :   structuredClone(value);
    }
    return out;
}

/**
 * The Hugo configuration, as an object.
 *
 * Pure: every input is handed in, so a test can describe the generated shape
 * without a repository on disk. {@link generateHugoConfig} is the same function
 * with the reading put back.
 *
 * `checkHomepage` runs first, before any value is composed — a missing or
 * mismatched `package.json` `homepage` is a finding on every site build.
 *
 * @param {object} options - The sources.
 * @param {object} options.config - The resolved build configuration.
 * @param {string} [options.description] - `package.json`'s `description`.
 * @param {readonly NavigationEntry[]} options.navigation - The navigation.
 * @param {string} options.themesDir - From {@link resolveThemesDir}.
 * @returns {Record<string, any>} The configuration Hugo reads.
 * @throws {TypeError} When `homepage` fails `checkHomepage`, or the
 *   configuration declares no `packageBuild.manifest.title`.
 */
export function hugoConfig({ config, description, navigation, themesDir }) {
    checkHomepage(config.homepage, config.contentPackage);

    const title = config.packageBuild?.manifest?.title;
    if (typeof title !== "string" || !title.trim()) {
        throw new TypeError(
            "package-build config: `packageBuild.manifest.title` is not declared, " +
                "and the site's `title` reads from it.",
        );
    }

    /** @type {Record<string, unknown>} */
    const params = {};
    if (typeof description === "string" && description.trim()) params.description = description;
    if (config.author?.name) params.author = config.author.name;
    if (config.site.assets) params.cdnBaseURL = config.site.assets;
    params.brand = { ...BRAND };
    params.list = { ...config.site.list };
    if (config.site.notfound) params.notfound = structuredClone(config.site.notfound);

    const generated = {
        baseURL: config.homepage,
        title,
        locale: LOCALE,
        publishDir: path.posix.relative(HUGO_SOURCE, `${DEPLOY_ROOT}/${config.contentPackage}`),
        themesDir,
        theme: THEME,
        contentDir: path.posix.relative(HUGO_SOURCE, HUGO_CONTENT),
        disableKinds: [...DISABLE_KINDS],
        params,
        markup: structuredClone(MARKUP),
        menu: { main: menuEntries(navigation) },
    };
    return deepMerge(generated, config.site.hugo);
}

/**
 * The configuration as the TOML Hugo reads.
 *
 * @param {Record<string, unknown>} generated - From {@link hugoConfig}.
 * @returns {string} The file's contents.
 */
export function hugoToml(generated) {
    return (
        "# Generated by `content-build site` from package.json and " +
        "package-build.config.yaml.\n# Every value here has a source there; edit " +
        "the source, not this file.\n\n" +
        `${stringifyToml(generated)}\n`
    );
}

/**
 * `package.json`'s `description`, or `undefined` when it declares none.
 *
 * @param {string} rootDir - The repository root.
 * @returns {string|undefined} The description.
 */
function packageDescription(rootDir) {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
    return typeof pkg.description === "string" ? pkg.description : undefined;
}

/**
 * The Hugo configuration, every source read from the repository.
 *
 * Reads `package.json`, the cached navigation and the installed theme's
 * location, and composes them with {@link hugoConfig}. Nothing is written, so
 * a caller can run this before touching the output tree and fail with it
 * intact.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {Record<string, any>} The configuration Hugo reads.
 * @throws {Error} When any source is missing or wrong.
 */
export function generateHugoConfig(config) {
    return hugoConfig({
        config,
        description: packageDescription(config.rootDir),
        navigation: readCachedNavigation(config),
        themesDir: resolveThemesDir(config.rootDir),
    });
}

/**
 * Write `build/hugo/hugo.toml`.
 *
 * @param {object} config - The resolved build configuration.
 * @param {Record<string, unknown>} [generated] - The configuration to write,
 *   when the caller already generated it. Generated here otherwise.
 * @returns {{file: string}} The file written.
 */
export function writeHugoConfig(config, generated = generateHugoConfig(config)) {
    const file = path.join(config.rootDir, HUGO_SOURCE, "hugo.toml");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, hugoToml(generated));
    return { file };
}
