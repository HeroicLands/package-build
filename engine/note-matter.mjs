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
 * **A page's frontmatter, read and written.** Reading splits and parses a note
 * exactly as the content index does ({@link splitFrontmatter} and `yaml`), so a
 * value reads the same on the site and in the preview as in a compendium pack.
 * Writing serializes with `js-yaml`, which quotes every string a YAML 1.1
 * reader would take for a boolean, a number or a timestamp, so each
 * value reads back as the string or number it was.
 *
 * @module
 */

import YAML from "yaml";
import { dump } from "js-yaml";
import { splitFrontmatter } from "./diagnostics.mjs";

/**
 * A page split at its frontmatter.
 *
 * @typedef {object} NoteMatter
 * @property {unknown} data - The parsed frontmatter; an empty map where the
 *   page has none or the block is empty.
 * @property {string} content - The body after the closing fence and its line
 *   break, or the whole text where there is no frontmatter.
 * @property {string} matter - The YAML source between the fences; empty where
 *   there is no frontmatter.
 */

/**
 * Split a page's frontmatter from its body and parse it.
 *
 * @param {string} source - The complete Markdown source.
 * @returns {NoteMatter} The parsed frontmatter, the body and the YAML source.
 * @throws {Error} The `yaml` parse error, where the frontmatter is not YAML.
 */
export function readMatter(source) {
    const fence = splitFrontmatter(source);
    if (!fence) return { data: {}, content: source, matter: "" };
    return { data: YAML.parse(fence.yaml) ?? {}, content: fence.body, matter: fence.yaml };
}

/**
 * A page with `data` as its frontmatter above `content`.
 *
 * @param {string} content - The body.
 * @param {Record<string, unknown>} data - The frontmatter.
 * @returns {string} The fenced YAML, then the body closed on a line break; the
 *   body alone where `data` serializes to an empty map.
 */
export function writeMatter(content, data) {
    const yaml = dump(data).trim();
    const body = content.endsWith("\n") ? content : `${content}\n`;
    return yaml === "{}" ? body : `---\n${yaml}\n---\n${body}`;
}
