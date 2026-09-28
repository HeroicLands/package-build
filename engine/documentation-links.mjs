/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import path from "node:path";

import { parseMarkdownFile } from "./helpers.mjs";

const LOCAL_MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^\s)]+\.md(?:#[^\s)]*)?)\)/g;

/** Keep repository-relative documentation links usable on addressed pages. */
export function documentationLinksPass({ config, book = false }) {
    const root = config.paths.content;
    const cache = new Map();
    return {
        beforeLinks(text, page) {
            return text.replace(LOCAL_MARKDOWN_LINK, (whole, label, target) => {
                const [fileName, fragment] = target.split("#", 2);
                const file = path.resolve(path.dirname(page.file), fileName);
                if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) return whole;
                let address = cache.get(file);
                if (!address) {
                    const { frontmatter } = parseMarkdownFile(file);
                    if (!frontmatter?.type || !frontmatter?.shortcode) return whole;
                    address = `/${config.contentPackage}/${frontmatter.type}-${frontmatter.shortcode}/`;
                    cache.set(file, address);
                }
                return `[${label}](${address}${fragment && !book ? `#${fragment}` : ""})`;
            });
        },
    };
}
