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
 * `rdf:Description` block of this module's own is written. A packet that
 * cannot be retained safely (it is not RDF, is not well-formed, uses an
 * unbound prefix, or binds a prefix this module uses to a different namespace)
 * is replaced whole, and the result says so in `foreignXmp` and gives the reason
 * in `foreignXmpReason`. Namespace declarations that sit on the foreign
 * `x:xmpmeta` or `rdf:RDF` element move onto this module's `rdf:RDF` (including
 * `dc`, `hl` and `Iptc4xmpExt` when bound to this module's namespaces), so
 * every retained property keeps its prefix bound. The SVG writer applies the
 * same rule to its managed metadata element; other elements remain unchanged.
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
 * {@link checkProvenance} reports, as `file:line:column: severity: message`, a
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

import { DOMParser } from "@xmldom/xmldom";
import { checkSvgResource, cleanSvgCss } from "./svg-derivative-css.mjs";
import { ParseOption, XmlCData, XmlDocument, XmlElement, XmlText } from "libxml2-wasm";
import {
    deriveRecord,
    sniffFormat,
    readWebpChunks,
    writeWebpProvenance,
    writeSvgProvenance,
    hasForeignXmp,
    decodeSvg,
    locateSvg,
    WEBP_HEADER,
    WEBP_EXIF_FLAG,
    WEBP_XMP_FLAG,
    X_NAMESPACE,
    RDF_NAMESPACE,
} from "./art-provenance-core.mjs";
export {
    HL_NAMESPACE,
    XMP_KEYWORD,
    SVG_METADATA_ID,
    DIGITAL_SOURCE_TRAINED_ALGORITHMIC,
    DIGITAL_SOURCE_TOKENS,
    STANDARD_KEYWORDS,
    readChunks,
    makeTextChunk,
    readTextChunk,
    readXmpRecord,
    readStandardRecord,
    readProvenance,
    writeProvenance,
    readSvgProvenance,
    writeSvgProvenance,
    readWebpChunks,
    readWebpProvenance,
    readJpegProvenance,
    writeWebpProvenance,
    findMaster,
    effectiveRecord,
    deriveRecord,
    sniffFormat,
    formatFinding,
    checkProvenance,
    masterFileName,
    planRenames,
} from "./art-provenance-core.mjs";
/** @typedef {import("./art-provenance-core.mjs").ProvenanceRecord} ProvenanceRecord */
/** @typedef {import("./art-provenance-core.mjs").PngChunk} PngChunk */
/** @typedef {import("./art-provenance-core.mjs").ProvenanceFinding} ProvenanceFinding */

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

/** SVG drawing elements retained in a derivative. */
const SVG_DRAWING_ELEMENTS = new Set(
    `svg g defs symbol use image switch a style path rect circle ellipse line polyline polygon text tspan textPath marker pattern mask clipPath linearGradient radialGradient stop filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence animate animateMotion animateTransform mpath set view`.split(
        " ",
    ),
);

/** SVG presentation attributes from https://www.w3.org/TR/SVG/latest/attindex.html
 * and https://www.w3.org/TR/SVG11/attindex.html, plus CSS transform-box. */
const SVG_PRESENTATION_ATTRIBUTES = new Set(
    `alignment-baseline baseline-shift clip clip-path clip-rule color color-interpolation color-interpolation-filters color-profile color-rendering cursor direction display dominant-baseline enable-background fill fill-opacity fill-rule filter flood-color flood-opacity font font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-orientation-horizontal glyph-orientation-vertical image-rendering kerning letter-spacing lighting-color marker marker-end marker-mid marker-start mask mask-type opacity overflow paint-order path-length pointer-events shape-rendering stop-color stop-opacity stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-overflow text-rendering transform transform-box transform-origin unicode-bidi vector-effect visibility white-space word-spacing writing-mode`.split(
        " ",
    ),
);

/** Drawing attributes from the W3C SVG attribute indexes, plus presentation attributes. */
const SVG_DRAWING_ATTRIBUTES = new Set([
    ...SVG_PRESENTATION_ATTRIBUTES,
    ...`accumulate additive amplitude attributeName attributeType azimuth baseFrequency baseProfile begin bias by calcMode class clipPathUnits cx cy d diffuseConstant divisor dur dx dy edgeMode elevation end exponent externalResourcesRequired filterRes filterUnits fr from fx fy gradientTransform gradientUnits height href id in in2 intercept k1 k2 k3 k4 kernelMatrix kernelUnitLength keyPoints keySplines keyTimes lengthAdjust limitingConeAngle markerHeight markerUnits markerWidth maskContentUnits maskUnits max media method min mode numOctaves offset operator order orient origin path pathLength patternContentUnits patternTransform patternUnits playbackorder points pointsAtX pointsAtY pointsAtZ preserveAlpha preserveAspectRatio primitiveUnits r radius refX refY repeatCount repeatDur requiredExtensions requiredFeatures restart result rotate rx ry scale seed side slope spacing specularConstant specularExponent spreadMethod startOffset stdDeviation stitchTiles style surfaceScale systemLanguage tableValues target targetX targetY textLength timelinebegin to type values version viewBox viewTarget width x x1 x2 xChannelSelector y y1 y2 yChannelSelector z zoomAndPan`.split(
        " ",
    ),
]);

