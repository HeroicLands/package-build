/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Naming an interface icon without drawing it.
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
    familyOf,
    EMPTY_ICON_REGISTRY,
    iconHtml,
    iconPlugin,
    iconsIn,
    lintIcons,
    parseIconAttributes,
    resolveIcon,
} from "../engine/content-icons.mjs";
import { isAllowedCodePoint } from "../engine/content-charset.mjs";
import markdownit from "markdown-it";

/**
 * A registry standing in for a consumer's own.
 *
 * Nothing ships one, so these tests supply the data the mechanism operates on.
 * The entries are chosen to exercise the shape rather than to be anyone's real
 * vocabulary: a filled and hollow pair, three names for one glyph, and both
 * families.
 */
const REGISTRY = {
    families: {
        fontawesome: {
            class: "fa",
            styles: ["solid", "regular", "brands"],
            describe: "Font Awesome Free",
        },
        "game-icons": {
            class: "ginf",
            styles: [],
            describe: "the Game-Icons.net webfont a package builds for itself",
        },
    },
    defaultFamily: "fontawesome",
    icons: {
        star: { style: "solid", icon: "star", label: "star" },
        "star-outline": { style: "regular", icon: "star", label: "hollow star" },
        gem: { style: "solid", icon: "gem", label: "value gem" },
        "gem-outline": { style: "regular", icon: "gem", label: "unearned value gem" },
        diamond: { style: "solid", icon: "gem", label: "value gem" },
        edit: { style: "solid", icon: "pen-to-square", label: "edit" },
        delete: { style: "solid", icon: "trash", label: "delete" },
        add: { style: "solid", icon: "plus", label: "add" },
        remove: { style: "solid", icon: "xmark", label: "remove" },
        "not-applicable": { style: "solid", icon: "xmark", label: "not applicable" },
        close: { style: "solid", icon: "xmark", label: "close" },
        run: { style: "solid", icon: "play", label: "run this action" },
        expand: { style: "solid", icon: "caret-right", label: "expand" },
        "context-menu": {
            style: "solid",
            icon: "ellipsis-vertical",
            fixedWidth: true,
            label: "context menu",
        },
        broadsword: { family: "game-icons", icon: "broadsword", label: "weapon" },
    },
} as never;

const render = (src: string, registry: never = REGISTRY) =>
    markdownit({ html: true }).use(iconPlugin(registry)).renderInline(src);

