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

/**
 * Provenance embedded in PNG, WebP, JPEG and SVG images.
 *
 * A master carries its image or icon Address, the primary note it shows, a
 * display name, the prompt that produced it, how it was generated, and the
 * rights it is published under. Nothing about where an image came from lives in
 * a filename, a sidecar or a database.
 *
 * ## One record, two encodings
 *
 * A {@link ProvenanceRecord} is written twice from the same values:
 *
 * - an **XMP packet** in an `iTXt` chunk whose keyword is `XML:com.adobe.xmp`.
 *   It holds `hl:address`, `hl:kind`, `hl:prompt` and `hl:generator` in the
 *   {@link HL_NAMESPACE} namespace, plus `dc:title`, `dc:creator`,
 *   `dc:rights`, `dc:description`, `dc:identifier` and
 *   `Iptc4xmpExt:DigitalSourceType`, and, when set, `hl:name` and
 *   `hl:primarynote`;
 * - the **standard text chunks** every PNG reader shows, as UTF-8 `iTXt`:
 *   `Title`, `Author`, `Copyright`, `Description`, `Creation Time` and
 *   `Software`.
 *
 * `hl:formerNames` is an `rdf:Bag` with no text-chunk counterpart.
 * `Description` carries the prompt. `Creation Time` and `Software` are text
 * chunks only.
 *
 * ## The address as `dc:identifier`
 *
 * The Address is stored twice in the packet: as `hl:address` and as the Dublin
 * Core `dc:identifier`, whose value is the Address (for example
 * `thalorna-none-image-abcd`). Every write sets both from the record's address.
 * A file that holds only one of the two is read as if both held that value, and
 * the next write fills in the other. {@link checkProvenance} reports a file
 * whose two values differ.
 *
 * ## Formats
 *
 * This module writes the record into three formats: the PNG `iTXt` XMP chunk
 * ({@link writeProvenance}), the SVG `<metadata>` element
 * ({@link writeSvgProvenance}) and the WebP `XMP ` chunk
 * ({@link writeWebpProvenance}). In each, the packet is a standard `x:xmpmeta` /
 * `rdf:RDF` document with every namespace declared, and `dc:identifier` and
 * `hl:address` carry the Address.
 *
 * ## Masters and derivatives
 *
 * A master is a PNG or an SVG; a derivative, rendered from it, is a WebP,
 * SVG or JPEG. They are the same image and carry the same `hl:address`; every address
 * names exactly one master and any number of derivatives (the same master in
 * several sizes or formats). `hl:derived` (record field `derived`) with the
 * value `true` marks a derivative; a master does not carry it. A rewrite keeps
 * it.
 *
 * A derivative is another rendering of the master, possibly resized, and the
 * master is the canonical version. A derivative's properties are the master's,
 * found by address: {@link findMaster} resolves the master among a set of files
 * and {@link effectiveRecord} returns a file's properties, the master's record
 * for a derivative with the values the derivative repeats applying. A derivative
 * may repeat a subset of the master's properties. Repeated values equal the
 * master's, except that `derivedFrom` names the master Address and indexed
 * public-note fields may supply the current name and primary note. Overrides
 * require the primary-note index; master metadata is audited separately.
 *
 * {@link deriveRecord} turns a master's record into a derivative's: the
 * address, `hl:derived`, `dc:rights` and the creator (`dc:creator`, the
 * attribution), plus the properties the caller names. Generation details
 * (`prompt`, `generator`) are never carried, and `hl:name` and `hl:primarynote`
 * only when the caller says the image's primary note is public. {@link writeDerivativeProvenance}
 * writes it over whatever a WebP or SVG file holds, so a private master field
 * reaches a derivative only when it is asked for.
 *
 * ## Non-AI alternatives
 *
 * A known-AI master carries `nonAiAlternative` as `hl:nonAiAlternative`: a complete
 * canonical image or icon Address with system `none`. Raw reads and edits allow
 * the field to be absent; the provenance check reports its absence on an AI
 * master. The public asset index carries the Address, while derivative metadata
 * omits it. This field records the declared target without resolving eligibility.
 *
 * ## The note an image shows
 *
 * `hl:name` (record field `name`) and `hl:primarynote` (`primaryNote`) say which
 * note an image shows. Both are optional and independent: an image may carry
 * either, both or neither, on any image or icon in any format, and a value is
 * written as given and kept when the file is rewritten. `hl:primarynote` is the
 * note's Address and `hl:name` is a name for the image's subject, normally the
 * note's `name.full`.
 *
 * The writers fill them from the content index
 * ({@link module:engine/art-primary-note.buildPrimaryNoteIndex}) when given
 * `{index}`: an image whose primary note is the single being or affiliation note
 * naming it, through an art slot, an embed or a body image, takes that note's
 * Address as `hl:primarynote` and its `name.full` as `hl:name`. A note with no
 * `name.full` supplies `hl:primarynote` alone, and a field is never written
 * empty. An image named by no such note, or by several, gets nothing derived;
 * {@link module:engine/art-primary-note.resolvePrimaryNote} reports which, and
 * the writers return it as `primary`. Renaming a note changes the `hl:name` the
 * next write embeds.
 *
 * ## Writing is a merge
 *
 * {@link writeProvenance} reads the record already in the file, replaces the
 * fields it is given and writes the result. A field that is `undefined` is left
 * as it is, and a field that is `null` is removed. Every chunk that is not one
 * of the text chunks above — `IHDR`, `PLTE`, `IDAT`, `iCCP`, `sRGB`, `gAMA`,
 * `cHRM`, `pHYs`, `IEND` and any other — is copied byte for byte, so pixels and
 * colour handling are untouched. A replaced chunk keeps its position; a new
 * chunk goes immediately before the first `IDAT`. Writing the same record twice
 * yields identical bytes.
 *
 * ## An existing XMP packet
 *
 * A file may already hold an XMP packet from another tool, such as an editor's
 * edit history. The policy is to **keep it and replace only the properties this
 * module manages**: eligible properties and comments inside `rdf:RDF` stay;
 * comments outside `rdf:RDF` are dropped. `foreignXmp` describes retained
 * foreign properties and comments inside `rdf:RDF`. The packet's
 * `rdf:Description` blocks stay, `dc:title`,
 * `dc:creator`, `dc:rights`, `dc:description` and the managed `hl:` and
 * `Iptc4xmpExt:DigitalSourceType` properties are removed from them, and one
 * `rdf:Description` block of this module's own is written. Unchanged multi-entry
 * creator and rights lists retain their complete XML in that block; explicit
 * field edits replace them. A packet that
 * cannot be retained safely (it is not RDF, is not well-formed, uses an
 * unbound prefix, or binds a prefix this module uses to a different namespace)
 * is replaced whole, and the result says so in `foreignXmp` and gives the reason
 * in `foreignXmpReason`. Namespace declarations that sit on the foreign
 * `x:xmpmeta` or `rdf:RDF` element move onto this module's `rdf:RDF` (including
 * `dc`, `hl` and `Iptc4xmpExt` when bound to this module's namespaces), so
 * every retained property keeps its prefix bound. The SVG writer applies the
 * same rule to its managed metadata element; other elements remain unchanged.
 * A write refuses an unchanged credit list that cannot be retained safely.
 * Only one XMP chunk survives: the first is rewritten and any
 * further ones are removed. An XMP packet stored in a `tEXt` or compressed
 * `iTXt` chunk is read the same way and rewritten as the one uncompressed
 * `iTXt` chunk.
 *
 * ## WebP
 *
 * {@link writeWebpProvenance} embeds the same packet in the WebP `XMP ` chunk
 * and {@link readWebpProvenance} reads it. A plain lossy or lossless file gains
 * a `VP8X` header with the XMP flag set; the RIFF size is rewritten; image data
 * and animation chunks are copied byte for byte.
 *
 * ## Checking
 *
 * {@link checkProvenance} reports, with its known location and severity, a
 * file with no address, an address that is not a complete Address, an
 * address with two masters, a derivative whose address has no master in the set,
 * a derivative with an incorrect parent trace or unauthorized note fields,
 * another repeated property that differs from or is absent on its master, a WebP without
 * `hl:derived`, a PNG with it, an `hl:derived` whose value is not `true`, a `dc:identifier` that differs from
 * `hl:address`, a `hl:primarynote` that is malformed or that names no note in
 * the index, a `hl:name` that differs from the named note's `name.full`, a
 * `hl:primarynote` that differs from the being or affiliation the image
 * resolves to, and metadata lost or disagreeing
 * between the XMP packet and the text chunks. The format is chosen by sniffing
 * the content: raster signatures select PNG, WebP or JPEG; anything else is
 * read as SVG. A JPEG must carry its master Address in `hl:derivedFrom` and
 * only the approved public fields, with no foreign metadata.
 *
 * @module engine/art-provenance
 */

import zlib from "node:zlib";
import { formatDiagnostic } from "./diagnostics.mjs";
import { validateComposition, checkCompositionSources } from "./art-composition.mjs";

import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { QName } from "@xmldom/xmldom/lib/grammar.js";
import { __DOMHandler as XmpDomHandler } from "@xmldom/xmldom/lib/dom-parser.js";

import { readCanonicalKey } from "./address.mjs";
import { isAddressSegment } from "./address-charset.mjs";
import { resolvePrimaryNote } from "./art-primary-note.mjs";

/** The namespace of the custom XMP properties. */
export const HL_NAMESPACE = "https://heroiclands.org/ns/1.0/";

/** The `iTXt` keyword of an XMP packet. */
export const XMP_KEYWORD = "XML:com.adobe.xmp";

/** The id of the managed SVG `<metadata>` element. */
export const SVG_METADATA_ID = "hl-provenance";

const DIGITAL_SOURCE_PREFIX = "http://cv.iptc.org/newscodes/digitalsourcetype/";

/** The IPTC digital source type for media made by a trained model. */
export const DIGITAL_SOURCE_TRAINED_ALGORITHMIC = `${DIGITAL_SOURCE_PREFIX}trainedAlgorithmicMedia`;

/** The short tokens `digitalSourceType` accepts, each mapped to its IPTC URI. */
export const DIGITAL_SOURCE_TOKENS = Object.freeze({
    trainedAlgorithmicMedia: DIGITAL_SOURCE_TRAINED_ALGORITHMIC,
    algorithmicMedia: `${DIGITAL_SOURCE_PREFIX}algorithmicMedia`,
    digitalCreation: `${DIGITAL_SOURCE_PREFIX}digitalCreation`,
    compositeWithTrainedAlgorithmicMedia: `${DIGITAL_SOURCE_PREFIX}compositeWithTrainedAlgorithmicMedia`,
});

/**
 * The `iTXt` keyword each record field is written under.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STANDARD_KEYWORDS = Object.freeze({
    title: "Title",
    creator: "Author",
    rights: "Copyright",
    prompt: "Description",
    created: "Creation Time",
    software: "Software",
    description: "Comment",
    source: "Source",
});

const DC_NAMESPACE = "http://purl.org/dc/elements/1.1/";
const IPTC_NAMESPACE = "http://iptc.org/std/Iptc4xmpExt/2008-02-29/";
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Record fields in a fixed order, so output is deterministic. */
const FIELDS = Object.freeze([
    "address",
    "kind",
    "name",
    "primaryNote",
    "nonAiAlternative",
    "role",
    "derived",
    "derivedFrom",
    "prompt",
    "generator",
    "title",
    "creator",
    "rights",
    "license",
    "digitalSourceType",
    "ai",
    "created",
    "software",
    "description",
    "source",
    "processing",
    "composition",
]);

/** The complete Address shape: `<package>-<system>-<type>-<shortcode>`. */
const COMPLETE_ADDRESS = {
    test: (value) => {
        const tuple = readCanonicalKey(value);
        return (
            Boolean(tuple) &&
            [tuple.package, tuple.system, tuple.type, tuple.shortcode].every(isAddressSegment)
        );
    },
};

/**
 * The record a master carries.
 *
 * @typedef {object} ProvenanceRecord
 * @property {string} [address] - The complete image or icon Address, such as
 *   `sample-none-image-example`.
 * @property {string} [identifier] - The Address again, as `dc:identifier`.
 *   Every write sets it to `address`; a record read from a file that holds only
 *   one of the two carries that value in both.
 * @property {string} [kind] - What the picture is, such as `portrait`.
 * @property {string} [name] - The `name.full` of the being or affiliation the
 *   image shows. Written as `hl:name` in the XMP packet only. It is independent
 *   of `primaryNote`: either may be present without the other.
 * @property {string} [primaryNote] - The complete Address of that being or
 *   affiliation note. Written as `hl:primarynote` in the XMP packet only, and
 *   independent of `name`.
 * @property {string} [nonAiAlternative] - The complete canonical Address of a non-AI
 *   image or icon, with system `none`. Stored as `hl:nonAiAlternative` on the
 *   master and projected into the public asset index. The provenance check
 *   requires it for known-AI masters; raw reads and writes allow it to be absent.
 * @property {string} [prompt] - The generating prompt, verbatim.
 * @property {string} [generator] - A JSON object, as a string, describing the
 *   service and model.
 * @property {string} [title] - The display name.
 * @property {string[]} [creator] - Ordered creator credits.
 * @property {string} [rights] - The rights statement.
 * @property {string} [license] - Exact machine-readable license identifier, stored as `hl:license`.
 * @property {string} [role] - What the image is for, such as `icon`,
 *   `icon-source`, `banner`, `media` or `background`. Written as `hl:role` in
 *   the XMP packet only.
 * @property {string} [derived] - `true` on a derivative, the distribution copy
 *   of a master; absent on a master. Written as `hl:derived` in the XMP packet
 *   only. A write accepts `true` or the string `true`, and `null` removes it.
 * @property {string} [derivedFrom] - A former path or address of the image this
 *   one was made from. Written as `hl:derivedFrom` in the XMP packet only.
 * @property {boolean} [ai] - Whether the image is AI-generated, stored as `hl:ai`.
 * @property {string} [digitalSourceType] - The IPTC digital source type, as a
 *   key of {@link DIGITAL_SOURCE_TOKENS} or a full URI; read back as the URI.
 *   Written as `Iptc4xmpExt:DigitalSourceType`. On write, `none` or `null`
 *   removes it, and a PNG with no record yet that is written without the field
 *   receives {@link DIGITAL_SOURCE_TRAINED_ALGORITHMIC} unless `ai` is supplied.
 * @property {string[]} [formerNames] - Paths the file held under earlier names,
 *   oldest first, relative to the masters directory. Written as an `rdf:Bag`
 *   in the XMP packet only. A write appends the names it is given that the
 *   file does not already list and keeps the earlier ones; `null` removes the
 *   list.
 * @property {string} [created] - The creation time.
 * @property {string} [software] - The generating software or service.
 * @property {string} [description] - A statement about the image that is not a
 *   prompt, such as who is credited for it. Written as `hl:description` and the
 *   `Comment` text chunk.
 * @property {string} [source] - Where the image was obtained, normally a URL.
 *   Written as `dc:source` and the `Source` text chunk.
 * @property {import("./art-composition.mjs").ArtComposition} [composition] - Ordered private source recipe, stored as JSON in `hl:composition`; never published on a derivative.
 * @property {string} [processing] - How the file was made from its source, in
 *   free text. Written as `hl:processing` in the XMP packet only.
 */