/** Refuse external and parameter entities before expanding a self-contained SVG. */
function checkSvgDtd(text) {
    const document = new DOMParser({ onError: () => {} }).parseFromString(text, "image/svg+xml");
    const doctype = document.doctype;
    if (!doctype) return;
    if (doctype.systemId || doctype.publicId)
        throw new Error("SVG external DTDs are not supported");
    const subset = doctype.internalSubset ?? "";
    let quote = "";
    let declaration = "";
    let words = 0;
    for (let i = 0; i < subset.length; i++) {
        if (!quote && subset.startsWith("<!--", i)) {
            const end = subset.indexOf("-->", i + 4);
            if (end < 0) throw new Error("SVG DTD comment is not closed");
            i = end + 2;
            continue;
        }
        const c = subset[i];
        if (c === "%" && (!quote || /^%[^\s\d;][^\s;]*;/u.test(subset.slice(i)))) {
            throw new Error("SVG parameter entities are not supported");
        }
        if (quote) {
            if (c === quote) quote = "";
            continue;
        }
        if (c === '"' || c === "'") {
            quote = c;
            continue;
        }
        if (subset.startsWith("<!", i)) {
            declaration = "";
            words = 0;
            i++;
            continue;
        }
        if (c === ">") {
            declaration = "";
            continue;
        }
        if (!/[\s<>'"=]/u.test(c)) {
            let j = i + 1;
            while (j < subset.length && !/[\s<>'"=]/u.test(subset[j])) j++;
            const token = subset.slice(i, j);
            if (!declaration) declaration = token;
            else if (
                declaration === "ENTITY" &&
                words > 1 &&
                (token === "SYSTEM" || token === "PUBLIC")
            ) {
                throw new Error("SVG external entities are not supported");
            }
            words++;
            i = j - 1;
        }
    }
}

/** Rebuild the drawing without editor markup and metadata containers. */
function cleanSvgDrawing(text) {
    checkSvgDtd(text);
    const source = XmlDocument.fromString(text, {
        option:
            ParseOption.XML_PARSE_NOENT |
            ParseOption.XML_PARSE_NO_XXE |
            ParseOption.XML_PARSE_DTDATTR,
    });
    const target = XmlDocument.create();
    try {
        const root = target.createRoot("svg", SVG_NAMESPACE);
        let xlinkDeclared = false;
        let foreignXmp = false;
        const inspectXmp = (element) => {
            if (
                (element.namespaceUri === X_NAMESPACE && element.name === "xmpmeta") ||
                (element.namespaceUri === RDF_NAMESPACE && element.name === "RDF")
            ) {
                foreignXmp ||= hasForeignXmp(
                    element.toString({ format: false, noDeclaration: true }),
                );
            }
            for (let child = element.firstChild; child; child = child.next) {
                if (child instanceof XmlElement) inspectXmp(child);
            }
        };
        inspectXmp(source.root);
        const copyAttributes = (from, to) => {
            const animated = from.attrs.find(
                (attribute) => !attribute.namespaceUri && attribute.name === "attributeName",
            )?.value;
            const animationValues = new Set(["from", "to", "by", "values"]);
            for (const attribute of from.attrs) {
                if (!attribute.namespaceUri && SVG_DRAWING_ATTRIBUTES.has(attribute.name)) {
                    if (attribute.name === "href") checkSvgResource(attribute.value);
                    const value =
                        (
                            attribute.name === "style" ||
                            SVG_PRESENTATION_ATTRIBUTES.has(attribute.name) ||
                            (animationValues.has(attribute.name) &&
                                (animated === "style" || SVG_PRESENTATION_ATTRIBUTES.has(animated)))
                        ) ?
                            cleanSvgCss(attribute.value)
                        :   attribute.value;
                    to.setAttr(attribute.name, value);
                } else if (
                    attribute.namespaceUri === XLINK_NAMESPACE &&
                    attribute.name === "href"
                ) {
                    checkSvgResource(attribute.value);
                    if (!xlinkDeclared) {
                        root.addNsDeclaration(XLINK_NAMESPACE, "xlink");
                        xlinkDeclared = true;
                    }
                    to.setAttr("href", attribute.value, "xlink");
                } else if (
                    attribute.namespaceUri === XML_NAMESPACE &&
                    ["space", "lang", "base"].includes(attribute.name)
                ) {
                    if (attribute.name === "base") checkSvgResource(attribute.value);
                    to.setAttr(attribute.name, attribute.value, "xml");
                }
            }
        };
        const copy = (from, to, parentText = false) => {
            const textContext =
                from.name === "text" ||
                (parentText && ["tspan", "textPath", "a"].includes(from.name));
            copyAttributes(from, to);
            const animated = from.attrs.find(
                (a) => !a.namespaceUri && a.name === "attributeName",
            )?.value;
            const hrefTarget =
                animated === "href" ||
                (typeof animated === "string" &&
                    animated.endsWith(":href") &&
                    from.namespaceForPrefix(animated.slice(0, -5)) === XLINK_NAMESPACE);
            if (hrefTarget) {
                for (const attr of from.attrs) {
                    if (["from", "to", "by", "values"].includes(attr.name)) {
                        for (const uri of attr.value.split(";")) checkSvgResource(uri);
                    }
                }
            }
            if (from.name === "style") {
                let css = "";
                for (let node = from.firstChild; node; node = node.next) {
                    if (node instanceof XmlText || node instanceof XmlCData) css += node.content;
                }
                to.addText(cleanSvgCss(css));
                return;
            }
            for (let node = from.firstChild; node; node = node.next) {
                if ((node instanceof XmlText || node instanceof XmlCData) && textContext)
                    to.addText(node.content);
                else if (
                    node instanceof XmlElement &&
                    (node.namespaceUri === SVG_NAMESPACE || !node.namespaceUri) &&
                    SVG_DRAWING_ELEMENTS.has(node.name)
                ) {
                    copy(node, to.addElement(node.name), textContext);
                }
            }
        };
        copy(source.root, root);
        return { text: target.toString({ format: false, noDeclaration: true }), foreignXmp };
    } finally {
        source.dispose();
        target.dispose();
    }
}

/**
 * Write a derivative's provenance into a WebP or an SVG.
 *
 * The record is {@link deriveRecord} of the master. WebP output carries its
 * `VP8X`, `VP8 `, `VP8L`, `ALPH`, `ANIM`, `ANMF` and `ICCP` chunks plus
 * selected XMP. Other chunks and trailing bytes are discarded; the EXIF flag
 * is cleared and XMP flag set. ICC bytes, including profile text, are retained.
 * SVG output keeps allowed drawing elements and presentation attributes,
 * rendering text, styles, XLink href and XML language, space and base attributes.
 * Other elements and attributes, non-rendering text, XML comments, CSS comment
 * contents, processing instructions, titles and descriptions are discarded.
 * Empty CSS comment separators preserve token boundaries. CSS strings and
 * drawing values remain. Resource references in href, XML base, animations
 * and CSS accept fragments, empty references and absolute HTTP(S) URLs without user information; local
 * paths and embedded data are refused. Internal general entities and default
 * attributes are expanded; external DTDs, external entities and parameter
 * entities are refused. `foreignXmp` reports discarded foreign or unreadable
 * inherited XMP for either format. Master writers preserve eligible foreign XMP.
 *
 * @param {Buffer|Uint8Array|string} input - The derivative file.
 * @param {ProvenanceRecord} master - The master's record.
 * @param {{repeat?: string[], notePublic?: boolean}} [options] - As for
 *   {@link deriveRecord}.
 * @returns {ReturnType<typeof writeWebpProvenance>|ReturnType<typeof writeSvgProvenance>}
 *   What the format's writer returns.
 * @throws {Error} When the file is a PNG, an SVG contains a local or embedded
 *   resource, external or parameter entities, or the writer otherwise refuses
 *   the input.
 */
export function writeDerivativeProvenance(input, master, options = {}) {
    const record = deriveRecord(master, options);
    const original = Buffer.from(input);
    const format = sniffFormat(input);
    if (format === "png") throw new Error("a PNG is a master, never a derivative");
    if (format === "jpeg") throw new Error("JPEG derivatives are rendered from a master");
    if (format === "webp") {
        const { chunks } = readWebpChunks(original);
        const imageChunks = new Set(["VP8X", "VP8 ", "VP8L", "ALPH", "ANIM", "ANMF", "ICCP"]);
        const kept = chunks
            .filter((chunk) => imageChunks.has(chunk.type))
            .map((chunk) => {
                const raw = Buffer.from(chunk.raw);
                if (chunk.type === "VP8X") raw[WEBP_HEADER] &= ~(WEBP_EXIF_FLAG | WEBP_XMP_FLAG);
                return raw;
            });
        const size = Buffer.alloc(4);
        size.writeUInt32LE(4 + kept.reduce((total, chunk) => total + chunk.length, 0));
        const clean = Buffer.concat([Buffer.from("RIFF"), size, Buffer.from("WEBP"), ...kept]);
        const result = writeWebpProvenance(clean, record);
        const foreign = chunks.some(
            (chunk) => chunk.type === "XMP " && hasForeignXmp(chunk.data.toString("utf8")),
        );
        return {
            ...result,
            foreignXmp: foreign ? "discarded" : "none",
            changed: !result.bytes.equals(original),
        };
    }
    const text = decodeSvg(input);
    locateSvg(text);
    const clean = cleanSvgDrawing(text);
    const result = writeSvgProvenance(clean.text, record);
    return {
        ...result,
        foreignXmp: clean.foreignXmp ? "discarded" : "none",
        changed: !result.bytes.equals(original),
    };
}
