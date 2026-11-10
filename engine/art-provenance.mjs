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
 * Provenance embedded in a PNG, WebP or SVG master.
 *
 * A master carries its own identity: the Address of the note it illustrates, a
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
 * ## Derivatives
 *
 * This module writes the record into two formats: the PNG `iTXt` XMP chunk
 * ({@link writeProvenance}) and the SVG `<metadata>` element
 * ({@link writeSvgProvenance}). In both, the packet is a standard `x:xmpmeta` /
 * `rdf:RDF` document with every namespace declared, and `dc:identifier` and
 * `hl:address` carry the Address.
 *
 * ## Optional fields shared by both formats
 *
 * `role` (`hl:role`) names what the image is for, such as `icon`,
 * `icon-source`, `banner`, `media` or `background`. `derivedFrom`
 * (`hl:derivedFrom`) names a former path or address of the image this one was
 * made from. `digitalSourceType` is written as `Iptc4xmpExt:DigitalSourceType`
 * and accepts a short token (`trainedAlgorithmicMedia`, `algorithmicMedia`,
 * `digitalCreation`, `compositeWithTrainedAlgorithmicMedia`) or a full URI. A
 * PNG that has no record yet and is written without the field receives
 * `trainedAlgorithmicMedia`; the value `none` (or `null`) writes no
 * `DigitalSourceType` at all and stays absent on later writes. An SVG never
 * receives a default.
 *
 * ## SVG
 *
 * {@link writeSvgProvenance} embeds the same XMP packet inside one
 * `<metadata id="hl-provenance">` element, placed as the first child of the
 * root `<svg>` after any leading `<title>` and `<desc>`. The write is a string
 * splice: the managed element is inserted, or replaced where it stands, and
 * every other byte of the file is unchanged. A self-closing root becomes an
 * open and close pair; nothing else about it changes. The merge rules are those
 * of the PNG writer, and the element holds only the packet, with no text-chunk
 * counterpart. A root with a prefixed name, a file with no root element, a file
 * with more than one `id="hl-provenance"` and text that is not valid UTF-8 are
 * refused.
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
 * module manages**: the packet's `rdf:Description` blocks stay, `dc:title`,
 * `dc:creator`, `dc:rights`, `dc:description` and every `hl:` and
 * `Iptc4xmpExt:DigitalSourceType` property are removed from them, and one
 * `rdf:Description` block of this module's own is appended. A packet that
 * cannot be retained safely (it is not RDF, is not well-formed, uses an
 * unbound prefix, or binds a prefix this module uses to a different namespace)
 * is replaced whole, and the result says so in `foreignXmp` and gives the reason
 * in `foreignXmpReason`. Namespace declarations that sit on the foreign
 * `x:xmpmeta` or `rdf:RDF` element move onto this module's `rdf:RDF` (including
 * `dc`, `hl` and `Iptc4xmpExt` when bound to this module's namespaces), so
 * every retained property keeps its prefix bound. The SVG writer retains nothing
 * foreign: it replaces the one managed element. Only one XMP chunk survives: the first is rewritten and any
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
 * {@link checkProvenance} reports, as `file:line:column: severity: message`, a
 * file with no address, an address that is not a complete Address, an
 * (address, role) pair two files share, a `dc:identifier` that differs from
 * `hl:address`, a `hl:primarynote` that is malformed or that names no note in
 * the index, a `hl:name` that differs from the named note's `name.full`, a
 * `hl:primarynote` that differs from the being or affiliation the image
 * resolves to, and metadata lost or disagreeing
 * between the XMP packet and the text chunks. The format is chosen by sniffing
 * the content: a PNG signature selects PNG, a RIFF `WEBP` container selects
 * WebP, anything else is read as SVG.
 *
 * @module engine/art-provenance
 */

