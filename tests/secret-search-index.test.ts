/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Secret text stays out of the site's search index.
 *
 * Pagefind indexes collapsed and `hidden` text alike, and quotes it in result
 * excerpts, so a secret is withheld from search only by `data-pagefind-ignore`
 * on the element that holds it.
 */

import { describe, expect, it } from "vitest";
import { renderBlocks, renderWithheldSections } from "../engine/content-blocks.mjs";
import { renderSpans } from "../engine/content-spans.mjs";

describe("secrets on the web", () => {
    it("keeps a secret block out of the search index", () => {
        const html = renderBlocks(':::secret {title="For the GM"}\nGM text.\n:::', "web").markdown;
        expect(html).toMatch(/<details [^>]*data-pagefind-ignore[^>]*>/);
    });

    it("keeps a withheld section out of the search index", () => {
        const html = renderWithheldSections("# The Cellar {#cellar .secret}\n\nGM text.\n");
        expect(html).toMatch(/<details [^>]*data-pagefind-ignore[^>]*>/);
    });

    it("keeps an inline secret out of the search index", () => {
        const html = renderSpans("A [hidden thing]{.secret} here.").markdown;
        expect(html).toMatch(/<span [^>]*data-inline-secret[^>]*data-pagefind-ignore/);
    });
});
