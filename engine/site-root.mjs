/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The files that belong to a deployment's **root** rather than to the rendered
 * site.
 *
 * Hugo renders into `<out>/<package>/`, because the deployment carries the
 * `/<package>/` prefix physically and the routing layer is a path-preserving
 * pass-through. The directory that is *uploaded* is its parent, and Cloudflare
 * Pages reads `_headers` and `_redirects` from there and nowhere else — a copy
 * inside the prefix is published as a text file and never applied. Hugo owns
 * everything under the prefix; this owns what sits beside it.
 *
 * **One implementation, because it is one policy.** What is indexable, where
 * the prefix root sends a reader, and how long that answer is cached are
 * decisions about the hosting rather than about any one package. Held in each
 * consumer they are the same file with one constant changed, which is a file
 * that drifts — and the drift is invisible, because nobody reads all of the
 * copies at once.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";

/**
 * The namespace the routing layer derives a package's origin in.
 *
 * `/<package>/` on the public host is proxied to
 * `https://<package>.<suffix>/<package>/`, and {@link noindexHeaders} depends on
 * that being a dedicated namespace.
 *
 * @type {string}
 */
export const ORIGIN_SUFFIX = "pkg.heroiclands.org";

/**
 * Where a package's landing is served, now that it is an addressed page.
 *
 * The site build emits the homepage at its own address rather than as the
 * site root's `_index.md`, so the prefix root is a redirect to it.
 *
 * @param {string} pkg - The content package name.
 * @returns {string} The landing's path.
 */
export function landingPath(pkg) {
    return `/${pkg}/homepage-root/`;
}

/**
 * Suppress indexing of every address a deployment answers on but nobody
 * advertises.
 *
 * Cloudflare Pages assigns three: the project's own `pages.dev`, a per-
 * deployment `pages.dev`, and the custom domain the project carries so the
 * routing layer has an origin to fetch. None is advertised, all answer with the
 * same pages, and left alone they are indexed and compete with the canonical
 * URL in search results.
 *
 * The third matters most: it is the address the routing layer fetches, so it is
 * the host-assigned address a reader is most plausibly handed. The rules are
 * **scoped to those hostnames**, which keeps this correct for anyone deploying
 * the site under a domain of their own — there it is indexable, and only the
 * host-assigned addresses are not.
 *
 * @returns {string[]} The header block's lines.
 */
export function noindexHeaders() {
    return [
        "https://:project.pages.dev/*",
        "  X-Robots-Tag: noindex",
        "",
        "https://:version.:project.pages.dev/*",
        "  X-Robots-Tag: noindex",
        "",
        `https://:package.${ORIGIN_SUFFIX}/*`,
        "  X-Robots-Tag: noindex",
        "",
    ];
}

/**
 * The lifetime pinned on the prefix-root redirect, and why it is pinned.
 *
 * Cloudflare Pages sets no `Cache-Control` on a redirect it generates — those
 * responses carry `location` and nothing else — and a 301 with no lifetime is
 * cached by a browser indefinitely, on the most-linked URL there is. An hour
 * keeps the 301's canonical signal without the permanence.
 *
 * @param {string} pkg - The content package name.
 * @returns {string[]} The header block's lines.
 */
export function cacheHeaders(pkg) {
    return [
        `/${pkg}/`,
        "  Cache-Control: max-age=3600",
        "",
        `/${pkg}`,
        "  Cache-Control: max-age=3600",
        "",
    ];
}

/**
 * Both forms of the prefix root, because Pages matches the raw path.
 *
 * Redirect matching runs before any trailing-slash or `index.html` handling, so
 * `/<pkg>` and `/<pkg>/` are distinct keys and a rule on one does not catch the
 * other.
 *
 * @param {string} pkg - The content package name.
 * @returns {string} The `_redirects` file's contents.
 */
export function redirects(pkg) {
    const to = landingPath(pkg);
    return [`/${pkg}/   ${to}   301`, `/${pkg}    ${to}   301`, ""].join("\n");
}

/**
 * The `_headers` file's contents.
 *
 * @param {string} pkg - The content package name.
 * @returns {string} The file's contents.
 */
export function headers(pkg) {
    return [...noindexHeaders(), ...cacheHeaders(pkg)].join("\n");
}

/**
 * Write `_headers` and `_redirects` beside the rendered site.
 *
 * @param {object} options - Options.
 * @param {string} options.pkg - The content package name, which is also the
 *   directory Hugo rendered into.
 * @param {string} options.out - The directory that is deployed.
 * @returns {{files: string[]}} The files written.
 * @throws {Error} When no rendered site is there, which means the site build
 *   has not run and writing root files would publish a deployment with nothing
 *   under the prefix.
 */
export function writeSiteRoot({ pkg, out }) {
    const root = path.resolve(out);
    const rendered = path.join(root, pkg);
    if (!fs.existsSync(path.join(rendered, "index.html"))) {
        throw new Error(
            `${out}/${pkg}/ holds no rendered site — build the site before its root files`,
        );
    }

    const written = [];
    for (const [name, body] of [
        ["_headers", headers(pkg)],
        ["_redirects", redirects(pkg)],
    ]) {
        const file = path.join(root, name);
        fs.writeFileSync(file, body);
        written.push(file);
    }
    return { files: written };
}
