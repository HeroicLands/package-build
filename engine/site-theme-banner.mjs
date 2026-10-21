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
 * **A page's banner image.** {@link bannerUrl} turns a note's banner fields into
 * the address of the hero image, or into `""` when the page has none.
 *
 * Resolution, in order:
 *
 * 1. `data.banner` — a note's own hero image, which the content build resolved
 *    from an asset address. It is used as given; a blank one declines an image.
 * 2. `banner` — a hand-authored page's value. `none` or `false` declines an
 *    image, a full URL is used as written, and anything else is a fragment
 *    under `images/`.
 * 3. `<dir>/<name>.webp` — the default for the page's kind: the banner
 *    `banner-kinds.yaml` maps its `type` and `subType` to, or its `category`
 *    for the types the mapping lists as taking theirs from there.
 * 4. `<dir>/<fallback>` — whenever the name step 2 or 3 picked is not in the
 *    declared inventory of `banners.yaml`. An asset host cannot be asked
 *    whether a name exists, so the inventory stands in for the test, and each
 *    name that misses is reported once.
 *
 * The inventory is checked only for a relative path directly inside the banner
 * directory; an absolute URL, a step 1 address and a fragment elsewhere under
 * `images/` pass through.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

import { cdnUrl } from "./site-theme-urls.mjs";

/** The directory holding the banner inventory and the kind mapping. */
export const BANNER_DATA_DIR = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "site-theme",
    "data",
);

/** @type {{banners: object, kinds: object}|undefined} */
let shipped;

/**
 * The banner data the theme ships.
 *
 * @returns {{banners: object, kinds: object}} The inventory and the kind mapping.
 */
export function shippedBannerData() {
    shipped ??= {
        banners: YAML.parse(fs.readFileSync(path.join(BANNER_DATA_DIR, "banners.yaml"), "utf8")),
        kinds: YAML.parse(fs.readFileSync(path.join(BANNER_DATA_DIR, "banner-kinds.yaml"), "utf8")),
    };
    return shipped;
}

/** The text of a value as a template prints it, with an unset value as `<nil>`. */
const printed = (value) => (value === undefined || value === null ? "<nil>" : String(value));

/**
 * The address of a page's banner.
 *
 * @param {object} site - The site: `params.cdnBaseURL` and `basePath`.
 * @param {object} fields - What the page states.
 * @param {object} [fields.data] - The page's `data`, read for the resolved `banner`.
 * @param {unknown} [fields.banner] - The hand-authored `banner` value.
 * @param {string} [fields.type] - The note `type`.
 * @param {string} [fields.subType] - The note `subType`.
 * @param {string} [fields.category] - The page's `category`.
 * @param {string} [fields.subtype] - The name to default to when no `type` is given.
 * @param {string} [fields.context] - The page address, named in a report.
 * @param {object} [options] - Options.
 * @param {{banners: object, kinds: object}} [options.data] - The inventory and the
 *   kind mapping. The shipped ones by default.
 * @param {(finding: {severity: string, message: string, page?: string}) => void} [options.report] -
 *   Receives each name that misses the inventory, once.
 * @param {Set<string>} [options.reported] - The names already reported.
 * @returns {string} The address, or `""` when the page has no banner.
 */
export function bannerUrl(site, fields, { data = shippedBannerData(), report, reported } = {}) {
    const banners = data.banners ?? {};
    const kinds = data.kinds ?? {};
    const dir = banners.dir || "images/banners";
    const fallback = banners.fallback || "default.webp";
    const available = banners.available ?? [];

    let subtype = fields.subtype ?? "";
    if (fields.type) {
        const entry = (kinds.kinds ?? {})[fields.type];
        if ((kinds.categoryTypes ?? []).includes(fields.type)) {
            subtype = fields.category || "default";
        } else if (entry && typeof entry === "object") {
            subtype = entry[String(fields.subType ?? "").toLowerCase()] || fields.type;
        } else {
            subtype = entry || fields.type;
        }
    }

    const raw = printed(fields.banner);
    const declined = raw.toLowerCase() === "none" || raw === "false";
    const resolved = fields.data ? fields.data.banner : undefined;
    const fromBuild = resolved !== undefined && resolved !== null;

    let banner = "";
    let absolute = false;
    if (fromBuild) {
        banner = String(resolved);
        absolute = true;
    } else if (!declined) {
        if (fields.banner) {
            const value = String(fields.banner);
            banner = `images/${value.replace(/^\//, "")}`;
            if (/^(?:https?:)?\/\//.test(value)) {
                banner = value;
                absolute = true;
            }
        } else if (subtype) {
            banner = `${dir}/${subtype}.webp`;
        }
        if (banner && !absolute && path.posix.dirname(banner) === dir) {
            const name = path.posix.basename(banner, path.posix.extname(banner));
            if (!available.includes(name)) {
                if (!reported?.has(name)) {
                    reported?.add(name);
                    report?.({
                        severity: "warning",
                        page: fields.context || undefined,
                        message:
                            `hero-banner: no banner named "${name}" in the shared artwork set; ` +
                            `falling back to ${dir}/${fallback}. Draw it and add "${name}" to ` +
                            "data/banners.yaml, or name a hero image with `data.banner`. " +
                            "Write `data.banner: none` to decline a hero image.",
                    });
                }
                banner = `${dir}/${fallback}`;
            }
        }
    }
    return banner ? cdnUrl(site, banner) : "";
}
