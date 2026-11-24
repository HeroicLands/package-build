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
import { PNG } from "pngjs";
import { checkCompositionSources } from "./art-composition.mjs";
import path from "node:path";
import { readCanonicalKey } from "./address.mjs";
import { renderAddress } from "./address.mjs";
import { isAddressSegment } from "./address-charset.mjs";
import {
    provenanceAi,
    assertPublicCreators,
    MISSING_ALTERNATIVE,
    readProvenance,
    readSvgProvenance,
    sniffFormat,
} from "./art-provenance-core.mjs";
import { imageDimensions } from "./asset-types.mjs";
import { copyArtSource, setArtSource } from "./art-source.mjs";

/**
 * Refuse an ordinary asset source that reaches a private master root.
 * @param {readonly string[]} roots Private master roots.
 * @param {readonly string[]} sources Asset and output roots.
 * @param {{inspectChildren?: boolean, role?: "input"|"output"}} [options] Path role and whether it follows child links.
 * @returns {void}
 */
export function assertPrivateArtRoots(
    roots,
    sources,
    { inspectChildren = true, role = "output" } = {},
) {
    if (!roots.length) return;
    const physicalPaths = new Map();
    const physical = (value) => {
        if (physicalPaths.has(value)) return physicalPaths.get(value);
        let ancestor = path.resolve(value);
        const suffix = [];
        while (!fs.existsSync(ancestor)) {
            const parent = path.dirname(ancestor);
            if (parent === ancestor) return path.resolve(value);
            suffix.unshift(path.basename(ancestor));
            ancestor = parent;
        }
        const resolved = path.resolve(fs.realpathSync(ancestor), ...suffix);
        physicalPaths.set(value, resolved);
        return resolved;
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
                throw new Error(
                    `private master root ${root} overlaps ${role} ${source}; move one of them`,
                );
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
 * Select the screen codec from the actual PNG alpha samples.
 * @param {Buffer|Uint8Array} bytes - PNG master bytes.
 * @returns {"jpeg"|"webp"} Screen codec.
 */
export function screenRasterFormat(bytes) {
    const image = PNG.sync.read(bytes, { skipRescale: true });
    const opaque = image.colorType === 3 ? 255 : 2 ** image.depth - 1;
    for (let offset = 3; offset < image.data.length; offset += 4)
        if (image.data[offset] !== opaque) return "webp";
    return "jpeg";
}

/**
 * Read each PNG and SVG in the configured roots once.
 *
 * A master's address names the consuming package or one of the picture
 * packages it declares under `art.packages`; any other package is a finding at
 * the master naming the address and the declared packages. A master of a
 * declared picture package is marked `dependency`.
 *
 * @param {readonly string[]} roots Private input directories.
 * @param {string} contentPackage The package owning the inputs.
 * @param {{componentRoots?: readonly string[], dependencyPackages?: Iterable<string>}} [options]
 *   Unpublished component input roots, and the picture packages whose masters
 *   this package accepts.
 * @returns {{masters: Map<string, {file: string, publication?: "master"|"component", dependency?: boolean, indexed?: Record<string, any>, record: import('./art-provenance-core.mjs').ProvenanceRecord, dimensions?: {width: number, height: number}}>, components: Map<string, {file: string, publication?: "master"|"component", dependency?: boolean, indexed?: Record<string, any>, record: import("./art-provenance-core.mjs").ProvenanceRecord, dimensions?: {width: number, height: number}}>, findings: object[], paths: string[]}} Parsed masters, input paths and findings.
 */
export function collectArtMasters(
    roots,
    contentPackage,
    { componentRoots = [], dependencyPackages = [] } = {},
) {
    const declared = [...dependencyPackages];
    assertPrivateArtRoots(roots, componentRoots, { inspectChildren: false, role: "input" });
    const masters = new Map();
    const components = new Map();
    const all = new Map();
    const findings = [];
    const paths = [];
    const reported = new Set();
    const add = (file, message) => findings.push({ file, severity: "error", message });
    const visit = (dir, publication) => {
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
            if (entry.isSymbolicLink()) {
                add(file, "symbolic links are not supported inside private master roots");
                continue;
            }
            if (entry.isDirectory()) {
                visit(file, publication);
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
                const { record, xmp, standard, packet } =
                    format === "png" ? readProvenance(bytes) : readSvgProvenance(bytes);
                assertPublicCreators(packet);
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
                    tuple.system !== "none" ||
                    !["image", "icon"].includes(tuple.type)
                )
                    throw new Error("master address must name an image or icon in this package");
                const dependency = tuple.package !== contentPackage;
                if (dependency && !declared.includes(tuple.package))
                    throw new Error(
                        `master address ${address} names package \`${tuple.package}\`, which is ` +
                            `neither this package nor a picture package declared under ` +
                            `\`art.packages\` (declared: ${declared.join(", ") || "none"})`,
                    );
                if (publication === "component") {
                    if (
                        !Array.isArray(record.creator) ||
                        !record.creator.length ||
                        record.creator.some((entry) => typeof entry !== "string" || !entry.length)
                    )
                        throw new Error("private component creator is missing");
                    if (typeof record.rights !== "string" || !record.rights.trim())
                        throw new Error("private component rights is missing");
                    if (record.composition !== undefined)
                        throw new Error(
                            "private component must be a source image without a recipe",
                        );
                }
                if (
                    publication === "master" &&
                    provenanceAi(record) === true &&
                    record.nonAiAlternative === undefined
                )
                    add(file, MISSING_ALTERNATIVE);
                const screenFormat =
                    format === "png" && publication === "master" ?
                        screenRasterFormat(bytes)
                    :   "svg";
                const master = {
                    screenFormat,
                    file,
                    record,
                    publication,
                    ...(dependency ? { dependency: true } : {}),
                    dimensions: imageDimensions(file, path.extname(file).toLowerCase(), bytes),
                };
                const previous = all.get(address)?.[0];
                all.set(address, [...(all.get(address) ?? []), master]);
                if (previous) {
                    if (!reported.has(address)) {
                        add(previous.file, "duplicate master address");
                        reported.add(address);
                    }
                    add(file, "duplicate master address");
                } else (publication === "component" ? components : masters).set(address, master);
            } catch (error) {
                add(file, error.message);
            }
        }
    };
    for (const root of roots) visit(root, "master");
    for (const root of componentRoots) visit(root, "component");
    findings.push(...checkCompositionSources(all));
    return { masters, components, findings, paths };
}

