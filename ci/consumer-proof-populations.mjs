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

/** Verify selected source population facts against a published index. @module */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import YAML from "yaml";
import { canonicalKey } from "../engine/address.mjs";
import { makeId } from "../engine/ids.mjs";
import { convertFiles } from "../scripts/convert-population-actual.mjs";

/**
 * Compare authored and published population-bearing fields for explicit Addresses.
 * @param {object[]} source - Complete source records.
 * @param {object[]} published - Published index records.
 * @param {string[]} addresses - Canonical subject Addresses.
 * @returns {{subjects:number, figures:number, differing:number}} Verified counts.
 */
export function verifyPopulationIndex(source, published, addresses) {
    assert.ok(addresses.length > 0, "At least one subject Address is required");
    assert.equal(new Set(addresses).size, addresses.length, "Subject Addresses must be unique");
    let figures = 0;
    let differing = 0;
    const one = (records, address) => {
        const matches = records.filter((record) => record.address?.canonical === address);
        assert.equal(matches.length, 1, `${address}: expected exactly one record`);
        return matches[0];
    };
    const check = (authored, result, label) => {
        if (authored === undefined) {
            assert.ok(result === undefined, `${label}: unexpected population`);
            return;
        }
        const number = (value) => {
            if (value === null) return null;
            assert.ok(
                typeof value === "number" || (typeof value === "string" && value.trim() !== ""),
                `${label}: invalid numeric representation`,
            );
            return Number(value);
        };
        const actual = number(authored.actual);
        const apparent = Object.hasOwn(authored, "apparent") ? number(authored.apparent) : actual;
        assert.ok(actual === null || Number.isFinite(actual), `${label}: actual figure`);
        assert.ok(apparent === null || Number.isFinite(apparent), `${label}: apparent figure`);
        assert.ok(
            isDeepStrictEqual(result, { actual: actual === apparent ? actual : null, apparent }),
            `${label}: population projection`,
        );
        figures++;
        if (actual !== apparent) differing++;
    };
    for (const address of addresses) {
        const sourceData = one(source, address).data ?? {};
        const publicData = one(published, address).data ?? {};
        for (const key of ["population", "territorial_population"])
            check(sourceData[key], publicData[key], `${address}: ${key}`);
        const rows = sourceData.settlements ?? [];
        const publicRows = publicData.settlements ?? [];
        assert.equal(publicRows.length, rows.length, `${address}: settlement rows`);
        rows.forEach((row, index) =>
            check(row.population, publicRows[index]?.population, `${address}: settlement ${index}`),
        );
    }
    assert.ok(figures > 0, "The selected subjects have no population figures");
    assert.ok(differing > 0, "The selected subjects have no private population figures");
    return { subjects: addresses.length, figures, differing };
}

/** Verify public page and document text and the corresponding private entry. */
export function verifyPopulationSurfaces(source, addresses, surfaces) {
    let hiddenFigures = 0;
    const token = (text, value) => {
        const forms = [...new Set([String(value), value.toLocaleString("en-US")])];
        return forms.some((form) => {
            const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return new RegExp(`(?<![0-9])${escaped}(?![0-9])`).test(text);
        });
    };
    const one = (items, address, label) => {
        const found = items.filter((item) => item.address === address);
        assert.equal(found.length, 1, `${address}: expected exactly one ${label}`);
        return found[0].text;
    };
    for (const address of addresses) {
        const record = source.find((item) => item.address?.canonical === address);
        assert.ok(record, `${address}: missing source record`);
        const data = record.data ?? {};
        const values = [
            data.population,
            data.territorial_population,
            ...(data.settlements ?? []).map((row) => row.population),
        ].filter(Boolean);
        const hidden = values.filter((value) => {
            const actual = value.actual === null ? null : Number(value.actual);
            const apparent =
                Object.hasOwn(value, "apparent") ?
                    value.apparent === null ?
                        null
                    :   Number(value.apparent)
                :   actual;
            return actual !== apparent;
        });
        assert.ok(hidden.length, `${address}: no differing figures`);
        const index = one(surfaces.indexDocuments, address, "public index record");
        const site = one(surfaces.sites, address, "public site page");
        const publicDoc = one(surfaces.publicDocuments, address, "public Foundry document");
        const privateDoc = one(surfaces.privateDocuments, address, "private Foundry entry");
        for (const value of hidden) {
            if (value.actual === null) {
                assert.match(privateDoc, /unknown/i, `${address}: private unknown actual`);
            } else {
                const actual = Number(value.actual);
                assert.ok(
                    !token(index, actual),
                    `${address}: actual figure appears in public index`,
                );
                assert.ok(!token(site, actual), `${address}: actual figure appears in public site`);
                assert.ok(
                    !token(publicDoc, actual),
                    `${address}: actual figure appears in public Foundry document`,
                );
                assert.ok(
                    token(privateDoc, actual),
                    `${address}: actual figure missing from private Foundry entry`,
                );
            }
            hiddenFigures++;
        }
    }
    return { subjects: addresses.length, hiddenFigures };
}

function files(root) {
    return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const name = path.join(root, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`${name}: symbolic links are not supported`);
        return (
            entry.isDirectory() ? files(name)
            : entry.isFile() ? [name]
            : []
        );
    });
}
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const rows = (file) => fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);

