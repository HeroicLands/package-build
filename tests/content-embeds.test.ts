/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * `![[address|label]]` — the wikilink that renders a picture where it stands.
 *
 * Three claims are pinned here, and each is one an embed can fail quietly.
 *
 * **It resolves to an ordinary image.** The embed's whole value is that every
 * surface already knows what to do with `![alt](pathname){directive}`, so the
 * rewrite is what is asserted rather than three renderings of it. A label that
 * stops reaching the alt text, or a directive that stops reaching the braces,
 * is a picture that publishes looking almost right.
 *
 * **It reaches asset types only.** The syntax invites transclusion of an
 * arbitrary note, and a `being` embedded as a picture would resolve to nothing
 * and print as literal brackets.
 *
 * **Its directive is the image directive.** One construct, one parser: a second
 * narrower one would accept `{float: top-left}` and quietly drop
 * `{.full-width, float: top-left}`, which looks exactly like a directive that
 * worked.
 */

import { describe, it, expect } from "vitest";

import {
    EMBED_DEFAULT_TYPE,
    checkEmbeds,
    embedsIn,
    resolveEmbeds,
} from "../engine/content-embeds.mjs";
import { LINK_FINDING_REASONS, linkFindingMessage } from "../engine/wikilink-syntax.mjs";
import { ASSET_TYPE_NAMES } from "../engine/asset-types.mjs";

/**
 * An index shaped as every asset resolver reads one, holding three files.
 *
 * `types` carries the note types as well as the asset ones, so an embed naming
 * `being` is refused for being the wrong *kind* of type rather than for naming
 * an unknown one — which are different findings with different fixes.
 */
const index = {
    contentPackage: "thalorna",
    packages: new Set(["thalorna", "sohl"]),
    types: new Set([...ASSET_TYPE_NAMES, "being", "skill"]),
    assets: new Map([
        [
            "thalorna-none-image-thorn",
            { package: "thalorna", asset: { path: "images/beings/thorn.webp" } },
        ],
        [
            "thalorna-none-icon-anvil",
            { package: "thalorna", asset: { path: "icons/tools/anvil.svg" } },
        ],
    ]),
    foreign: new Map([
        ["sohl-none-image-anvil", { package: "sohl", asset: { path: "images/tools/anvil.webp" } }],
    ]),
};

const rewrite = (body: string) => resolveEmbeds(body, { index }).markdown;
const reasons = (body: string) => resolveEmbeds(body, { index }).unresolved.map((u) => u.reason);

describe("the syntax supplies the default type", () => {
    it("defaults a bare shortcode to `image`", () => {
        expect(EMBED_DEFAULT_TYPE).toBe("image");
        expect(rewrite("![[thorn|Thorn]]\n")).toBe(
            "![Thorn](thalorna/assets/images/beings/thorn.webp)\n",
        );
    });

    it("reads a stated type rather than defaulting it", () => {
        expect(rewrite("![[icon-anvil|An anvil]]\n")).toBe(
            "![An anvil](thalorna/assets/icons/tools/anvil.svg)\n",
        );
    });

    it("resolves a qualified address into another package", () => {
        expect(rewrite("![[sohl-none-image-anvil|Anvil]]\n")).toBe(
            "![Anvil](sohl/assets/images/tools/anvil.webp)\n",
        );
    });
});

describe("a label is alt text, and an absent one is a finding", () => {
    it("carries the label through as the alt text", () => {
        expect(rewrite("![[thorn|Thorn of the Vale]]\n")).toContain("![Thorn of the Vale](");
    });

    it("renders an empty label as deliberately decorative", () => {
        expect(rewrite("![[thorn|]]\n")).toBe("![](thalorna/assets/images/beings/thorn.webp)\n");
        expect(reasons("![[thorn|]]\n")).toEqual([]);
    });

    it("reports an unlabelled embed and leaves it as authored", () => {
        expect(reasons("![[thorn]]\n")).toEqual(["unlabelled"]);
        expect(rewrite("![[thorn]]\n")).toBe("![[thorn]]\n");
    });
});

