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

/** Disposable, verified public derivative bytes indexed by complete render inputs. */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const signature = Buffer.from("HLART1\0", "ascii");
const headerSize = signature.length + 64;
const pending = new Map();
const identities = new Map();
const digest = (bytes) => createHash("sha256").update(bytes).digest();

/**
 * Identify a renderer and the shared public-provenance implementation.
 * @param {string} renderer Renderer module URL.
 * @returns {string} Implementation digest.
 */
export function artRendererIdentity(renderer) {
    if (!identities.has(renderer)) {
        const hash = createHash("sha256");
        for (const file of [
            renderer,
            new URL("./art-provenance.mjs", import.meta.url),
            new URL("./art-provenance-core.mjs", import.meta.url),
            new URL("./svg-derivative-css.mjs", import.meta.url),
        ])
            hash.update(fs.readFileSync(new URL(file)));
        const require = createRequire(import.meta.url);
        for (const name of ["@xmldom/xmldom", "libxml2-wasm"]) {
            const manifest = JSON.parse(
                fs.readFileSync(require.resolve(`${name}/package.json`), "utf8"),
            );
            hash.update(`${name}:${manifest.version}\n`);
        }
        identities.set(renderer, hash.digest("hex"));
    }
    return identities.get(renderer);
}

/**
 * Reuse a complete public render or generate it atomically.
 * @param {Buffer|Uint8Array} source Master bytes, used only to compute the key.
 * @param {Record<string, unknown>} descriptor Format, settings, implementation and public metadata.
 * @param {string} cacheDir Disposable build cache directory.
 * @param {() => Promise<Buffer>} render Public render producer.
 * @returns {Promise<Buffer>} Verified derivative bytes.
 */
export async function cachedArtRender(source, descriptor, cacheDir, render) {
    const settings = JSON.stringify(descriptor, (_key, value) =>
        value && typeof value === "object" && !Array.isArray(value) ?
            Object.fromEntries(
                Object.keys(value)
                    .sort()
                    .map((key) => [key, value[key]]),
            )
        :   value,
    );
    const key = digest(Buffer.concat([signature, digest(source), Buffer.from(settings)]));
    const file = path.resolve(cacheDir, key.toString("hex"));
    let work = pending.get(file);
    if (!work) {
        work = Promise.resolve().then(async () => {
            try {
                if (fs.lstatSync(file).isFile()) {
                    const entry = fs.readFileSync(file);
                    const bytes = entry.subarray(headerSize);
                    if (
                        entry.length >= headerSize &&
                        entry.subarray(0, signature.length).equals(signature) &&
                        entry.subarray(signature.length, signature.length + 32).equals(key) &&
                        entry.subarray(signature.length + 32, headerSize).equals(digest(bytes))
                    )
                        return bytes;
                }
            } catch {
                // A missing or unreadable cache entry contributes no build input.
            }
            const bytes = await render();
            fs.mkdirSync(cacheDir, { recursive: true });
            const temporary = path.join(cacheDir, `${key.toString("hex")}.${randomUUID()}.tmp`);
            try {
                fs.writeFileSync(temporary, Buffer.concat([signature, key, digest(bytes), bytes]), {
                    flag: "wx",
                    mode: 0o600,
                });
                fs.renameSync(temporary, file);
            } finally {
                fs.rmSync(temporary, { force: true });
            }
            return bytes;
        });
        pending.set(file, work);
    }
    try {
        return Buffer.from(await work);
    } finally {
        if (pending.get(file) === work) pending.delete(file);
    }
}