/**
 * One PNG chunk.
 *
 * @typedef {object} PngChunk
 * @property {string} type - The four-letter chunk type.
 * @property {Buffer} data - The chunk payload.
 * @property {Buffer} raw - The whole chunk: length, type, payload and CRC.
 */

/**
 * Split a PNG into its chunks.
 *
 * @param {Buffer} bytes - The file.
 * @returns {PngChunk[]} The chunks in file order.
 * @throws {Error} When the signature, a length or a CRC is wrong, or `IEND` is
 *   missing.
 */
export function readChunks(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 8 || !bytes.subarray(0, 8).equals(SIGNATURE)) {
        throw new Error("not a PNG: the signature is missing");
    }
    const chunks = [];
    let offset = 8;
    while (offset < bytes.length) {
        if (offset + 12 > bytes.length) throw new Error("PNG chunk is truncated");
        const length = bytes.readUInt32BE(offset);
        const end = offset + 12 + length;
        if (end > bytes.length) throw new Error("PNG chunk is truncated");
        const type = bytes.toString("latin1", offset + 4, offset + 8);
        const crc = bytes.readUInt32BE(end - 4);
        if (zlib.crc32(bytes.subarray(offset + 4, end - 4)) !== crc) {
            throw new Error(`PNG ${type} chunk fails its CRC`);
        }
        chunks.push({
            type,
            data: bytes.subarray(offset + 8, end - 4),
            raw: bytes.subarray(offset, end),
        });
        offset = end;
        if (type === "IEND") break;
    }
    if (chunks.at(-1)?.type !== "IEND") throw new Error("PNG has no IEND chunk");
    return chunks;
}

/** Build one chunk. */
function makeChunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])));
    return { type, data, raw: Buffer.concat([head, data, crc]) };
}

/**
 * Build an uncompressed UTF-8 `iTXt` chunk.
 *
 * @param {string} keyword - Latin-1 keyword, 1 to 79 characters.
 * @param {string} text - The text.
 * @returns {PngChunk} The chunk.
 */
export function makeTextChunk(keyword, text) {
    if (!/^[\x20-\x7e\xa1-\xff]{1,79}$/.test(keyword)) {
        throw new Error(`invalid PNG text keyword ${JSON.stringify(keyword)}`);
    }
    return makeChunk(
        "iTXt",
        Buffer.concat([
            Buffer.from(keyword, "latin1"),
            Buffer.from([0, 0, 0, 0, 0]),
            Buffer.from(text, "utf8"),
        ]),
    );
}

/**
 * Read a `tEXt`, `zTXt` or `iTXt` chunk.
 *
 * @param {PngChunk} chunk - The chunk.
 * @returns {{keyword: string, text: string}|null} The entry, or `null` for any
 *   other chunk type or an unreadable chunk.
 */
export function readTextChunk(chunk) {
    if (!["tEXt", "zTXt", "iTXt"].includes(chunk.type)) return null;
    const d = chunk.data;
    const nul = d.indexOf(0);
    if (nul < 1) return null;
    const keyword = d.toString("latin1", 0, nul);
    try {
        if (chunk.type === "tEXt") {
            return { keyword, text: d.toString("utf8", nul + 1) };
        }
        if (chunk.type === "zTXt") {
            return { keyword, text: zlib.inflateSync(d.subarray(nul + 2)).toString("utf8") };
        }
        const compressed = d[nul + 1] === 1;
        const langEnd = d.indexOf(0, nul + 3);
        if (langEnd < 0) return null;
        const transEnd = d.indexOf(0, langEnd + 1);
        if (transEnd < 0) return null;
        const body = d.subarray(transEnd + 1);
        return { keyword, text: (compressed ? zlib.inflateSync(body) : body).toString("utf8") };
    } catch {
        return null;
    }
}

/** Escape text for XML element content. */
function escapeXml(text) {
    // eslint-disable-next-line no-control-regex
    if (
        /[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/.test(text) ||
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text)
    ) {
        throw new Error("text holds a character XML cannot carry");
    }
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
        .replace(/\r/g, "&#13;");
}

/** Reverse {@link escapeXml}, including numeric references. */
function unescapeXml(text) {
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, ref) => {
        switch (ref) {
            case "amp":
                return "&";
            case "lt":
                return "<";
            case "gt":
                return ">";
            case "quot":
                return '"';
            case "apos":
                return "'";
            default:
                return String.fromCodePoint(
                    ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10),
                );
        }
    });
}

/** The element-wrapping each XMP property takes. */
const XMP_PROPERTIES = Object.freeze([
    ["title", "dc:title", "alt"],
    ["creator", "dc:creator", "seq"],
    ["rights", "dc:rights", "alt"],
    ["license", "hl:license", "plain"],
    ["ai", "hl:ai", "boolean"],
    ["prompt", "dc:description", "alt"],
    ["address", "hl:address", "plain"],
    ["identifier", "dc:identifier", "plain"],
    ["kind", "hl:kind", "plain"],
    ["name", "hl:name", "plain"],
    ["primaryNote", "hl:primarynote", "plain"],
    ["nonAiAlternative", "hl:nonAiAlternative", "plain"],
    ["role", "hl:role", "plain"],
    ["derived", "hl:derived", "plain"],
    ["derivedFrom", "hl:derivedFrom", "plain"],
    ["prompt", "hl:prompt", "plain"],
    ["generator", "hl:generator", "plain"],
    ["formerNames", "hl:formerNames", "bag"],
    ["description", "hl:description", "plain"],
    ["source", "dc:source", "plain"],
    ["processing", "hl:processing", "plain"],
    ["composition", "hl:composition", "json"],
    ["digitalSourceType", "Iptc4xmpExt:DigitalSourceType", "plain"],
]);

/** Every property name this module owns inside an XMP packet. */
const MANAGED_PROPERTIES = Object.freeze(XMP_PROPERTIES.map(([, name]) => name));

/**
 * The `rdf:Description` block holding a record.
 *
 * @param {ProvenanceRecord} record - The record.
 * @param {string} [eol] - The line ending between structural lines.
 * @param {Map<string, string[]>} [creditLists] - Complete unchanged credit properties.
 * @returns {string} The XML.
 */
function descriptionBlock(record, eol = "\n", creditLists = new Map()) {
    const lines = [];
    for (const [field, name, shape] of XMP_PROPERTIES) {
        const value = record[field];
        if (value === undefined) continue;
        if (creditLists.has(field)) {
            lines.push(...creditLists.get(field).map((markup) => `   ${markup}`));
            continue;
        }
        if (shape === "bag") {
            const items = value.map((item) => `<rdf:li>${escapeXml(item)}</rdf:li>`).join("");
            lines.push(`   <${name}><rdf:Bag>${items}</rdf:Bag></${name}>`);
            continue;
        }
        if (shape === "seq") {
            const items = value.map((item) => `<rdf:li>${escapeXml(item)}</rdf:li>`).join("");
            lines.push(`   <${name}><rdf:Seq>${items}</rdf:Seq></${name}>`);
            continue;
        }
        const text = escapeXml(
            shape === "json" ? JSON.stringify(validateComposition(value))
            : shape === "boolean" ?
                value ? "True"
                :   "False"
            :   value,
        );
        if (shape === "alt") {
            lines.push(
                `   <${name}><rdf:Alt><rdf:li xml:lang="x-default">${text}</rdf:li></rdf:Alt></${name}>`,
            );
        } else {
            lines.push(`   <${name}>${text}</${name}>`);
        }
    }
    return (
        `  <rdf:Description rdf:about="" xmlns:dc="${DC_NAMESPACE}" ` +
        `xmlns:hl="${HL_NAMESPACE}" xmlns:Iptc4xmpExt="${IPTC_NAMESPACE}">${eol}` +
        `${lines.join(eol)}${eol}  </rdf:Description>${eol}`
    );
}

const X_NAMESPACE = "adobe:ns:meta/";
const RDF_NAMESPACE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

/** The prefixes this module's own markup binds, and what they are bound to. */
const OWN_BINDINGS = Object.freeze({
    x: X_NAMESPACE,
    rdf: RDF_NAMESPACE,
    dc: DC_NAMESPACE,
    hl: HL_NAMESPACE,
    Iptc4xmpExt: IPTC_NAMESPACE,
});

/**
 * The packet's opening, with extra namespace declarations on `rdf:RDF`.
 *
 * @param {string} [declarations] - Declarations, each with a leading space.
 */
function packetHead(declarations = "") {
    return (
        '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
        `<x:xmpmeta xmlns:x="${X_NAMESPACE}">\n` +
        ` <rdf:RDF xmlns:rdf="${RDF_NAMESPACE}"${declarations}>\n`
    );
}
const PACKET_TAIL = ' </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>';

const OWN_DESCRIPTION = new RegExp(
    `[ \\t]*<rdf:Description\\b[^>]*xmlns:hl="${HL_NAMESPACE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"[^>]*>[\\s\\S]*?</rdf:Description>[ \\t]*\\n?`,
);

const ATTRIBUTE = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parse the attributes of a start tag's text; `null` when it repeats a name. */
function parseAttributes(text) {
    const attributes = new Map();
    for (const match of text.matchAll(ATTRIBUTE)) {
        if (attributes.has(match[1])) return null;
        attributes.set(match[1], match[2] ?? match[3]);
    }
    return attributes;
}

const TOKEN =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const BAD_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

/**
 * Whether markup is well-formed with every prefix bound.
 *
 * @param {string} xml - Content without a root of its own.
 * @param {Record<string, string>} bindings - The prefixes bound outside it.
 * @returns {string|null} `null` when sound, otherwise the reason.
 */
function checkMarkup(xml, bindings) {
    const stack = [];
    let scopes = [bindings];
    let last = 0;
    const lookup = (prefix) => {
        for (let i = scopes.length - 1; i >= 0; i--) if (prefix in scopes[i]) return true;
        return false;
    };
    const prefixOf = (name) => (name.includes(":") ? name.slice(0, name.indexOf(":")) : null);
    const text = (from, to) => {
        const chunk = xml.slice(from, to);
        return chunk.includes("<") || BAD_ENTITY.test(chunk) ? "stray markup in text" : null;
    };
    for (const match of xml.matchAll(TOKEN)) {
        const between = text(last, match.index);
        if (between) return between;
        last = match.index + match[0].length;
        if (match[1] !== undefined) {
            if (stack.pop() !== match[1]) return `mismatched end tag </${match[1]}>`;
            scopes.pop();
            continue;
        }
        if (match[2] === undefined) continue;
        const attributes = parseAttributes(match[3]);
        if (attributes === null) return `repeated attribute on <${match[2]}>`;
        const local = {};
        for (const [name, value] of attributes) {
            if (BAD_ENTITY.test(value) || value.includes("<")) return "bad attribute value";
            if (name.startsWith("xmlns:")) local[name.slice(6)] = value;
        }
        scopes = [...scopes, local];
        const names = [match[2], ...[...attributes.keys()].filter((n) => !n.startsWith("xmlns"))];
        for (const name of names) {
            const prefix = prefixOf(name);
            if (prefix !== null && prefix !== "xml" && !lookup(prefix)) {
                return `unbound prefix ${prefix}`;
            }
        }
        if (match[4]) scopes.pop();
        else stack.push(match[2]);
    }
    const tail = text(last, xml.length);
    if (tail) return tail;
    return stack.length ? `unclosed element <${stack.at(-1)}>` : null;
}

/** Isolate the RDF container and the namespace bindings in scope at its opening. */
function rdfScope(packet) {
    const namespaces = new Map();
    const frames = [];
    const heads = new Map();
    let root;
    const names = new RegExp(QName.source, "uy");
    const markup =
        /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^<>"'])*(?:>|(?=<)|$)/gu;
    const pop = () => {
        const frame = frames.pop();
        if (frame.previous === undefined) heads.delete(frame.name);
        else heads.set(frame.name, frame.previous);
        for (const [prefix, before] of frame.bindings.reverse()) {
            if (before === undefined) namespaces.delete(prefix);
            else namespaces.set(prefix, before);
        }
        return frame;
    };
    for (const match of packet.matchAll(markup)) {
        const tag = match[0];
        if (tag.startsWith("<!") || tag.startsWith("<?") || !tag.endsWith(">")) continue;
        const closing = tag[1] === "/";
        names.lastIndex = closing ? 2 : 1;
        const named = names.exec(tag);
        if (!named || !/[\s/>]/u.test(tag[names.lastIndex] ?? "")) continue;
        const name = named[0];
        if (closing) {
            if (!/^\s*>$/.test(tag.slice(names.lastIndex))) continue;
            const head = heads.get(name);
            if (head === undefined) continue;
            while (frames.length - 1 > head) if (pop() === root) return null;
            const frame = pop();
            if (frame.rdf)
                return { inner: packet.slice(frame.start, match.index), declared: frame.rdf };
            continue;
        }
        const attributes = parseAttributes(tag.slice(names.lastIndex));
        if (attributes === null) return null;
        const bindings = [];
        for (const [attribute, raw] of attributes) {
            if (attribute !== "xmlns" && !attribute.startsWith("xmlns:")) continue;
            const prefix = attribute === "xmlns" ? "" : attribute.slice(6);
            let value;
            try {
                value = unescapeXml(raw);
            } catch {
                return null;
            }
            bindings.push([prefix, namespaces.get(prefix)]);
            namespaces.set(prefix, value);
        }
        const colon = name.indexOf(":");
        const prefix = colon < 0 ? "" : name.slice(0, colon);
        const rdf = name.slice(colon + 1) === "RDF" && namespaces.get(prefix) === RDF_NAMESPACE;
        const frame = {
            name,
            bindings,
            previous: heads.get(name),
            start: match.index + tag.length,
            rdf: rdf && root === undefined ? new Map(namespaces) : undefined,
        };
        if (frame.rdf) root = frame;
        frames.push(frame);
        heads.set(name, frames.length - 1);
        if (/\/\s*>$/.test(tag)) pop();
    }
    return null;
}

/**
 * Decide what survives of a foreign XMP packet.
 *
 * The RDF container is identified by namespace URI and local name. Namespace
 * bindings inherited from its enclosing elements move onto this module's
 * `rdf:RDF`, so retained properties keep the prefixes they
 * were written with. A packet is dropped when it is not RDF, is not
 * well-formed, uses an unbound prefix, or binds a prefix this module uses to a
 * different namespace.
 *
 * @param {string} packet - The XMP text.
 * @param {Set<string>} [unchangedCredits] - Credit fields whose full lists must survive.
 * @param {Map<string, string[]>} [creditLists] - Receives complete credit-property markup.
 * @returns {{kept: true, markup: string, declarations: string}|
 *   {kept: false, reason?: string, empty?: true}} The retained markup and the
 *   declarations it needs, or why nothing is retained (`empty` when the packet
 *   holds nothing but this module's own block).
 */