describe("an embed reaches asset types only", () => {
    it("refuses a note type with its own reason", () => {
        expect(reasons("![[being-thorn|Thorn]]\n")).toEqual(["not-an-asset"]);
        expect(rewrite("![[being-thorn|Thorn]]\n")).toBe("![[being-thorn|Thorn]]\n");
    });

    it("names the reason in the shared vocabulary", () => {
        expect(LINK_FINDING_REASONS.has("not-an-asset")).toBe(true);
        expect(
            linkFindingMessage({ reason: "not-an-asset", target: "being-thorn", type: "being" }),
        ).toContain("being");
    });

    it("reports an address nothing publishes", () => {
        expect(reasons("![[nosuchthing|Nothing]]\n")).toEqual(["unresolved"]);
    });

    it("locates a non-asset embed by file, line and column", () => {
        const findings = checkEmbeds("Prose.\n\n![[being-thorn|Thorn]]\n", "Lore/Vale.md", {
            bodyLine: 9,
            index,
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            file: "Lore/Vale.md",
            line: 11,
            column: 1,
            severity: "error",
        });
    });
});

describe("the directive is the image directive, whole", () => {
    it("accepts a named size alongside a float", () => {
        const source = "![[thorn|Thorn]]{size: medium, float: top-left}\n";
        expect(checkEmbeds(source, "x.md", { index })).toEqual([]);
        expect(rewrite(source)).toBe(
            "![Thorn](thalorna/assets/images/beings/thorn.webp){size: medium, float: top-left}\n",
        );
    });

    it("locates an invalid size", () => {
        expect(checkEmbeds("![[thorn|Thorn]]{size: huge}\n", "x.md", { index })).toEqual([
            expect.objectContaining({ file: "x.md", line: 1, column: 17, severity: "error" }),
        ]);
    });

    it("honours a float", () => {
        expect(rewrite("![[thorn|Thorn]]{float: top-left}\n")).toBe(
            "![Thorn](thalorna/assets/images/beings/thorn.webp){float: top-left}\n",
        );
    });

    it("honours a width class", () => {
        expect(rewrite("![[thorn|Thorn]]{.full-width}\n")).toBe(
            "![Thorn](thalorna/assets/images/beings/thorn.webp){.full-width}\n",
        );
    });

    it("honours both, in either order", () => {
        expect(rewrite("![[thorn|Thorn]]{.full-width, float: top-left}\n")).toBe(
            "![Thorn](thalorna/assets/images/beings/thorn.webp){.full-width, float: top-left}\n",
        );
        expect(rewrite("![[thorn|Thorn]]{float: top-left, .full-width}\n")).toBe(
            "![Thorn](thalorna/assets/images/beings/thorn.webp){float: top-left, .full-width}\n",
        );
    });

    it("refuses an unrecognised value, located, and honours no part of it", () => {
        const findings = checkEmbeds("![[thorn|Thorn]]{.fullwidth, float: middle}\n", "x.md", {
            index,
        });
        expect(findings).toHaveLength(2);
        for (const finding of findings) {
            expect(finding.severity).toBe("error");
            expect(finding.column).toBe(17);
        }
        // Nothing partial: the braces stay as written, so the mistake is on the
        // page as well as in the log.
        expect(rewrite("![[thorn|Thorn]]{.fullwidth, float: middle}\n")).toBe(
            "![[thorn|Thorn]]{.fullwidth, float: middle}\n",
        );
    });
});

describe("an embed is a block, and code is verbatim", () => {
    it("reports an embed sharing its paragraph with prose", () => {
        const findings = checkEmbeds("See ![[thorn|Thorn]] there.\n", "x.md", { index });
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
        expect(findings[0].message).toContain("block");
    });

    it("leaves an embed inside a fence exactly as written", () => {
        const fenced = "```markdown\n![[thorn|Thorn]]{float: top-left}\n```\n";
        expect(rewrite(fenced)).toBe(fenced);
        expect(checkEmbeds(fenced, "x.md", { index })).toEqual([]);
        expect(embedsIn(fenced)).toEqual([]);
    });
});

describe("an embed is never read as an ordinary link", () => {
    it("consumes the `!`, so the inner brackets are not a wikilink", () => {
        const { markdown } = resolveEmbeds("![[thorn|Thorn]]\n[[skill-clmb|Climbing]]\n", {
            index,
        });
        expect(markdown).toBe(
            "![Thorn](thalorna/assets/images/beings/thorn.webp)\n[[skill-clmb|Climbing]]\n",
        );
    });

    it("reports two identical embeds at their own positions", () => {
        const body = "![[nosuchthing|A]]\n\n![[nosuchthing|A]]\n";
        const offsets = resolveEmbeds(body, { index }).unresolved.map((u) => u.offset);
        expect(offsets).toEqual([0, 20]);
    });
});