/** Prepare source records, or verify built outputs and write a non-secret receipt. */
function main(mode, proof) {
    assert.ok(
        ["prepare", "verify"].includes(mode) && proof,
        "usage: node ci/consumer-proof-populations.mjs prepare|verify <proof-directory>",
    );
    const sourceFile = path.join(proof, "population-source.jsonl");
    const addressesFile = path.join(proof, "population-addresses.json");
    const addresses = JSON.parse(process.env.POPULATION_PROOF_ADDRESSES ?? "null");
    assert.ok(
        Array.isArray(addresses) &&
            addresses.length &&
            addresses.every(
                (address) =>
                    typeof address === "string" &&
                    /^thalorna-note-(?:place|affiliation)-[a-z0-9]+$/.test(address),
            ),
        "population addresses must be a JSON list of canonical place or affiliation Addresses",
    );
    assert.equal(new Set(addresses).size, addresses.length, "population Addresses must be unique");
    for (const name of ["CANDIDATE_SHA", "CONSUMER_SHA"])
        assert.match(
            process.env[name] ?? "",
            /^[0-9a-f]{40}$/,
            `${name} must be a full commit SHA`,
        );
    if (mode === "prepare") {
        const noteFiles = files("assets/content").filter(
            (name) =>
                name.endsWith(".md") && /^(?:\uFEFF)?---\r?\n/.test(fs.readFileSync(name, "utf8")),
        );
        const conversion = convertFiles(noteFiles, { write: true });
        assert.ok(conversion.files > 0, "the source snapshot has no notes");
        const selected = [];
        for (const file of noteFiles) {
            const raw = fs.readFileSync(file, "utf8");
            const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
            if (!match) continue;
            const fm = YAML.parse(match[1]);
            if (!fm || typeof fm.type !== "string" || typeof fm.shortcode !== "string") continue;
            const address = canonicalKey("thalorna", "note", fm.type, fm.shortcode);
            if (addresses.includes(address))
                selected.push({ ...fm, address: { canonical: address } });
        }
        for (const address of addresses)
            assert.equal(
                selected.filter((record) => record.address.canonical === address).length,
                1,
                `${address}: expected exactly one source note`,
            );
        fs.writeFileSync(
            sourceFile,
            selected.map((record) => JSON.stringify(record)).join("\n") + "\n",
            { mode: 0o600 },
        );
        fs.writeFileSync(addressesFile, JSON.stringify(addresses) + "\n");
        return;
    }
    assert.deepEqual(
        JSON.parse(fs.readFileSync(addressesFile, "utf8")),
        addresses,
        "selected addresses changed",
    );
    const source = rows(sourceFile);
    const indexFile = "build/content-index/thalorna-metadata.jsonl";
    const published = rows(indexFile);
    const counts = verifyPopulationIndex(source, published, addresses);
    const indexDocuments = published
        .filter((record) => addresses.includes(record.address?.canonical))
        .map((record) => ({ address: record.address.canonical, text: JSON.stringify(record) }));
    const config = YAML.parse(fs.readFileSync("package-build.config.yaml", "utf8"));
    const packNames = (config.packs ?? []).filter((pack) => pack.type === "JournalEntry");
    const privateNames = packNames.filter((pack) => pack.private === true).map((pack) => pack.name);
    assert.ok(privateNames.length, "a configured private JournalEntry pack is required");
    const privateDocs = [];
    const publicDocs = [];
    for (const pack of packNames) {
        const root = path.join("build/packs-json", pack.name);
        if (!fs.existsSync(root)) continue;
        for (const file of files(root).filter((name) => name.endsWith(".json"))) {
            const text = fs.readFileSync(file, "utf8");
            const document = JSON.parse(text);
            const target = pack.private === true ? privateDocs : publicDocs;
            for (const record of source) {
                const address = record.address.canonical;
                const title = typeof record.name === "string" ? record.name : record.name?.full;
                if (
                    (pack.private === true &&
                        document._id === makeId("population-supplement", address)) ||
                    document.name === title
                )
                    target.push({ address, text, file });
            }
        }
    }
    const sites = [];
    for (const file of files("build/site").filter((name) => name.endsWith("index.html"))) {
        for (const record of source) {
            if (path.basename(path.dirname(file)) === `${record.type}-${record.shortcode}`)
                sites.push({
                    address: record.address.canonical,
                    text: fs.readFileSync(file, "utf8"),
                    file,
                });
        }
    }
    const surfaces = verifyPopulationSurfaces(source, addresses, {
        sites,
        indexDocuments,
        publicDocuments: publicDocs,
        privateDocuments: privateDocs,
    });
    const outputs = [...sites, ...publicDocs, ...privateDocs].map(({ address, file }) => ({
        address,
        file,
        sha256: hash(file),
    }));
    const candidateArchiveSha256 = hash(path.join(proof, "candidate.tgz"));
    const installed = JSON.parse(
        fs.readFileSync(path.join(proof, "installed-archive.json"), "utf8"),
    );
    assert.deepEqual(
        installed,
        { archiveSha256: candidateArchiveSha256, verified: true },
        "candidate installation proof",
    );
    const receipt = {
        candidate: process.env.CANDIDATE_SHA,
        consumer: process.env.CONSUMER_SHA,
        addresses,
        sourceSha256: hash(sourceFile),
        indexSha256: hash(indexFile),
        addressesSha256: hash(addressesFile),
        candidateArchiveSha256,
        installedArchiveVerified: true,
        originalLockSha256: hash(path.join(proof, "original-lock.json")),
        candidateLockSha256: hash("package-lock.json"),
        ...counts,
        ...surfaces,
        outputs,
    };
    fs.writeFileSync(
        path.join(proof, "population-evidence", "receipt.json"),
        JSON.stringify(receipt, null, 2) + "\n",
    );
    console.log(
        `Verified ${counts.figures} index figures and ${surfaces.hiddenFigures} private figures across ${counts.subjects} subjects.`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        main(process.argv[2], process.argv[3]);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
