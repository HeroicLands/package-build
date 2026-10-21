/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * The pages a site build collected, as a test reads them.
 *
 * `buildSite` renders every page and returns it: the note's frontmatter as the
 * page publishes it, and the expanded Markdown. {@link builtPages} sets each
 * out as a note — the frontmatter above the body, the body prepared for the
 * `web` renderer — keyed by the file name its address gives it, so a case reads
 * a page the way an author reads a note. The homepage is `_index.md`.
 */

import { createRenderer } from "../../engine/content-render.mjs";
import { encodeAddresses } from "../../engine/note-addresses.mjs";
import { writeMatter } from "../../engine/note-matter.mjs";

const renderer = createRenderer("web");

/**
 * Every page a build published, as note text.
 *
 * @param built - What `buildSite` returned.
 * @returns The note text of each page by file name; empty when the build
 *   stopped at a gate.
 */
export function builtPages(built: any): Record<string, string> {
    const out: Record<string, string> = {};
    if (!built.site) return out;
    for (const entry of built.site.pages) {
        const body = renderer.prepare(entry.markdown, {
            runs: built.site.runs,
            figures: entry.figures,
            resolveSrc: (src: string) => src,
        });
        out[`${entry.page.slug}.md`] = writeMatter(body, encodeAddresses(entry.data));
    }
    for (const home of built.site.homepages)
        out["_index.md"] = writeMatter(home.body, encodeAddresses(home.data));
    return out;
}
