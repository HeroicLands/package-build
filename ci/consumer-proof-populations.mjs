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
import { DOMParser } from "@xmldom/xmldom";
import {
    canonicalKey,
    ownDocumentSystem,
    renderAddress,
    parseAddress,
} from "../engine/address.mjs";
import { flattenPublishedAddresses } from "../engine/address-values.mjs";
import { makeId } from "../engine/ids.mjs";
import { formatQuantity } from "../engine/infobox.mjs";
import { convertFiles } from "../scripts/convert-population-actual.mjs";

/** Normalize an in-memory tuple or a published Address link. */
function addressOf(value) {
    if (typeof value === "string") return value;
    if (value?.address) return addressOf(value.address);
    if (value?.package && value?.system && value?.type && value?.shortcode)
        return renderAddress(value);
    return undefined;
}

/** Find the fact-owning record and its separately addressed journal. */
export function resolvePopulationSubject(records, address) {
    const find = (key) => {
        const hits = records.filter((record) => addressOf(record.address?.canonical) === key);
        assert.equal(hits.length, 1, `${key}: expected exactly one index record`);
        return hits[0];
    };
    const selected = find(address);
    const subject = selected.documents ? find(addressOf(selected.documents)) : selected;
    const subjectAddress = addressOf(subject.address?.canonical);
    assert.ok(subjectAddress && !subject.documents, `${address}: missing fact-owning record`);
    const journal = subject.documentation ? find(addressOf(subject.documentation)) : subject;
    if (journal !== subject)
        assert.equal(
            addressOf(journal.documents),
            subjectAddress,
            `${address}: documentation relation`,
        );
    const uuid = journal.foundry?.note?.uuid;
    assert.match(
        uuid ?? "",
        /^Compendium\.[^.]+\.[^.]+\.JournalEntry\.[^.]+$/,
        `${address}: public journal UUID`,
    );
    assert.equal(journal.id, uuid.split(".").at(-1), `${address}: journal ID and UUID`);
    return { subject, subjectAddress, journal, uuid };
}

/** Select the site output by the published URL or the declared address slug. */
export function selectSiteFile(siteFiles, subject, journal, address) {
    const url =
        journal.siteURL ??
        subject.siteURL ??
        journal.site?.url ??
        subject.site?.url ??
        journal.url ??
        subject.url;
    const slug = journal.address?.slug ?? subject.address?.slug;
    assert.ok(url || slug, `${address}: published site URL or slug is required`);
    const suffix =
        url ?
            `${new URL(url, "https://example.invalid").pathname.replace(/\/$/, "")}/index.html`
        :   `/${slug}/index.html`;
    const candidates = siteFiles.filter((file) =>
        `/${file.replaceAll(path.sep, "/")}`.endsWith(suffix),
    );
    assert.equal(candidates.length, 1, `${address}: expected one published site page`);
    return candidates[0];
}

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
        const matches = records.filter(
            (record) => addressOf(record.address?.canonical) === address,
        );
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
        rows.forEach((row, index) => {
            assert.equal(
                publicRows[index]?.settlement,
                row.settlement,
                `${address}: settlement ${index} identity`,
            );
            if (row.location !== undefined && row.location !== null) {
                const expected = renderAddress(
                    parseAddress(row.location, {
                        package: "thalorna",
                        system: "note",
                        type: "place",
                    }),
                );
                assert.equal(
                    addressOf(publicRows[index]?.location),
                    expected,
                    `${address}: settlement ${index} location`,
                );
            }
            check(row.population, publicRows[index]?.population, `${address}: settlement ${index}`);
        });
    }
    assert.ok(figures > 0, "The selected subjects have no population figures");
    assert.ok(differing > 0, "The selected subjects have no private population figures");
    return { subjects: addresses.length, figures, differing };
}

