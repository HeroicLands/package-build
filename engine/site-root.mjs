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
 * **One file, `_headers`.** The prefix root is the homepage — the site build
 * writes it as the mount's `_index.md` — so nothing redirects, and no
 * `_redirects` is written. One left beside the site by an earlier build is
 * removed rather than left to send every reader somewhere nothing publishes.
 *
 * **One implementation, because it is one policy.** What is indexable and how
 * long the prefix root is cached are decisions about the hosting rather than
 * about any one package. Held in each consumer they are the same file with one
 * constant changed, which is a file that drifts — and the drift is invisible,
 * because nobody reads all of the copies at once.
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
 * The lifetime pinned on the prefix root, both spellings.
 *
 * The root is the homepage, the most-linked address a package has. An hour
 * bounds how long a cached copy of it outlives a deploy, on every path between
 * the origin and a reader. Both spellings, because Pages matches the raw path:
 * `/<pkg>` and `/<pkg>/` are distinct keys and a rule on one does not catch the
 * other.
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
 * The `_headers` file's contents.
 *
 * @param {string} pkg - The content package name.
 * @returns {string} The file's contents.
 */
export function headers(pkg) {
    return [...noindexHeaders(), ...cacheHeaders(pkg)].join("\n");
}

/**
 * Write `_headers` beside the rendered site, and remove any `_redirects`.
 *
 * The removal is part of owning the root: a `_redirects` this build did not
 * write is one an earlier build left, and Cloudflare Pages applies whatever
 * sits there. Left in place it would redirect the prefix root — the homepage —
 * to an address nothing publishes.
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

    const file = path.join(root, "_headers");
    fs.writeFileSync(file, headers(pkg));
    fs.rmSync(path.join(root, "_redirects"), { force: true });
    return { files: [file] };
}
