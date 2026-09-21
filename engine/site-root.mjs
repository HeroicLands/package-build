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
 * **And one directory inside the prefix, `pagefind/`.** Every package site
 * ends the same way — Hugo renders into the output directory, this
 * post-processes it there — so the search index is built in this step and
 * every site gets one without each repository adding a dependency and a
 * script. Pagefind indexes the rendered pages and writes `<package>/pagefind/`
 * beside them, served at `/<package>/pagefind/` with the rest of the site;
 * the theme loads it relative to the site's base URL like any other asset.
 * `site.search: false` skips the step, and removes an index an earlier build
 * left. What is indexed is whatever the theme rendered: the theme marks its
 * own chrome `data-pagefind-ignore`, and this package's part is only to run
 * the indexer over the result.
 *
 * **One implementation, because it is one policy.** What is indexable is a
 * decision about the hosting rather than about any one package. Held in each
 * consumer it is the same file with one constant changed, which is a file that
 * drifts — and the drift is invisible, because nobody reads all of the copies
 * at once.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import * as pagefind from "pagefind";

import { formatDiagnostic } from "./diagnostics.mjs";

/**
 * The directory the search index is written to, inside the rendered site.
 *
 * Pagefind's own default, and the one its browser bundle derives the site's
 * base URL from: `pagefind.js` at `/<package>/pagefind/pagefind.js` means
 * every result's `url` is joined onto `/<package>/`, so nothing about the
 * prefix is configured on either side.
 *
 * @type {string}
 */
export const SEARCH_DIR = "pagefind";

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
 * The `_headers` file's contents: the `noindex` rules, and nothing else.
 *
 * No `Cache-Control` is pinned on the prefix root. It is the homepage, and a
 * lifetime on it would hold a stale copy at the most-linked address after a
 * deploy; Pages' own defaults for a page apply.
 *
 * @returns {string} The file's contents.
 */
export function headers() {
    return noindexHeaders().join("\n");
}

/**
 * What runs the search indexer over a rendered site.
 *
 * {@link indexSite} is the one the command uses; a test hands
 * {@link writeSiteRoot} a stand-in, so the step's own contract — what it is
 * given, when it runs, how its failure is reported — is checked without a
 * binary.
 *
 * @callback SiteIndexer
 * @param {{site: string, output: string}} where - The rendered site, and the
 *   directory inside it the index is written to.
 * @returns {Promise<{pages: number}>} How many pages were indexed.
 */

/**
 * Build the search index of a rendered site with Pagefind.
 *
 * Pagefind's Node API drives the binary the `pagefind` package installs for
 * the platform as an optional dependency, so there is nothing to put on a
 * `PATH`. Three things it does not do on its own are done here, because each
 * is a quiet failure otherwise:
 *
 * - A directory that is not there indexes as zero pages and no error, so the
 *   site is checked first.
 * - Zero pages from a directory that _is_ there means the pages were not
 *   read — an empty index is deployable and finds nothing — so it is refused.
 * - The binary missing is reported by the package as an install failure of
 *   its own; it is rethrown naming the platform package to install.
 *
 * The output directory is emptied first, so an index of an earlier build's
 * pages never survives beside the current one.
 *
 * @type {SiteIndexer}
 */
export async function indexSite({ site, output }) {
    if (!fs.statSync(site, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(`${site} is not a directory, so there is nothing to index`);
    }
    fs.rmSync(output, { recursive: true, force: true });

    let index;
    try {
        ({ index } = await pagefind.createIndex({ verbose: false }));
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // The package's own wording for "no binary resolved for this
        // platform", the one failure of the step that is not the site's.
        if (/Failed to install/.test(message)) {
            const platform = process.platform === "win32" ? "windows" : process.platform;
            throw new Error(
                `the pagefind binary for ${platform}-${process.arch} is not installed — ` +
                    `\`npm ci\` installs it as the optional dependency ` +
                    `@pagefind/${platform}-${process.arch} of pagefind; on a platform it ` +
                    `has no build for, set PAGEFIND_BINARY_PATH to a binary from ` +
                    `https://github.com/Pagefind/pagefind/releases`,
            );
        }
        throw err;
    }
    try {
        const added = await index.addDirectory({ path: site });
        if (added.errors.length) throw new Error(added.errors.join("; "));
        const pages = added.page_count;
        if (!pages) {
            throw new Error(`no page under ${site} was indexed — the site holds no HTML`);
        }
        const written = await index.writeFiles({ outputPath: output });
        if (written.errors.length) throw new Error(written.errors.join("; "));
        return { pages };
    } finally {
        await pagefind.close();
    }
}

/**
 * Write `_headers` beside the rendered site, remove any `_redirects`, and
 * index the site for search.
 *
 * The removal is part of owning the root: a `_redirects` this build did not
 * write is one an earlier build left, and Cloudflare Pages applies whatever
 * sits there. Left in place it would redirect the prefix root — the homepage —
 * to an address nothing publishes. The same holds for a `pagefind/` left by an
 * earlier build when `search` is off: deployed, it is a working search over
 * pages that may no longer exist, so it goes too.
 *
 * `_headers` is written before the index is built, so a failed index leaves
 * the root files as they would be — the failure is the indexer's, reported as
 * one finding naming the rendered site, and nothing else about the deployment
 * is in doubt.
 *
 * @param {object} options - Options.
 * @param {string} options.pkg - The content package name, which is also the
 *   directory Hugo rendered into.
 * @param {string} options.out - The directory that is deployed.
 * @param {boolean} [options.search] - Whether to build the search index;
 *   `site.search` in the configuration. Default `true`.
 * @param {SiteIndexer} [options.indexer] - What builds it. Default
 *   {@link indexSite}.
 * @returns {Promise<{files: string[], search: {dir: string, pages: number}|null}>}
 *   The files written, and the index — where it is and how many pages it
 *   holds — or `null` when none was built.
 * @throws {Error} When no rendered site is there, which means the site build
 *   has not run and writing root files would publish a deployment with nothing
 *   under the prefix; or, located at the rendered site, when the indexer
 *   fails.
 */
export async function writeSiteRoot({ pkg, out, search = true, indexer = indexSite }) {
    const root = path.resolve(out);
    const rendered = path.join(root, pkg);
    if (!fs.existsSync(path.join(rendered, "index.html"))) {
        throw new Error(
            `${out}/${pkg}/ holds no rendered site — build the site before its root files`,
        );
    }

    const file = path.join(root, "_headers");
    fs.writeFileSync(file, headers());
    fs.rmSync(path.join(root, "_redirects"), { force: true });

    const dir = path.join(rendered, SEARCH_DIR);
    if (!search) {
        fs.rmSync(dir, { recursive: true, force: true });
        return { files: [file], search: null };
    }
    let pages;
    try {
        ({ pages } = await indexer({ site: rendered, output: dir }));
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A directory, so the locator is the file field alone: there is no
        // line to name, and `1:1` would send a reader to the homepage's
        // markup for a failure that is the indexer's.
        throw Object.assign(
            new Error(
                formatDiagnostic({
                    file: rendered,
                    severity: "error",
                    message: `search index: ${message}`,
                }),
            ),
            { located: true, file: rendered },
        );
    }
    return { files: [file], search: { dir, pages } };
}
