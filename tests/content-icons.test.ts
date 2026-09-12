/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Naming an interface icon without drawing it (#378).
 *
 * The cases below turn on one decision: a note contains a **name**, never a
 * glyph. So the tests assert what that buys — the name survives the charset
 * check, an unknown one is reported rather than swallowed, and the rendered
 * output is the same Font Awesome element the system's own templates emit.
 *
 * Deliberately not covered here: which codepoint a name resolves to. The
 * renderer reads that from the font it embeds, and asserting a hand-copied
 * table would only test the copy.
 */

import { describe, it, expect } from "vitest";
import {
    checkIconRegistry,
    DEFAULT_ICONS,
    ICON_STYLES,
    iconHtml,
    iconPlugin,
    iconsIn,
    lintIcons,
    resolveIcon,
} from "../engine/content-icons.mjs";
import { isAllowedCodePoint } from "../engine/content-charset.mjs";
import markdownit from "markdown-it";

const render = (src: string, registry = DEFAULT_ICONS) =>
    markdownit({ html: true }).use(iconPlugin(registry)).renderInline(src);

describe("the registry", () => {
    it("declares only styles Font Awesome Free ships", () => {
        expect(checkIconRegistry(DEFAULT_ICONS)).toEqual([]);
    });

    it("gives every icon an accessible label", () => {
        for (const [name, entry] of Object.entries(DEFAULT_ICONS)) {
            expect(entry.label, name).toBeTruthy();
        }
    });

    it("covers the filled and hollow star as separate names", () => {
        // Same Font Awesome icon, different style — which is exactly why style
        // cannot be dropped from an entry, and why a codepoint alone would not
        // have distinguished them.
        expect(resolveIcon("star")!.style).toBe("solid");
        expect(resolveIcon("star-outline")!.style).toBe("regular");
        expect(resolveIcon("star")!.icon).toBe(resolveIcon("star-outline")!.icon);
    });

    it("names the three senses of ✕ separately, though one glyph draws them", () => {
        // "not applicable" in a column, "remove" on a control, "close" on a
        // dialog. Identical to look at, three different things to be told.
        const senses = ["not-applicable", "remove", "close"] as const;
        for (const n of senses) expect(resolveIcon(n)!.icon, n).toBe("xmark");
        const labels = senses.map((n) => resolveIcon(n)!.label);
        expect(new Set(labels).size).toBe(3);
    });

    it("gives the run control its own name rather than borrowing expand", () => {
        // `▶` runs an action; a screen reader saying "expand" would be wrong.
        expect(resolveIcon("run")!.icon).toBe("play");
        expect(resolveIcon("run")!.label).toContain("run");
        expect(resolveIcon("expand")!.icon).toBe("caret-right");
    });

    it("spells delete the way the sheets do", () => {
        // The system draws fa-trash 25 times and fa-trash-can never. A registry
        // that disagrees with the interface prints an icon nobody has seen.
        expect(resolveIcon("delete")!.icon).toBe("trash");
    });

    it("refuses a style Font Awesome Free does not ship", () => {
        const findings = checkIconRegistry({ x: { style: "duotone", icon: "star", label: "s" } });
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("duotone");
        expect(ICON_STYLES).not.toContain("duotone");
    });

    it("refuses an entry with no label, naming the consequence", () => {
        const findings = checkIconRegistry({ x: { style: "solid", icon: "star", label: "" } });
        expect(findings[0].message).toContain("read aloud");
    });

    it("refuses a value that is not an entry at all", () => {
        expect(checkIconRegistry({ x: "fa-star" } as never)).toHaveLength(1);
    });

    it("does not inherit names from the object prototype", () => {
        // `resolveIcon("constructor")` must miss, not return a function.
        expect(resolveIcon("constructor")).toBeNull();
        expect(resolveIcon("toString")).toBeNull();
    });
});

describe("the syntax", () => {
    it("is made only of characters the charset allows", () => {
        // The point of the whole exercise: a note names an icon in ASCII.
        for (const ch of ":icon-star-outline:") {
            expect(isAllowedCodePoint(ch.codePointAt(0)!), ch).toBe(true);
        }
    });

    it("finds each name written, in order", () => {
        const found = iconsIn("the :icon-star: and the :icon-edit: button");
        expect(found.map((f) => f.name)).toEqual(["star", "edit"]);
    });

    it("does not claim a bare colon or an emoji shortcode", () => {
        expect(iconsIn("a ratio of 3:1, and :smile: too")).toEqual([]);
    });

    it("does not claim an uppercase or underscored name", () => {
        expect(iconsIn(":icon-Star: :icon-my_icon:")).toEqual([]);
    });
});

describe("rendering", () => {
    it("emits the element the system's own templates emit", () => {
        expect(render("the :icon-star: there")).toContain('class="fa-solid fa-star"');
    });

    it("distinguishes the hollow star from the filled one", () => {
        expect(render(":icon-star-outline:")).toContain('class="fa-regular fa-star"');
    });

    it("gives the icon an accessible name rather than hiding it", () => {
        // "the ☆ toggles it" read aloud as "the toggles it" is a hole in a
        // sentence, so an inline icon is labelled, not aria-hidden.
        const html = render(":icon-edit:");
        expect(html).toContain('role="img"');
        expect(html).toContain('aria-label="edit"');
        expect(html).not.toContain("aria-hidden");
    });

    it("leaves an unknown name exactly as written", () => {
        // Visible on the page is how the author finds it without reading a log.
        expect(render("a :icon-stra: here")).toContain(":icon-stra:");
    });

    it("renders around surrounding markdown", () => {
        const html = render("**bold** :icon-star: _italic_");
        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain("fa-star");
        expect(html).toContain("<em>italic</em>");
    });

    it("renders several on one line", () => {
        const html = render(":icon-star::icon-star::icon-star-outline:");
        expect(html.match(/fa-solid fa-star/g)).toHaveLength(2);
        expect(html.match(/fa-regular fa-star/g)).toHaveLength(1);
    });

    it("does not render inside a code span", () => {
        expect(render("`:icon-star:`")).toContain(":icon-star:");
        expect(render("`:icon-star:`")).not.toContain("fa-star");
    });

    it("escapes a registry value rather than trusting it", () => {
        const html = render(":icon-x:", {
            x: { style: "solid", icon: 'star" onload="x', label: "s" },
        } as never);
        expect(html).not.toContain('onload="x"');
        expect(html).toContain("&quot;");
    });

    it("honours a package's own registry", () => {
        const html = render(":icon-anvil:", {
            anvil: { style: "solid", icon: "hammer", label: "crafting" },
        } as never);
        expect(html).toContain("fa-hammer");
    });
});

describe("linting", () => {
    it("reports an undeclared name", () => {
        const findings = lintIcons("the :icon-stra: button", "n.md");
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("does not declare");
    });

    it("suggests the name that was probably meant", () => {
        expect(lintIcons(":icon-stra:", "n.md")[0].message).toContain(":icon-star:");
    });

    it("offers no suggestion when nothing is close", () => {
        const message = lintIcons(":icon-zzzzzzzzzz:", "n.md")[0].message;
        expect(message).not.toContain("did you mean");
    });

    it("says nothing about a declared name", () => {
        expect(lintIcons("the :icon-delete: control", "n.md")).toEqual([]);
    });

    it("locates the name it reports", () => {
        const findings = lintIcons("ok\nok\nthe :icon-nope: here", "n.md");
        expect(findings[0].line).toBe(3);
        expect(findings[0].column).toBe(5);
    });
});