/** Read visible population fields and settlement/private table cells from rendered HTML. */
function populationCells(html) {
    const document = new DOMParser({ onError: () => {} }).parseFromString(
        /<html(?:\s|>)/i.test(html) ? html : `<html><body>${html}</body></html>`,
        "text/html",
    );
    const text = (node) =>
        String(node?.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim();
    const elements = (node, name) => Array.from(node.getElementsByTagName(name));
    const fields = [];
    for (const list of elements(document, "dl")) {
        if (!/\b(?:info-profile-grid|infobox-rows)\b/.test(list.getAttribute("class") ?? ""))
            continue;
        const children = Array.from(list.childNodes).filter((node) => node.nodeType === 1);
        for (let i = 0; i + 1 < children.length; i++) {
            if (
                children[i].nodeName.toLowerCase() === "dt" &&
                children[i + 1].nodeName.toLowerCase() === "dd"
            )
                fields.push([text(children[i]), text(children[i + 1])]);
        }
    }
    const tables = [];
    for (const table of elements(document, "table")) {
        const rows = elements(table, "tr")
            .map((row) =>
                Array.from(row.childNodes)
                    .filter(
                        (node) =>
                            node.nodeType === 1 &&
                            ["th", "td"].includes(node.nodeName.toLowerCase()),
                    )
                    .map(text),
            )
            .filter((row) => row.length);
        if (rows.length) tables.push(rows);
    }
    const visibleText = (node) => {
        if (node.nodeType === 3) return node.nodeValue ?? "";
        if (["a", "script", "style"].includes(String(node.nodeName ?? "").toLowerCase())) return "";
        return Array.from(node.childNodes ?? [])
            .map(visibleText)
            .join("");
    };
    const prose = elements(document, "p")
        .filter((node) => {
            for (let parent = node.parentNode; parent; parent = parent.parentNode) {
                const tag = String(parent.nodeName ?? "").toLowerCase();
                if (
                    ["table", "dl", "nav", "header", "footer", "script", "style", "aside"].includes(
                        tag,
                    )
                )
                    return false;
                if (/infobox|sidebar|info-box/.test(parent.getAttribute?.("class") ?? ""))
                    return false;
            }
            return true;
        })
        .map((node) => visibleText(node).replace(/\s+/g, " ").trim());
    return { fields, tables, prose };
}

const normalized = (value) =>
    value === null || value === undefined ? "unknown" : Number(value).toLocaleString("en-US");
const readNumber = (text) => {
    assert.equal(typeof text, "string", "population cell is missing");
    const cleaned = String(text).trim().replace(/,/g, "");
    if (!cleaned || /^unknown$/i.test(cleaned)) return "unknown";
    assert.match(cleaned, /^-?\d+(?:\.\d+)?$/, "population cell must contain a number or Unknown");
    return Number(cleaned).toLocaleString("en-US");
};

/** Verify each selected population field and inline row in rendered outputs. */
export function verifyPopulationSurfaces(source, addresses, surfaces) {
    let hiddenFigures = 0;
    const one = (items, address, label) => {
        const found = items.filter((item) => item.address === address);
        assert.equal(found.length, 1, `${address}: expected exactly one ${label}`);
        return populationCells(found[0].text);
    };
    const field = (surface, label, expected, context) => {
        const hits = surface.fields.filter(([name]) => name.toLowerCase() === label.toLowerCase());
        if (expected === "unknown" && hits.length === 0) return;
        assert.equal(hits.length, 1, `${context}: expected one ${label} field`);
        const actual = hits[0][1].trim();
        if (expected === "unknown")
            assert.ok(actual === "" || /^unknown$/i.test(actual), `${context}: ${label} field`);
        else assert.equal(actual, expected, `${context}: ${label} field`);
    };
    const tableRow = (surface, header, label, context) => {
        const matches = [];
        for (const rows of surface.tables) {
            const columns = rows[0].map((cell) => cell.toLowerCase());
            if (!header.every((name) => columns.includes(name))) continue;
            for (const name of header)
                assert.equal(
                    columns.filter((column) => column === name).length,
                    1,
                    `${context}: duplicate ${name} column`,
                );
            for (const row of rows.slice(1)) {
                if (row[0] !== label) continue;
                assert.equal(row.length, columns.length, `${context}: incomplete ${label} row`);
                matches.push({ row, columns });
            }
        }
        assert.ok(matches.length > 0, `${context}: missing ${label} row`);
        return matches;
    };
    for (const address of addresses) {
        const record = source.find((item) => addressOf(item.address?.canonical) === address);
        assert.ok(record, `${address}: missing source record`);
        const data = record.data ?? {};
        const site = one(surfaces.sites, address, "public site page");
        const publicDoc = one(surfaces.publicDocuments, address, "public Foundry document");
        const privateDoc = one(surfaces.privateDocuments, address, "private Foundry entry");
        for (const surface of [site, publicDoc])
            assert.ok(
                !surface.fields.some(([label]) =>
                    /^(?:actual|apparent) (?:territorial )?population$/i.test(label),
                ),
                `${address}: private population field appears in public output`,
            );
        const hidden = [];
        const effective = (value) =>
            Object.hasOwn(value, "apparent") ? value.apparent : value.actual;
        const checkPrivate = (value, label) => {
            const actual = normalized(value.actual),
                apparent = normalized(effective(value));
            if (actual === apparent) return;
            const rows = tableRow(privateDoc, ["population", "actual", "apparent"], label, address);
            assert.equal(rows.length, 1, `${address}: duplicate private ${label} row`);
            const { row, columns } = rows[0];
            assert.equal(
                readNumber(row[columns.indexOf("actual")]),
                actual,
                `${address}: ${label} actual`,
            );
            assert.equal(
                readNumber(row[columns.indexOf("apparent")]),
                apparent,
                `${address}: ${label} apparent`,
            );
            if (value.actual !== null) hidden.push(Number(value.actual));
            hiddenFigures++;
        };
        for (const [key, publicLabel, privateLabel] of [
            [
                "population",
                "Population",
                record.type === "affiliation" ? "Membership" : "Population",
            ],
            ["territorial_population", "Territorial Population", "Territorial population"],
        ]) {
            const value = data[key];
            if (value === undefined) continue;
            const display =
                effective(value) === null ? "unknown" : formatQuantity(Number(effective(value)));
            field(site, publicLabel, display, `${address}: site`);
            field(publicDoc, publicLabel, display, `${address}: public journal`);
            checkPrivate(value, privateLabel);
        }
        for (const row of data.settlements ?? []) {
            if (row.population === undefined) continue;
            const expected = normalized(effective(row.population));
            for (const [surface, label] of [
                [site, "site"],
                [publicDoc, "public journal"],
            ]) {
                const matches = tableRow(
                    surface,
                    ["settlement", "population"],
                    row.settlement,
                    `${address}: ${label}`,
                );
                for (const match of matches)
                    assert.equal(
                        readNumber(match.row[match.columns.indexOf("population")]),
                        expected,
                        `${address}: ${row.settlement} apparent`,
                    );
            }
            const location = row.location ? ` (${addressOf(row.location) ?? row.location})` : "";
            checkPrivate(row.population, `${row.settlement}${location}`);
        }
        // Visible prose is checked separately from structured fields and metadata.
        for (const text of [...site.prose, ...publicDoc.prose].flatMap((paragraph) =>
            paragraph.split(/(?<=[.!?])\s+/),
        )) {
            if (!/\b(?:population|people|residents|inhabitants)\b/i.test(text)) continue;
            for (const value of hidden) {
                const forms = [String(value), value.toLocaleString("en-US")];
                for (const form of forms) {
                    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                    assert.ok(
                        !new RegExp(`(?<![0-9])${escaped}(?![0-9])`).test(text),
                        `${address}: actual figure appears in public population prose`,
                    );
                }
            }
        }
    }
    assert.ok(hiddenFigures > 0, "The selected subjects have no private population figures");
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
                    /^thalorna-(?:note-place|sohl-affiliation)-[a-z0-9]+$/.test(address),
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
            const address = canonicalKey(
                "thalorna",
                ownDocumentSystem(fm.type),
                fm.type,
                fm.shortcode,
            );
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
    const published = rows(indexFile).map((record) => flattenPublishedAddresses(record));
    const counts = verifyPopulationIndex(source, published, addresses);
    const config = YAML.parse(fs.readFileSync("package-build.config.yaml", "utf8"));
    const packs = (config.packs ?? []).filter(
        (pack) => pack.type === "JournalEntry" && !pack.prebuilt,
    );
    const privatePacks = packs.filter((pack) => pack.private === true && !pack.system);
    const preferred = privatePacks.filter((pack) => pack.default === true);
    assert.ok(preferred.length <= 1, "private JournalEntry defaults must be unambiguous");
    const destination = preferred[0] ?? (privatePacks.length === 1 ? privatePacks[0] : undefined);
    assert.ok(destination, "one eligible private JournalEntry destination is required");
    const readDocument = (pack, id, address) => {
        const dir = path.join("build/packs-json", pack.name);
        assert.ok(fs.existsSync(dir), `${address}: missing ${pack.name} pack`);
        const matches = files(dir)
            .filter((name) => name.endsWith(".json"))
            .flatMap((file) => {
                const document = JSON.parse(fs.readFileSync(file, "utf8"));
                return document._id === id ? [{ document, file }] : [];
            });
        assert.equal(matches.length, 1, `${address}: expected one document for the published ID`);
        return matches[0];
    };
    const documentText = (document) =>
        (document.pages ?? []).map((page) => page.text?.content ?? "").join("\n");
    const sites = [],
        publicDocs = [],
        privateDocs = [];
    const siteFiles = files("build/site").filter((name) => name.endsWith("index.html"));
    const surfaceSource = [];
    for (const sourceRecord of source) {
        const requested = addressOf(sourceRecord.address.canonical);
        const { subject, subjectAddress, journal, uuid } = resolvePopulationSubject(
            published,
            requested,
        );
        assert.equal(subjectAddress, requested, `${requested}: fact-owning identity`);
        const parts = uuid.split(".");
        assert.equal(parts[1], "thalorna", `${requested}: journal package`);
        const publicPack = packs.find((pack) => pack.name === parts[2] && pack.private !== true);
        assert.ok(publicPack, `${requested}: journal must be in a public JournalEntry pack`);
        const publicDoc = readDocument(publicPack, parts[4], requested);
        const privateDoc = readDocument(
            destination,
            makeId("population-supplement", subjectAddress),
            requested,
        );
        assert.equal(privateDoc.document.ownership?.default, 0, `${requested}: private ownership`);
        publicDocs.push({
            address: requested,
            text: documentText(publicDoc.document),
            file: publicDoc.file,
        });
        privateDocs.push({
            address: requested,
            text: documentText(privateDoc.document),
            file: privateDoc.file,
        });
        const siteFile = selectSiteFile(siteFiles, subject, journal, requested);
        sites.push({ address: requested, text: fs.readFileSync(siteFile, "utf8"), file: siteFile });
        const data = { ...sourceRecord.data };
        if (Array.isArray(data.settlements))
            data.settlements = data.settlements.map((row, index) => ({
                ...row,
                ...(subject.data?.settlements?.[index]?.location === undefined ?
                    {}
                :   { location: subject.data.settlements[index].location }),
            }));
        surfaceSource.push({ ...sourceRecord, data });
    }
    const surfaces = verifyPopulationSurfaces(surfaceSource, addresses, {
        sites,
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
