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
 * **A site served while it is written.** {@link serveSite} builds a package's
 * site, serves it, and keeps it current: it watches the content tree and the
 * theme, writes again what a change touches, and tells every open page to
 * reload.
 *
 * | Change | What is written again |
 * | ------ | --------------------- |
 * | a note's body or frontmatter | that note's page |
 * | a note's name, type or shortcode, a new or removed note, a note holding an `sql` table, any other file in the content tree | the whole site |
 * | the theme's layouts, partials or files | every page, and the theme's files |
 *
 * A page that changes because another note changed — a table that lists the
 * note, a link that carries its name — is written again by the next whole
 * build. A note in error is written as its page shows it, and the error is
 * reported; a build whose gates fire writes nothing and leaves the last good
 * site in place.
 *
 * The site is served from the deployed root, so a page is at the address it is
 * deployed at, its base path included. Every HTML page is sent with a script
 * that listens on {@link RELOAD_PATH} for the server's `reload` event; the
 * script is added as the page is sent and is never written to the site. The
 * search index is built once, after the first build.
 *
 * @module
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { siteBuildFailed } from "./site-build.mjs";
import { SITE_THEME_DIR } from "./site-theme.mjs";
import { SITE_STATIC_DIR, buildPackageSite, writeSite, writeThemeFiles } from "./site-render.mjs";
import { SEARCH_DIR, indexSite } from "./site-root.mjs";

/** The address a served page listens on for the server's reloads. */
export const RELOAD_PATH = "/__package-build/reload";

/** How long a burst of changes is gathered before it is written, in milliseconds. */
const SETTLE_MS = 120;

/** What a file is sent as, by its extension. */
const CONTENT_TYPES = Object.freeze({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".xml": "application/xml",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".wasm": "application/wasm",
});

/** The script a served page is sent with. */
const RELOAD_SCRIPT = `<script>new EventSource(${JSON.stringify(RELOAD_PATH)}).addEventListener("reload", () => location.reload());</script>`;

