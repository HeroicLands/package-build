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
 * build. A failed build is reported and leaves the last successful site in
 * place, including its search index.
 *
 * The site is served from the deployed root, so a page is at the address it is
 * deployed at, its base path included. Every HTML page is sent with a script
 * that listens on {@link RELOAD_PATH} for the server's `reload` event; the
 * script is added as the page is sent and is never written to the site. The
 * search index is built with each whole build before it replaces the last site.
 *
 * @module
 */

import fs from "node:fs";
import { Worker } from "node:worker_threads";
import path from "node:path";

import { siteBuildFailed } from "./site-build.mjs";
import { SITE_THEME_DIR } from "./site-theme.mjs";
import { SITE_STATIC_DIR, buildPackageSite, writeSite, writeThemeFiles } from "./site-render.mjs";
import { siteBase } from "../content-config.mjs";
import { SEARCH_DIR, indexSite } from "./site-root.mjs";
import { readCachedNavigation, siteSettings } from "./site-config.mjs";

/** The address a served page listens on for the server's reloads. */
export const RELOAD_PATH = "/__package-build/reload";

/** How long a burst of changes is gathered before it is written, in milliseconds. */
const SETTLE_MS = 120;

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
 * @param {boolean} [options.search] - Build the search index with each whole
 *   build, where the site has one.
 * @param {number} [options.year] - The year the footer states.
 * @param {(event: {kind: string, built?: object, files?: string[], findings?: object[], error?: unknown, message?: string, fatal?: boolean}) => void} [options.report] -
 *   Told of progress (`message`) and each build: `built` for a whole build, `page` for one note's page,
 *   `theme` for the theme, `failed` with what the build found, `error` with
 *   what it threw.
 * @returns {Promise<{url: string, close: () => Promise<void>, settled: () => Promise<void>, done: Promise<void>}>}
 *   Resolves as soon as HTTP listens, before the first build. The address of
 *   the site's home page, how to stop serving, and a promise for the initial
 *   build and every change seen so far to finish. Failed builds are reported
 *   through `report` and leave the last successful site in service. `done`
 *   resolves on close and rejects if HTTP stops unexpectedly.
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
    // Refuse a site that cannot be described before starting its server.
    siteSettings({ config });
    readCachedNavigation(config);
    root = path.resolve(root);
    out = path.resolve(out);
    let timer = null;
    const watchers = [];
    let closing = false;
    let complete;
    let abort;
    const done = new Promise((resolve, reject) => {
        complete = resolve;
        abort = reject;
    });
    // The caller may attach its lifecycle handler after awaiting startup.
    done.catch(() => {});
    const stopWatching = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        for (const watcher of watchers) watcher.close();
    };
    const worker = new Worker(new URL("./site-serve-http.mjs", import.meta.url), {
        workerData: { root, out, host, port, reloadPath: RELOAD_PATH },
        // The HTTP helper uses only Node builtins. A caller's --input-type
        // or loader flags describe its own entry point, not this file.
        execArgv: [],
    });
    let workerFailure;
    let started = false;
    const requests = new Map();
    worker.on("message", (event) => {
        const waiting = requests.get(event.kind);
        if (!waiting) return;
        requests.delete(event.kind);
        if (event.error) waiting.reject(event.error);
        else waiting.resolve(event);
    });
    const failed = (error) => {
        if (workerFailure) return;
        workerFailure = error;
        stopWatching();
        abort(error);
        for (const waiting of requests.values()) waiting.reject(error);
        requests.clear();
        if (started) report({ kind: "error", error, fatal: true });
    };
    worker.on("error", failed);
    const exited = new Promise((resolve) => {
        worker.once("exit", (code) => {
            if ((started || requests.size) && !workerFailure)
                failed(new Error(`the preview HTTP server stopped (exit ${code})`));
            resolve();
        });
    });
    const receive = (kind) =>
        new Promise((resolve, reject) => {
            if (workerFailure) reject(workerFailure);
            else requests.set(kind, { resolve, reject });
        });
    const listening = await receive("listening");
    started = true;
    let state = null;
    const progress = (message) => report({ kind: "progress", message });
    const reload = () => worker.postMessage({ kind: "reload" });

    // Whole builds and incremental updates publish through the same boundary.
    // HTTP owns the renames, between requests; writers only touch private trees.
    const publish = async (write) => {
        if (workerFailure || closing) return null;
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const staging = fs.mkdtempSync(path.join(path.dirname(out), ".site-preview-"));
        const staged = path.join(staging, "site");
        const previous = path.join(staging, "previous");
        let installed = false;
        try {
            const result = await write(staged);
            if (!result || closing) return null;
            if (workerFailure) throw workerFailure;
            const ready = receive("installed");
            worker.postMessage({ kind: "install", staged, previous });
            await ready;
            installed = true;
            return result;
        } finally {
            // A failed rollback must retain the only remaining previous tree.
            if (installed || !fs.existsSync(previous))
                fs.rmSync(staging, { recursive: true, force: true });
        }
    };

    const buildAll = async () => {
        const result = await publish(async (staged) => {
            const built = await buildPackageSite({ config, out: staged, year, progress });
            const findings = [...(built.written?.findings ?? []), ...(built.fonts?.findings ?? [])];
            if (
                !built.written ||
                siteBuildFailed(built.built) ||
                built.fonts?.findings.length ||
                findings.some((finding) => finding.severity === "error")
            ) {
                report({ kind: "failed", built: built.built, findings });
                return null;
            }
            if (search && config.site.search !== false) {
                progress("building the search index");
                const indexed = await indexSite({
                    site: staged,
                    output: path.join(staged, SEARCH_DIR),
                    base: siteBase(config),
                });
                progress(`indexed ${indexed.pages} page(s) for search`);
            }
            return { ...built, findings };
        });
        if (!result) return false;
        state = result;
        report({ kind: "built", built: result.built, findings: result.findings });
        return true;
    };

    const redraw = async ({ pages, only, theme = false }) => {
        return publish((staged) => {
            // Keep unchanged pages, static files and the current search index.
            fs.cpSync(out, staged, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
            if (theme) writeThemeFiles(staged);
            const written = writeSite({ site: state.site, pages, out: staged, only });
            if (written.findings.some((finding) => finding.severity === "error")) {
                report({ kind: "failed", findings: written.findings });
                return null;
            }
            return {
                ...written,
                files: written.files.map((file) => path.join(out, path.relative(staged, file))),
            };
        });
    };

    const redrawNotes = async (files) => {
        if (!state) return false;
        const changed = new Set();
        let pages = state.pages;
        for (const file of files) {
            const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
            if (!file.endsWith(".md") || !text || holdsQuery(text)) return false;
            const entry = state.built.site.renderNote(file);
            if (!entry) return false;
            if (entry.findings.length) {
                report({ kind: "failed", findings: entry.findings });
                return null;
            }
            const page = state.pageOf(entry);
            pages = pages.map((old) => (old.url === page.url ? page : old));
            changed.add(page.url);
        }
        const written = await redraw({ pages, only: changed });
        if (!written) return null;
        state.pages = pages;
        report({ kind: "page", files: written.files, findings: written.findings });
        return true;
    };

    const redrawTheme = async () => {
        if (!state) return false;
        const written = await redraw({
            pages: state.pages,
            only: new Set(state.pages.map((page) => page.url)),
            theme: true,
        });
        if (!written) return false;
        report({ kind: "theme", files: written.files, findings: written.findings });
        return true;
    };

    /** @type {{content: Set<string>, theme: boolean}} */
    let pending = { content: new Set(), theme: false };
    let work = Promise.resolve();
    const flush = () => {
        timer = null;
        const batch = pending;
        pending = { content: new Set(), theme: false };
        work = work.then(async () => {
            try {
                if (workerFailure || closing) return;
                let changed = batch.content.size ? await redrawNotes([...batch.content]) : true;
                if (changed === false) changed = await buildAll();
                else if (changed && batch.theme) changed = await redrawTheme();
                if (changed) reload();
            } catch (error) {
                if (error !== workerFailure) report({ kind: "error", error });
            }
        });
    };
    const queue = (kind, file) => {
        if (workerFailure || closing) return;
        if (kind === "theme") pending.theme = true;
        else pending.content.add(file);
        if (!timer) timer = setTimeout(flush, SETTLE_MS);
    };

    try {
        watchers.push(
            fs.watch(config.paths.content, { recursive: true }, (_event, name) => {
                if (name) queue("content", path.join(config.paths.content, String(name)));
            }),
        );
        for (const dir of [SITE_THEME_DIR, SITE_STATIC_DIR]) {
            if (fs.existsSync(dir))
                watchers.push(fs.watch(dir, { recursive: true }, () => queue("theme")));
        }
    } catch (error) {
        stopWatching();
        started = false;
        worker.postMessage({ kind: "close" });
        await exited;
        abort(error);
        throw error;
    }

    // Return the listening address before beginning the first long build.
    work = new Promise((resolve) => setImmediate(resolve)).then(async () => {
        try {
            if (await buildAll()) reload();
        } catch (error) {
            if (error !== workerFailure) report({ kind: "error", error });
        }
    });

    return {
        url: `http://${host}:${listening.port}${new URL(config.homepage).pathname}`,
        done,
        settled: async () => {
            for (;;) {
                const current = work;
                await current;
                if (workerFailure) throw workerFailure;
                if (!timer && !pending.content.size && !pending.theme && current === work) return;
                await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
            }
        },
        close: async () => {
            closing = true;
            stopWatching();
            await work;
            started = false;
            worker.postMessage({ kind: "close" });
            await exited;
            complete();
        },
    };
}