describe("the registry", () => {
    it("declares only styles Font Awesome Free ships", () => {
        expect(checkIconRegistry(REGISTRY)).toEqual([]);
    });

    it("gives every icon an accessible label", () => {
        for (const [name, entry] of Object.entries(REGISTRY.icons)) {
            expect(entry.label, name).toBeTruthy();
        }
    });

    it("covers the filled and hollow star as separate names", () => {
        // Same Font Awesome icon, different style — which is exactly why style
        // cannot be dropped from an entry, and why a codepoint alone would not
        // have distinguished them.
        expect(resolveIcon("star", REGISTRY)!.style).toBe("solid");
        expect(resolveIcon("star-outline", REGISTRY)!.style).toBe("regular");
        expect(resolveIcon("star", REGISTRY)!.icon).toBe(
            resolveIcon("star-outline", REGISTRY)!.icon,
        );
    });

    it("names the three senses of ✕ separately, though one glyph draws them", () => {
        // "not applicable" in a column, "remove" on a control, "close" on a
        // dialog. Identical to look at, three different things to be told.
        const senses = ["not-applicable", "remove", "close"] as const;
        for (const n of senses) expect(resolveIcon(n, REGISTRY)!.icon, n).toBe("xmark");
        const labels = senses.map((n) => resolveIcon(n, REGISTRY)!.label);
        expect(new Set(labels).size).toBe(3);
    });

    it("gives the run control its own name rather than borrowing expand", () => {
        // `▶` runs an action; a screen reader saying "expand" would be wrong.
        expect(resolveIcon("run", REGISTRY)!.icon).toBe("play");
        expect(resolveIcon("run", REGISTRY)!.label).toContain("run");
        expect(resolveIcon("expand", REGISTRY)!.icon).toBe("caret-right");
    });

    it("spells delete the way the sheets do", () => {
        // The system draws fa-trash 25 times and fa-trash-can never. A registry
        // that disagrees with the interface prints an icon nobody has seen.
        expect(resolveIcon("delete", REGISTRY)!.icon).toBe("trash");
    });

    it("refuses a style Font Awesome Free does not ship", () => {
        const findings = checkIconRegistry({
            families: {
                fontawesome: {
                    class: "fa",
                    styles: ["solid", "regular", "brands"],
                    describe: "Font Awesome Free",
                },
                "game-icons": { class: "ginf", styles: [], describe: "Game-Icons" },
            },
            defaultFamily: "fontawesome",
            icons: { x: { style: "duotone", icon: "star", label: "s" } },
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("duotone");
        expect(REGISTRY.families.fontawesome.styles).not.toContain("duotone");
    });

    it("refuses an entry with no label, naming the consequence", () => {
        const findings = checkIconRegistry({
            families: {
                fontawesome: {
                    class: "fa",
                    styles: ["solid", "regular", "brands"],
                    describe: "Font Awesome Free",
                },
                "game-icons": { class: "ginf", styles: [], describe: "Game-Icons" },
            },
            defaultFamily: "fontawesome",
            icons: { x: { style: "solid", icon: "star", label: "" } },
        });
        expect(findings[0].message).toContain("read aloud");
    });

    it("refuses a value that is not an entry at all", () => {
        expect(
            checkIconRegistry({
                families: {
                    fontawesome: {
                        class: "fa",
                        styles: ["solid", "regular", "brands"],
                        describe: "Font Awesome Free",
                    },
                    "game-icons": { class: "ginf", styles: [], describe: "Game-Icons" },
                },
                defaultFamily: "fontawesome",
                icons: { x: "fa-star" },
            } as never),
        ).toHaveLength(1);
    });

    it("does not inherit names from the object prototype", () => {
        // `resolveIcon("constructor", REGISTRY)` must miss, not return a function.
        expect(resolveIcon("constructor", REGISTRY)).toBeNull();
        expect(resolveIcon("toString", REGISTRY)).toBeNull();
    });
});

describe("icon families", () => {
    const GINF = REGISTRY;

    it("defaults an entry with no family to Font Awesome", () => {
        expect(familyOf(REGISTRY.icons.star, REGISTRY)).toBe("fontawesome");
        expect(render(":icon-star:")).toContain('class="fa-solid fa-star"');
    });

    it("draws a Game-Icons entry with its own prefix and no weight", () => {
        // The family has no weights, so there is no style class to emit.
        const html = render(":icon-broadsword:", GINF);
        expect(html).toContain('class="ginf-broadsword"');
        expect(html).not.toContain("fa-solid");
    });

    it("still carries the accessible name across families", () => {
        expect(render(":icon-broadsword:", GINF)).toContain('aria-label="weapon"');
    });

    it("applies a size to either family", () => {
        // The generated Game-Icons stylesheet mirrors Font Awesome's box
        // metrics deliberately, so the size classes work for both.
        expect(render(":icon-broadsword:{size: 2x}", GINF)).toContain("fa-2x");
        expect(render(":icon-star:{size: 2x}")).toContain("fa-2x");
    });

    it("accepts a Game-Icons entry that names no style", () => {
        expect(
            checkIconRegistry({
                families: REGISTRY.families,
                defaultFamily: "fontawesome",
                icons: { broadsword: REGISTRY.icons.broadsword },
            } as never),
        ).toEqual([]);
    });

    it("reports a style on a family that has no weights", () => {
        const findings = checkIconRegistry({
            families: REGISTRY.families,
            defaultFamily: "fontawesome",
            icons: {
                x: { family: "game-icons", style: "solid", icon: "broadsword", label: "w" },
            },
        } as never);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("no weights");
    });

    it("reports a family nobody declared", () => {
        const findings = checkIconRegistry({
            families: REGISTRY.families,
            defaultFamily: "fontawesome",
            icons: { x: { family: "noto", icon: "star", label: "s" } },
        } as never);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("fontawesome, game-icons");
    });

    it("still requires a style on Font Awesome entries", () => {
        const findings = checkIconRegistry({
            families: REGISTRY.families,
            defaultFamily: "fontawesome",
            icons: { x: { icon: "star", label: "s" } },
        } as never);
        expect(findings.some((f) => f.message.includes("names style"))).toBe(true);
    });
});

describe("the value gem", () => {
    it("draws the pair from fa-gem, which has both weights", () => {
        // fa-diamond is the playing-card suit and ships solid only, so it can
        // spell no hollow half of a filled/hollow pair.
        expect(resolveIcon("gem", REGISTRY)!.icon).toBe("gem");
        expect(resolveIcon("gem", REGISTRY)!.style).toBe("solid");
        expect(resolveIcon("gem-outline", REGISTRY)!.style).toBe("regular");
    });

    it("keeps `diamond` working, pointing at the gem", () => {
        expect(resolveIcon("diamond", REGISTRY)!.icon).toBe("gem");
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
            ...REGISTRY,
            icons: { x: { style: "solid", icon: 'star" onload="x', label: "s" } },
        } as never);
        expect(html).not.toContain('onload="x"');
        expect(html).toContain("&quot;");
    });

    it("honours a package's own registry", () => {
        const html = render(":icon-anvil:", {
            ...REGISTRY,
            icons: { anvil: { style: "solid", icon: "hammer", label: "crafting" } },
        } as never);
        expect(html).toContain("fa-hammer");
    });
});