/** Whether a note's text holds a query its build prepares ahead of the render. */
const holdsQuery = (text) => /```\s*sql\b|\{\{[^}]*\bsql\b/.test(text);

/**
 * Serve a package's site, and keep it current.
 *
 * @param {object} options - The inputs.
 * @param {object} options.config - The resolved configuration.
 * @param {string} options.out - The site's directory under the deployed
 *   root, which the site is written to.
 * @param {string} [options.root] - The deployed root, which is served. The
 *   directory above `out` by default; `out` itself for a site served at `/`.
 * @param {string} [options.host] - The address to listen on.
 * @param {number} [options.port] - The port; `0` takes any free one.
 * @param {boolean} [options.search] - Build the search index after the first
 *   build, where the site has one.
 * @param {number} [options.year] - The year the footer states.
 * @param {(event: {kind: string, built?: object, files?: string[], findings?: object[], error?: unknown}) => void} [options.report] -
 *   Told of each build: `built` for a whole build, `page` for one note's page,
 *   `theme` for the theme, `failed` with what the build found, `error` with
 *   what it threw.
 * @returns {Promise<{url: string, close: () => Promise<void>, settled: () => Promise<void>}>}
 *   The address of the site's home page, how to stop serving, and a promise
 *   for the moment every change seen so far has been written.
 */
export async function serveSite({
    config,
    out,
    root = path.dirname(out),
    host = "127.0.0.1",
    port = 1313,
    search = true,
    year,
    report = () => {},
}) {
    /** @type {Set<http.ServerResponse>} */
    const listeners = new Set();
    let state = null;

    const reload = () => {
        for (const res of listeners) res.write("event: reload\ndata: {}\n\n");
    };

    const buildAll = async () => {
        const result = await buildPackageSite({ config, out, year });
        if (!result.written || siteBuildFailed(result.built))
            report({ kind: "failed", built: result.built });
        if (!result.written) return false;
        state = result;
        report({ kind: "built", built: result.built, findings: result.written.findings });
        return true;
    };

    const redrawNotes = (files) => {
        if (!state) return false;
        const changed = new Set();
        for (const file of files) {
            const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
            if (!file.endsWith(".md") || !text || holdsQuery(text)) return false;
            const entry = state.built.site.renderNote(file);
            if (!entry) return false;
            if (entry.findings.length) {
                report({ kind: "failed", findings: entry.findings });
                return true;
            }
            const page = state.pageOf(entry);
            state.pages = state.pages.map((old) => (old.url === page.url ? page : old));
            changed.add(page.url);
        }
        const written = writeSite({ site: state.site, pages: state.pages, out, only: changed });
        report({ kind: "page", files: written.files, findings: written.findings });
        return true;
    };

    const redrawTheme = () => {
        if (!state) return false;
        writeThemeFiles(out);
        const written = writeSite({
            site: state.site,
            pages: state.pages,
            out,
            only: new Set(state.pages.map((page) => page.url)),
        });
        report({ kind: "theme", files: written.files, findings: written.findings });
        return true;
    };

    const indexForSearch = async () => {
        if (!search || config.site.search === false || !state) return;
        await indexSite({ site: out, output: path.join(out, SEARCH_DIR) });
    };

    await buildAll();
    await indexForSearch();

    /** @type {{content: Set<string>, theme: boolean}} */
    let pending = { content: new Set(), theme: false };
    let timer = null;
    let work = Promise.resolve();
    const flush = () => {
        timer = null;
        const batch = pending;
        pending = { content: new Set(), theme: false };
        work = work.then(async () => {
            try {
                let done = true;
                if (batch.content.size && !redrawNotes([...batch.content])) {
                    done = await buildAll();
                    if (done) await indexForSearch();
                } else if (batch.theme) done = redrawTheme();
                if (done) reload();
            } catch (error) {
                report({ kind: "error", error });
            }
        });
    };
    const queue = (kind, file) => {
        if (kind === "theme") pending.theme = true;
        else pending.content.add(file);
        if (!timer) timer = setTimeout(flush, SETTLE_MS);
    };

    const watchers = [
        fs.watch(config.paths.content, { recursive: true }, (_event, name) => {
            if (name) queue("content", path.join(config.paths.content, String(name)));
        }),
        ...[SITE_THEME_DIR, SITE_STATIC_DIR]
            .filter((dir) => fs.existsSync(dir))
            .map((dir) => fs.watch(dir, { recursive: true }, () => queue("theme"))),
    ];

    const server = http.createServer((req, res) => {
        const address = decodeURIComponent(
            new URL(req.url ?? "/", "http://serve.invalid").pathname,
        );
        if (address === RELOAD_PATH) {
            res.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
                connection: "keep-alive",
            });
            res.write(": connected\n\n");
            listeners.add(res);
            req.on("close", () => listeners.delete(res));
            return;
        }
        let file = path.join(root, address);
        if (!file.startsWith(root)) {
            res.writeHead(403).end();
            return;
        }
        if (fs.statSync(file, { throwIfNoEntry: false })?.isDirectory())
            file = path.join(file, "index.html");
        let status = 200;
        if (!fs.existsSync(file)) {
            status = 404;
            file = path.join(out, "404.html");
            if (!fs.existsSync(file)) {
                res.writeHead(404).end();
                return;
            }
        }
        const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
        let body = fs.readFileSync(file);
        if (type.startsWith("text/html")) {
            const html = body.toString("utf8");
            const at = html.lastIndexOf("</body>");
            body = Buffer.from(
                at < 0 ? html + RELOAD_SCRIPT : html.slice(0, at) + RELOAD_SCRIPT + html.slice(at),
            );
        }
        res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
        res.end(body);
    });
    await new Promise((resolve) => server.listen(port, host, resolve));
    const listening = /** @type {import("node:net").AddressInfo} */ (server.address());
    const base = new URL(config.homepage).pathname;

    return {
        url: `http://${host}:${listening.port}${base}`,
        settled: async () => {
            while (timer || pending.content.size || pending.theme) {
                await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
            }
            await work;
        },
        close: async () => {
            if (timer) clearTimeout(timer);
            for (const watcher of watchers) watcher.close();
            for (const res of listeners) res.end();
            await work;
            await new Promise((resolve) => server.close(() => resolve()));
        },
    };
}
