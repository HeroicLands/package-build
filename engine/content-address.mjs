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
 * Where a content note publishes on the web.
 *
 * One rule, in one place, because two builds need the same answer: the
 * knowledgebase build renders the page, and the link manifest records the
 * address other packages link to. Stating it twice is how a manifest comes to
 * assert a URL that resolves at build time and 404s for the reader.
 */

import { contentSlug } from "./content-slug.mjs";
// The scheme vocabulary is part of the configuration contract — a
// repository names its scheme in `package-build.config.yaml` — so it is
// declared beside the rest of that vocabulary rather than here, and this
// module reads it. `config.mjs` is the leaf entry point and imports nothing
// but `node:path` and `engine/ids.mjs`, so the direction cannot close a
// cycle (see `engine/pack-config.mjs`).
import { DEFAULT_ADDRESS_SCHEME, LANDING_RULES } from "../content-config.mjs";

export { DEFAULT_ADDRESS_SCHEME, LANDING_RULES };

/** The knowledgebase's mount within this package's site (#1470). */
export const KB_PREFIX = "kb/";

/**
 * The URL section a note routes to.
 *
 * A `doc` is narrative content whose only identity is its subtype label, so it
 * routes by `category`; every other type names its own section.
 *
 * @param {object} fm - Parsed frontmatter.
 * @returns {string|undefined} The section, or `undefined` when the note has
 *   none — a `doc` with no category has no address and is not published.
 */
export function sectionOf(fm) {
    return fm.type === "doc" ? fm.category : fm.type;
}

/**
 * A note's address below the knowledgebase mount, e.g. `affliction/aconite/`.
 *
 * A `README.md` **is** its section's landing page rather than a page within it,
 * so it addresses the section itself and has no slug of its own.
 *
 * @param {object} fm - Parsed frontmatter.
 * @param {string} name - The note's display name; the slug derives from it
 *   (#1278), never from the shortcode, which is identity rather than
 *   presentation.
 * @param {boolean} isReadme - Whether the file is a `README.md`.
 * @returns {string} The section-relative address, with a trailing slash.
 * @throws {Error} When the name yields no usable slug.
 */
export function contentAddress(fm, name, isReadme) {
    const sec = sectionOf(fm);
    return isReadme ? `${sec}/` : `${sec}/${contentSlug(name)}/`;
}

/**
 * Whether a note is a landing page under a scheme, and what it lands at.
 *
 * @param {object} fm - Parsed frontmatter.
 * @param {boolean} isReadme - Whether the file is a `README.md`.
 * @param {string} landing - The landing rule, one of {@link LANDING_RULES}.
 * @returns {{landing: true, segment: string}|{landing: false}|{landing: true, segment: undefined}}
 *   `segment` is the single path segment the note addresses. A `collection`
 *   note that declares no `section` is a landing page with no segment — an
 *   error rather than a page, since it names nowhere to land.
 */
function landingOf(fm, isReadme, landing) {
    if (landing === "readme") {
        return isReadme ? { landing: true, segment: sectionOf(fm) } : { landing: false };
    }
    // `collection`. The section is authored rather than derived: it is the
    // identity of the section being introduced, and the note's own title
    // ("Creatures") is presentation, which would slug to something else.
    if (fm.type === "doc" && fm.category === "collection") {
        return { landing: true, segment: fm.section || fm.slug };
    }
    return { landing: false };
}

/**
 * A note's address relative to its **package**, e.g. `kb/affliction/aconite/`.
 *
 * This is the form the link manifest records and the site build emits pages at,
 * and it is one function because those two must agree — a manifest asserting an
 * address the site does not publish resolves at build time and 404s for the
 * reader, which is the failure this module exists to prevent.
 *
 * @param {object} fm - Parsed frontmatter.
 * @param {string} name - The note's display name; a page slug derives from it
 *   (#1278), never from the shortcode, which is identity rather than
 *   presentation.
 * @param {object} [options] - Options.
 * @param {boolean} [options.isReadme] - Whether the file is a `README.md`.
 * @param {{prefix?: string, landing?: string}} [options.scheme] - The
 *   repository's address scheme; defaults to {@link DEFAULT_ADDRESS_SCHEME}.
 * @returns {string} The package-relative address, with a trailing slash and no
 *   leading one.
 * @throws {Error} When the note has no address — no section, a landing page
 *   naming no section, or a name yielding no usable slug. Each is a note that
 *   is not published, and inventing an address for one would put a dead entry
 *   in the manifest.
 */
export function packageAddress(fm, name, { isReadme = false, scheme } = {}) {
    const { prefix, landing } = { ...DEFAULT_ADDRESS_SCHEME, ...scheme };
    if (!LANDING_RULES.includes(landing)) {
        throw new Error(
            `unknown landing rule ${JSON.stringify(landing)} — expected one ` +
                `of ${LANDING_RULES.join(", ")}`,
        );
    }
    const land = landingOf(fm, isReadme, landing);
    if (land.landing) {
        if (typeof land.segment !== "string" || !land.segment) {
            throw new Error(`landing note declares no section, so it lands nowhere`);
        }
        return `${prefix}${land.segment}/`;
    }
    const sec = sectionOf(fm);
    if (typeof sec !== "string" || !sec) {
        throw new Error(`type "${fm.type}" has no section`);
    }
    return `${prefix}${sec}/${contentSlug(name)}/`;
}
