/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ASSET_RECORD_FIELDS } from "./asset-index.mjs";
import { readCanonicalKey, renderAddress } from "./address.mjs";
import sharp from "sharp";
import { inspectPublicDerivative } from "./art-public-derivative.mjs";
import { provenanceAi } from "./art-provenance-core.mjs";
import { decodeIndexAddresses } from "./note-addresses.mjs";

const preparedPackages = new WeakMap();
const verifiedSources = new WeakMap();

const assetFields = new Set(ASSET_RECORD_FIELDS.map((field) => field.name));

function object(value, keys, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${label} must be an object`);
    for (const key of Object.keys(value))
        if (!keys.includes(key)) throw new Error(`${label} contains unknown field ${key}`);
}

function readContainedFile(root, relative) {
    if (
        typeof relative !== "string" ||
        !relative ||
        relative.includes("\\") ||
        path.posix.isAbsolute(relative) ||
        relative.split("/").some((part) => !part || part === "." || part === "..")
    )
        throw new Error(`unsafe artwork path ${JSON.stringify(relative)}`);
    const file = fs.realpathSync(path.join(root, ...relative.split("/")));
    const inside = path.relative(root, file);
    if (!inside || inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside))
        throw new Error(`artwork path escapes package: ${relative}`);
    if (!fs.statSync(file).isFile()) throw new Error(`artwork path is not a file: ${relative}`);
    return { file, bytes: fs.readFileSync(file) };
}

/** Freeze public metadata without exposing a mutable authority snapshot. */
function freezeRecord(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) freezeRecord(child);
        Object.freeze(value);
    }
    return value;
}

/**
 * Prepare structurally verified artwork for local-index construction.
 * Public-note claims remain unvalidated; preparation exposes no byte sources.
 * @param {string} directory Installed package root.
 * @param {{name:string, version:string, contentPackage:string}} expected Required identity.
 * @returns {Promise<{records: readonly Record<string, any>[]}>} Opaque prepared package.
 */
export async function prepareArtPackage(directory, expected) {
    const root = fs.realpathSync(directory);
    const readFile = (relative) => readContainedFile(root, relative);
    const json = (file) => JSON.parse(readFile(file).bytes.toString("utf8"));
    const pkg = json("package.json");
    if (pkg.name !== expected.name || pkg.version !== expected.version)
        throw new Error("artwork npm package name or version does not match");
    const descriptor = json("artwork.json");
    object(
        descriptor,
        ["formatVersion", "contentPackage", "index", "assets"],
        "artwork descriptor",
    );
    if (descriptor.formatVersion !== 1 || descriptor.contentPackage !== expected.contentPackage)
        throw new Error("artwork format version or content package does not match");
    if (!Array.isArray(descriptor.assets)) throw new Error("artwork assets must be an array");
    const check = (entry, label) => {
        object(entry, ["path", "sha256"], label);
        if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256))
            throw new Error(`${label} has invalid SHA-256`);
        const result = readFile(entry.path);
        if (crypto.createHash("sha256").update(result.bytes).digest("hex") !== entry.sha256)
            throw new Error(`${label} SHA-256 does not match: ${entry.path}`);
        return result;
    };
    const index = check(descriptor.index, "artwork index");
    const files = new Map();
    for (const entry of descriptor.assets) {
        if (typeof entry?.path !== "string" || !/\.(?:svg|webp)$/.test(entry.path))
            throw new Error("artwork assets must be SVG or WebP files");
        if (files.has(entry.path)) throw new Error(`duplicate artwork binding: ${entry.path}`);
        const asset = check(entry, "artwork asset");
        const publicImage = inspectPublicDerivative(
            entry.path,
            asset.bytes,
            expected.contentPackage,
        );
        try {
            await sharp(asset.bytes, { failOn: "error" }).stats();
        } catch {
            throw new Error(`artwork image payload is invalid: ${entry.path}`);
        }
        files.set(entry.path, {
            root,
            relative: entry.path,
            sha256: entry.sha256,
            metadata: freezeRecord(publicImage.metadata),
        });
    }
    const records = [];
    const addresses = new Set();
    const used = new Set();
    for (const line of index.bytes.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        const record = JSON.parse(line);
        object(record, ["package", "type", "shortcode", "address", "asset"], "asset record");
        object(record.address, ["canonical"], "asset address");
        object(record.asset, [...assetFields], "asset metadata");
        decodeIndexAddresses(record, { package: expected.contentPackage });
        const address = readCanonicalKey(record.address.canonical);
        const key = address && renderAddress(address);
        if (
            !address ||
            address.package !== expected.contentPackage ||
            address.system !== "none" ||
            !["image", "icon"].includes(address.type) ||
            record.package !== address.package ||
            record.type !== address.type ||
            record.shortcode !== address.shortcode
        )
            throw new Error("asset record has wrong package or address");
        if (addresses.has(key)) throw new Error("duplicate asset address");
        addresses.add(key);
        if (![true, false, null].includes(record.asset.ai))
            throw new Error("invalid asset AI status");
        for (const key of ["attribution", "source", "license", "notes", "role"]) {
            if (key in record.asset && typeof record.asset[key] !== "string")
                throw new Error(`invalid asset ${key}`);
        }
        for (const key of ["width", "height"]) {
            const value = record.asset[key];
            if (value !== undefined && value !== "" && (!Number.isInteger(value) || value <= 0))
                throw new Error(`invalid asset ${key}`);
        }
        if (record.asset.ai === true && !record.asset.nonAiAlternative)
            throw new Error("AI asset lacks a non-AI alternative");
        if (typeof record.asset.path !== "string" || !files.has(record.asset.path))
            throw new Error("asset record has no file binding");
        const image = files.get(record.asset.path);
        if (
            image.metadata.address !== key ||
            image.metadata.creator !== (record.asset.attribution || undefined)
        )
            throw new Error("asset image identity or creator does not match its index record");
        if (image.metadata.ai !== undefined && provenanceAi(image.metadata) !== record.asset.ai)
            throw new Error("asset image AI status does not match its index record");
        used.add(record.asset.path);
        records.push(record);
    }
    for (const file of files.keys())
        if (!used.has(file)) throw new Error(`unused artwork binding: ${file}`);
    const prepared = Object.freeze({ records: freezeRecord(records) });
    preparedPackages.set(prepared, files);
    return prepared;
}

/**
 * Accept prepared public-note claims before exposing verified byte sources.
 * @param {{records: readonly Record<string, any>[]}} prepared From prepareArtPackage.
 * @param {{validatePublicNote?:(address:string, metadata:Record<string,any>) => boolean}} [options] Authoritative synchronous verifier.
 * @returns {{records: readonly Record<string, any>[], files: Map<string, object>}} Accepted package.
 */
export function finalizeArtPackage(prepared, { validatePublicNote } = {}) {
    const bindings = preparedPackages.get(prepared);
    if (!bindings) throw new Error("artwork package was not prepared by this loader");
    for (const { metadata } of bindings.values()) {
        if (
            (metadata.name !== undefined || metadata.primaryNote !== undefined) &&
            (!validatePublicNote || validatePublicNote(metadata.address, metadata) !== true)
        )
            throw new Error("public note metadata requires verification against local notes");
    }
    const files = new Map();
    for (const [relative, binding] of bindings) {
        const source = Object.freeze({});
        verifiedSources.set(source, binding);
        files.set(relative, source);
    }
    return { records: prepared.records, files };
}

/**
 * Read the exact verified bytes to write or transform at an output boundary.
 * Never reopen an installed pathname after calling this function.
 * @param {object} source Opaque source returned by finalization.
 * @returns {Buffer} A new buffer checked against the prepared SHA-256.
 */
export function readVerifiedBytes(source) {
    const binding = verifiedSources.get(source);
    if (!binding) throw new Error("artwork source has not passed final validation");
    const { bytes } = readContainedFile(binding.root, binding.relative);
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== binding.sha256)
        throw new Error(`artwork bytes changed after preparation: ${binding.relative}`);
    return bytes;
}

/**
 * Load and finalize one installed artwork package with an authoritative verifier.
 * @param {string} directory Installed package root.
 * @param {{name:string, version:string, contentPackage:string, validatePublicNote?:(address:string, metadata:Record<string,any>) => boolean}} expected Identity and note verifier.
 * @returns {Promise<{records: readonly Record<string, any>[], files: Map<string, object>}>} Accepted records and opaque byte sources.
 */
export async function loadArtPackage(directory, expected) {
    return finalizeArtPackage(await prepareArtPackage(directory, expected), expected);
}