function retainForeign(packet, unchangedCredits = new Set(), creditLists = new Map()) {
    const scope = rdfScope(packet);
    if (scope === null) return { kept: false, reason: "the packet is not RDF" };
    const { inner, declared } = scope;

    const bindings = { x: X_NAMESPACE, rdf: RDF_NAMESPACE };
    let declarations = "";
    for (const [boundPrefix, value] of declared) {
        const prefix = boundPrefix === "" ? null : boundPrefix;
        const name = prefix === null ? "xmlns" : `xmlns:${prefix}`;
        if (prefix !== null && prefix in OWN_BINDINGS) {
            if (OWN_BINDINGS[prefix] !== value) {
                return {
                    kept: false,
                    reason: `the prefix ${prefix} is bound to a different namespace than this module's`,
                };
            }
            if (prefix === "x" || prefix === "rdf") continue;
        }
        if (prefix !== null) bindings[prefix] = value;
        declarations += ` ${name}="${escapeXml(value)}"`;
    }
    const problem = checkMarkup(inner, bindings);
    if (problem) return { kept: false, reason: `the packet cannot be retained: ${problem}` };
    let invalid = false;
    let document;
    try {
        document = new DOMParser({
            onError: () => {
                invalid = true;
            },
        }).parseFromString(
            `<rdf:RDF xmlns:rdf="${RDF_NAMESPACE}" xmlns:x="${X_NAMESPACE}"${declarations}>${inner}</rdf:RDF>`,
            "application/xml",
        );
    } catch {
        return { kept: false, reason: "the packet is not well-formed XML" };
    }
    if (invalid) return { kept: false, reason: "the packet is not well-formed XML" };
    const managed = new Set(
        MANAGED_PROPERTIES.map((name) => {
            const [prefix, local] = name.split(":");
            return `${OWN_BINDINGS[prefix]}|${local}`;
        }),
    );
    const serializer = new XMLSerializer();
    const retained = [];
    const creditCounts = new Map();
    const countCredit = (node) => {
        if (node.namespaceURI !== DC_NAMESPACE || !unchangedCredits.has(node.localName)) return;
        creditCounts.set(node.localName, (creditCounts.get(node.localName) ?? 0) + 1);
    };
    for (
        let description = document.documentElement.firstChild;
        description;
        description = description.nextSibling
    ) {
        if (description.nodeType === 8) {
            retained.push(serializer.serializeToString(description));
            continue;
        }
        if (description.nodeType !== 1) continue;
        if (description.namespaceURI !== RDF_NAMESPACE || description.localName !== "Description") {
            return { kept: false, reason: "the RDF contains unsupported markup" };
        }
        for (let i = description.attributes.length - 1; i >= 0; i--) {
            const attribute = description.attributes.item(i);
            countCredit(attribute);
            if (managed.has(`${attribute.namespaceURI}|${attribute.localName}`))
                description.removeAttributeNode(attribute);
        }
        for (let child = description.firstChild; child;) {
            const next = child.nextSibling;
            if (child.nodeType === 1 && managed.has(`${child.namespaceURI}|${child.localName}`)) {
                countCredit(child);
                const preserve =
                    child.namespaceURI === DC_NAMESPACE && unchangedCredits.has(child.localName);
                if (preserve) {
                    const entries = creditLists.get(child.localName) ?? [];
                    const copy = child.cloneNode(true);
                    if (!copy.prefix)
                        copy.setAttributeNS(
                            "http://www.w3.org/2000/xmlns/",
                            "xmlns",
                            copy.namespaceURI,
                        );
                    // Credits inherit these bindings in the destination description.
                    const context = document.createElement("credit-context");
                    for (const [prefix, uri] of Object.entries(OWN_BINDINGS))
                        context.setAttributeNS(
                            "http://www.w3.org/2000/xmlns/",
                            `xmlns:${prefix}`,
                            uri,
                        );
                    context.appendChild(copy);
                    const markup = serializer.serializeToString(context, {
                        nodeFilter: (node) => (node.nodeType === 3 ? escapeXml(node.data) : node),
                    });
                    entries.push(
                        markup.slice(markup.indexOf(">") + 1, -"</credit-context>".length),
                    );
                    creditLists.set(child.localName, entries);
                }
                const retainComments = (node) => {
                    for (let nested = node.firstChild; nested; nested = nested.nextSibling) {
                        if (nested.nodeType === 8)
                            description.insertBefore(document.createComment(nested.data), child);
                        else retainComments(nested);
                    }
                };
                if (!preserve) retainComments(child);
                description.removeChild(child);
            }
            child = next;
        }
        const foreignAttributes = Array.from({ length: description.attributes.length }, (_, i) =>
            description.attributes.item(i),
        ).some(
            (a) =>
                a.namespaceURI !== "http://www.w3.org/2000/xmlns/" &&
                !(a.namespaceURI === RDF_NAMESPACE && a.localName === "about"),
        );
        const foreignChildren = Array.from({ length: description.childNodes.length }, (_, i) =>
            description.childNodes.item(i),
        ).some(
            (n) =>
                n.nodeType === 1 ||
                n.nodeType === 8 ||
                ((n.nodeType === 3 || n.nodeType === 4) && n.data.trim() !== ""),
        );
        if (foreignAttributes || foreignChildren)
            retained.push(serializer.serializeToString(description));
    }
    assertUnambiguousCredits(creditCounts, unchangedCredits);
    if (!retained.length) return { kept: false, empty: true };
    return { kept: true, markup: `  ${retained.join("\n  ")}\n`, declarations };
}

/** Refuse unchanged credit properties whose distinct subjects cannot be collapsed. */
function assertUnambiguousCredits(counts, unchangedCredits) {
    for (const field of unchangedCredits)
        if ((counts.get(field) ?? 0) > 1)
            throw new Error(
                `${field}: duplicate XMP properties; explicitly replace or remove ${field} to edit this packet`,
            );
}

/** Whether an inherited packet has properties outside the managed record. */
function hasForeignXmp(packet, properties = MANAGED_PROPERTIES) {
    let invalid = false;
    let document;
    try {
        document = new DOMParser({
            onError: () => {
                invalid = true;
            },
        }).parseFromString(packet, "application/xml");
    } catch {
        return true;
    }
    if (invalid || !document.documentElement) return true;
    const managed = new Set(
        properties.map((name) => {
            const [prefix, local] = name.split(":");
            return `${OWN_BINDINGS[prefix]}|${local}`;
        }),
    );
    const rdf = document.getElementsByTagNameNS(RDF_NAMESPACE, "RDF");
    const containsComment = (node) => {
        for (let child = node.firstChild; child; child = child.nextSibling) {
            if (child.nodeType === 8 || containsComment(child)) return true;
        }
        return false;
    };
    for (let i = 0; i < rdf.length; i++) if (containsComment(rdf.item(i))) return true;
    const descriptions = document.getElementsByTagNameNS(RDF_NAMESPACE, "Description");
    if (!descriptions.length) return true;
    for (let i = 0; i < descriptions.length; i++) {
        const description = descriptions.item(i);
        for (let j = 0; j < description.attributes.length; j++) {
            const attribute = description.attributes.item(j);
            if (
                attribute.namespaceURI === "http://www.w3.org/2000/xmlns/" ||
                (attribute.namespaceURI === RDF_NAMESPACE && attribute.localName === "about")
            )
                continue;
            if (!managed.has(`${attribute.namespaceURI}|${attribute.localName}`)) return true;
        }
        for (let child = description.firstChild; child; child = child.nextSibling) {
            if (child.nodeType === 1 && !managed.has(`${child.namespaceURI}|${child.localName}`))
                return true;
        }
    }
    return false;
}

/** The ordinary managed fields; structured generation facts have dedicated readers. */
const READ_PROPERTIES = new Map(
    XMP_PROPERTIES.filter(
        ([field, name]) =>
            !["composition", "ai", "nonAiAlternative"].includes(field) && name !== "dc:description",
    ).map(([field, name, shape]) => {
        const [prefix, local] = name.split(":");
        return [`${OWN_BINDINGS[prefix]}|${local}`, { field, shape }];
    }),
);

/** Whether a credit property carries only the one value its scalar writer emits. */
function losslessCreditProperty(markup, bindings, field, value) {
    let invalid = false;
    let document;
    try {
        const declarations = [...bindings]
            .map(([prefix, uri]) => ` xmlns${prefix ? `:${prefix}` : ""}="${escapeXml(uri)}"`)
            .join("");
        document = new DOMParser({
            onError: () => {
                invalid = true;
            },
        }).parseFromString(
            `<credit-context${declarations}>${markup}</credit-context>`,
            "application/xml",
        );
    } catch {
        return false;
    }
    if (invalid) return false;
    const attributesOnly = (node, defaultLanguage = false) =>
        Array.from(node.attributes).every(
            (attribute) =>
                attribute.namespaceURI === "http://www.w3.org/2000/xmlns/" ||
                (defaultLanguage &&
                    attribute.namespaceURI === "http://www.w3.org/XML/1998/namespace" &&
                    attribute.localName === "lang" &&
                    attribute.value === "x-default"),
        );
    const onlyElement = (parent, namespace, name) => {
        const children = Array.from(parent.childNodes).filter(
            (node) => !(node.nodeType === 3 && node.data.trim() === ""),
        );
        if (children.length !== 1) return null;
        const child = children[0];
        return (
                child.nodeType === 1 && child.namespaceURI === namespace && child.localName === name
            ) ?
                child
            :   null;
    };
    const property = onlyElement(document.documentElement, DC_NAMESPACE, field);
    if (!property || !attributesOnly(property)) return false;
    const container = onlyElement(property, RDF_NAMESPACE, field === "creator" ? "Seq" : "Alt");
    if (!container || !attributesOnly(container)) return false;
    if (field === "creator") {
        const items = Array.from(container.childNodes).filter(
            (node) => !(node.nodeType === 3 && node.data.trim() === ""),
        );
        return (
            Array.isArray(value) &&
            items.length === value.length &&
            items.every(
                (item, at) =>
                    item.nodeType === 1 &&
                    item.namespaceURI === RDF_NAMESPACE &&
                    item.localName === "li" &&
                    attributesOnly(item) &&
                    Array.from(item.childNodes).every((node) => node.nodeType === 3) &&
                    item.textContent === value[at],
            )
        );
    }
    const item = onlyElement(container, RDF_NAMESPACE, "li");
    if (!item || !attributesOnly(item, field === "rights")) return false;
    if (
        field === "rights" &&
        item.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang") !== "x-default"
    )
        return false;
    return (
        Array.from(item.childNodes).every((node) => node.nodeType === 3) &&
        item.textContent === value
    );
}

/**
 * Read ordinary properties in one pass without imposing XML validity on raw text.
 * @param {string} packet - The source XMP.
 * @param {Set<string>} [unsafeCredits] - Receives credit fields that need their original XML.
 * @param {Map<string, number>} [creditCounts] - Receives all credit-property occurrence counts.
 * @returns {object} Scalar properties and the former-name list.
 */
function readManagedProperties(packet, unsafeCredits, creditCounts, invalidCreator) {
    const own = OWN_DESCRIPTION.exec(packet);
    const inOwn = (at) => own !== null && at >= own.index && at < own.index + own[0].length;
    const countCredit = (field) => {
        if (creditCounts && ["creator", "rights"].includes(field))
            creditCounts.set(field, (creditCounts.get(field) ?? 0) + 1);
    };
    // Standalone fragments use canonical prefix bindings; declarations override them.
    const namespaces = new Map(Object.entries(OWN_BINDINGS));
    const expanded = (name, attribute = false) => {
        const colon = name.indexOf(":");
        const prefix = colon < 0 ? "" : name.slice(0, colon);
        const namespace = attribute && colon < 0 ? "" : (namespaces.get(prefix) ?? "");
        return `${namespace}|${name.slice(colon + 1)}`;
    };
    const elements = new Map();
    const attributes = new Map();
    const frames = [];
    const heads = new Map();
    let active;
    const pop = () => {
        const frame = frames.pop();
        active = frame.before;
        if (frame.previous === undefined) heads.delete(frame.name);
        else heads.set(frame.name, frame.previous);
        for (const [prefix, before] of frame.bindings.reverse()) {
            if (before === undefined) namespaces.delete(prefix);
            else namespaces.set(prefix, before);
        }
        return frame;
    };
    const names = new RegExp(QName.source, "uy");
    const markup =
        /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^<>"'])*(?:>|(?=<)|$)/gu;
    for (const match of packet.matchAll(markup)) {
        const tag = match[0];
        if (tag.startsWith("<!") || tag.startsWith("<?") || !tag.endsWith(">")) continue;
        const closing = tag[1] === "/";
        names.lastIndex = closing ? 2 : 1;
        const named = names.exec(tag);
        if (!named || !/[\s/>]/u.test(tag[names.lastIndex] ?? "")) continue;
        const name = named[0];
        if (closing) {
            if (!/^\s*>$/.test(tag.slice(names.lastIndex))) continue;
            const head = heads.get(name);
            if (head === undefined) continue;
            while (frames.length - 1 > head) pop();
            const frame = pop();
            if (frame.capture) {
                frame.capture.end = match.index;
                frame.capture.markupEnd = match.index + tag.length;
            }
            if (frame.item) frame.item.items.push([frame.start, match.index]);
            continue;
        }
        const attrs = [...tag.slice(names.lastIndex).matchAll(ATTRIBUTE)];
        const bindings = [];
        for (const attr of attrs) {
            if (attr[1] !== "xmlns" && !attr[1].startsWith("xmlns:")) continue;
            const prefix = attr[1] === "xmlns" ? "" : attr[1].slice(6);
            const raw = attr[2] ?? attr[3];
            let value = raw;
            try {
                value = unescapeXml(raw);
            } catch {
                /* Invalid namespace text names no managed property. */
            }
            bindings.push([prefix, namespaces.get(prefix)]);
            namespaces.set(prefix, value);
        }
        const before = active;
        const isOwn = inOwn(match.index);
        for (const attr of attrs) {
            if (attr[1] === "xmlns" || attr[1].startsWith("xmlns:")) continue;
            const property = READ_PROPERTIES.get(expanded(attr[1], true));
            if (!property || property.shape === "bag") continue;
            countCredit(property.field);
            const previous = attributes.get(property.field);
            if (!previous || (isOwn && !previous.own))
                attributes.set(property.field, { own: isOwn, value: attr[2] ?? attr[3] });
        }
        const key = expanded(name);
        const property = READ_PROPERTIES.get(key);
        if (property) countCredit(property.field);
        const credit = unsafeCredits && ["creator", "rights"].includes(property?.field);
        if (credit) unsafeCredits.add(property.field);
        const selfClosing = /\/\s*>$/.test(tag);
        if (
            invalidCreator &&
            (property?.field === "creator" ||
                (key === `${RDF_NAMESPACE}|li` && active?.shape === "seq"))
        ) {
            if (
                selfClosing ||
                attrs.some((attr) => {
                    const attribute = expanded(attr[1], true);
                    return (
                        attribute === `${RDF_NAMESPACE}|resource` ||
                        attribute === `${RDF_NAMESPACE}|parseType`
                    );
                })
            )
                invalidCreator.bad = true;
        }
        let capture;
        if (property && !selfClosing) {
            const previous = elements.get(property.field);
            if (!previous || (isOwn && !previous.own)) {
                capture = {
                    own: isOwn,
                    start: match.index + tag.length,
                    items: [],
                    shape: property.shape,
                    ...(credit ?
                        {
                            markupStart: match.index,
                            namespaces: new Map(namespaces),
                            inheritedContext: frames.some((frame) => frame.xmlContext),
                        }
                    :   {}),
                };
                elements.set(property.field, capture);
                active = capture;
            }
        }
        frames.push({
            name,
            bindings,
            before,
            previous: heads.get(name),
            capture,
            item: key === `${RDF_NAMESPACE}|li` ? active : undefined,
            start: match.index + tag.length,
            xmlContext:
                unsafeCredits &&
                attrs.some((attr) => ["xml:lang", "xml:base", "xml:space"].includes(attr[1])),
        });
        heads.set(name, frames.length - 1);
        if (selfClosing) pop();
    }
    const record = {};
    for (const { field } of READ_PROPERTIES.values()) {
        const element = elements.get(field);
        const attribute = attributes.get(field);
        if (element?.end !== undefined && !(attribute?.own && !element.own)) {
            if (element.shape === "bag" || element.shape === "seq") {
                if (
                    field === "creator" &&
                    invalidCreator &&
                    element.items.some(([start, end]) => packet.slice(start, end).includes("<"))
                )
                    invalidCreator.bad = true;
                record[field] = element.items.map(([start, end]) =>
                    unescapeXml(packet.slice(start, end)),
                );
                if (field === "creator" && !element.items.length) {
                    const raw = packet.slice(element.start, element.end);
                    if (raw && !raw.includes("<")) record[field] = [unescapeXml(raw)];
                }
            } else {
                const [start, end] = element.items[0] ?? [element.start, element.end];
                record[field] = unescapeXml(packet.slice(start, end));
            }
            if (
                element.namespaces &&
                !element.inheritedContext &&
                losslessCreditProperty(
                    packet.slice(element.markupStart, element.markupEnd),
                    element.namespaces,
                    field,
                    record[field],
                )
            )
                unsafeCredits.delete(field);
        } else if (attribute)
            record[field] =
                field === "creator" ? [unescapeXml(attribute.value)] : unescapeXml(attribute.value);
    }
    return record;
}