import zlib from "node:zlib";

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
    "role",
    "derivedFrom",
    "prompt",
    "generator",
    "title",
    "creator",
    "rights",
    "digitalSourceType",
    "created",
    "software",
    "description",
    "source",
    "processing",
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
 * @property {string} [address] - The complete Address of the note that uses the
 *   image, such as `thalorna-note-being-abyssdrk`.
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
 * @property {string} [prompt] - The generating prompt, verbatim.
 * @property {string} [generator] - A JSON object, as a string, describing the
 *   service and model.
 * @property {string} [title] - The display name.
 * @property {string} [creator] - The person holding the rights.
 * @property {string} [rights] - The rights statement.
 * @property {string} [role] - What the image is for, such as `icon`,
 *   `icon-source`, `banner`, `media` or `background`. Written as `hl:role` in
 *   the XMP packet only.
 * @property {string} [derivedFrom] - A former path or address of the image this
 *   one was made from. Written as `hl:derivedFrom` in the XMP packet only.
 * @property {string} [digitalSourceType] - The IPTC digital source type, as a
 *   key of {@link DIGITAL_SOURCE_TOKENS} or a full URI; read back as the URI.
 *   Written as `Iptc4xmpExt:DigitalSourceType`. On write, `none` or `null`
 *   removes it, and a PNG with no record yet that is written without the field
 *   receives {@link DIGITAL_SOURCE_TRAINED_ALGORITHMIC}.
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
    ["prompt", "dc:description", "alt"],
    ["address", "hl:address", "plain"],
    ["identifier", "dc:identifier", "plain"],
    ["kind", "hl:kind", "plain"],
    ["name", "hl:name", "plain"],
    ["primaryNote", "hl:primarynote", "plain"],
    ["role", "hl:role", "plain"],
    ["derivedFrom", "hl:derivedFrom", "plain"],
    ["prompt", "hl:prompt", "plain"],
    ["generator", "hl:generator", "plain"],
    ["formerNames", "hl:formerNames", "bag"],
    ["description", "hl:description", "plain"],
    ["source", "dc:source", "plain"],
    ["processing", "hl:processing", "plain"],
    ["digitalSourceType", "Iptc4xmpExt:DigitalSourceType", "plain"],
]);

/** Every property name this module owns inside an XMP packet. */
const MANAGED_PROPERTIES = Object.freeze(XMP_PROPERTIES.map(([, name]) => name));

/**
 * The `rdf:Description` block holding a record.
 *
 * @param {ProvenanceRecord} record - The record.
 * @param {string} [eol] - The line ending between structural lines.
 * @returns {string} The XML.
 */
