/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import path from "node:path";
import { readCanonicalKey } from "./address.mjs";
import { isAddressSegment } from "./address-charset.mjs";
import {
    readSvgProvenance,
    readWebpProvenance,
    sniffFormat,
    hasForeignXmp,
} from "./art-provenance-core.mjs";
import { writeDerivativeProvenance } from "./art-provenance.mjs";

const PUBLIC_FIELDS = new Set([
    "address",
    "identifier",
    "derived",
    "derivedFrom",
    "creator",
    "rights",
    "ai",
    "name",
    "primaryNote",
]);
const PUBLIC_PROPERTIES = [
    "hl:address",
    "dc:identifier",
    "hl:derived",
    "hl:derivedFrom",
    "dc:creator",
    "dc:rights",
    "hl:ai",
    "hl:name",
    "hl:primarynote",
];

/** Validate public provenance, identity and sanitized derivative bytes.
 * @param {string} name - Public file name.
 * @param {Buffer} bytes - Public bytes.
 * @param {string} contentPackage - Owning content package.
 * @param {(message:string) => Error} [failure] - Contextual error factory.
 * @returns {{name:string, bytes:Buffer, format:string, metadata:Record<string,any>}} Validated derivative.
 */
export function inspectPublicDerivative(
    name,
    bytes,
    contentPackage,
    failure = (message) => new Error(message),
) {
    const format = sniffFormat(bytes);
    if (!["webp", "svg"].includes(format) || path.extname(name).toLowerCase() !== `.${format}`)
        throw failure("public artwork archive accepts only WebP and SVG derivatives");
    let read;
    try {
        read = format === "svg" ? readSvgProvenance(bytes) : readWebpProvenance(bytes);
    } catch {
        throw failure("invalid image metadata in public artwork archive");
    }
    const r = read.record,
        tuple = readCanonicalKey(r.address);
    if (
        !tuple ||
        tuple.package !== contentPackage ||
        tuple.system !== "none" ||
        !["image", "icon"].includes(tuple.type) ||
        !Object.values(tuple).every(isAddressSegment) ||
        r.identifier !== r.address ||
        r.derived !== "true" ||
        r.derivedFrom !== r.address
    )
        throw failure("invalid embedded public image identity or parent trace");
    if (
        Object.keys(r).some((key) => !PUBLIC_FIELDS.has(key)) ||
        !read.packet ||
        hasForeignXmp(read.packet, PUBLIC_PROPERTIES)
    )
        throw failure("public image metadata exceeds the publication allowlist");
    let sanitized;
    try {
        sanitized = writeDerivativeProvenance(bytes, r, {
            repeat: [
                "derivedFrom",
                ...(r.name !== undefined ? ["name"] : []),
                ...(r.primaryNote !== undefined ? ["primaryNote"] : []),
            ],
            notePublic: r.name !== undefined || r.primaryNote !== undefined,
        }).bytes;
    } catch {
        throw failure("public archive contains unsafe image metadata or markup");
    }
    if (!sanitized.equals(bytes))
        throw failure("public archive contains unsanitized image metadata or markup");
    return { name, bytes, format, metadata: r };
}
