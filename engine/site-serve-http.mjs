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
 * HTTP stays responsive while the calling thread renders a large site.
 * Only filesystem and listening addresses cross this boundary; the resolved
 * configuration and the build's render closures remain with their caller.
 * @module
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

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
const RELOAD_SCRIPT = `<script>new EventSource(${JSON.stringify(workerData?.reloadPath)}).addEventListener("reload", () => location.reload());</script>`;

if (parentPort) {
    const { root, out, host, port, reloadPath: RELOAD_PATH } = workerData;
    const listeners = new Set();
    const server = http.createServer((req, res) => {
        let address;
        try {
            address = decodeURIComponent(new URL(req.url ?? "/", "http://serve.invalid").pathname);
        } catch {
            res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
            res.end("Bad request.\n");
            return;
        }
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
        if (!fs.existsSync(path.join(out, "index.html"))) {
            res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "retry-after": "1" });
            res.end(
                "No site is available yet. See build progress and diagnostics in the terminal.\n",
            );
            return;
        }
        let file = path.join(root, address);
        if (file !== root && !file.startsWith(root + path.sep)) {
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
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
    });
    const listening = /** @type {import("node:net").AddressInfo} */ (server.address());
    parentPort.postMessage({ kind: "listening", port: listening.port });

    parentPort.on("message", (message) => {
        if (message.kind === "reload") {
            for (const res of listeners) res.write("event: reload\ndata: {}\n\n");
        } else if (message.kind === "install") {
            // Requests and these renames run on one event loop, so no request
            // observes the gap between moving the old tree and installing it.
            let moved = false;
            try {
                if (fs.existsSync(out)) {
                    fs.renameSync(out, message.previous);
                    moved = true;
                }
                try {
                    fs.renameSync(message.staged, out);
                } catch (error) {
                    if (moved) {
                        try {
                            fs.renameSync(message.previous, out);
                        } catch (rollback) {
                            throw new Error(
                                `the new site could not be installed or the previous one restored; the previous site remains at ${message.previous}`,
                                { cause: rollback },
                            );
                        }
                    }
                    throw error;
                }
                parentPort.postMessage({ kind: "installed" });
            } catch (error) {
                parentPort.postMessage({ kind: "installed", error });
            }
        } else if (message.kind === "close") {
            for (const res of listeners) res.end();
            server.close(() => parentPort.close());
            server.closeAllConnections();
        }
    });
}
