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
 * **Addresses in the site layouts.** The layouts carry no address of their own:
 * every URL they write comes from the site's configuration or from a page's
 * data, and a site served under a path prefix such as `/thalorna/` needs its own
 * links to carry the prefix without writing it down anywhere.
 *
 * | Function | Resolves |
 * | -------- | -------- |
 * | {@link relUrl} | a path inside the site, under its base path |
 * | {@link cdnUrl} | an asset path, against `params.cdnBaseURL` when the site has one |
 * | {@link siteUrl} | a consumer-supplied link: absolute, a fragment, or a path in the site |
 * | {@link safeUrl} | a link from data, refused when its scheme could run script |
 *
 * @module
 */

import { slugify } from "./content-slug.mjs";

/** Whether an address names a host: `http://`, `https://` or `//`. */
export function isAbsoluteUrl(url) {
    return /^(?:https?:)?\/\//.test(String(url ?? ""));
}

/**
 * The path a site is served under, with a leading and a trailing slash.
 *
 * @param {object} site - The site; `baseURL` is its address.
 * @returns {string} `/` for a site at its origin's root, `/thalorna/` for one under a prefix.
 */
export function basePath(site) {
    if (!site.baseURL) return "/";
    const { pathname } = new URL(site.baseURL, "https://site.invalid");
    return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

/**
 * A path inside the site, under its base path.
 *
 * A leading slash is dropped first: it would otherwise read as "from the
 * origin" and leave the base path off.
 *
 * @param {object} site - The site.
 * @param {string} [target] - The path; empty for the site's root.
 * @returns {string} The address.
 */
export function relUrl(site, target = "") {
    return `${basePath(site)}${String(target).replace(/^\/+/, "")}`;
}

/**
 * An asset path, resolved against the site's asset host.
 *
 * An absolute address is returned as written. Otherwise the path is joined onto
 * `params.cdnBaseURL`, and with none set it is a path inside the site.
 *
 * @param {object} site - The site; `params.cdnBaseURL` is the asset root.
 * @param {string} target - The asset path.
 * @returns {string} The address.
 */
export function cdnUrl(site, target) {
    if (isAbsoluteUrl(target)) return target;
    const rel = String(target).replace(/^\/+/, "");
    const root = site.params?.cdnBaseURL;
    return root ? `${String(root).replace(/\/+$/, "")}/${rel}` : relUrl(site, rel);
}

/**
 * A link a consuming site supplied, resolved against the site it is rendered on.
 *
 * An absolute address, a fragment and a query are returned as written; anything
 * else is a path inside the site.
 *
 * @param {object} site - The site.
 * @param {string} [url] - The link; empty for the site's root.
 * @returns {string} The address.
 */
export function siteUrl(site, url = "") {
    const value = String(url ?? "");
    return isAbsoluteUrl(value) || value.startsWith("#") || value.startsWith("?") ?
            value
        :   relUrl(site, value);
}

/** A scheme that can run script or load a document of the page's own origin. */
const UNSAFE_SCHEME = /^\s*(?:javascript|vbscript|data):/i;

/**
 * A link from a page's data, with a scheme that could run script refused.
 *
 * @param {unknown} url - The link as the data states it.
 * @returns {string} The link, or `#` when its scheme is not one a reader should follow.
 */
export function safeUrl(url) {
    const value = String(url ?? "");
    // Control characters and spaces are dropped by a browser inside a scheme.
    const bare = value.replace(/[\u0000- ]/g, "");
    return UNSAFE_SCHEME.test(bare) ? "#" : value;
}

/**
 * The address of a tag's listing page.
 *
 * One function writes it for the link in a page's tag row and for the page the
 * site build writes, so the two cannot disagree.
 *
 * @param {object} site - The site.
 * @param {string} tag - The tag.
 * @returns {string} The address.
 */
export function tagUrl(site, tag) {
    return relUrl(site, `tags/${slugify(tag)}/`);
}
