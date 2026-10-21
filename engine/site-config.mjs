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
 * What a site build reads from the configuration: the site's address, title
 * and parameters, and the organisation's navigation.
 *
 * Every value has one source. The package's identity (`baseURL`, `title`,
 * `params.description`, `params.author`) is read from `package.json` and
 * `package-build.config.yaml`, where it is already stated. The organisation's
 * constants — the brand links — are stated once here, because they are the
 * same on every site and a copy per repository is a copy that drifts. The
 * navigation is neither: it is the list of packages the organisation
 * publishes, which lives in one place, heroiclands-site's roster, and reaches
 * every site as the `nav.json` that site publishes. package-build carries no
 * package list; `deps fetch` caches the navigation and the site build reads
 * the cache.
 *
 * What a repository still says for itself is the residue that is genuinely
 * its own, such as the wording of its "page not found" page.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

import { checkHomepage, fail } from "../config.mjs";
import { siteFontsParam } from "./script-font-delivery.mjs";

/**
 * The directory that is deployed, relative to the repository root.
 *
 * `package-build site build` renders into `<DEPLOY_ROOT>/<contentPackage>/`
 * and writes `_headers` beside it and the search index inside it.
 */
export const DEPLOY_ROOT = "build/site";

/**
 * The brand chrome's own links, the same on every site.
 *
 * `logo` is a path on the asset host rather than an address.
 */
export const BRAND = Object.freeze({
    logo: "images/brand/sohl-icon-white.webp",
    licenseURL: "https://www.heroiclands.org/license/",
    discordURL: "https://discord.gg/EwMfkNd3az",
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
 * reach the menu as `undefined` labels and links.
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
            "the site navigation has not been fetched. Run `package-build deps fetch` first.",
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
 * What a site is, read from the configuration: its address, its title and the
 * parameters its layouts read.
 *
 * `checkHomepage` runs first, before any value is composed — a missing or
 * mismatched `package.json` `homepage` is a finding on every site build.
 *
 * @param {object} options - The sources.
 * @param {object} options.config - The resolved build configuration.
 * @returns {{baseURL: string, title: string, params: Record<string, unknown>}}
 *   The site. `params` holds `description`, `author`, `cdnBaseURL`, `brand`,
 *   `notfound` and `scriptFonts`, each where the configuration states it.
 * @throws {TypeError} When `homepage` fails `checkHomepage`, or the
 *   configuration declares no `site.title` or `packageBuild.manifest.title`, no
 *   `site.description`, or no `site.assets`.
 */
export function siteSettings({ config }) {
    checkHomepage(config.homepage, config.contentPackage, config.site.base);

    const title = config.site.title || config.packageBuild?.manifest?.title;
    if (typeof title !== "string" || !title.trim()) {
        throw new TypeError(
            "package-build config: declare `site.title` or " +
                "`packageBuild.manifest.title` for the site's title.",
        );
    }
    if (!config.site.description) {
        fail(
            "site.description",
            'is not declared, and the site\'s `<meta name="description">` reads from it',
        );
    }
    if (!config.site.assets) {
        fail(
            "site.assets",
            "is not declared, and a site build needs one — it is the host every " +
                "package's imagery is served from, and the theme resolves every " +
                "relative asset against it",
        );
    }

    /** @type {Record<string, unknown>} */
    const params = { description: config.site.description };
    if (config.author?.name) params.author = config.author.name;
    if (config.site.assets) params.cdnBaseURL = config.site.assets;
    params.brand = { ...BRAND };
    if (config.site.notfound) params.notfound = structuredClone(config.site.notfound);
    // Named only when the build copies the fonts, so the theme links nothing
    // it does not ship.
    const scriptFonts = siteFontsParam(config);
    if (scriptFonts) params.scriptFonts = scriptFonts;
    return { baseURL: config.homepage, title, params };
}