/** Refuse ambiguous creator structures when projecting public credits.
 * @param {string|null} packet Source XMP packet.
 * @returns {void}
 */
export function assertPublicCreators(packet) {
    if (packet === null) return;
    const fail = () => {
        throw new Error("creator: public credits require one unambiguous list of text entries");
    };
    let invalid = false,
        document;
    try {
        document = new DOMParser({
            onError: () => {
                invalid = true;
            },
        }).parseFromString(packet, "application/xml");
    } catch {
        fail();
    }
    if (invalid || !document) fail();
    const counts = new Map(),
        bad = { bad: false };
    const record = readManagedProperties(packet, undefined, counts, bad);
    if ((counts.get("creator") ?? 0) > 1 || bad.bad) fail();
    const creators = Array.from(document.getElementsByTagNameNS(DC_NAMESPACE, "creator"));
    const descriptions = Array.from(document.getElementsByTagNameNS(RDF_NAMESPACE, "Description"));
    const attributes = descriptions.flatMap((element) =>
        Array.from(element.attributes).filter(
            (attribute) =>
                attribute.namespaceURI === DC_NAMESPACE && attribute.localName === "creator",
        ),
    );
    if (creators.length + attributes.length > 1) fail();
    if (!creators.length && !attributes.length) {
        if ((counts.get("creator") ?? 0) > 0) fail();
        return;
    }
    const permittedAttributes = (element) =>
        Array.from(element.attributes).every(
            (attribute) =>
                attribute.namespaceURI === "http://www.w3.org/2000/xmlns/" ||
                (attribute.namespaceURI === "http://www.w3.org/XML/1998/namespace" &&
                    attribute.localName === "lang"),
        );
    const significant = (element) =>
        Array.from(element.childNodes).filter(
            (node) => node.nodeType !== 8 && !(node.nodeType === 3 && !node.data.trim()),
        );
    let values;
    if (attributes.length) values = [attributes[0].value];
    else {
        const property = creators[0];
        if (!permittedAttributes(property)) fail();
        const children = significant(property);
        if (
            property.childNodes.length &&
            Array.from(property.childNodes).every((node) => node.nodeType === 3)
        )
            values = [property.textContent];
        else {
            if (
                children.length !== 1 ||
                children[0].nodeType !== 1 ||
                children[0].namespaceURI !== RDF_NAMESPACE ||
                children[0].localName !== "Seq"
            )
                fail();
            const sequence = children[0];
            if (!permittedAttributes(sequence)) fail();
            const items = significant(sequence);
            if (!items.length) fail();
            values = items.map((item) => {
                if (
                    item.nodeType !== 1 ||
                    item.namespaceURI !== RDF_NAMESPACE ||
                    item.localName !== "li" ||
                    !permittedAttributes(item)
                )
                    fail();
                if (!Array.from(item.childNodes).every((node) => node.nodeType === 3)) fail();
                return item.textContent;
            });
        }
    }
    if (
        values.some((value) => typeof value !== "string" || !value.length) ||
        JSON.stringify(record.creator) !== JSON.stringify(values)
    )
        fail();
}

