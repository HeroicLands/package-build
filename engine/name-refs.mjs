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
 * The `ref=` attribute of a `.name` span: the note a spelling belongs to, or a
 * page-local key for a subject with no note. Shape findings need no catalog;
 * resolution findings take the prepared name catalog.
 * @module
 */

import { rebaseNameSpans } from "./name-markup.mjs";
import { scanSpans } from "./content-spans.mjs";

/** A page-local key: `#` then a word of letters, digits, `_` and `-`. */
const LOCAL_KEY = /^#[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;

const isName = (span) =>
    span.attrs.some(([key, value]) => key === "class" && value.split(/\s+/).includes("name"));

/**
 * Whether a `ref` value is a page-local key rather than a note address.
 * @param {string} ref - The attribute value as written.
 * @returns {boolean} True for a value beginning with `#`.
 */
export const isLocalRef = (ref) => ref.startsWith("#");

/**
 * The `ref` a span states.
 * @param {{attrs: ReadonlyArray<readonly [string, string]>}} span - A parsed span.
 * @returns {string|null} The value as written, or null when the span has none.
 */
export function readNameRef(span) {
    return span.attrs.find(([key]) => key === "ref")?.[1] ?? null;
}

/** A finding at a named attribute part, with the position left out when unknown. */
function at(span, key, part, file, message) {
    const site = span.attributePositions?.[key]?.[part];
    return {
        ...(file === undefined ? {} : { file }),
        ...(Number.isFinite(site?.line) ? { line: site.line } : {}),
        ...(Number.isFinite(site?.column) ? { column: site.column } : {}),
        severity: "error",
        message,
    };
}

/**
 * The `ref=` findings that depend on the span alone.
 * @param {ReadonlyArray<import("./names.mjs").ParsedNameSpan>} spans - Every parsed span, at file coordinates.
 * @param {{file?: string}} [options] - Authored source file.
 * @returns {Array<{file?: string, line?: number, column?: number, severity: "error", message: string}>} One error per defect.
 */
export function nameRefFindings(spans, { file } = {}) {
    const findings = [];
    for (const span of spans) {
        const ref = readNameRef(span);
        if (ref === null) continue;
        if (!isName(span)) {
            findings.push(
                at(
                    span,
                    "ref",
                    "key",
                    file,
                    "ref= belongs on a .name span; a wikilink never takes ref",
                ),
            );
            continue;
        }
        if (span.attrs.some(([key]) => key === "data-type"))
            findings.push(
                at(
                    span,
                    "data-type",
                    "key",
                    file,
                    "data-type is for a name with no note; the ref states the type",
                ),
            );
        if (isLocalRef(ref) && !LOCAL_KEY.test(ref))
            findings.push(
                at(
                    span,
                    "ref",
                    "value",
                    file,
                    `ref ${JSON.stringify(ref)} must be a note address or a page-local key such as #jane`,
                ),
            );
    }
    return findings;
}

/**
 * Create the check that every note `ref=` of a note names a note.
 * @param {object} options - The lint's prepared inputs.
 * @param {import("./names.mjs").NameCatalog} options.catalog - Resolves an address to its note.
 * @param {Map<string, {raw: string, body: string, bodyLine?: number, bodyColumn?: number}>} [options.parsed] - Captured authored bodies.
 * @param {import("./content-session.mjs").ContentSyntax} [options.syntax] - Exact-text scanner projections.
 * @returns {(note: {file: string, raw: string}) => Array<{file: string, line?: number, column?: number, severity: "error", message: string}>} One error per unresolved address.
 */
export function createNameRefChecker({ catalog, parsed, syntax }) {
    return ({ file, raw }) => {
        const authored = parsed?.get(file);
        const spans =
            authored?.raw === raw && Number.isInteger(authored.bodyLine) ?
                rebaseNameSpans(
                    (syntax ? syntax(authored.body).spans : scanSpans(authored.body)).names,
                    {
                        raw,
                        bodyLine: authored.bodyLine,
                        bodyColumn: authored.bodyColumn,
                    },
                )
            :   scanSpans(raw).names;
        const findings = [];
        for (const span of spans) {
            const ref = readNameRef(span);
            if (ref === null || isLocalRef(ref) || catalog.resolve(ref)) continue;
            findings.push(
                at(
                    span,
                    "ref",
                    "value",
                    file,
                    `ref ${JSON.stringify(ref)} names no note in this package or its declared dependencies`,
                ),
            );
        }
        return findings;
    };
}
