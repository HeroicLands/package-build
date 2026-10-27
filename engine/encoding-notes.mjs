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

/** Encoding documents and glyph codes read from the consumer's content and fonts. */
import fs from "node:fs";
import path from "node:path";
import { compileEncoding, EncodingError } from "./encoding.mjs";
import { parseAddress, renderAddress, isAddressTuple } from "./address.mjs";
import { positionOfFrontmatterPath, positionOfYamlPath } from "./diagnostics.mjs";
import { isNoteRecord } from "./index-records.mjs";
import { addressSuffixes } from "./address-render.mjs";
import { faceSlug } from "./script-fonts.mjs";

function codePointPosition(raw, position) {
    if (position.line === undefined || position.column === undefined) return position;
    const line = raw.split("\n")[position.line - 1] ?? "";
    return { ...position, column: [...line.slice(0, position.column - 1)].length + 1 };
}

/** Complete an encoding reference with the document type and citing package.
 * @param {unknown} value - Authored encoding Address or default.
 * @param {string} [contentPackage] - The citing note's package.
 * @returns {string|undefined} Canonical Address, default, or an invalid reference.
 */
export function encodingAddress(value, contentPackage) {
    if (value === "default" || value === undefined) return "default";
    const parsed = parseAddress(
        value,
        {
            package: contentPackage,
            system: "note",
            type: "doc",
            types: new Set(["doc"]),
        },
        { declared: true },
    );
    return isAddressTuple(parsed) && parsed.type === "doc" ? renderAddress(parsed) : undefined;
}

/** The executable fields a document owns, excluding ordinary document metadata.
 * @param {Record<string, any>} data - Authored document data.
 * @returns {Record<string, any>} Only the compiler's fields.
 */
export function encodingData(data) {
    return Object.fromEntries(
        ["language", "font", "accepts", "vowels", "mappings", "rules"]
            .filter((key) => data?.[key] !== undefined)
            .map((key) => [key, data[key]]),
    );
}

/** Read this selected face's published glyph codes, with no external code tables.
 * @param {import("./script-fonts.mjs").ScriptFonts|undefined} fonts - Consumer fonts.
 * @param {string} font - The selected face's slug.
 * @returns {Record<string,string>} Code-to-Unicode mapping for this font only.
 */
export function fontCodes(fonts, font) {
    const file = fonts?.root ? path.join(fonts.root, "fonts.json") : "package.json";
    const familyIndex = fonts?.manifest?.families?.findIndex((entry) => faceSlug(entry) === font);
    const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const failure = (message, keyPath = []) => {
        throw Object.assign(new EncodingError(message), {
            file,
            ...(raw && keyPath.length ?
                codePointPosition(
                    raw,
                    positionOfYamlPath(raw, ["families", familyIndex, ...keyPath]),
                )
            :   {}),
        });
    };
    const face = fonts?.manifest?.families?.find((entry) => faceSlug(entry) === font);
    if (!face) failure(`Font \`${font}\` is not installed from @heroiclands/fonts`);
    const codes = Object.create(null);
    for (const [pointIndex, point] of (face.codepoints ?? []).entries()) {
        if (typeof point.code !== "string" || !/^[A-Za-z0-9_]+$/.test(point.code))
            failure(`Font \`${font}\` has a missing or invalid glyph code at ${point.codepoint}`, [
                "codepoints",
                pointIndex,
                "code",
            ]);
        const matched = /^U\+([0-9A-F]{4,6})$/.exec(point.codepoint ?? "");
        const scalar = matched ? Number.parseInt(matched[1], 16) : -1;
        if (scalar < 0 || scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff))
            failure(`Font \`${font}\` has an invalid code point ${point.codepoint}`, [
                "codepoints",
                pointIndex,
                "codepoint",
            ]);
        if (Object.hasOwn(codes, point.code))
            failure(`Font \`${font}\` repeats glyph code \`${point.code}\``, [
                "codepoints",
                pointIndex,
                "code",
            ]);
        codes[point.code] = String.fromCodePoint(scalar);
    }
    if (!Object.keys(codes).length) failure(`Font \`${font}\` publishes no glyph codes`);
    return codes;
}

/** Compile each encoding document once and resolve references by document Address.
 * @param {Iterable<Record<string, any>>} records - Content index records.
 * @param {{languages?: Record<string, any>, contentPackage?: string, rootDir?: string, paths?: {content?: string}}} [config] - Consumer context.
 * @param {import("./script-fonts.mjs").ScriptFonts} [fonts] - Installed glyph metadata.
 * @returns {{encodings: Map<string, ReturnType<typeof compileEncoding>>, definitions: Map<string,{data:Record<string,any>,codes:Record<string,string>}>, findings:object[]}} Runtime and serializable document inputs.
 */
export function encodingsFromRecords(records, config = {}, fonts) {
    const encodings = new Map(),
        definitions = new Map(),
        findings = [];
    for (const record of records ?? []) {
        if (
            !isNoteRecord(record) ||
            record.type !== "doc" ||
            (!Object.hasOwn(record.data ?? {}, "mappings") &&
                !Object.hasOwn(record.data ?? {}, "rules"))
        )
            continue;
        const identity = {
            package: record.package ?? config.contentPackage,
            system: "note",
            type: "doc",
            shortcode: record.shortcode,
        };
        const name = renderAddress(identity);
        const file =
            typeof record.file === "string" ?
                record.file
            :   path.resolve(
                    config.paths?.content ?? config.rootDir ?? ".",
                    record.file?.path ?? "",
                );
        let raw = record.raw ?? "";
        if (!raw && fs.existsSync(file) && fs.statSync(file).isFile())
            raw = fs.readFileSync(file, "utf8");
        try {
            const data = encodingData(record.data);
            if (!Object.hasOwn(config.languages ?? {}, data.language))
                throw new EncodingError(
                    `Encoding language \`${data.language}\` is not configured`,
                    { key: "language" },
                );
            const codes = fontCodes(fonts, data.font);
            const encoding = compileEncoding(data, { codes, name });
            if (encodings.has(name))
                throw new EncodingError(`Encoding document \`${name}\` is repeated`);
            encodings.set(name, encoding);
            definitions.set(name, { data, codes });
            if ((record.package ?? config.contentPackage) === config.contentPackage) {
                for (const alias of addressSuffixes(identity))
                    if (alias !== "default") encodings.set(alias, encoding);
            }
        } catch (error) {
            const own = !error.file || error.file === file;
            const key =
                error.key?.startsWith("mappings.") ?
                    ["mappings", error.key.slice("mappings.".length)]
                :   (error.key
                        ?.split(".")
                        .map((part) => (/^\d+$/.test(part) ? Number(part) : part)) ?? []);
            findings.push({
                file: error.file ?? file,
                ...(own ?
                    codePointPosition(raw, positionOfFrontmatterPath(raw, ["data", ...key]))
                :   {
                        ...(error.line === undefined ? {} : { line: error.line }),
                        ...(error.column === undefined ? {} : { column: error.column }),
                    }),
                severity: "error",
                message: error.message,
            });
        }
    }
    return { encodings, definitions, findings };
}