/**
 * Make public asset records without private source paths or provenance.
 * A declared `nonAiAlternative` is carried as a complete canonical asset Address
 * string, or null when absent; standard index decoding restores its Address value.
 *
 * A master of a declared picture package lies under a directory named for that
 * package — `images/<package>/<shortcode>.<ext>` — so its shortcode never meets
 * one of the consuming package's own. Its creator, license, AI status,
 * alternative and dimensions are the picture package's indexed values, bound by
 * {@link module:engine/art-packages.bindDependencyMasters}; the master supplies
 * only the pixels.
 *
 * @param {ReturnType<typeof collectArtMasters>["masters"]} masters Parsed masters.
 * @returns {Record<string, any>[]} Asset records.
 */
export function masterAssetRecords(masters) {
    return [...masters]
        .filter(([, master]) => master.publication !== "component")
        .map(([address, master]) => {
            const tuple = readCanonicalKey(address);
            const extension = path.extname(master.file).toLowerCase();
            const indexed = master.indexed;
            const dimensions = master.dimensions;
            const root = tuple.type === "icon" ? "icons" : "images";
            const directory = master.dependency ? `${root}/${tuple.package}` : root;
            return setArtSource(
                {
                    package: tuple.package,
                    type: tuple.type,
                    shortcode: tuple.shortcode,
                    address: { canonical: address },
                    asset: {
                        path: `${directory}/${tuple.shortcode}${
                            extension === ".svg" ? ".svg"
                            : (
                                (master.screenFormat ??
                                    screenRasterFormat(fs.readFileSync(master.file))) === "jpeg"
                            ) ?
                                ".jpg"
                            :   ".webp"
                        }`,
                        attribution: indexed ? indexed.attribution : (master.record.creator ?? []),
                        source: "",
                        ai: indexed ? indexed.ai : provenanceAi(master.record),
                        nonAiAlternative:
                            indexed ?
                                indexed.nonAiAlternative
                            :   (master.record.nonAiAlternative ?? null),
                        license: indexed ? indexed.license : (master.record.license ?? ""),
                        notes: "",
                        role: "",
                        width: indexed ? indexed.width : (dimensions?.width ?? ""),
                        height: indexed ? indexed.height : (dimensions?.height ?? ""),
                    },
                },
                master.file,
                { master: true },
            );
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
        .map((record) =>
            copyArtSource(record, {
                ...record,
                address: {
                    ...record.address,
                    canonical: renderAddress(readCanonicalKey(record.address.canonical)),
                },
            }),
        );
}
