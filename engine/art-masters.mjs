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

/** Private image inputs keyed by their embedded address. */
import fs from "node:fs";
import path from "node:path";
import { readCanonicalKey } from "./address.mjs";
import { renderAddress } from "./address.mjs";
import { isAddressSegment } from "./address-charset.mjs";
import { readProvenance, readSvgProvenance, sniffFormat } from "./art-provenance-core.mjs";
import { imageDimensions } from "./asset-types.mjs";

const GENERATED_SOURCE_TYPES = new Set([
    "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
    "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia",
]);
const HUMAN_SOURCE_TYPE = "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation";

/**
 * Refuse an ordinary asset source that reaches a private master root.
 * @param {readonly string[]} roots Private master roots.
 * @param {readonly string[]} sources Asset and output roots.
 * @param {{inspectChildren?: boolean}} [options] Whether source copying or writing follows child links.
 * @returns {void}
 */
export function assertPrivateArtRoots(roots, sources, { inspectChildren = true } = {}) {
    if (!roots.length) return;
    const physical = (value) => {
        let ancestor = path.resolve(value);
        const suffix = [];
        while (!fs.existsSync(ancestor)) {
            const parent = path.dirname(ancestor);
            if (parent === ancestor) return path.resolve(value);
            suffix.unshift(path.basename(ancestor));
            ancestor = parent;
        }
        return path.resolve(fs.realpathSync(ancestor), ...suffix);
    };
    const inside = (left, right) => {
        const rel = path.relative(physical(left), physical(right));
        return (
            rel === "" ||
            (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))
        );
    };
    const visited = new Set();
    const check = (source) => {
        for (const root of roots)
            if (inside(root, source) || inside(source, root))
                throw new Error(`private master root overlaps an asset staging source: ${root}`);
        if (!fs.existsSync(source)) return;
        const real = physical(source);
        if (visited.has(real)) return;
        visited.add(real);
        if (inspectChildren && fs.statSync(source).isDirectory())
            for (const name of fs.readdirSync(source)) check(path.join(source, name));
    };
    for (const source of sources) check(source);
}

/**
 * Read each PNG and SVG in the configured roots once.
 * @param {readonly string[]} roots Private input directories.
 * @param {string} contentPackage The package owning the inputs.
 * @returns {{masters: Map<string, {file: string, record: import('./art-provenance-core.mjs').ProvenanceRecord}>, findings: object[], paths: string[]}} Parsed masters, input paths and located findings.
 */
export function collectArtMasters(roots, contentPackage) {
    const masters = new Map();
    const findings = [];
    const paths = [];
    const reported = new Set();
    const add = (file, message) =>
        findings.push({ file, line: 1, column: 1, severity: "error", message });
    const visit = (dir) => {
        paths.push(dir);
        let entries;
        try {
            entries = fs
                .readdirSync(dir, { withFileTypes: true })
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            add(dir, `cannot read master directory: ${error.message}`);
            return;
        }
        for (const entry of entries) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                visit(file);
                continue;
            }
            if (
                !entry.isFile() ||
                ![".png", ".svg"].includes(path.extname(entry.name).toLowerCase())
            )
                continue;
            paths.push(file);
            try {
                const bytes = fs.readFileSync(file);
                const format = sniffFormat(bytes);
                const expected = path.extname(entry.name).slice(1).toLowerCase();
                if (format !== expected)
                    throw new Error(`expected ${expected.toUpperCase()} input`);
                const { record, xmp, standard } =
                    format === "png" ? readProvenance(bytes) : readSvgProvenance(bytes);
                if (xmp.derived !== undefined)
                    throw new Error("a master must not carry hl:derived");
                if (xmp.address && xmp.identifier && xmp.address !== xmp.identifier)
                    throw new Error("hl:address and dc:identifier differ");
                const address = xmp.address ?? xmp.identifier ?? standard.address;
                if (!address) throw new Error("master address is missing");
                const tuple = readCanonicalKey(address);
                if (
                    !tuple ||
                    !Object.values(tuple).every(isAddressSegment) ||
                    tuple.package !== contentPackage ||
                    tuple.system !== "none" ||
                    !["image", "icon"].includes(tuple.type)
                )
                    throw new Error("master address must name an image or icon in this package");
                const previous = masters.get(address);
                if (previous) {
                    if (!reported.has(address)) {
                        add(previous.file, "duplicate master address");
                        reported.add(address);
                    }
                    add(file, "duplicate master address");
                } else masters.set(address, { file, record });
            } catch (error) {
                add(file, error.message);
            }
        }
    };
    for (const root of roots) visit(root);
    return { masters, findings, paths };
}

/**
 * Make public asset records without private source paths or provenance.
 * @param {ReturnType<typeof collectArtMasters>["masters"]} masters Parsed masters.
 * @returns {Record<string, any>[]} Asset records.
 */
export function masterAssetRecords(masters) {
    return [...masters].map(([address, master]) => {
        const tuple = readCanonicalKey(address);
        const extension = path.extname(master.file).toLowerCase();
        const dimensions = imageDimensions(master.file, extension);
        const root = tuple.type === "icon" ? "icons" : "images";
        return {
            package: tuple.package,
            type: tuple.type,
            shortcode: tuple.shortcode,
            address: { canonical: address },
            asset: {
                path: `${root}/${tuple.shortcode}${extension === ".svg" ? ".svg" : ".webp"}`,
                attribution: master.record.creator ?? "",
                source: "",
                ai:
                    GENERATED_SOURCE_TYPES.has(master.record.digitalSourceType) ? true
                    : master.record.digitalSourceType === HUMAN_SOURCE_TYPE ? false
                    : null,
                license: master.record.license ?? "",
                notes: "",
                role: "",
                width: dimensions?.width ?? "",
                height: dimensions?.height ?? "",
            },
        };
    });
}

/**
 * Adapt indexed asset Addresses to the shipping record shape.
 * @param {readonly Record<string, any>[]} records Indexed records.
 * @returns {Record<string, any>[]} Asset records with canonical address strings.
 */
export function shippingAssetRecords(records) {
    return records
        .filter((record) => record.asset)
        .map((record) => ({
            ...record,
            address: {
                ...record.address,
                canonical: renderAddress(readCanonicalKey(record.address.canonical)),
            },
        }));
}
