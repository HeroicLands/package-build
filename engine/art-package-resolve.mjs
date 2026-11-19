/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import path from "node:path";
import { prepareArtPackage, finalizeArtPackage } from "./art-package.mjs";
import { buildPrimaryNoteIndex, resolvePrimaryNote } from "./art-primary-note.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { readCanonicalKey, renderAddress } from "./address.mjs";
export { readVerifiedBytes } from "./art-package.mjs";

const preparedInputs = new WeakMap();

const exactVersion =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const lengths = { sha1: 20, sha256: 32, sha384: 48, sha512: 64 };
function integrityValid(value) {
    if (typeof value !== "string" || !value) return false;
    return value.split(/\s+/).every((token) => {
        const match = /^(sha1|sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(token);
        if (!match) return false;
        const bytes = Buffer.from(match[2], "base64");
        return bytes.length === lengths[match[1]] && bytes.toString("base64") === match[2];
    });
}
function json(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
        throw new Error(`${file}: cannot read valid JSON: ${error.message}`);
    }
}

/**
 * Resolve required, locked artwork from this consumer's own installation.
 * Preparation exposes asset records for index construction, without byte sources.
 * @param {{rootDir:string, contentPackage:string, art:{packages:readonly string[]}}} config Consumer config.
 * @returns {Promise<{records: readonly Record<string, any>[], packages: readonly {name:string, version:string, records:readonly Record<string,any>[]}[]}>} Opaque prepared inputs; public-note claims remain pending.
 */
export async function prepareArtPackages(config) {
    const names = config.art.packages;
    const root = path.resolve(config.rootDir);
    const manifest = names.length ? json(path.join(root, "package.json")) : {};
    const lock =
        names.length ?
            json(path.join(root, "package-lock.json"))
        :   { lockfileVersion: 3, packages: {} };
    if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object")
        throw new Error("package-lock.json: artwork requires a lockfile version 3 packages map");
    const out = [],
        seen = new Set(),
        selected = new Set(),
        deployments = new Set(),
        handles = [];
    for (const name of names) {
        if (
            typeof name !== "string" ||
            name.length > 214 ||
            !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)
        )
            throw new Error("art.packages: invalid package name");
        if (selected.has(name)) throw new Error(`art.packages: duplicate package ${name}`);
        selected.add(name);
        const version = manifest.devDependencies?.[name];
        if (
            typeof version !== "string" ||
            !exactVersion.test(version) ||
            manifest.optionalDependencies?.[name]
        )
            throw new Error(`package.json: ${name} must be an exact required devDependency`);
        const entry = lock.packages[`node_modules/${name}`];
        if (
            lock.packages[""]?.devDependencies?.[name] !== version ||
            lock.packages[""]?.optionalDependencies?.[name]
        )
            throw new Error(
                `package-lock.json: ${name} does not match the required root declaration`,
            );
        if (
            !entry ||
            entry.version !== version ||
            (entry.name && entry.name !== name) ||
            entry.link ||
            entry.optional ||
            (entry.resolved && !/^https?:\/\//.test(entry.resolved)) ||
            !integrityValid(entry.integrity)
        )
            throw new Error(
                `package-lock.json: ${name} has a missing or invalid locked identity, version or integrity`,
            );
        const segments = ["node_modules", ...name.split("/")];
        let directory = root;
        for (const segment of segments) {
            directory = path.join(directory, segment);
            let stat;
            try {
                stat = fs.lstatSync(directory);
            } catch {
                throw new Error(`${directory}: installed artwork package is missing`);
            }
            if (!stat.isDirectory() || stat.isSymbolicLink())
                throw new Error(`${directory}: artwork installation must be a local directory`);
        }
        const installed = json(path.join(directory, "package.json"));
        if (installed.name !== name || installed.version !== version)
            throw new Error(
                `${directory}/package.json: installed artwork identity or version differs`,
            );
        const prepared = await prepareArtPackage(directory, {
            name,
            version,
            contentPackage: config.contentPackage,
        });
        const { records } = prepared;
        for (const record of records) {
            const address = readCanonicalKey(record.address.canonical);
            if (!address) throw new Error("invalid canonical artwork address");
            const key = renderAddress(address);
            if (seen.has(key)) throw new Error(`duplicate artwork address across packages: ${key}`);
            seen.add(key);
            if (deployments.has(record.asset.path))
                throw new Error(
                    `duplicate artwork deployment path across packages: ${record.asset.path}`,
                );
            deployments.add(record.asset.path);
        }
        out.push(Object.freeze({ name, version, records }));
        handles.push(prepared);
    }
    const prepared = Object.freeze({
        records: Object.freeze(out.flatMap((pkg) => pkg.records)),
        packages: Object.freeze(out),
    });
    preparedInputs.set(prepared, { handles, contentPackage: config.contentPackage });
    return prepared;
}

/**
 * Validate claims against the local authoritative index and expose byte sources.
 * Required alternative eligibility must also pass before any output is published.
 * @param {{records: readonly Record<string, any>[], packages: readonly any[]}} prepared Prepared inputs.
 * @param {{records: readonly Record<string, any>[]}} authority Local index including own notes.
 * @returns {Array<{name:string, version:string, records:readonly Record<string,any>[], files:Map<string,object>}>} Accepted packages.
 */
export function finalizeArtPackages(prepared, { records }) {
    const state = preparedInputs.get(prepared);
    if (!state) throw new Error("artwork inputs were not prepared by this resolver");
    const local = records.filter(
        (record) => record.package === state.contentPackage && isNoteRecord(record),
    );
    const index = buildPrimaryNoteIndex(local);
    const validatePublicNote = (address, metadata) => {
        const resolved = resolvePrimaryNote(index, address).note;
        const primary = metadata.primaryNote ?? resolved?.address;
        const named = index.notes.get(primary);
        return Boolean(
            named &&
            index.publicNotes.has(primary) &&
            (!resolved || resolved.address === primary) &&
            (metadata.name === undefined || metadata.name === named.name),
        );
    };
    return prepared.packages.map((pkg, at) => ({
        ...pkg,
        ...finalizeArtPackage(state.handles[at], { validatePublicNote }),
    }));
}

/**
 * Resolve and finalize artwork when the authoritative local index already exists.
 * @param {object} config Consumer configuration.
 * @param {{records: readonly Record<string, any>[]}} authority Authoritative local index.
 * @returns {Promise<ReturnType<typeof finalizeArtPackages>>} Accepted packages.
 */
export async function resolveArtPackages(config, authority) {
    return finalizeArtPackages(await prepareArtPackages(config), authority ?? { records: [] });
}
