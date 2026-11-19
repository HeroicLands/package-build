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
import { readCanonicalKey } from "./address.mjs";
import { decodeIndexAddresses } from "./note-addresses.mjs";
import { sniffFormat, readSvgProvenance, readWebpChunks } from "./art-provenance-core.mjs";

const assetFields = new Set(ASSET_RECORD_FIELDS.map((field) => field.name));

function object(value, keys, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${label} must be an object`);
    for (const key of Object.keys(value))
        if (!keys.includes(key)) throw new Error(`${label} contains unknown field ${key}`);
}

/**
 * Load the public asset records and digest-verified files from one installed
 * artwork package. The caller supplies the package directory explicitly.
 *
 * @param {string} directory - Installed package root.
 * @param {{name:string, version:string, contentPackage:string}} expected - Required identity.
 * @returns {{records: Record<string, any>[], files: Map<string, string>}} Decoded records and relative-to-absolute file bindings.
 */
export function loadArtPackage(directory, expected) {
    const root = fs.realpathSync(directory);
    const readFile = (relative) => {
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
        if (
            !inside ||
            inside === ".." ||
            inside.startsWith(`..${path.sep}`) ||
            path.isAbsolute(inside)
        )
            throw new Error(`artwork path escapes package: ${relative}`);
        if (!fs.statSync(file).isFile()) throw new Error(`artwork path is not a file: ${relative}`);
        return { file, bytes: fs.readFileSync(file) };
    };
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
        const format = entry.path.endsWith(".svg") ? "svg" : "webp";
        if (sniffFormat(asset.bytes) !== format)
            throw new Error(`artwork format does not match: ${entry.path}`);
        if (format === "svg") readSvgProvenance(asset.bytes);
        else readWebpChunks(asset.bytes);
        files.set(entry.path, asset.file);
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
        const address = readCanonicalKey(record.address.canonical);
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
        if (addresses.has(record.address.canonical)) throw new Error("duplicate asset address");
        addresses.add(record.address.canonical);
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
        used.add(record.asset.path);
        records.push(decodeIndexAddresses(record, { package: expected.contentPackage }));
    }
    for (const file of files.keys())
        if (!used.has(file)) throw new Error(`unused artwork binding: ${file}`);
    return { records, files };
}
