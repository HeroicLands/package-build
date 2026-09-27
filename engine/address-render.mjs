/* SPDX-License-Identifier: GPL-3.0-or-later */

import { assertSystemSegment } from "./systems.mjs";

/**
 * Render the four segments of a complete Address in lowercase.
 * @param {{package: string, system: string, type: string, shortcode: string}} tuple
 * @returns {string} The canonical Address.
 */
export function renderAddress(tuple) {
    const { package: pkg, system, type, shortcode } = tuple;
    assertSystemSegment(system, `the address of ${type}-${shortcode}`);
    return `${pkg}-${system}-${type}-${shortcode}`.toLowerCase();
}

/** Render every written suffix of one complete Address. */
export function addressSuffixes(tuple) {
    const full = renderAddress(tuple);
    const { system, type, shortcode } = tuple;
    return [
        String(shortcode).toLowerCase(),
        [type, shortcode].join("-").toLowerCase(),
        [system, type, shortcode].join("-").toLowerCase(),
        full,
    ];
}