describe("attributes", () => {
    it("renders a size as the Font Awesome class", () => {
        expect(render(":icon-star:{size: 2x}")).toContain("fa-2x");
    });

    it("tolerates spacing the way a writer would type it", () => {
        for (const src of [
            ":icon-star:{size: lg}",
            ":icon-star:{size:lg}",
            ":icon-star:{ size : lg }",
        ]) {
            expect(render(src), src).toContain("fa-lg");
        }
    });

    it("takes more than one pair, comma-separated", () => {
        // Only `size` exists today; the parser must not assume that.
        const { attrs, problems } = parseIconAttributes("size: xl");
        expect(attrs).toEqual({ size: "xl" });
        expect(problems).toEqual([]);
    });

    it("renders the bare form with no size class", () => {
        const html = render(":icon-star:");
        expect(html).toContain("fa-star");
        expect(html).not.toMatch(/fa-(lg|xl|2x|3x)/);
    });

    it("keeps the accessible name whatever the size", () => {
        expect(render(":icon-delete:{size: 3x}")).toContain('aria-label="delete"');
    });

    it("reports a size that is not in the vocabulary", () => {
        const findings = lintIcons(":icon-star:{size: 9x}", "n.md", REGISTRY);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("lg, xl, 2x, 3x");
    });

    it("reports an attribute nobody declared, rather than ignoring it", () => {
        const findings = lintIcons(":icon-star:{colour: red}", "n.md", REGISTRY);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("not an icon attribute");
    });

    it("reports a pair written without its colon", () => {
        const findings = lintIcons(":icon-star:{2x}", "n.md", REGISTRY);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("`key: value`");
    });

    it("still renders when an attribute cannot be honoured", () => {
        // The icon is right and the size is wrong; hiding the icon would be a
        // worse answer than drawing it and reporting the size.
        expect(render(":icon-star:{size: 9x}")).toContain("fa-star");
    });

    it("says nothing about attributes when the name itself is unknown", () => {
        // One token, one rewrite, one finding.
        expect(lintIcons(":icon-nope:{size: 9x}", "n.md", REGISTRY)).toHaveLength(1);
    });

    it("does not swallow a brace that is not ours", () => {
        const html = render("plain :icon-star: then {not: mine}");
        expect(html).toContain("fa-star");
        expect(html).toContain("{not: mine}");
    });
});

describe("severity", () => {
    // `reportFindings` fails on an error and not on a warning, so this is what
    // keeps an undeclared icon name from breaking a consumer's build.
    it("reports an undeclared name as a warning, never an error", () => {
        const findings = lintIcons(":icon-nope:", "n.md", REGISTRY);
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("warning");
    });

    it("reports a bad attribute as a warning too", () => {
        const findings = lintIcons(":icon-star:{size: 9x}", "n.md", REGISTRY);
        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("warning");
    });
});

describe("linting", () => {
    it("reports an undeclared name", () => {
        const findings = lintIcons("the :icon-stra: button", "n.md", REGISTRY);
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("does not declare");
    });

    it("suggests the name that was probably meant", () => {
        expect(lintIcons(":icon-stra:", "n.md", REGISTRY)[0].message).toContain(":icon-star:");
    });

    it("offers no suggestion when nothing is close", () => {
        const message = lintIcons(":icon-zzzzzzzzzz:", "n.md", REGISTRY)[0].message;
        expect(message).not.toContain("did you mean");
    });

    it("says nothing about a declared name", () => {
        expect(lintIcons("the :icon-delete: control", "n.md", REGISTRY)).toEqual([]);
    });

    it("locates the name it reports", () => {
        const findings = lintIcons("ok\nok\nthe :icon-nope: here", "n.md", REGISTRY);
        expect(findings[0].line).toBe(3);
        expect(findings[0].column).toBe(5);
    });
});

describe("what a package that declares nothing gets", () => {
    it("is an empty registry, not a starter set", () => {
        // A starter set would be a promise about fonts this package does not
        // ship, and a vocabulary belonging to one game system besides.
        expect(EMPTY_ICON_REGISTRY.icons).toEqual({});
        expect(EMPTY_ICON_REGISTRY.families).toEqual({});
    });

    it("names no icon, so a note's token stays visible on the page", () => {
        expect(resolveIcon("star", EMPTY_ICON_REGISTRY)).toBeNull();
        expect(render(":icon-star:", EMPTY_ICON_REGISTRY)).toContain(":icon-star:");
    });

    it("reports the name rather than passing it through in silence", () => {
        const findings = lintIcons(":icon-star:", "n.md", EMPTY_ICON_REGISTRY);

        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain("the registry does not declare");
    });
});

describe("fixed width", () => {
    it("is the table's to say, and rides on the entry", () => {
        // Whether `fa-ellipsis-vertical` is too narrow to sit in a column of
        // controls is a fact about that glyph, true everywhere it is drawn —
        // not something a note asks for at one use site.
        expect(iconHtml(resolveIcon("context-menu", REGISTRY) as never, {}, REGISTRY)).toContain(
            "fa-fw",
        );
    });

    it("is absent from a glyph that does not ask for it", () => {
        expect(iconHtml(resolveIcon("star", REGISTRY) as never, {}, REGISTRY)).not.toContain(
            "fa-fw",
        );
    });

    it("is refused on a family with no such class", () => {
        const findings = checkIconRegistry({
            families: REGISTRY.families,
            icons: {
                sword: {
                    family: "game-icons",
                    icon: "broadsword",
                    fixedWidth: true,
                    label: "sword",
                },
            },
        } as never);

        expect(findings).toHaveLength(1);
        expect(findings[0].message).toMatch(/fixed width/);
    });
});
