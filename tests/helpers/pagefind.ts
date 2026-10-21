/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * Pagefind's own search, run over a built index the way a reader's browser
 * runs it: the bundle's `pagefind.js` loaded from a local server, so what is
 * asserted on is what a search on the deployed site answers.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** A local server for some directories, each under its own path. */
export interface Served {
    /** The server's origin, such as `http://127.0.0.1:4321`. */
    origin: string;
    close: () => Promise<void>;
}

/**
 * Serve directories over HTTP.
 *
 * @param mounts - Each path prefix, such as `/` or `/demo/`, and the directory
 *   it serves. The longest prefix that matches a request answers it.
 */
export async function serveDirectories(mounts: Record<string, string>): Promise<Served> {
    const prefixes = Object.keys(mounts).sort((a, b) => b.length - a.length);
    const server = http.createServer((req, res) => {
        const address = decodeURIComponent(new URL(req.url ?? "/", "http://x.invalid").pathname);
        const prefix = prefixes.find((p) => address.startsWith(p));
        const file = prefix ? path.join(mounts[prefix], address.slice(prefix.length)) : "";
        if (!file || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200).end(fs.readFileSync(file));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    return {
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}

/**
 * Load a bundle's search, as its page would.
 *
 * Each call loads a fresh copy of the bundle's script, so two searches in one
 * process keep apart.
 *
 * @param bundle - The bundle directory on disk, holding `pagefind.js`.
 * @param url - Where the bundle is served.
 */
export async function loadSearch(bundle: string, url: string): Promise<any> {
    const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pagefind-js-")), "pagefind.mjs");
    fs.copyFileSync(path.join(bundle, "pagefind.js"), copy);
    const search = await import(pathToFileURL(copy).href);
    await search.options({ basePath: url });
    await search.init();
    return search;
}

/** Every result of a search, with its data. */
export async function results(search: any, term: string | null, options: object = {}) {
    const found = await search.search(term, options);
    return Promise.all(found.results.map((result: any) => result.data()));
}