function descriptionBlock(record, eol = "\n") {
    const lines = [];
    for (const [field, name, shape] of XMP_PROPERTIES) {
        const value = record[field];
        if (value === undefined) continue;
        if (shape === "bag") {
            const items = value.map((item) => `<rdf:li>${escapeXml(item)}</rdf:li>`).join("");
            lines.push(`   <${name}><rdf:Bag>${items}</rdf:Bag></${name}>`);
            continue;
        }
        const text = escapeXml(value);
        if (shape === "alt") {
            lines.push(
                `   <${name}><rdf:Alt><rdf:li xml:lang="x-default">${text}</rdf:li></rdf:Alt></${name}>`,
            );
        } else if (shape === "seq") {
            lines.push(`   <${name}><rdf:Seq><rdf:li>${text}</rdf:li></rdf:Seq></${name}>`);
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

/**
 * Decide what survives of a foreign XMP packet.
 *
 * Namespace declarations on the foreign `x:xmpmeta` and `rdf:RDF` elements move
 * onto this module's `rdf:RDF`, so retained properties keep the prefixes they
 * were written with. A packet is dropped when it is not RDF, is not
 * well-formed, uses an unbound prefix, or binds a prefix this module uses to a
 * different namespace.
 *
 * @param {string} packet - The XMP text.
 * @returns {{kept: true, markup: string, declarations: string}|
 *   {kept: false, reason?: string, empty?: true}} The retained markup and the
 *   declarations it needs, or why nothing is retained (`empty` when the packet
 *   holds nothing but this module's own block).
 */
function retainForeign(packet) {
    const rest = packet.replace(OWN_DESCRIPTION, "");
    const start = rest.indexOf("<rdf:RDF");
    const open = start < 0 ? -1 : rest.indexOf(">", start);
    const close = rest.lastIndexOf("</rdf:RDF>");
    const rdfTag = open < 0 ? "" : rest.slice(start, open + 1);
    if (open < 0 || close <= open || /\/>$/.test(rdfTag)) {
        return { kept: false, reason: "the packet is not RDF" };
    }
    const declared = {};
    const metaStart = rest.indexOf("<x:xmpmeta");
    if (metaStart >= 0 && metaStart < start) {
        const metaEnd = rest.indexOf(">", metaStart);
        const meta = parseAttributes(rest.slice(metaStart + "<x:xmpmeta".length, metaEnd));
        if (meta === null || metaEnd < 0 || metaEnd > start) {
            return { kept: false, reason: "the x:xmpmeta element is malformed" };
        }
        for (const [name, value] of meta) if (name.startsWith("xmlns")) declared[name] = value;
    }
    const rdf = parseAttributes(rdfTag.slice("<rdf:RDF".length, -1));
    if (rdf === null) return { kept: false, reason: "the rdf:RDF element is malformed" };
    for (const [name, value] of rdf) if (name.startsWith("xmlns")) declared[name] = value;

    const bindings = { x: X_NAMESPACE, rdf: RDF_NAMESPACE };
    let declarations = "";
    for (const [name, value] of Object.entries(declared)) {
        const prefix = name === "xmlns" ? null : name.slice(6);
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
        declarations += ` ${name}="${value}"`;
    }
    const inner = stripManaged(rest.slice(open + 1, close));
    if (!/<rdf:Description\b/.test(inner)) {
        return { kept: false, empty: true };
    }
    const problem = checkMarkup(inner, bindings);
    if (problem) return { kept: false, reason: `the packet cannot be retained: ${problem}` };
    return { kept: true, markup: `  ${inner.trim()}\n`, declarations };
}

/** Remove the managed properties from foreign XMP markup. */
function stripManaged(xml) {
    let out = xml;
    for (const name of MANAGED_PROPERTIES) {
        const q = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(`<${q}\\b[^>]*/>`, "g"), "");
        out = out.replace(new RegExp(`<${q}\\b[^>]*>[\\s\\S]*?</${q}>`, "g"), "");
        out = out.replace(new RegExp(`(\\s)${q}=(?:"[^"]*"|'[^']*')`, "g"), "$1");
    }
    return out;
}

/** Read a plain, alt or seq property out of XMP markup. */
function readProperty(xml, name) {
    const q = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const element = new RegExp(`<${q}\\b[^>]*>([\\s\\S]*?)</${q}>`).exec(xml);
    if (element) {
        const li = /<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/.exec(element[1]);
        return unescapeXml(li ? li[1] : element[1]);
    }
    const attribute = new RegExp(`\\s${q}=(?:"([^"]*)"|'([^']*)')`).exec(xml);
    return attribute ? unescapeXml(attribute[1] ?? attribute[2]) : undefined;
}

/**
 * Read the record stored in an XMP packet.
 *
 * @param {string} packet - The XMP text.
 * @returns {ProvenanceRecord} The fields the packet holds; fields it lacks are
 *   absent.
 */
export function readXmpRecord(packet) {
    const own = OWN_DESCRIPTION.exec(packet);
    const xml = own ? own[0] : packet;
    const record = {};
    for (const [field, name] of XMP_PROPERTIES) {
        if (field === "prompt" && name === "dc:description") continue;
        if (field === "formerNames") {
            const bag = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
            if (bag) {
                record.formerNames = [
                    ...bag[1].matchAll(/<rdf:li\b[^>]*>([\s\S]*?)<\/rdf:li>/g),
                ].map((item) => unescapeXml(item[1]));
            }
            continue;
        }
        const value = readProperty(xml, name);
        if (value !== undefined) record[field] = value;
    }
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
        if (byKeyword.has(keyword)) record[field] = byKeyword.get(keyword);
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
    const xmpChunk = chunks.find(isXmpChunk);
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
    for (const field of FIELDS) {
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
        else record[field] = fields[field];
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
 * @returns {{text: string, foreignXmp: "none"|"kept"|"discarded", foreignXmpReason?: string}}
 */
function buildPacket(existing, record) {
    let foreign = "";
    let foreignXmp = "none";
    let foreignReason;
    let declarations = "";
    if (existing !== null) {
        const kept = retainForeign(existing);
        if (kept.kept) {
            foreign = kept.markup;
            declarations = kept.declarations;
            foreignXmp = "kept";
        } else if (!kept.empty) {
            foreignXmp = "discarded";
            foreignReason = kept.reason;
        }
    }
    return {
        text: packetHead(declarations) + foreign + descriptionBlock(record) + PACKET_TAIL,
        foreignXmp,
        ...(foreignReason === undefined ? {} : { foreignXmpReason: foreignReason }),
    };
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
 *   other properties were retained, `discarded` when it could not be retained
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
    if (fields.digitalSourceType === undefined && existing.address === undefined) {
        record.digitalSourceType ??= DIGITAL_SOURCE_TRAINED_ALGORITHMIC;
    }
    validateRecord(record);

    const xmpChunks = chunks.filter(isXmpChunk);
    const built = buildPacket(xmpChunks.length ? readTextChunk(xmpChunks[0]).text : null, record);
    const { foreignXmp, foreignXmpReason: foreignReason } = built;
    const packetText = built.text;
    const xmpOut = makeTextChunk(XMP_KEYWORD, packetText);

    const standardOut = new Map();
    for (const [field, keyword] of Object.entries(STANDARD_KEYWORDS)) {
        if (record[field] !== undefined)
            standardOut.set(keyword, makeTextChunk(keyword, record[field]));
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
function svgMetadataElement(record, eol) {
    return (
        `<metadata id="${SVG_METADATA_ID}">${eol}` +
        `<x:xmpmeta xmlns:x="adobe:ns:meta/">${eol}` +
        ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${eol}` +
        descriptionBlock(record, eol) +
        ` </rdf:RDF>${eol}</x:xmpmeta>${eol}</metadata>`
    );
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
 *   primary?: import("./art-primary-note.mjs").PrimaryNoteResult}}
 *   The new file as text and as UTF-8 bytes, the record it carries, whether
 *   the text differs from the input, and with `index` what the resolver answered.
 * @throws {Error} When the SVG is refused (see {@link readSvgProvenance}), the
 *   merged record has no valid address or an invalid field, or a value holds a
 *   character XML cannot carry.
 */
export function writeSvgProvenance(input, fields, options = {}) {
    const text = decodeSvg(input);
    const { elements, root, managed } = locateSvg(text);
    const existing =
        managed && !managed.selfClosing ?
            readXmpRecord(text.slice(managed.end, managed.closeStart))
        :   {};
    const record = mergeRecord(existing, fields);
    const primary = options.index ? applyPrimaryNote(record, options.index) : undefined;
    validateRecord(record);
    const element = svgMetadataElement(record, lineEnding(text));

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
        ...(primary ? { primary } : {}),
        changed: out !== text,
    };
}

/** The size of a WebP chunk's header: four type bytes and a four-byte length. */
const WEBP_HEADER = 8;

/** The `VP8X` flag that says an `XMP ` chunk follows the image data. */
const WEBP_XMP_FLAG = 0x04;

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
    const chunk = chunks.find((entry) => entry.type === "XMP ");
    return chunk ? chunk.data.toString("utf8") : null;
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
    const built = buildPacket(existingPacket, record);
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

/**
 * The format of a file, by signature rather than by file name.
 *
 * @param {Buffer|Uint8Array|string} input - The file.
 * @returns {"png"|"webp"|"svg"} `png` for a PNG signature, `webp` for a RIFF
 *   container holding `WEBP`; anything else is treated as SVG.
 */
export function sniffFormat(input) {
    if (isWebp(input)) return "webp";
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
 * @property {number} line - Always 1; the finding is about the file as a whole.
 * @property {number} column - Always 1.
 * @property {"error"} severity - The severity.
 * @property {string} message - What is wrong.
 */

/**
 * Format a finding as `file:line:column: severity: message`.
 *
 * @param {ProvenanceFinding} finding - The finding.
 * @returns {string} The line.
 */
export function formatFinding(finding) {
    return `${finding.file}:${finding.line}:${finding.column}: ${finding.severity}: ${finding.message}`;
}

/**
 * Check a set of masters, PNG, WebP and SVG alike.
 *
 * The format of each file is sniffed from its content. A file is refused for a
 * missing address, an address that is not a complete Address, an
 * (address, role) pair another file in the set carries (an absent role is the
 * empty role), an XMP packet or managed SVG element that is missing, and, for a
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
 * @param {{file: string, bytes: Buffer|string}[]} entries - The files to check.
 * @param {{index?: object}} [options] - The primary-note index to check against.
 * @returns {ProvenanceFinding[]} The findings, in file order; empty when the set
 *   is sound.
 */
export function checkProvenance(entries, options = {}) {
    const findings = [];
    const add = (file, message) =>
        findings.push({ file, line: 1, column: 1, severity: "error", message });
    const owners = new Map();
    for (const { file, bytes } of entries) {
        const format = sniffFormat(bytes);
        const isPng = format === "png";
        let read;
        try {
            read =
                isPng ? readProvenance(bytes)
                : format === "webp" ? readWebpProvenance(bytes)
                : readSvgProvenance(bytes);
        } catch (error) {
            add(file, error.message);
            continue;
        }
        const { xmp, standard, packet } = read;
        if (packet === null) {
            add(
                file,
                format !== "svg" ?
                    "the XMP packet is missing"
                :   `the <metadata id="${SVG_METADATA_ID}"> element is missing`,
            );
        }
        const address = xmp.address ?? xmp.identifier ?? standard.address;
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
            const key = `${address}\u0000${xmp.role ?? ""}`;
            const list = owners.get(key) ?? { address, role: xmp.role ?? "", files: [] };
            list.files.push(file);
            owners.set(key, list);
        }
        if (xmp.primaryNote !== undefined) {
            if (!COMPLETE_ADDRESS.test(xmp.primaryNote)) {
                add(
                    file,
                    `malformed hl:primarynote ${JSON.stringify(xmp.primaryNote)}: expected <package>-<system>-<type>-<shortcode>`,
                );
            } else if (options.index) {
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
                xmp[field] !== standard[field]
            ) {
                add(file, `the XMP ${field} and the ${keyword} text chunk disagree`);
            }
        }
    }
    for (const { address, role, files } of owners.values()) {
        if (files.length < 2) continue;
        const what = role === "" ? `address ${address}` : `address ${address} with role ${role}`;
        for (const file of files) {
            add(file, `${what} is shared by ${files.length} files: ${files.join(", ")}`);
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
