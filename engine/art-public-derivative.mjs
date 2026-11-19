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
import path from "node:path";
import { readCanonicalKey } from "./address.mjs";
import { isAddressSegment } from "./address-charset.mjs";
import {
    readSvgProvenance,
    readJpegProvenance,
    readWebpProvenance,
    sniffFormat,
    hasForeignXmp,
    provenancePacket,
    assertPublicCreators,
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

/** Refuse non-public JPEG application segments and trailing bytes. */
function sanitizedJpeg(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
    let at = 2;
    while (at < bytes.length) {
        if (bytes[at++] !== 0xff) return false;
        while (bytes[at] === 0xff) at++;
        const marker = bytes[at++];
        if (marker === 0xd9) return at === bytes.length;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (at + 2 > bytes.length) return false;
        const length = bytes.readUInt16BE(at);
        if (length < 2 || at + length > bytes.length) return false;
        const data = bytes.subarray(at + 2, at + length);
        if (marker >= 0xe0 && marker <= 0xef) {
            const allowed =
                (marker === 0xe0 &&
                    data.length === 14 &&
                    data.subarray(0, 5).equals(Buffer.from("JFIF\0")) &&
                    data[12] === 0 &&
                    data[13] === 0) ||
                (marker === 0xe1 &&
                    data.subarray(0, 29).equals(Buffer.from("http://ns.adobe.com/xap/1.0/\0"))) ||
                (marker === 0xe2 && data.subarray(0, 12).equals(Buffer.from("ICC_PROFILE\0"))) ||
                (marker === 0xee &&
                    data.length === 12 &&
                    data.subarray(0, 5).equals(Buffer.from("Adobe")));
            if (!allowed) return false;
        }
        if (marker === 0xfe) return false;
        at += length;
        if (marker === 0xda) {
            while (at < bytes.length) {
                if (bytes[at] !== 0xff) {
                    at++;
                    continue;
                }
                let next = at + 1;
                while (bytes[next] === 0xff) next++;
                if (bytes[next] === 0 || (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)) {
                    at = next + 1;
                    continue;
                }
                break;
            }
        }
    }
    return false;
}

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
    if (
        !["webp", "svg", "jpeg"].includes(format) ||
        !(format === "jpeg" ? [".jpg", ".jpeg"] : [`.${format}`]).includes(
            path.extname(name).toLowerCase(),
        )
    )
        throw failure("public artwork accepts only JPEG, WebP and SVG derivatives");
    let read;
    try {
        read =
            format === "svg" ? readSvgProvenance(bytes)
            : format === "jpeg" ? readJpegProvenance(bytes)
            : readWebpProvenance(bytes);
        assertPublicCreators(read.packet);
        if (format === "jpeg" && (read.foreignMetadata || !sanitizedJpeg(bytes)))
            throw new Error("invalid JPEG metadata");
    } catch {
        throw failure("invalid public artwork image metadata");
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
        if (format === "jpeg") {
            if (read.packet !== provenancePacket(r))
                throw new Error("JPEG XMP does not match its public record");
            return { name, bytes, format, metadata: r };
        }
        sanitized = writeDerivativeProvenance(bytes, r, {
            repeat: [
                "derivedFrom",
                ...(r.name !== undefined ? ["name"] : []),
                ...(r.primaryNote !== undefined ? ["primaryNote"] : []),
            ],
            notePublic: r.name !== undefined || r.primaryNote !== undefined,
        }).bytes;
    } catch {
        throw failure("public artwork contains unsafe image metadata or markup");
    }
    if (!sanitized.equals(bytes))
        throw failure("public artwork contains unsanitized image metadata or markup");
    return { name, bytes, format, metadata: r };
}