/** Read a declared composition with strict XML and property validation. */
function readComposition(packet) {
    const markup =
        /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^<>"'])*(?:>|(?=<)|$)/gu;
    const element = /^<\s*(?:[^\s<=>/]+:)?composition(?=[\s=/>]|$)/u;
    const qualifiedAttribute =
        /^<\s*\/?\s*[^\s<=>/]+[\s\S]*?[\s"'](?:[^\s<=>/]+:)composition(?=[\s=/>]|$)/u;
    const attribute =
        /^<\s*\/?\s*[:_a-zA-Z\xC0-\xD6\xD8-\xF6\xF8-\u02FF\u0370-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{10FFFF}][^\s<=>/]*[\s\S]*?[\s"']composition(?=\s*=|\/?>)/u;
    if (
        ![...packet.matchAll(markup)].some((match) => {
            const tag = match[0];
            if (tag.startsWith("<!") || tag.startsWith("<?")) return false;
            const masked = tag.replace(/"[^"]*(?:"|$)|'[^']*(?:'|$)/gu, '""');
            return (
                element.test(masked) ||
                qualifiedAttribute.test(masked) ||
                (attribute.test(masked) &&
                    (tag.endsWith(">") || /[\s"']composition\s*=\s*""/u.test(masked)))
            );
        })
    )
        return undefined;
    let invalid = false;
    let document;
    try {
        document = new DOMParser({
            onError: () => {
                invalid = true;
            },
        }).parseFromString(packet, "application/xml");
    } catch {
        throw new Error("composition: malformed XMP");
    }
    if (invalid) throw new Error("composition: malformed XMP");
    const nodes = document.getElementsByTagNameNS(HL_NAMESPACE, "composition");
    const elements = document.getElementsByTagName("*");
    for (let index = 0; index < elements.length; index++) {
        const element = elements.item(index);
        if (element.localName === "composition" && element.namespaceURI !== HL_NAMESPACE)
            throw new Error("composition: property has the wrong namespace");
        for (let attribute = 0; attribute < element.attributes.length; attribute++) {
            const item = element.attributes.item(attribute);
            if (
                item.localName === "composition" &&
                item.namespaceURI !== HL_NAMESPACE &&
                item.namespaceURI !== "http://www.w3.org/2000/xmlns/"
            )
                throw new Error("composition: property has the wrong namespace");
        }
        if (element.hasAttributeNS(HL_NAMESPACE, "composition"))
            throw new Error("composition: use one JSON text element, not an attribute");
    }
    if (nodes.length === 0) return undefined;
    if (nodes.length !== 1) throw new Error("composition: duplicate XMP properties");
    const node = nodes.item(0);
    if (
        node.parentNode.namespaceURI !== RDF_NAMESPACE ||
        node.parentNode.localName !== "Description"
    )
        throw new Error("composition: property must belong to an RDF Description");
    for (let index = 0; index < node.attributes.length; index++)
        if (node.attributes.item(index).namespaceURI !== "http://www.w3.org/2000/xmlns/")
            throw new Error("composition: property accepts JSON text only");
    for (let child = node.firstChild; child; child = child.nextSibling)
        if (child.nodeType !== 3 && child.nodeType !== 4)
            throw new Error("composition: property accepts JSON text only");
    try {
        return validateComposition(JSON.parse(node.textContent));
    } catch (error) {
        throw new Error(`composition: invalid embedded recipe: ${error.message}`);
    }
}

/**
 * Select generation declarations with a forward namespace scan.
 * Selection tolerates unrelated malformed markup; validation reads the original packet.
 */
function hasGenerationDeclaration(packet, includeSource = false) {
    const namePattern = new RegExp(QName.source, "uy");
    const space = (at) => /\s/u.test(packet[at] ?? "");
    const skipSpace = (at) => {
        while (at < packet.length && space(at)) at++;
        return at;
    };
    const property = (name) => {
        const local = name.slice(name.lastIndexOf(":") + 1);
        return local === "ai" || (includeSource && local === "DigitalSourceType");
    };
    const frames = [];
    const heads = new Map();
    let namespace = "";
    let cursor = 0;
    while (cursor < packet.length) {
        const start = packet.indexOf("<", cursor);
        if (start < 0) break;
        cursor = start + 1;
        let skipped = false;
        for (const [open, close] of [
            ["<!--", "-->"],
            ["<![CDATA[", "]]>"],
            ["<?", "?>"],
        ]) {
            if (!packet.startsWith(open, start)) continue;
            const end = packet.indexOf(close, start + open.length);
            cursor = end < 0 ? packet.length : end + close.length;
            skipped = true;
            break;
        }
        if (skipped) continue;
        if (packet.startsWith("<!", start)) {
            let brackets = 0;
            let quote;
            while (cursor < packet.length) {
                if (!quote && packet.startsWith("<!--", cursor)) {
                    const end = packet.indexOf("-->", cursor + 4);
                    cursor = end < 0 ? packet.length : end + 3;
                    continue;
                }
                const char = packet[cursor++];
                if (quote) {
                    if (char === quote) quote = undefined;
                    continue;
                }
                if (char === '"' || char === "'") quote = char;
                else if (char === "[") brackets++;
                else if (char === "]") brackets = Math.max(0, brackets - 1);
                else if (char === ">" && brackets === 0) break;
            }
            continue;
        }
        const spaced = space(cursor);
        cursor = skipSpace(cursor);
        const closing = packet[cursor] === "/";
        if (closing) cursor = skipSpace(cursor + 1);
        namePattern.lastIndex = cursor;
        const element = namePattern.exec(packet);
        let name = element?.[0] ?? "";
        if (element) cursor = namePattern.lastIndex;
        if (!element || (cursor < packet.length && !/[\s=/>]/u.test(packet[cursor]))) {
            name = "";
            while (cursor < packet.length && !/[\s=<>/"']/u.test(packet[cursor])) cursor++;
        }
        const afterName = skipSpace(cursor);
        let tail = afterName;
        if (packet[tail] === "/") tail = skipSpace(tail + 1);
        const framed =
            afterName === packet.length || packet[afterName] === "=" || packet[tail] === ">";
        let localNamespace = namespace;
        let assigned = false;
        let declared = false;
        let completed = false;
        let selfClosing = false;
        while (cursor < packet.length) {
            cursor = skipSpace(cursor);
            if (packet[cursor] === "<" || cursor === packet.length) break;
            if (packet[cursor] === ">") {
                cursor++;
                completed = true;
                break;
            }
            if (packet[cursor] === "/") {
                const end = skipSpace(cursor + 1);
                if (packet[end] === ">") {
                    cursor = end + 1;
                    completed = true;
                    selfClosing = true;
                    break;
                }
                cursor++;
                continue;
            }
            if (packet[cursor] === '"' || packet[cursor] === "'") {
                const end = packet.indexOf(packet[cursor], cursor + 1);
                cursor = end < 0 ? packet.length : end + 1;
                continue;
            }
            namePattern.lastIndex = cursor;
            const attribute = namePattern.exec(packet);
            if (!attribute) {
                cursor++;
                continue;
            }
            cursor = namePattern.lastIndex;
            if (cursor < packet.length && !/[\s=/>"']/u.test(packet[cursor])) {
                while (cursor < packet.length && !/[\s=<>/"']/u.test(packet[cursor])) cursor++;
                continue;
            }
            const key = attribute[0];
            if (key.includes(":") && !key.startsWith("xmlns:") && property(key)) declared = true;
            cursor = skipSpace(cursor);
            if (packet[cursor] !== "=") continue;
            assigned = true;
            cursor = skipSpace(cursor + 1);
            const quote = packet[cursor];
            if (quote !== '"' && quote !== "'") {
                while (cursor < packet.length && !/[\s<>]/u.test(packet[cursor])) cursor++;
                continue;
            }
            const end = packet.indexOf(quote, cursor + 1);
            if (end < 0) {
                cursor = packet.length;
                break;
            }
            if (key === "xmlns") {
                localNamespace = packet
                    .slice(cursor + 1, end)
                    .replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (encoded, ref) => {
                        if (!ref.startsWith("#")) return unescapeXml(encoded);
                        const point =
                            ref[1] === "x" ?
                                parseInt(ref.slice(2), 16)
                            :   parseInt(ref.slice(1), 10);
                        return point >= 0 && point <= 0x10ffff ?
                                String.fromCodePoint(point)
                            :   encoded;
                    });
            }
            cursor = end + 1;
        }
        if (declared) return true;
        if (
            property(name) &&
            (name.includes(":") ||
                ((framed || assigned) &&
                    (!spaced ||
                        localNamespace === (name === "ai" ? HL_NAMESPACE : IPTC_NAMESPACE))))
        )
            return true;
        if (!completed || !name) continue;
        if (closing) {
            const head = heads.get(name);
            if (head === undefined) continue;
            while (frames.length > head) {
                const frame = frames.pop();
                namespace = frame.before;
                if (frame.previous === undefined) heads.delete(frame.name);
                else heads.set(frame.name, frame.previous);
            }
        } else if (!selfClosing) {
            const frame = { name, before: namespace, previous: heads.get(name) };
            heads.set(name, frames.length);
            frames.push(frame);
            namespace = localNamespace;
        }
    }
    return false;
}

/**
 * Parse managed scalar properties and count declarations before DOM normalization.
 * @param {string} packet - The original XMP packet.
 * @param {{namespace: string, local: string, key: string}[]} properties - Expanded names to count.
 * @returns {{document: object, invalid: boolean, duplicateAttribute: boolean, counts: Map<string, number>}}
 */
function managedPropertyDocument(packet, properties) {
    const keys = new Map(
        properties.map(({ namespace, local, key }) => [`${namespace}|${local}`, key]),
    );
    const counts = new Map(properties.map(({ key }) => [key, 0]));
    let invalid = false;
    let duplicateAttribute = false;
    let document;
    const count = (namespace, local) => {
        const key = keys.get(`${namespace}|${local}`);
        if (key !== undefined) counts.set(key, counts.get(key) + 1);
        return key !== undefined;
    };
    class ManagedPropertyHandler extends XmpDomHandler {
        startElement(namespaceURI, localName, qName, attrs) {
            const managed = count(namespaceURI, localName);
            const elementAttributes = new Set();
            for (let i = 0; i < attrs.length; i++) {
                if (managed && attrs.getURI(i) !== "http://www.w3.org/2000/xmlns/") {
                    const key = `${attrs.getURI(i) ?? ""}|${attrs.getLocalName(i)}`;
                    if (elementAttributes.has(key)) duplicateAttribute = true;
                    elementAttributes.add(key);
                }
                count(attrs.getURI(i), attrs.getLocalName(i));
            }
            super.startElement(namespaceURI, localName, qName, attrs);
        }
    }
    try {
        document = new DOMParser({
            domHandler: ManagedPropertyHandler,
            onError: () => {
                invalid = true;
            },
        }).parseFromString(packet, "application/xml");
    } catch {
        invalid = true;
    }
    return { document, invalid, duplicateAttribute, counts };
}

/**
 * Read text properties from RDF Description elements or their attributes.
 * @param {object} document - The validated XML document.
 * @param {object} options - Property identity and diagnostic messages.
 * @param {string} options.namespace - The property's namespace URI.
 * @param {string} options.local - The property's local name.
 * @param {string} options.parentMessage - Invalid attribute-owner diagnostic.
 * @param {string} options.shapeMessage - Invalid element-value diagnostic.
 * @param {string} [options.elementParentMessage] - Invalid element-parent diagnostic.
 * @param {boolean} [options.resource] - Whether an RDF resource attribute supplies the value.
 * @param {string} [options.conflictMessage] - Conflicting resource and text diagnostic.
 * @returns {string[]} Values in document order.
 */
function managedPropertyValues(
    document,
    {
        namespace,
        local,
        parentMessage,
        shapeMessage,
        elementParentMessage = shapeMessage,
        resource = false,
        conflictMessage,
    },
) {
    const values = [];
    const description = (node) =>
        node?.namespaceURI === RDF_NAMESPACE && node.localName === "Description";
    const matches = (node) => node.namespaceURI === namespace && node.localName === local;
    const elements = document.getElementsByTagName("*");
    for (let i = 0; i < elements.length; i++) {
        const node = elements.item(i);
        for (let j = 0; j < node.attributes.length; j++) {
            const attr = node.attributes.item(j);
            if (!matches(attr)) continue;
            if (!description(node)) throw new Error(parentMessage);
            values.push(attr.value);
        }
        if (!matches(node)) continue;
        if (!description(node.parentNode)) throw new Error(elementParentMessage);
        for (let child = node.firstChild; child; child = child.nextSibling)
            if (child.nodeType !== 3 && child.nodeType !== 4) throw new Error(shapeMessage);
        let reference;
        for (let j = 0; j < node.attributes.length; j++) {
            const attr = node.attributes.item(j);
            if (attr.namespaceURI === "http://www.w3.org/2000/xmlns/") continue;
            if (
                resource &&
                attr.namespaceURI === RDF_NAMESPACE &&
                attr.localName === "resource" &&
                reference === undefined
            )
                reference = attr.value;
            else throw new Error(shapeMessage);
        }
        if (reference !== undefined && node.textContent.trim() !== "")
            throw new Error(conflictMessage);
        values.push(reference ?? node.textContent);
    }
    return values;
}

/** Read generation facts by expanded XMP property name. */
function readGeneration(packet, includeSource = false) {
    if (!hasGenerationDeclaration(packet, includeSource)) return undefined;
    const { document, invalid, duplicateAttribute, counts } = managedPropertyDocument(packet, [
        { namespace: HL_NAMESPACE, local: "ai", key: "ai" },
        { namespace: IPTC_NAMESPACE, local: "DigitalSourceType", key: "digitalSourceType" },
    ]);
    if (invalid) throw new Error("generation metadata: malformed XMP");
    if (!includeSource && counts.get("ai") === 0) return undefined;
    if (duplicateAttribute) throw new Error("generation metadata: duplicate XMP attributes");
    for (const [key, count] of counts)
        if (count > 1) throw new Error(`${key}: duplicate XMP properties`);
    const parentMessage = "generation metadata: property must belong to an RDF Description";
    const values = managedPropertyValues(document, {
        namespace: HL_NAMESPACE,
        local: "ai",
        parentMessage,
        shapeMessage: "ai: expected a boolean XMP property",
    });
    const sources = managedPropertyValues(document, {
        namespace: IPTC_NAMESPACE,
        local: "DigitalSourceType",
        parentMessage,
        shapeMessage: "digitalSourceType: invalid XMP property",
        resource: true,
        conflictMessage: "digitalSourceType: conflicting XMP values",
    });
    if (values.length > 1) throw new Error("ai: duplicate XMP properties");
    if (sources.length > 1) throw new Error("digitalSourceType: duplicate XMP properties");
    if (values.length && !["True", "False", "true", "false"].includes(values[0]))
        throw new Error("ai: expected a boolean XMP value");
    if (sources.length && !/^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(sources[0]))
        throw new Error("digitalSourceType: expected a URI");
    if (!values.length && !sources.length) return undefined;
    return {
        ai: values.length ? values[0].toLowerCase() === "true" : undefined,
        source: sources[0],
    };
}

/** Read the alternative by expanded name, retaining inherited namespace bindings. */
function readNonAiAlternative(packet) {
    if (!packet.includes("nonAiAlternative")) return undefined;
    const { document, invalid, counts } = managedPropertyDocument(packet, [
        { namespace: HL_NAMESPACE, local: "nonAiAlternative", key: "nonAiAlternative" },
    ]);
    const count = counts.get("nonAiAlternative");
    // Prose, comments and foreign properties do not declare this field.
    if (count === 0) return undefined;
    if (invalid) throw new Error("nonAiAlternative: malformed XMP");
    if (count !== 1) throw new Error("nonAiAlternative: duplicate XMP properties");
    const parentMessage = "nonAiAlternative: property must belong to an RDF Description";
    return managedPropertyValues(document, {
        namespace: HL_NAMESPACE,
        local: "nonAiAlternative",
        parentMessage,
        elementParentMessage: parentMessage,
        shapeMessage: "nonAiAlternative: expected an Address text property",
    })[0];
}

/** Validate a declared alternative without resolving its target. */
function validateNonAiAlternative(record) {
    const value = record.nonAiAlternative;
    if (value === undefined) return;
    const tuple = readCanonicalKey(value);
    if (
        typeof value !== "string" ||
        !COMPLETE_ADDRESS.test(value) ||
        tuple.system !== "none" ||
        !["image", "icon"].includes(tuple.type)
    )
        throw new Error(
            `nonAiAlternative ${JSON.stringify(value)} must be a complete ` +
                "<package>-none-image-<shortcode> or <package>-none-icon-<shortcode> Address",
        );
}

/**
 * The AI classification supported by explicit metadata or a recognized source type.
 * @param {ProvenanceRecord} record Embedded provenance.
 * @returns {boolean|null} Unknown status remains null.
 */
export function provenanceAi(record) {
    return record.ai ?? sourceAi(record.digitalSourceType);
}

/** Classify only source types whose meaning states AI status. */
function sourceAi(source) {
    if (
        source === DIGITAL_SOURCE_TOKENS.trainedAlgorithmicMedia ||
        source === DIGITAL_SOURCE_TOKENS.compositeWithTrainedAlgorithmicMedia
    )
        return true;
    return source === DIGITAL_SOURCE_TOKENS.digitalCreation ? false : null;
}

/** The author remedy shared by collection and provenance auditing. */
export const MISSING_ALTERNATIVE =
    "hl:nonAiAlternative is missing on an AI master; declare hl:nonAiAlternative with the Address of a non-AI image or icon licensed to ship in Foundry";

/** Refuse explicit status that conflicts with a recognized source type. */
function validateAiClassification(record) {
    if (record.ai !== undefined && typeof record.ai !== "boolean")
        throw new Error("ai must be a boolean");
    const classified = sourceAi(record.digitalSourceType);
    if (record.ai !== undefined && classified !== null && record.ai !== classified)
        throw new Error("ai conflicts with digitalSourceType");
}

/**
 * Read the record stored in an XMP packet. Ordinary properties use namespace
 * bindings while retaining raw text and RDF list values. Composition parsing
 * imposes XML validity only when a composition declaration is present, then checks its
 * namespace, structure, and recipe. Unframed prose such as `a <b composition c`
 * does not declare the property; `a <b composition>` is a framed attribute
 * attempt and selects composition validation.
 *
 * @param {string} packet - The XMP text.
 * @returns {ProvenanceRecord} The fields the packet holds; fields it lacks are
 *   absent.
 */
export function readXmpRecord(packet) {
    const record = readManagedProperties(packet);
    const ai = readGeneration(packet);
    if (ai !== undefined) {
        if (ai.ai !== undefined) {
            record.ai = ai.ai;
            if (ai.source === undefined) delete record.digitalSourceType;
            else record.digitalSourceType = ai.source;
        }
    }
    const alternative = readNonAiAlternative(packet);
    if (alternative !== undefined) record.nonAiAlternative = alternative;
    validateAiClassification(record);
    validateNonAiAlternative(record);
    const composition = readComposition(packet);
    if (composition !== undefined) record.composition = composition;
    return record;
}

/**
 * Read the record stored in the standard text chunks.
 *
 * @param {PngChunk[]} chunks - The file's chunks.
 * @returns {ProvenanceRecord} The fields the chunks hold.
 */
export function readStandardRecord(chunks) {
    const byKeyword = new Map();
    for (const chunk of chunks) {
        const entry = readTextChunk(chunk);
        if (entry && !byKeyword.has(entry.keyword)) byKeyword.set(entry.keyword, entry.text);
    }
    const record = {};
    for (const [field, keyword] of Object.entries(STANDARD_KEYWORDS)) {
        if (byKeyword.has(keyword))
            record[field] = field === "creator" ? [byKeyword.get(keyword)] : byKeyword.get(keyword);
    }
    return record;
}

/** Whether a chunk is an XMP packet. */
function isXmpChunk(chunk) {
    return readTextChunk(chunk)?.keyword === XMP_KEYWORD;
}

/**
 * Read a file's provenance.
 *
 * @param {Buffer} bytes - The PNG.
 * @returns {{xmp: ProvenanceRecord, standard: ProvenanceRecord, packet: string|null,
 *   record: ProvenanceRecord}} What the XMP packet holds, what the standard
 *   chunks hold, the packet text, and the two combined with the XMP packet
 *   winning.
 * @throws {Error} When the file is not a readable PNG.
 */
export function readProvenance(bytes) {
    const chunks = readChunks(bytes);
    const xmpChunks = chunks.filter(isXmpChunk);
    if (
        xmpChunks.length > 1 &&
        xmpChunks.some((chunk) => readGeneration(readTextChunk(chunk).text)?.ai !== undefined)
    )
        throw new Error("ai: multiple XMP packets cannot carry an unambiguous declaration");
    const xmpChunk = xmpChunks[0];
    const packet = xmpChunk ? readTextChunk(xmpChunk).text : null;
    const xmp = packet === null ? {} : readXmpRecord(packet);
    const standard = readStandardRecord(chunks);
    return { xmp, standard, packet, record: withIdentifier({ ...standard, ...xmp }) };
}

/**
 * Fill in whichever of `address` and `identifier` a record lacks from the other.
 * Both present is left as it is, so a disagreement stays visible.
 */
function withIdentifier(record) {
    const out = { ...record };
    if (out.address === undefined && out.identifier !== undefined) out.address = out.identifier;
    if (out.identifier === undefined && out.address !== undefined) out.identifier = out.address;
    return out;
}

/** Validate the fields of a merged record. */
function validateRecord(record) {
    if (!record.address) throw new Error("a provenance record needs an address");
    if (!COMPLETE_ADDRESS.test(record.address)) {
        throw new Error(
            `address ${JSON.stringify(record.address)} is not a complete ` +
                "<package>-<system>-<type>-<shortcode> Address",
        );
    }
    if (record.primaryNote !== undefined && !COMPLETE_ADDRESS.test(record.primaryNote)) {
        throw new Error(
            `primaryNote ${JSON.stringify(record.primaryNote)} is not a complete ` +
                "<package>-<system>-<type>-<shortcode> Address",
        );
    }
    if (record.derived !== undefined && record.derived !== "true") {
        throw new Error(`derived must be "true" or absent, not ${JSON.stringify(record.derived)}`);
    }
    if (record.generator !== undefined) {
        let parsed;
        try {
            parsed = JSON.parse(record.generator);
        } catch {
            parsed = null;
        }
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("generator must be a JSON object written as a string");
        }
    }
    if (
        record.creator !== undefined &&
        (!Array.isArray(record.creator) ||
            record.creator.length === 0 ||
            record.creator.some((entry) => typeof entry !== "string" || entry.length === 0))
    )
        throw new Error("creator must be a non-empty list of non-empty strings");
    if (record.formerNames !== undefined) {
        const names = record.formerNames;
        if (
            !Array.isArray(names) ||
            names.length === 0 ||
            names.some((name) => typeof name !== "string" || name === "") ||
            new Set(names).size !== names.length
        ) {
            throw new Error("formerNames must be a non-empty list of distinct non-empty strings");
        }
    }
    if (record.composition !== undefined) {
        validateComposition(record.composition);
        if (record.derived !== undefined)
            throw new Error("composition is private and never repeated on a derivative");
    }
    validateAiClassification(record);
    validateNonAiAlternative(record);
    for (const field of FIELDS) {
        if (field === "composition" || field === "ai" || field === "creator") continue;
        const value = record[field];
        if (value !== undefined && (typeof value !== "string" || value === "")) {
            throw new Error(`${field} must be a non-empty string`);
        }
    }
    if (
        record.digitalSourceType !== undefined &&
        !/^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(record.digitalSourceType)
    ) {
        throw new Error(
            `digitalSourceType must be a full URI or one of ${Object.keys(DIGITAL_SOURCE_TOKENS).join(", ")}`,
        );
    }
}

/**
 * Merge supplied fields over an existing record.
 *
 * `undefined` keeps a field, `null` removes it, `formerNames` appends, and
 * `digitalSourceType` expands a token to its URI, with `none` removing it.
 */
function mergeRecord(existing, fields) {
    const record = withIdentifier(existing);
    for (const field of FIELDS) {
        if (field === "digitalSourceType" || fields[field] === undefined) continue;
        if (fields[field] === null) delete record[field];
        else record[field] = field === "derived" && fields[field] === true ? "true" : fields[field];
    }
    const dst = fields.digitalSourceType;
    if (dst === null || dst === "none") {
        delete record.digitalSourceType;
    } else if (dst !== undefined) {
        record.digitalSourceType =
            typeof dst === "string" ? (DIGITAL_SOURCE_TOKENS[dst] ?? dst) : dst;
    }
    if (Array.isArray(fields.formerNames)) {
        const merged = [...(existing.formerNames ?? [])];
        for (const name of fields.formerNames) if (!merged.includes(name)) merged.push(name);
        record.formerNames = merged;
    } else if (fields.formerNames === null) {
        delete record.formerNames;
    }
    if (record.address === undefined) delete record.identifier;
    else record.identifier = record.address;
    return record;
}

/**
 * The XMP packet for a record, keeping what another tool's packet holds.
 *
 * @param {string|null} existing - The packet already in the file, or `null`.
 * @param {ProvenanceRecord} record - The record to write.
 * @param {object} [fields] - Explicit field edits; undefined preserves complete credit lists.
 * @returns {{text: string, foreignXmp: "none"|"kept"|"discarded", foreignXmpReason?: string}}
 */
function buildPacket(existing, record, fields = {}) {
    let foreign = "";
    let foreignXmp = "none";
    let foreignReason;
    let declarations = "";
    const creditLists = new Map();
    if (existing !== null) {
        const unchangedCredits = new Set(
            ["creator", "rights"].filter((field) => fields[field] === undefined),
        );
        const kept = retainForeign(existing, unchangedCredits, creditLists);
        if (kept.kept) {
            foreign = kept.markup;
            declarations = kept.declarations;
            foreignXmp = "kept";
        } else if (!kept.empty) {
            const unsafeCredits = new Set();
            const counts = new Map();
            readManagedProperties(existing, unsafeCredits, counts);
            assertUnambiguousCredits(counts, unchangedCredits);
            for (const field of unsafeCredits)
                if (unchangedCredits.has(field))
                    throw new Error(
                        `${field}: cannot preserve the complete credit property: ${kept.reason}`,
                    );
            creditLists.clear();
            foreignXmp = "discarded";
            foreignReason = kept.reason;
        }
    }
    return {
        text:
            packetHead(declarations) +
            descriptionBlock(record, "\n", creditLists) +
            foreign +
            PACKET_TAIL,
        foreignXmp,
        ...(foreignReason === undefined ? {} : { foreignXmpReason: foreignReason }),
    };
}

/** Serialize a fresh managed XMP packet. */
export function provenancePacket(record) {
    validateRecord(record);
    return buildPacket(null, record).text;
}

/** Read the standard XMP APP1 segment of a JPEG. */
export function readJpegProvenance(input) {
    const bytes = Buffer.from(input);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("not a JPEG");
    const prefix = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "ascii");
    let packet = null;
    let foreignMetadata = false;
    let at = 2;
    while (at < bytes.length) {
        if (bytes[at++] !== 0xff) throw new Error("invalid JPEG marker");
        while (bytes[at] === 0xff) at++;
        const marker = bytes[at++];
        if (marker === 0xd9) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (at + 2 > bytes.length) throw new Error("truncated JPEG segment");
        const length = bytes.readUInt16BE(at);
        if (length < 2 || at + length > bytes.length)
            throw new Error("invalid JPEG segment length");
        const data = bytes.subarray(at + 2, at + length);
        if (marker === 0xe1 && data.subarray(0, prefix.length).equals(prefix)) {
            if (packet !== null) throw new Error("multiple JPEG XMP packets");
            packet = data.subarray(prefix.length).toString("utf8");
        } else if (marker === 0xe1 || marker === 0xed || marker === 0xfe) foreignMetadata = true;
        at += length;
        if (marker === 0xda) {
            // Entropy data escapes FF as FF00; restart markers remain inside the scan.
            while (at < bytes.length) {
                if (bytes[at] !== 0xff) {
                    at++;
                    continue;
                }
                let next = at + 1;
                while (bytes[next] === 0xff) next++;
                if (bytes[next] === 0x00 || (bytes[next] >= 0xd0 && bytes[next] <= 0xd7)) {
                    at = next + 1;
                    continue;
                }
                break;
            }
        }
    }
    const xmp = packet === null ? {} : readXmpRecord(packet);
    return { xmp, standard: {}, packet, record: withIdentifier(xmp), foreignMetadata };
}

/**
 * Fill a record's `name` and `primaryNote` from the content index.
 *
 * An image whose primary note is a being or an affiliation takes that note's
 * `name.full` (when it has one) and Address. Any other image keeps whatever the record already
 * holds.
 *
 * @param {ProvenanceRecord} record - The merged record, changed in place.
 * @param {object} index - From {@link module:engine/art-primary-note.buildPrimaryNoteIndex}.
 * @returns {import("./art-primary-note.mjs").PrimaryNoteResult|undefined} What
 *   the resolver answered; `undefined` when the record has no address to ask about.
 */
function applyPrimaryNote(record, index) {
    if (record.address === undefined) return undefined;
    const primary = resolvePrimaryNote(index, record.address);
    if (primary.note) {
        if (primary.note.name !== "") record.name = primary.note.name;
        record.primaryNote = primary.note.address;
    }
    return primary;
}

/**
 * Write provenance into a PNG, merging with what the file already carries.
 *
 * Fields that are `undefined` in `fields` keep the file's value, and fields that
 * are `null` are removed. See the module description for the chunks that are
 * touched and the policy for an existing XMP packet.
 *
 * @param {Buffer} bytes - The PNG.
 * @param {ProvenanceRecord|Record<string, string|string[]|null|undefined>} fields - The
 *   fields to set. `digitalSourceType` also accepts the token `none`.
 * @param {{index?: object}} [options] - With `index` (from
 *   {@link module:engine/art-primary-note.buildPrimaryNoteIndex}), an image whose
 *   primary note is a being or an affiliation takes `name` and `primaryNote`
 *   from that note, whatever `fields` says. Every other image keeps the values
 *   it carries and the values `fields` supplies.
 * @returns {{bytes: Buffer, record: ProvenanceRecord, foreignXmp: "none"|"kept"|"discarded",
 *   changed: boolean, primary?: import("./art-primary-note.mjs").PrimaryNoteResult}} The new file, the record it carries, what became of
 *   another tool's XMP packet (`none` when the file held none, `kept` when its
 *   foreign properties or comments inside `rdf:RDF` were retained, `discarded`
 *   when it could not be retained
 *   safely, with `foreignXmpReason` saying why), and whether any byte differs
 *   from the input; with `index`, `primary` is what the resolver answered, so a
 *   caller can report an image with several notes.
 * @throws {Error} When the file is not a PNG, the merged record has no valid
 *   address or an invalid field, or a value holds a character XML cannot carry.
 */
export function writeProvenance(bytes, fields, options = {}) {
    const chunks = readChunks(bytes);
    const existing = readProvenance(bytes).record;
    const record = mergeRecord(existing, fields);
    const primary = options.index ? applyPrimaryNote(record, options.index) : undefined;
    if (
        fields.digitalSourceType === undefined &&
        fields.ai === undefined &&
        existing.address === undefined
    ) {
        record.digitalSourceType ??= DIGITAL_SOURCE_TRAINED_ALGORITHMIC;
    }
    validateRecord(record);

    const xmpChunks = chunks.filter(isXmpChunk);
    const built = buildPacket(
        xmpChunks.length ? readTextChunk(xmpChunks[0]).text : null,
        record,
        fields,
    );
    const { foreignXmp, foreignXmpReason: foreignReason } = built;
    const packetText = built.text;
    const xmpOut = makeTextChunk(XMP_KEYWORD, packetText);

    const standardOut = new Map();
    for (const [field, keyword] of Object.entries(STANDARD_KEYWORDS)) {
        if (record[field] !== undefined)
            standardOut.set(
                keyword,
                makeTextChunk(
                    keyword,
                    field === "creator" ? record.creator.join(", ") : record[field],
                ),
            );
    }

    const out = [];
    let wroteXmp = false;
    const placed = new Set();
    const firstData = chunks.findIndex((chunk) => chunk.type === "IDAT");
    const beforeData = firstData < 0 ? chunks.length - 1 : firstData;
    const pending = () => {
        const list = [];
        if (!wroteXmp) {
            list.push(xmpOut);
            wroteXmp = true;
        }
        for (const [keyword, chunk] of standardOut) {
            if (!placed.has(keyword)) {
                list.push(chunk);
                placed.add(keyword);
            }
        }
        return list;
    };
    chunks.forEach((chunk, index) => {
        const entry = readTextChunk(chunk);
        if (entry?.keyword === XMP_KEYWORD) {
            if (!wroteXmp) {
                out.push(xmpOut);
                wroteXmp = true;
            }
            return;
        }
        if (entry && Object.values(STANDARD_KEYWORDS).includes(entry.keyword)) {
            if (standardOut.has(entry.keyword) && !placed.has(entry.keyword)) {
                out.push(standardOut.get(entry.keyword));
                placed.add(entry.keyword);
            }
            return;
        }
        if (index === beforeData) out.push(...pending());
        out.push(chunk);
    });
    const result = Buffer.concat([SIGNATURE, ...out.map((chunk) => chunk.raw)]);
    return {
        bytes: result,
        record,
        ...(primary ? { primary } : {}),
        foreignXmp,
        ...(foreignReason === undefined ? {} : { foreignXmpReason: foreignReason }),
        changed: !result.equals(bytes),
    };
}

/** Decode SVG bytes or text; the BOM, if any, stays in the text. */
function decodeSvg(input) {
    if (typeof input === "string") return input;
    if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
        throw new Error("an SVG is given as text or bytes");
    }
    try {
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
    } catch {
        throw new Error("the SVG is not valid UTF-8");
    }
}

/**
 * Tokenize the markup of an SVG into elements.
 *
 * Comments, processing instructions, CDATA sections and the DOCTYPE (with its
 * internal subset) are skipped. Each element records where its start tag and
 * end tag lie and how deep it sits; the root has depth 0.
 */
function scanSvg(text) {
    const elements = [];
    const stack = [];
    const fail = (what) => new Error(`the SVG is not well formed: ${what}`);
    const skipTo = (from, terminator, what) => {
        const at = text.indexOf(terminator, from);
        if (at < 0) throw fail(`unterminated ${what}`);
        return at + terminator.length;
    };
    let i = 0;
    while (i < text.length) {
        const lt = text.indexOf("<", i);
        if (lt < 0) break;
        if (text.startsWith("<!--", lt)) {
            i = skipTo(lt + 4, "-->", "comment");
        } else if (text.startsWith("<![CDATA[", lt)) {
            i = skipTo(lt + 9, "]]>", "CDATA section");
        } else if (text.startsWith("<?", lt)) {
            i = skipTo(lt + 2, "?>", "processing instruction");
        } else if (text.startsWith("<!", lt)) {
            let depth = 0;
            let quote = null;
            let j = lt + 2;
            for (; j < text.length; j++) {
                const c = text[j];
                if (quote) {
                    if (c === quote) quote = null;
                } else if (text.startsWith("<!--", j)) {
                    j = skipTo(j + 4, "-->", "comment") - 1;
                } else if (c === '"' || c === "'") {
                    quote = c;
                } else if (c === "[") {
                    depth++;
                } else if (c === "]") {
                    depth--;
                } else if (c === ">" && depth <= 0) {
                    break;
                }
            }
            if (j >= text.length) throw fail("unterminated declaration");
            i = j + 1;
        } else if (text[lt + 1] === "/") {
            const match = /^<\/([^\s>]+)\s*>/.exec(text.slice(lt, lt + 512));
            if (!match) throw fail("malformed end tag");
            const open = stack.pop();
            if (!open || open.name !== match[1]) {
                throw fail(
                    `</${match[1]}> does not close ${open ? `<${open.name}>` : "an element"}`,
                );
            }
            open.closeStart = lt;
            open.closeEnd = lt + match[0].length;
            i = open.closeEnd;
        } else {
            const nameMatch = /^<([^\s/>]+)/.exec(text.slice(lt, lt + 512));
            if (!nameMatch) throw fail("malformed start tag");
            let j = lt + nameMatch[0].length;
            let quote = null;
            for (; j < text.length; j++) {
                const c = text[j];
                if (quote) {
                    if (c === quote) quote = null;
                } else if (c === '"' || c === "'") {
                    quote = c;
                } else if (c === ">") {
                    break;
                }
            }
            if (j >= text.length) throw fail(`unterminated <${nameMatch[1]}> tag`);
            const attrText = text.slice(lt + nameMatch[0].length, j);
            const attrs = {};
            for (const m of attrText.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
                attrs[m[1]] ??= m[2] ?? m[3];
            }
            const element = {
                name: nameMatch[1],
                start: lt,
                end: j + 1,
                attrs,
                selfClosing: text[j - 1] === "/",
                depth: stack.length,
            };
            if (stack.length === 0 && elements.length > 0) throw fail("more than one root element");
            elements.push(element);
            if (!element.selfClosing) stack.push(element);
            i = j + 1;
        }
    }
    if (stack.length) throw fail(`<${stack.at(-1).name}> is never closed`);
    return elements;
}

/** Locate the root and the managed element of an SVG. */
function locateSvg(text) {
    const elements = scanSvg(text);
    const root = elements[0];
    if (!root) throw new Error("the SVG has no root element");
    if (root.name.includes(":")) {
        throw new Error(
            `the root element <${root.name}> has a prefixed name; only an unprefixed <svg> root is supported`,
        );
    }
    if (root.name !== "svg") throw new Error(`the root element is <${root.name}>, not <svg>`);
    const owners = elements.filter((element) => element.attrs.id === SVG_METADATA_ID);
    if (owners.length > 1) {
        throw new Error(`the SVG holds ${owners.length} elements with id="${SVG_METADATA_ID}"`);
    }
    if (owners[0] && owners[0].name !== "metadata") {
        throw new Error(`id="${SVG_METADATA_ID}" is on <${owners[0].name}>, not on <metadata>`);
    }
    return { elements, root, managed: owners[0] ?? null };
}

/** The line ending the file uses, from its first line break. */
function lineEnding(text) {
    return /\r\n|\n|\r/.exec(text)?.[0] ?? "\n";
}

/**
 * Read an SVG's provenance.
 *
 * @param {Buffer|Uint8Array|string} input - The SVG.
 * @returns {{xmp: ProvenanceRecord, standard: ProvenanceRecord, packet: string|null,
 *   record: ProvenanceRecord}} The record in the managed element (`standard`
 *   is always empty), the element's inner XML or `null` when the file has none,
 *   and the record again as `record`.
 * @throws {Error} When the text is not valid UTF-8, has no `<svg>` root, has a
 *   prefixed root, or holds more than one managed element.
 */
export function readSvgProvenance(input) {
    const text = decodeSvg(input);
    const { managed } = locateSvg(text);
    if (!managed || managed.selfClosing) return { xmp: {}, standard: {}, packet: null, record: {} };
    const packet = text.slice(managed.end, managed.closeStart);
    const xmp = readXmpRecord(packet);
    return { xmp, standard: {}, packet, record: withIdentifier(xmp) };
}

/** The managed `<metadata>` element holding a record. */
function svgMetadataElement(record, eol, existing, fields) {
    const built = buildPacket(existing, record, fields);
    const packet = built.text.slice(built.text.indexOf("\n") + 1, built.text.lastIndexOf("\n"));
    return {
        ...built,
        element: `<metadata id="${SVG_METADATA_ID}">${eol}${packet.replaceAll("\n", eol)}${eol}</metadata>`,
    };
}

/**
 * Write provenance into an SVG, merging with what the file already carries.
 *
 * The merge rules are those of {@link writeProvenance}, except that no
 * `digitalSourceType` is supplied by default. The file is edited as text: the
 * managed `<metadata id="hl-provenance">` element is replaced where it stands,
 * or inserted as the first child of the root after any leading `<title>` and
 * `<desc>` elements, and every other byte is unchanged. A self-closing root is
 * rewritten as an open and close pair.
 *
 * @param {Buffer|Uint8Array|string} input - The SVG.
 * @param {ProvenanceRecord|Record<string, string|string[]|null|undefined>} fields - The
 *   fields to set.
 * @param {{index?: object}} [options] - As for {@link writeProvenance}.
 * @returns {{text: string, bytes: Buffer, record: ProvenanceRecord, changed: boolean,
 *   foreignXmp: "none"|"kept"|"discarded", foreignXmpReason?: string,
 *   primary?: import("./art-primary-note.mjs").PrimaryNoteResult}}
 *   The new file as text and UTF-8 bytes, its record, the managed packet's
 *   foreign XMP status and optional reason, whether the text differs from the
 *   input, and with `index` what the resolver answered.
 * @throws {Error} When the SVG is refused (see {@link readSvgProvenance}), the
 *   merged record has no valid address or an invalid field, or a value holds a
 *   character XML cannot carry.
 */
export function writeSvgProvenance(input, fields, options = {}) {
    const text = decodeSvg(input);
    const { elements, root, managed } = locateSvg(text);
    const packet =
        managed && !managed.selfClosing ? text.slice(managed.end, managed.closeStart) : null;
    const existing = packet === null ? {} : readXmpRecord(packet);
    const record = mergeRecord(existing, fields);
    const primary = options.index ? applyPrimaryNote(record, options.index) : undefined;
    validateRecord(record);
    const { element, foreignXmp, foreignXmpReason } = svgMetadataElement(
        record,
        lineEnding(text),
        packet,
        fields,
    );

    let out;
    if (managed) {
        const stop = managed.selfClosing ? managed.end : managed.closeEnd;
        out = text.slice(0, managed.start) + element + text.slice(stop);
    } else {
        const children = elements.filter((child) => child.depth === 1);
        const next = children.find((child) => child.name !== "title" && child.name !== "desc");
        const leading = next ? children.slice(0, children.indexOf(next)) : children;
        let at = root.end;
        if (next) at = next.start;
        else if (leading.length) at = leading.at(-1).closeEnd ?? leading.at(-1).end;
        out =
            root.selfClosing ?
                `${text.slice(0, root.end - 2)}>${element}</svg>${text.slice(root.end)}`
            :   text.slice(0, at) + element + text.slice(at);
    }
    return {
        text: out,
        bytes: Buffer.from(out, "utf8"),
        record,
        foreignXmp,
        ...(foreignXmpReason === undefined ? {} : { foreignXmpReason }),
        ...(primary ? { primary } : {}),
        changed: out !== text,
    };
}

/** The size of a WebP chunk's header: four type bytes and a four-byte length. */
const WEBP_HEADER = 8;

/** The `VP8X` flag that says an `XMP ` chunk follows the image data. */
const WEBP_XMP_FLAG = 0x04;

/** The `VP8X` flag for EXIF metadata. */
const WEBP_EXIF_FLAG = 0x08;

/** The `VP8X` flag that says the image has an alpha channel. */
const WEBP_ALPHA_FLAG = 0x10;

/** Whether bytes are a WebP RIFF container, by signature. */
function isWebp(input) {
    return (
        typeof input !== "string" &&
        input.length >= 12 &&
        Buffer.from(input.subarray(0, 4)).toString("latin1") === "RIFF" &&
        Buffer.from(input.subarray(8, 12)).toString("latin1") === "WEBP"
    );
}

/**
 * Split a WebP into its chunks.
 *
 * @param {Buffer} bytes - The file.
 * @returns {{chunks: {type: string, data: Buffer, raw: Buffer}[], trailing: Buffer}}
 *   The chunks in file order, each `raw` holding its header, payload and pad
 *   byte, and any bytes after the RIFF container.
 * @throws {Error} When the file is not a WebP or a chunk length runs past the
 *   container.
 */
export function readWebpChunks(bytes) {
    if (!isWebp(bytes)) throw new Error("not a WebP: the RIFF/WEBP signature is missing");
    const end = bytes.readUInt32LE(4) + WEBP_HEADER;
    if (end > bytes.length || end < 12) throw new Error("the WebP RIFF size is wrong");
    const chunks = [];
    let at = 12;
    while (at < end) {
        if (at + WEBP_HEADER > end) throw new Error("a WebP chunk header is truncated");
        const type = bytes.toString("latin1", at, at + 4);
        const length = bytes.readUInt32LE(at + 4);
        const dataEnd = at + WEBP_HEADER + length;
        if (dataEnd > end) throw new Error(`WebP chunk ${JSON.stringify(type)} runs past the file`);
        const padded = length % 2 === 1 && dataEnd < end ? dataEnd + 1 : dataEnd;
        const body = bytes.subarray(at, padded);
        const raw =
            length % 2 === 1 && padded === dataEnd ? Buffer.concat([body, Buffer.alloc(1)]) : body;
        chunks.push({ type, data: bytes.subarray(at + WEBP_HEADER, dataEnd), raw });
        at = padded;
    }
    return { chunks, trailing: bytes.subarray(end) };
}

/** Build a WebP chunk, padded to an even length. */
function makeWebpChunk(type, data) {
    const header = Buffer.alloc(WEBP_HEADER);
    header.write(type, 0, "latin1");
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
}

/** The XMP packet in a WebP's chunks, or `null`. */
function webpPacket(chunks) {
    const packets = chunks
        .filter((entry) => entry.type === "XMP ")
        .map((entry) => entry.data.toString("utf8"));
    const firstAi = packets.length > 0 && readGeneration(packets[0])?.ai !== undefined;
    for (const packet of packets.slice(1)) {
        if (readGeneration(packet, firstAi) !== undefined)
            throw new Error("generation metadata: ambiguous WebP XMP packets");
    }
    return packets[0] ?? null;
}

/**
 * Read a WebP's provenance from its `XMP ` chunk.
 *
 * @param {Buffer|Uint8Array} bytes - The WebP.
 * @returns {{xmp: ProvenanceRecord, standard: ProvenanceRecord, packet: string|null,
 *   record: ProvenanceRecord}} As {@link readSvgProvenance}: `standard` is always empty.
 * @throws {Error} When the file is not a readable WebP.
 */
export function readWebpProvenance(bytes) {
    const packet = webpPacket(readWebpChunks(Buffer.from(bytes)).chunks);
    const xmp = packet === null ? {} : readXmpRecord(packet);
    return { xmp, standard: {}, packet, record: withIdentifier(xmp) };
}

/** The `VP8X` chunk a plain WebP needs before it can carry metadata. */
function extendedHeader(image) {
    let width;
    let height;
    let flags = WEBP_XMP_FLAG;
    if (image.type === "VP8 " && image.data.length >= 10) {
        width = image.data.readUInt16LE(6) & 0x3fff;
        height = image.data.readUInt16LE(8) & 0x3fff;
    } else if (image.type === "VP8L" && image.data.length >= 5) {
        const bits = image.data.readUInt32LE(1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
        if ((bits >>> 28) & 1) flags |= WEBP_ALPHA_FLAG;
    } else {
        throw new Error("a WebP with no VP8X header must start with a VP8 or VP8L image chunk");
    }
    const data = Buffer.alloc(10);
    data[0] = flags;
    data.writeUIntLE(width - 1, 4, 3);
    data.writeUIntLE(height - 1, 7, 3);
    return makeWebpChunk("VP8X", data);
}

/**
 * Write provenance into a WebP, merging with what the file already carries.
 *
 * The record lives in the one `XMP ` chunk, with the same packet, merge rules
 * and handling of another tool's packet as {@link writeProvenance}, and no
 * default `digitalSourceType`. A plain lossy or lossless file gains a `VP8X`
 * header with the XMP flag set and its canvas size taken from the bitstream; a
 * file that has one keeps it with the flag set. The `XMP ` chunk is replaced in
 * place or appended after the last chunk, further `XMP ` chunks are removed,
 * and the RIFF size is rewritten. Every other chunk, image data and animation
 * frames included, is copied byte for byte.
 *
 * @param {Buffer|Uint8Array} input - The WebP.
 * @param {ProvenanceRecord|Record<string, string|string[]|null|undefined>} fields - The
 *   fields to set.
 * @param {{index?: object}} [options] - As for {@link writeProvenance}.
 * @returns {{bytes: Buffer, record: ProvenanceRecord, changed: boolean,
 *   foreignXmp: "none"|"kept"|"discarded",
 *   primary?: import("./art-primary-note.mjs").PrimaryNoteResult}} The new file,
 *   the record it carries, whether any byte differs, and what became of another
 *   tool's packet.
 * @throws {Error} When the file is not a readable WebP, the merged record has
 *   no valid address or an invalid field, or a value holds a character XML cannot carry.
 */
export function writeWebpProvenance(input, fields, options = {}) {
    const bytes = Buffer.from(input);
    const { chunks, trailing } = readWebpChunks(bytes);
    const existingPacket = webpPacket(chunks);
    const existing = existingPacket === null ? {} : withIdentifier(readXmpRecord(existingPacket));
    const record = mergeRecord(existing, fields);
    const primary = options.index ? applyPrimaryNote(record, options.index) : undefined;
    validateRecord(record);
    const built = buildPacket(existingPacket, record, fields);
    const xmpOut = makeWebpChunk("XMP ", Buffer.from(built.text, "utf8"));

    const body = [];
    if (chunks[0]?.type === "VP8X") {
        const header = Buffer.from(chunks[0].raw);
        header[WEBP_HEADER] |= WEBP_XMP_FLAG;
        body.push(header);
    } else {
        body.push(extendedHeader(chunks[0] ?? { type: "", data: Buffer.alloc(0) }));
    }
    let wrote = false;
    chunks.forEach((chunk, index) => {
        if (index === 0 && chunk.type === "VP8X") return;
        if (chunk.type === "XMP ") {
            if (!wrote) body.push(xmpOut);
            wrote = true;
            return;
        }
        body.push(chunk.raw);
    });
    if (!wrote) body.push(xmpOut);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(4 + body.reduce((sum, part) => sum + part.length, 0));
    const out = Buffer.concat([Buffer.from("RIFF"), size, Buffer.from("WEBP"), ...body, trailing]);
    return {
        bytes: out,
        record,
        ...(primary ? { primary } : {}),
        foreignXmp: built.foreignXmp,
        ...(built.foreignXmpReason === undefined ?
            {}
        :   { foreignXmpReason: built.foreignXmpReason }),
        changed: !out.equals(bytes),
    };
}

/** Read a file of any of the three formats. */
function readAny(bytes) {
    const format = sniffFormat(bytes);
    return (
        format === "png" ? readProvenance(bytes)
        : format === "webp" ? readWebpProvenance(bytes)
        : format === "jpeg" ? readJpegProvenance(bytes)
        : readSvgProvenance(bytes)
    );
}

/** The address a file's read result names. */
function addressOf({ xmp, standard }) {
    return xmp.address ?? xmp.identifier ?? standard.address;
}

/**
 * Find the master of an address among a set of files.
 *
 * The master is the PNG or SVG with that `hl:address` and no `hl:derived`. A
 * WebP is never a master, and files that cannot be read are skipped.
 *
 * @param {{file: string, bytes: Buffer|string}[]} entries - The files.
 * @param {string} address - The address.
 * @returns {{file: string, record: ProvenanceRecord}|{reason: "no-master"|"several-masters",
 *   files?: string[]}} The master, or why there is none.
 */
export function findMaster(entries, address) {
    const masters = [];
    for (const { file, bytes } of entries) {
        let read;
        try {
            if (["webp", "jpeg"].includes(sniffFormat(bytes))) continue;
            read = readAny(bytes);
        } catch {
            continue;
        }
        if (read.xmp.derived === undefined && addressOf(read) === address) {
            masters.push({ file, record: read.record });
        }
    }
    if (masters.length === 0) return { reason: "no-master" };
    if (masters.length > 1) return { reason: "several-masters", files: masters.map((m) => m.file) };
    return masters[0];
}

/**
 * The properties of a file: a master's own record, or for a derivative the
 * record of the master that has its address, with the values the derivative
 * repeats applying. The result carries no `derived`.
 *
 * @param {{file: string, bytes: Buffer|string}} entry - The file.
 * @param {{file: string, bytes: Buffer|string}[]} entries - The files that may
 *   hold the master.
 * @returns {ProvenanceRecord} The effective record.
 * @throws {Error} When the file is a derivative and the set holds no master or
 *   several for its address.
 */
export function effectiveRecord(entry, entries) {
    const { record } = readAny(entry.bytes);
    if (record.derived === undefined) return record;
    const master = findMaster(entries, record.address);
    if (master.reason) {
        throw new Error(
            `${entry.file}: ${master.reason === "no-master" ? "no master" : "several masters"} for address ${record.address}`,
        );
    }
    const effective = { ...master.record };
    for (const field of REPEATABLE) {
        if (record[field] !== undefined) effective[field] = record[field];
    }
    return effective;
}

/** Shorten a value for a message. */
function brief(value) {
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    const flat = text.replace(/\s+/g, " ").trim();
    return JSON.stringify(flat.length > 60 ? `${flat.slice(0, 57)}...` : flat);
}

/** The record properties a derivative may repeat from its master. */
const REPEATABLE = Object.freeze([
    ...FIELDS.filter((field) => !["address", "derived", "nonAiAlternative"].includes(field)),
    "formerNames",
]);

/** Generation details, which no derivative carries. */
const NEVER_REPEATED = Object.freeze(["prompt", "generator", "composition"]);

/** The note fields, repeated only for a public primary note. */
const NOTE_FIELDS = Object.freeze(["name", "primaryNote"]);

/** The record fields a derivative carries unless told otherwise. */
const DERIVATIVE_FIELDS = Object.freeze(["address", "creator", "rights", "ai"]);

/**
 * The record of a derivative made from a master.
 *
 * The record holds `address` (unchanged), `derived` set to `true`, `rights`
 * (`dc:rights`) and `creator` (`dc:creator`, the attribution). It repeats `ai`
 * when explicitly declared and each property named in `repeat`. Other master
 * fields are left out.
 *
 * `prompt` and `generator` (generation details) are never repeated, and `name`
 * and `primaryNote` are repeated only when `notePublic` is `true`.
 * `nonAiAlternative` belongs to the master and public asset index and cannot
 * be named in `repeat`.
 *
 * @param {ProvenanceRecord} master - The master's record.
 * @param {{repeat?: string[], notePublic?: boolean}} [options] - `repeat` names
 *   further record fields to repeat, such as `description`. `notePublic` is
 *   whether the image's primary note is public, as the content index's note
 *   visibility says; only then may `name` and `primaryNote` be named.
 * @returns {ProvenanceRecord} The derivative's record.
 * @throws {Error} When the master has no valid address, `repeat` names a field
 *   that cannot be repeated, names `prompt` or `generator`, or names `name` or
 *   `primaryNote` while `notePublic` is not `true`.
 */
export function deriveRecord(master, options = {}) {
    const repeat = options.repeat ?? [];
    for (const field of repeat) {
        if (NEVER_REPEATED.includes(field)) {
            throw new Error(`${field} is generation detail and is never repeated on a derivative`);
        }
        if (NOTE_FIELDS.includes(field) && options.notePublic !== true) {
            throw new Error(
                `${field} is repeated on a derivative only when the primary note is public`,
            );
        }
        if (!REPEATABLE.includes(field)) throw new Error(`${field} cannot be repeated`);
    }
    const record = {};
    for (const field of [...DERIVATIVE_FIELDS, ...repeat]) {
        if (master[field] !== undefined) record[field] = master[field];
    }
    record.identifier = record.address;
    record.derived = "true";
    validateRecord(record);
    return record;
}

/**
 * The format of a file, by signature rather than by file name.
 *
 * @param {Buffer|Uint8Array|string} input - The file.
 * @returns {"png"|"webp"|"jpeg"|"svg"} The image format by signature; anything
 *   without a recognized raster signature is treated as SVG.
 */
export function sniffFormat(input) {
    if (isWebp(input)) return "webp";
    if (typeof input !== "string" && input[0] === 0xff && input[1] === 0xd8) return "jpeg";
    return (
            typeof input !== "string" &&
                input.length >= 8 &&
                Buffer.from(input.subarray(0, 8)).equals(SIGNATURE)
        ) ?
            "png"
        :   "svg";
}

/**
 * One finding of {@link checkProvenance}.
 *
 * @typedef {object} ProvenanceFinding
 * @property {string} file - The file the finding is about.
 * @property {number} [line] - The 1-based line, when known.
 * @property {number} [column] - The 1-based column, when known.
 * @property {"error"} severity - The severity.
 * @property {string} message - What is wrong.
 */

/**
 * Format a finding with its known location and severity.
 *
 * @param {ProvenanceFinding} finding - The finding.
 * @returns {string} The line.
 */
export function formatFinding(finding) {
    return formatDiagnostic(finding);
}

/**
 * Check PNG and SVG masters and their WebP, SVG and JPEG derivatives.
 *
 * The format of each file is sniffed from its content. A file is refused for a
 * missing address, an address that is not a complete Address, an
 * master address another master carries, an XMP packet or managed SVG element
 * that is missing, and, for a
 * PNG, a field the XMP packet and the text chunks both hold with different
 * values.
 *
 * `hl:name` and `hl:primarynote` are optional and independent. A
 * `hl:primarynote` that is not a complete Address is refused. With `index`
 * (from {@link module:engine/art-primary-note.buildPrimaryNoteIndex}), a
 * `hl:primarynote` that names no note in it is refused, a `hl:name` that differs
 * from the named note's `name.full` is refused, and so is a `hl:primarynote`
 * that differs from the being or affiliation note the image resolves to.
 *
 * Known-AI masters must declare a complete `nonAiAlternative` asset Address.
 * Targets among the checked masters must be distinct and explicitly non-AI.
 * Index publication checks dependency resolution and Foundry eligibility.
 * Derivative parent traces name the canonical master Address. With `index`,
 * derivative note fields must match a public indexed note; without it, they
 * must repeat the master's values. Master note metadata is audited separately.
 *
 * @param {{file: string, bytes: Buffer|string}[]} entries - The files to check.
 * @param {{index?: ReturnType<import("./art-primary-note.mjs").buildPrimaryNoteIndex>}} [options] - The primary-note index to check against.
 * @returns {ProvenanceFinding[]} The findings, in file order; empty when the set
 *   is sound.
 */
export function checkProvenance(entries, options = {}) {
    const findings = [];
    const add = (file, message) => findings.push({ file, severity: "error", message });
    const masterFiles = new Map();
    const derivatives = [];
    for (const { file, bytes } of entries) {
        const format = sniffFormat(bytes);
        const isPng = format === "png";
        let read;
        try {
            read =
                isPng ? readProvenance(bytes)
                : format === "webp" ? readWebpProvenance(bytes)
                : format === "jpeg" ? readJpegProvenance(bytes)
                : readSvgProvenance(bytes);
        } catch (error) {
            add(file, error.message);
            continue;
        }
        const { xmp, standard, packet } = read;
        if (xmp.derived !== undefined && xmp.composition !== undefined)
            add(file, "composition is private and never repeated on a derivative");
        if (packet === null) {
            add(
                file,
                format !== "svg" ?
                    "the XMP packet is missing"
                :   `the <metadata id="${SVG_METADATA_ID}"> element is missing`,
            );
        }
        if (xmp.derived !== undefined && xmp.nonAiAlternative !== undefined)
            add(
                file,
                "hl:nonAiAlternative belongs only to the master; remove it from the derivative",
            );
        if (
            (isPng || format === "svg") &&
            xmp.derived === undefined &&
            provenanceAi(xmp) === true &&
            xmp.nonAiAlternative === undefined
        )
            add(file, MISSING_ALTERNATIVE);
        const address = xmp.address ?? xmp.identifier ?? standard.address;
        if (xmp.derived !== undefined && xmp.derived !== "true") {
            add(file, `hl:derived ${JSON.stringify(xmp.derived)} must be "true"`);
        }
        if ((format === "webp" || format === "jpeg") && xmp.derived === undefined) {
            add(
                file,
                `a ${format === "jpeg" ? "JPEG" : "WebP"} is a derivative and must carry hl:derived`,
            );
        }
        if (format === "jpeg") {
            const allowed = new Set([
                "address",
                "identifier",
                "derived",
                "derivedFrom",
                "creator",
                "rights",
                "license",
                "ai",
                "name",
                "primaryNote",
            ]);
            for (const field of Object.keys(xmp))
                if (!allowed.has(field)) add(file, `JPEG metadata must not carry ${field}`);
            if (!address || xmp.derivedFrom !== address)
                add(file, "JPEG hl:derivedfrom must name its master address");
            const publicProperties = XMP_PROPERTIES.filter(([field]) => allowed.has(field)).map(
                ([, property]) => property,
            );
            if (
                read.foreignMetadata ||
                (packet !== null && hasForeignXmp(packet, publicProperties))
            )
                add(file, "JPEG carries foreign metadata");
        }
        if (isPng && xmp.derived !== undefined) {
            add(file, "a PNG is a master and must not carry hl:derived");
        }
        if (
            xmp.address !== undefined &&
            xmp.identifier !== undefined &&
            xmp.address !== xmp.identifier
        ) {
            add(
                file,
                `dc:identifier ${JSON.stringify(xmp.identifier)} differs from hl:address ${JSON.stringify(xmp.address)}`,
            );
        }
        if (!address) {
            add(file, "no address: hl:address and dc:identifier are missing");
        } else if (!COMPLETE_ADDRESS.test(address)) {
            add(
                file,
                `malformed address ${JSON.stringify(address)}: expected <package>-<system>-<type>-<shortcode>`,
            );
        } else {
            if (xmp.derived === undefined) {
                if (format !== "webp" && format !== "jpeg") {
                    const list = masterFiles.get(address) ?? [];
                    list.push({ file, record: read.record });
                    masterFiles.set(address, list);
                }
            } else {
                derivatives.push({ file, address, xmp, format });
            }
        }
        if (xmp.primaryNote !== undefined) {
            if (!COMPLETE_ADDRESS.test(xmp.primaryNote)) {
                add(
                    file,
                    `malformed hl:primarynote ${JSON.stringify(xmp.primaryNote)}: expected <package>-<system>-<type>-<shortcode>`,
                );
            } else if (options.index && xmp.derived === undefined) {
                const named = options.index.notes.get(xmp.primaryNote);
                const derived =
                    address && COMPLETE_ADDRESS.test(address) ?
                        resolvePrimaryNote(options.index, address).note
                    :   undefined;
                if (!named) {
                    add(file, `hl:primarynote ${xmp.primaryNote} names no note in the index`);
                } else {
                    if (xmp.name !== undefined && named.name !== "" && xmp.name !== named.name) {
                        add(
                            file,
                            `hl:name ${JSON.stringify(xmp.name)} differs from the name ${JSON.stringify(named.name)} of ${xmp.primaryNote}`,
                        );
                    }
                    if (derived && derived.address !== xmp.primaryNote) {
                        add(
                            file,
                            `hl:primarynote ${xmp.primaryNote} differs from ${derived.address}, the ${derived.type} that names the image`,
                        );
                    }
                }
            }
        }
        for (const [field, keyword] of Object.entries(STANDARD_KEYWORDS)) {
            if (field === "created" || field === "software") continue;
            if (xmp[field] !== undefined && standard[field] === undefined) {
                if (isPng) add(file, `the ${keyword} text chunk is missing`);
            } else if (
                xmp[field] === undefined &&
                standard[field] !== undefined &&
                packet !== null
            ) {
                add(file, `the XMP packet lacks the ${field} the ${keyword} text chunk holds`);
            } else if (
                xmp[field] !== undefined &&
                standard[field] !== undefined &&
                (field === "creator" ?
                    xmp.creator.join(", ") !== standard.creator[0]
                :   xmp[field] !== standard[field])
            ) {
                add(file, `the XMP ${field} and the ${keyword} text chunk disagree`);
            }
        }
    }
    findings.push(...checkCompositionSources(masterFiles));
    for (const [address, masters] of masterFiles) {
        for (const { file, record } of masters) {
            if (!record.nonAiAlternative) continue;
            if (record.nonAiAlternative === address)
                add(
                    file,
                    "hl:nonAiAlternative names the master itself; declare a different non-AI image or icon",
                );
            else {
                const targets = masterFiles.get(record.nonAiAlternative);
                if (targets?.some((target) => provenanceAi(target.record) !== false))
                    add(
                        file,
                        `hl:nonAiAlternative ${record.nonAiAlternative} must name an explicitly non-AI master; choose a human-made image or icon`,
                    );
            }
        }
    }
    for (const [address, masters] of masterFiles) {
        if (masters.length < 2) continue;
        const names = masters.map((m) => m.file);
        for (const file of names) {
            add(file, `address ${address} has ${masters.length} masters: ${names.join(", ")}`);
        }
    }
    for (const { file, address, xmp, format } of derivatives) {
        const masters = masterFiles.get(address);
        if (!masters) {
            add(file, `a derivative of address ${address} has no master among the checked files`);
            continue;
        }
        if (masters.length > 1) continue;
        const master = masters[0];
        if (xmp.derivedFrom !== undefined && xmp.derivedFrom !== address && format !== "jpeg") {
            add(file, "hl:derivedFrom must name its master address");
        }
        const indexedNoteFields =
            options.index && NOTE_FIELDS.some((field) => xmp[field] !== undefined);
        if (indexedNoteFields) {
            const resolved = resolvePrimaryNote(options.index, address).note;
            const noteAddress = xmp.primaryNote ?? master.record.primaryNote ?? resolved?.address;
            const named = options.index.notes.get(noteAddress);
            if (!named) {
                add(
                    file,
                    `derivative note fields name no note in the index: ${noteAddress ?? "no primary note"}`,
                );
            } else if (!options.index.publicNotes?.has(noteAddress)) {
                add(file, `derivative note fields require a public indexed note: ${noteAddress}`);
            } else {
                if (xmp.name !== undefined && xmp.name !== named.name) {
                    add(
                        file,
                        `hl:name ${JSON.stringify(xmp.name)} differs from the indexed name ${JSON.stringify(named.name)} of ${noteAddress}`,
                    );
                }
                if (resolved && resolved.address !== noteAddress) {
                    add(
                        file,
                        `hl:primarynote ${noteAddress} differs from ${resolved.address}, the ${resolved.type} that names the image`,
                    );
                }
            }
        }
        for (const field of REPEATABLE) {
            if (field === "derivedFrom" || (indexedNoteFields && NOTE_FIELDS.includes(field)))
                continue;
            if (xmp[field] === undefined) continue;
            const name = XMP_PROPERTIES.find(([f]) => f === field)[1];
            const mine = master.record[field];
            const authority =
                NOTE_FIELDS.includes(field) ?
                    "; supply a public note index to validate an override"
                :   "";
            if (mine === undefined) {
                add(
                    file,
                    `${name} ${brief(xmp[field])} is not carried by its master ${master.file}${authority}`,
                );
            } else if (JSON.stringify(mine) !== JSON.stringify(xmp[field])) {
                add(
                    file,
                    `${name} ${brief(xmp[field])} is stale: its master ${master.file} has ${brief(mine)}${authority}`,
                );
            }
        }
    }
    return findings;
}

/** The role word a master's pixel size selects. */
const ROLE_BY_SIZE = Object.freeze({ "1152x896": "creature", "896x1152": "portrait" });

/**
 * The file name a master takes: `<shortcode>-<role>.png`.
 *
 * The shortcode is the last segment of the Address, and the role is `creature`
 * for a 1152×896 landscape and `portrait` for an 896×1152 picture.
 *
 * @param {string} address - The complete Address.
 * @param {number} width - Pixel width.
 * @param {number} height - Pixel height.
 * @returns {string} The file name.
 * @throws {Error} When the Address is not complete or the size selects no role.
 */
export function masterFileName(address, width, height) {
    if (!COMPLETE_ADDRESS.test(address)) {
        throw new Error(`address ${JSON.stringify(address)} is not a complete Address`);
    }
    const role = ROLE_BY_SIZE[`${width}x${height}`];
    if (!role) throw new Error(`a ${width}x${height} picture selects no role`);
    return `${readCanonicalKey(address).shortcode}-${role}.png`;
}

/**
 * Plan the new names of a set of masters.
 *
 * Two masters in one folder that would receive the same name are both refused.
 *
 * @param {{path: string, address: string, width: number, height: number}[]} masters -
 *   Each master's `/`-separated path relative to the masters directory, its
 *   Address and its pixel size.
 * @returns {{renames: {path: string, to: string, name: string}[],
 *   refused: {path: string, reason: string}[]}} The new path of each master that
 *   receives a new name, and the reason for each that cannot.
 */
export function planRenames(masters) {
    const planned = [];
    const refused = [];
    for (const master of masters) {
        try {
            const name = masterFileName(master.address, master.width, master.height);
            const dir =
                master.path.includes("/") ?
                    master.path.slice(0, master.path.lastIndexOf("/") + 1)
                :   "";
            planned.push({ path: master.path, name, to: `${dir}${name}` });
        } catch (error) {
            refused.push({ path: master.path, reason: error.message });
        }
    }
    const byTarget = new Map();
    for (const item of planned)
        byTarget.set(item.to, [...(byTarget.get(item.to) ?? []), item.path]);
    const renames = [];
    for (const item of planned) {
        const sharing = byTarget.get(item.to);
        if (sharing.length > 1) {
            refused.push({
                path: item.path,
                reason: `would be named ${item.to}, as ${sharing.filter((p) => p !== item.path).join(", ")} would be`,
            });
        } else {
            renames.push(item);
        }
    }
    return { renames, refused };
}

export {
    hasForeignXmp,
    decodeSvg,
    locateSvg,
    WEBP_HEADER,
    WEBP_EXIF_FLAG,
    WEBP_XMP_FLAG,
    X_NAMESPACE,
    RDF_NAMESPACE,
};
