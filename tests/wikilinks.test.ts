/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
// Build-time pack helper (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import {
    PACK_BY_TYPE,
    packForType,
    anchorPageId,
    buildWikilinkIndex,
    convertWikilinks,
    readQualifier,
} from "../engine/wikilinks.mjs";
import { itemDocEntryId } from "../engine/item-docs.mjs";

/** A small stand-in content tree spanning three packs. */
const DOCS = [
    {
        type: "doc",
        id: "aaaaaaaaaaaaaaa1",
        shortcode: "shock",
        name: "Shock",
    },
    {
        type: "doc",
        id: "aaaaaaaaaaaaaaa2",
        shortcode: "bleeding",
        name: "Bleeding",
    },
    {
        type: "doc",
        id: "aaaaaaaaaaaaaaa3",
        shortcode: "coma",
        name: "Coma",
    },
    {
        type: "doc",
        id: "aaaaaaaaaaaaaaa4",
        shortcode: "extshock",
        name: "Extreme Shock",
    },
    {
        type: "skill",
        id: "bbbbbbbbbbbbbbb1",
        shortcode: "climb",
        name: "Climbing",
    },
    {
        type: "being",
        id: "ccccccccccccccc1",
        shortcode: "condor",
        name: "Condor",
    },
    {
        type: "macro",
        id: "ddddddddddddddd1",
        shortcode: "rollit",
        name: "Roll It",
    },
    {
        type: "containergear",
        id: "eeeeeeeeeeeeeee1",
        shortcode: "backpack",
        name: "Backpack",
    },
];

const index = buildWikilinkIndex(DOCS, "sohl");
const from = { type: "doc", id: "aaaaaaaaaaaaaaa2" }; // "Bleeding"

const convert = (src: string, ctx = from) => convertWikilinks(src, { ...ctx, index });

describe("packForType (content type → the pack it compiles into)", () => {
    it("routes the non-item types to their own packs", () => {
        // Pack *names*, not addresses: the package that owns them is supplied
        // by the caller, because it belongs to the repository doing the
        // building and not to the content.
        expect(packForType("doc")).toEqual({
            pack: "journals",
            docType: "JournalEntry",
        });
        expect(packForType("macro")).toEqual({
            pack: "macros",
            docType: "Macro",
        });
        expect(packForType("being")).toEqual({
            pack: "actors",
            docType: "Actor",
        });
        // A map note compiles into a Scene, so a link to one addresses the
        // scenes pack rather than falling through to items.
        for (const type of ["map"]) {
            expect(packForType(type)).toEqual({
                pack: "scenes",
                docType: "Scene",
            });
        }
        // A bundle compiles into an Adventure — the installer a set of
        // documents is packaged as. Conventionally the `adventures`
        // pack, which is also what the scenes pass calls its companion; a
        // repository shipping both names them apart.
        expect(packForType("bundle")).toEqual({
            pack: "adventures",
            docType: "Adventure",
        });
        expect(Object.keys(PACK_BY_TYPE).sort()).toEqual([
            "being",
            "bundle",
            "doc",
            "lore",
            "macro",
            "map",
            "place",
            "scenario",
        ]);
    });

    it("routes every other type to the items pack, including one it has never seen", () => {
        for (const type of [
            "armorgear",
            "weapongear",
            "containergear",
            "miscgear",
            "skill",
            "attribute",
            "affliction",
            "trauma",
            "mystery",
            "mysticalability",
        ]) {
            expect(packForType(type)).toEqual({
                pack: "items",
                docType: "Item",
            });
        }
        // Item types are the open set, so a type added tomorrow is linkable the
        // day it is authored — no table to forget.
        expect(packForType("somenewgear")).toEqual({
            pack: "items",
            docType: "Item",
        });
    });
});

describe("anchorPageId (deterministic JournalEntryPage id for an anchor)", () => {
    it("is a valid 16-character Foundry id", () => {
        const id = anchorPageId("aaaaaaaaaaaaaaa1", "shock-state-index");
        expect(id).toMatch(/^[A-Za-z0-9]{16}$/);
    });

    it("is deterministic for the same note id and anchor slug", () => {
        expect(anchorPageId("aaaaaaaaaaaaaaa1", "shock-state-index")).toBe(
            anchorPageId("aaaaaaaaaaaaaaa1", "shock-state-index"),
        );
    });

    it("differs by anchor slug and by note id", () => {
        const a = anchorPageId("aaaaaaaaaaaaaaa1", "shock-state-index");
        expect(a).not.toBe(anchorPageId("aaaaaaaaaaaaaaa1", "shock-states"));
        expect(a).not.toBe(anchorPageId("aaaaaaaaaaaaaaa9", "shock-state-index"));
    });
});

describe("convertWikilinks", () => {
    it("converts a qualified link to a same-pack @UUID enricher", () => {
        const { markdown, unresolved } = convert("see [[doc/shock|the Shock rules]].");
        expect(markdown).toBe(
            "see @UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa1]{the Shock rules}.",
        );
        expect(unresolved).toEqual([]);
    });

    it("reports an unlabelled link, keeping the author's prose", () => {
        const { markdown, unresolved } = convert("worsens the [[Shock State]] of the victim");
        expect(markdown).toBe(
            `worsens the ${'<span class="sohl-unresolved-link" title="Unresolved link: Shock State">Shock State</span>'} of the victim`,
        );
        expect(unresolved[0]).toMatchObject({ reason: "unlabelled" });
    });

    it("crosses packs: a system-qualified skill link reaches the items pack", () => {
        // Qualified with the system, because prose defaults to `none` and a
        // bare link therefore names the documentation.
        const { markdown } = convert("a [[sohl-skill-climb|Climbing]] test");
        expect(markdown).toBe(
            "a @UUID[Compendium.sohl.items.Item.bbbbbbbbbbbbbbb1]{Climbing} test",
        );
    });

    it("routes actor and macro types to their packs", () => {
        expect(convert("[[sohl-being-condor|Condor]]").markdown).toBe(
            "@UUID[Compendium.sohl.actors.Actor.ccccccccccccccc1]{Condor}",
        );
        // A macro's own document is a core one, already at `none`, so the bare
        // form still names the Macro and is not redirected to its journal.
        expect(convert("[[macro/rollit|Roll It]]").markdown).toBe(
            "@UUID[Compendium.sohl.macros.Macro.ddddddddddddddd1]{Roll It}",
        );
    });

    it("resolves a type whose directory has no pack mapping of its own", () => {
        expect(convert("[[sohl-containergear-backpack|a backpack]]").markdown).toBe(
            "@UUID[Compendium.sohl.items.Item.eeeeeeeeeeeeeee1]{a backpack}",
        );
    });

    it("refuses a capitalised package, system or type segment", () => {
        // Those three are closed vocabularies with one spelling each, so
        // accepting `Skill` beside `skill` would bless two ways of writing one
        // address. Reported rather than folded.
        const { markdown, unresolved } = convert("[[SOHL-Skill-Climb|Climbing]]");
        expect(markdown).toBe(
            '<span class="sohl-unresolved-link" title="Unresolved link: SOHL-Skill-Climb">Climbing</span>',
        );
        expect(unresolved[0]).toMatchObject({ reason: "not-lowercase" });
    });

    it("keeps a mixed-case SHORTCODE, which is case-sensitive", () => {
        // A shortcode is written as the note declares it — `Clb`, `LtShoe`,
        // `HsTunic` are all real — so only the three segments in front of it
        // are held to lowercase.
        const { unresolved } = convert("[[sohl-skill-Climb|Climbing]]");
        expect(unresolved).toEqual([]);
    });

    it("converts a cross-page section link to a JournalEntryPage target", () => {
        const page = anchorPageId("aaaaaaaaaaaaaaa1", "shock-state-index");
        const { markdown } = convert("the [[doc/shock#shock-state-index|Shock State Index]]");
        expect(markdown).toBe(
            "the @UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa1.JournalEntryPage." +
                page +
                "]{Shock State Index}",
        );
    });

    it("resolves a same-page anchor against the source note itself", () => {
        const page = anchorPageId(from.id, "blood-loss-advance-test");
        const { markdown } = convert("see [[#blood-loss-advance-test|the advance test]]");
        expect(markdown).toBe(
            "see @UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa2.JournalEntryPage." +
                page +
                "]{the advance test}",
        );
    });

    it("accepts a table-escaped pipe (`\\|`) inside the link", () => {
        const { markdown } = convert("| [[doc/shock\\|Shock]] |");
        expect(markdown).toBe(
            "| @UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa1]{Shock} |",
        );
    });

    it("resolves an address from any source type", () => {
        // An address is not scoped to the citing note, so the same link means
        // the same document wherever it is written.
        const { markdown, unresolved } = convert("[[doc-coma|Coma]]", {
            type: "skill",
            id: "bbbbbbbbbbbbbbb1",
        });
        expect(markdown).toBe(
            "@UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa3]{Coma}",
        );
        expect(unresolved).toEqual([]);
    });

    it("leaves an unlabelled link untouched and reports it", () => {
        const { markdown, unresolved } = convert("a [[Coma]] state");
        expect(markdown).toBe(
            `a ${'<span class="sohl-unresolved-link" title="Unresolved link: Coma">Coma</span>'} state`,
        );
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0]).toMatchObject({
            target: "Coma",
            reason: "unlabelled",
        });
    });

    it("leaves an unknown shortcode untouched and reports it", () => {
        const { markdown, unresolved } = convert("the [[doc/nosuchcode|Injury]] rules");
        expect(markdown).toBe(
            `the ${'<span class="sohl-unresolved-link" title="Unresolved link: doc/nosuchcode">Injury</span>'} rules`,
        );
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0].reason).toBe("unresolved");
    });

    it("rejects a qualifier that is not a content type — including the retired directory form", () => {
        const { markdown, unresolved } = convert("the [[Rules/shock|Shock]] rules");
        expect(markdown).toBe(
            `the ${'<span class="sohl-unresolved-link" title="Unresolved link: Rules/shock">Shock</span>'} rules`,
        );
        expect(unresolved[0]).toMatchObject({ reason: "unknown-type" });
    });

    it("never touches external markdown links or intra-page markdown", () => {
        const src = "see [Kelestia](https://www.kelestia.com/) and ![art](icons/a.svg)";
        expect(convert(src).markdown).toBe(src);
    });

    it("converts every link on a line, and leaves surrounding prose alone", () => {
        const { markdown } = convert("[[doc/shock|Shock]] and [[sohl-skill-climb|Climbing]] both");
        expect(markdown).toBe(
            "@UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa1]{Shock} and " +
                "@UUID[Compendium.sohl.items.Item.bbbbbbbbbbbbbbb1]{Climbing} both",
        );
    });
});

/**
 * An item and its documentation are two different documents in two different
 * packs, so they need two different addresses. `skill/climb` is the item;
 * `docskill/climb` is the JournalEntry that item's prose compiled into.
 */
describe("convertWikilinks — the `doc<type>` virtual qualifier", () => {
    const climbDoc = itemDocEntryId("bbbbbbbbbbbbbbb1");

    it("addresses the item doc entry, not the item", () => {
        const { markdown, unresolved } = convert("see [[docskill/climb|the Climbing rules]]");
        expect(markdown).toBe(
            `see @UUID[Compendium.sohl.journals.JournalEntry.${climbDoc}]{the Climbing rules}`,
        );
        expect(unresolved).toEqual([]);
        // The two addresses must not collide.
        expect(climbDoc).not.toBe("bbbbbbbbbbbbbbb1");
    });

    it("addresses a page within the item doc via an anchor", () => {
        const page = anchorPageId(climbDoc, "crafting");
        const { markdown } = convert("the [[docskill/climb#crafting|crafting rules]]");
        expect(markdown).toBe(
            "the @UUID[Compendium.sohl.journals.JournalEntry." +
                `${climbDoc}.JournalEntryPage.${page}]{crafting rules}`,
        );
    });

    it("hashes the anchor against the item doc entry id, never the item id", () => {
        const page = anchorPageId(climbDoc, "crafting");
        expect(page).not.toBe(anchorPageId("bbbbbbbbbbbbbbb1", "crafting"));
    });

    it("works for any item type, including one it has never seen", () => {
        const backpackDoc = itemDocEntryId("eeeeeeeeeeeeeee1");
        expect(convert("[[doccontainergear/backpack|Backpack]]").markdown).toBe(
            `@UUID[Compendium.sohl.journals.JournalEntry.${backpackDoc}]{Backpack}`,
        );
    });

    it("refuses the virtual qualifier in mixed case, like any other address", () => {
        // The lowercase rule is the address's, not a per-form exception, so the
        // virtual `doc<type>` spelling is held to it too.
        const { unresolved } = convert("[[DocSkill/Climb|Climbing]]");
        expect(unresolved[0]).toMatchObject({ reason: "not-lowercase" });
        expect(convert("[[docskill/climb|Climbing]]").markdown).toBe(
            `@UUID[Compendium.sohl.journals.JournalEntry.${climbDoc}]{Climbing}`,
        );
    });

    it("points a bare prose link at the documentation, not the item", () => {
        // Body prose is under no system block, so the system defaults to
        // `none` — and a note's `none` address IS its `doc<type>` journal. From
        // prose it is almost always the written page a reader wants, not the
        // Item's sheet. This used to emit the Item's UUID.
        expect(convert("[[skill/climb|Climbing]]").markdown).toMatch(
            /^@UUID\[Compendium\.sohl\.journals\.JournalEntry\./,
        );
        expect(convert("[[skill-climb|Climbing]]").markdown).toMatch(
            /^@UUID\[Compendium\.sohl\.journals\.JournalEntry\./,
        );
    });

    it("points at the item when the link states the system", () => {
        // "and if not, then we should be using the full format" — stating the
        // system is how prose reaches the Item.
        expect(convert("[[sohl-skill-climb|Climbing]]").markdown).toBe(
            "@UUID[Compendium.sohl.items.Item.bbbbbbbbbbbbbbb1]{Climbing}",
        );
    });

    it("leaves a system-less type at its own document", () => {
        // `doc` carries no `doc<type>` form, so `none` names the note itself
        // and nothing is redirected.
        expect(convert("[[doc-extshock|Extreme Shock]]").markdown).toBe(
            "@UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa4]{Extreme Shock}",
        );
    });

    it("rejects `doc` applied to a type that has no item doc", () => {
        // A `doc` note compiles to the journals pack, and its single document
        // *is* the prose — so there is no separate documentation to address,
        // and `docdoc` names nothing.
        //
        // `docbeing` is deliberately not tested here: an
        // actor publishes documentation like every other system-bearing note,
        // so it is a valid qualifier. See the case below.
        for (const [link, text, target] of [["[[docdoc/shock|Shock]]", "Shock", "docdoc/shock"]]) {
            const { markdown, unresolved } = convert(link);
            // The author's text survives, marked so the reader can tell a link
            // was meant. Dropping it would silently rewrite the sentence.
            expect(markdown).toBe(
                `<span class="sohl-unresolved-link" title="Unresolved link: ${target}">${text}</span>`,
            );
            expect(unresolved[0]).toMatchObject({ reason: "unknown-type" });
        }
    });

    it("resolves `docbeing` to the actor's documentation journal", () => {
        // The counterpart of the case above. A being's prose is a page a reader
        // wants to arrive at, so it has a documentation journal and an address
        // that names it — which is what a bare prose link defaults to.
        const { markdown, unresolved } = convert("[[docbeing/condor|Condor]]");
        expect(unresolved).toEqual([]);
        expect(markdown).toMatch(/^@UUID\[Compendium\.sohl\.journals\.JournalEntry\./);
        expect(markdown).toMatch(/\{Condor\}$/);
    });

    it("reports an unknown shortcode under a valid virtual qualifier", () => {
        const { markdown, unresolved } = convert("[[docskill/nosuchcode|Nope]]");
        expect(markdown).toBe(
            '<span class="sohl-unresolved-link" title="Unresolved link: docskill/nosuchcode">Nope</span>',
        );
        expect(unresolved[0]).toMatchObject({ reason: "unresolved" });
    });

    it("ignores an anchor applied to an Item — an Item has no pages", () => {
        // Only a JournalEntry has pages. Rather than forge a JournalEntryPage id
        // onto a document that can never hold one, the anchor
        // is simply dropped and the link addresses the item.
        //
        // Reaching the Item from prose means stating the system; the
        // bare form names the documentation, where the anchor does address a
        // page — see the case below.
        const { markdown, unresolved } = convert("[[sohl-skill-climb#crafting|Climbing]]");
        expect(markdown).toBe("@UUID[Compendium.sohl.items.Item.bbbbbbbbbbbbbbb1]{Climbing}");
        expect(markdown).not.toContain("JournalEntryPage");
        expect(unresolved).toEqual([]);
    });

    it("carries the anchor when prose names the documentation", () => {
        // The same anchor, on the same authored link, now lands on a real page:
        // a bare prose link names the note's `none` address, which is its
        // documentation journal, and a journal does have pages. It used to be
        // dropped because the link addressed the Item.
        const page = anchorPageId(climbDoc, "crafting");
        expect(convert("[[skill-climb#crafting|Climbing]]").markdown).toBe(
            "@UUID[Compendium.sohl.journals.JournalEntry." +
                `${climbDoc}.JournalEntryPage.${page}]{Climbing}`,
        );
    });

    it("ignores an anchor on an actor or a macro for the same reason", () => {
        expect(convert("[[sohl-being-condor#wings|Condor]]").markdown).toBe(
            "@UUID[Compendium.sohl.actors.Actor.ccccccccccccccc1]{Condor}",
        );
        expect(convert("[[macro/rollit#step|Roll It]]").markdown).toBe(
            "@UUID[Compendium.sohl.macros.Macro.ddddddddddddddd1]{Roll It}",
        );
    });

    it("still honours the anchor on the item's documentation", () => {
        // The same anchor that is meaningless on the item addresses a real page
        // on its item doc.
        const page = anchorPageId(climbDoc, "crafting");
        expect(convert("[[docskill/climb#crafting|Crafting]]").markdown).toBe(
            "@UUID[Compendium.sohl.journals.JournalEntry." +
                `${climbDoc}.JournalEntryPage.${page}]{Crafting}`,
        );
    });

    it("prefers a real content type over the virtual reading of the same name", () => {
        // Were a type literally named `docskill` ever authored, it would own the
        // qualifier — the virtual form is only consulted when no such type exists.
        const withReal = buildWikilinkIndex(
            [
                ...DOCS,
                {
                    type: "docskill",
                    id: "fffffffffffffff1",
                    shortcode: "climb",
                },
            ],
            "sohl",
        );
        const { markdown } = convertWikilinks("[[docskill/climb|X]]", {
            ...from,
            index: withReal,
        });
        expect(markdown).toBe("@UUID[Compendium.sohl.items.Item.fffffffffffffff1]{X}");
    });
});

describe("convertWikilinks — the `type-shortcode` separator", () => {
    it("resolves a hyphen-qualified target exactly as the slash form does", () => {
        const slash = convert("[[doc/shock|the Shock rules]]");
        const hyphen = convert("[[doc-shock|the Shock rules]]");
        expect(hyphen.markdown).toBe(slash.markdown);
        expect(hyphen.unresolved).toEqual([]);
    });

    it("crosses types", () => {
        // Until the separator was understood this resolved only from a `doc`
        // note and silently failed from every other type — 283 links at the
        // time.
        const fromSkill = { type: "skill", id: "bbbbbbbbbbbbbbb1" };
        const { markdown, unresolved } = convert("[[doc-shock|Shock]]", fromSkill);
        expect(markdown).toBe(
            "@UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa1]{Shock}",
        );
        expect(unresolved).toEqual([]);
    });

    it("carries an anchor through to the page target", () => {
        const page = anchorPageId("aaaaaaaaaaaaaaa1", "shock-state-index");
        expect(convert("[[doc-shock#shock-state-index|Index]]").markdown).toBe(
            "@UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa1" +
                `.JournalEntryPage.${page}]{Index}`,
        );
    });

    it("reaches every pack, like the slash form", () => {
        // System-qualified, since a bare prose link names the documentation;
        // the point here is the hyphen form reaching each pack.
        expect(convert("[[sohl-skill-climb|Climbing]]").markdown).toBe(
            "@UUID[Compendium.sohl.items.Item.bbbbbbbbbbbbbbb1]{Climbing}",
        );
        expect(convert("[[sohl-being-condor|Condor]]").markdown).toBe(
            "@UUID[Compendium.sohl.actors.Actor.ccccccccccccccc1]{Condor}",
        );
    });

    it("supports the `doc<type>` virtual qualifier", () => {
        const climbDoc = itemDocEntryId("bbbbbbbbbbbbbbb1");
        expect(convert("[[docskill-climb|the Climbing rules]]").markdown).toBe(
            `@UUID[Compendium.sohl.journals.JournalEntry.${climbDoc}]{the Climbing rules}`,
        );
    });

    it("refuses the hyphen form too when it carries an uppercase letter", () => {
        const { unresolved } = convert("[[Sohl-Skill-Climb|Climbing]]");
        expect(unresolved[0]).toMatchObject({ reason: "not-lowercase" });
    });

    // This used to split at the *first* hyphen so a shortcode could contain one
    // (`self-pro`). Every segment is `^[A-Za-z0-9]+$`, and the
    // grammar positional — three segments is `<system>-<type>-<shortcode>` —
    // so the two rules cannot both hold. The charset rule wins: it is enforced,
    // and no tree has ever used the tolerance (138,204 authored shortcodes
    // across four trees, none carrying a separator).
    it("does not read a hyphenated shortcode, which the charset forbids", () => {
        const withHyphenCode = buildWikilinkIndex(
            [...DOCS, { type: "trauma", id: "99999999999999a1", shortcode: "self-pro" }],
            "sohl",
        );
        const { markdown, unresolved } = convertWikilinks("[[trauma-self-pro|Self-Protective]]", {
            ...from,
            index: withHyphenCode,
        });
        // `trauma` is not a system, so three segments parse as nothing at all —
        // reported, rather than silently resolved by a rule the linter would
        // reject the shortcode under anyway.
        expect(markdown).toContain("sohl-unresolved-link");
        expect(unresolved).toHaveLength(1);
    });

    it("does not split a hyphenated *name* — it is not a qualified target", () => {
        // `Grukar-ahk` is a note name, not `type-shortcode`. A hyphen only
        // qualifies when what precedes it is a known type, which is why the
        // hyphen form cannot be treated as unconditionally qualified the way
        // the slash form is. Written with a label it is a defect; the point
        // here is that it is *not* read as `Grukar` + `ahk`.
        const { markdown, unresolved } = convert("[[Grukar-ahk|the Ahk]]");
        expect(markdown).toBe(
            '<span class="sohl-unresolved-link" title="Unresolved link: Grukar-ahk">the Ahk</span>',
        );
        expect(unresolved[0]).toMatchObject({ reason: "not-an-address" });
    });

    it("reports an unknown shortcode under a valid type", () => {
        const { markdown, unresolved } = convert("[[doc-nosuchcode|Nope]]");
        expect(markdown).toBe(
            '<span class="sohl-unresolved-link" title="Unresolved link: doc-nosuchcode">Nope</span>',
        );
        expect(unresolved[0]).toMatchObject({ reason: "unresolved" });
    });
});

// An address written with an *empty* label — `[[x|]]`. It is the one form that
// shows the target's own name rather than text the author wrote, so a rename
// reaches every citation with no link edited.
describe("convertWikilinks — an address with an empty label", () => {
    it("shows a qualified target's document name, not its shortcode", () => {
        // `doc-shock` is an *address*, not prose: showing it to the reader
        // leaks the shortcode into the sentence.
        expect(convert("see [[doc-shock|]]").markdown).toBe(
            "see @UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa1]{Shock}",
        );
    });

    it("does the same for the legacy slash form", () => {
        expect(convert("see [[doc/shock|]]").markdown).toBe(
            "see @UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa1]{Shock}",
        );
    });

    it("shows the name of a target in another pack", () => {
        expect(convert("a [[sohl-skill-climb|]] test").markdown).toBe(
            "a @UUID[Compendium.sohl.items.Item.bbbbbbbbbbbbbbb1]{Climbing} test",
        );
    });

    it("keeps the name when the link carries an anchor", () => {
        const page = anchorPageId("aaaaaaaaaaaaaaa1", "shock-state-index");
        expect(convert("[[doc-shock#shock-state-index|]]").markdown).toBe(
            "@UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa1" +
                `.JournalEntryPage.${page}]{Shock}`,
        );
    });

    it("names the item behind the `doc<type>` virtual qualifier", () => {
        const climbDoc = itemDocEntryId("bbbbbbbbbbbbbbb1");
        expect(convert("[[docskill-climb|]]").markdown).toBe(
            `@UUID[Compendium.sohl.journals.JournalEntry.${climbDoc}]{Climbing}`,
        );
    });

    it("prefers the author's label over the document name", () => {
        expect(convert("[[doc-shock|the Shock rules]]").markdown).toBe(
            "@UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa1]{the Shock rules}",
        );
    });

    it("falls back to the target when the document has no name", () => {
        const nameless = buildWikilinkIndex(
            [
                {
                    type: "doc",
                    id: "88888888888888a1",
                    shortcode: "nameless",
                },
            ],
            "sohl",
        );
        const { markdown } = convertWikilinks("[[doc-nameless|]]", {
            ...from,
            index: nameless,
        });
        expect(markdown).toBe(
            "@UUID[Compendium.sohl.journals.JournalEntry.88888888888888a1]{doc-nameless}",
        );
    });
});

describe("readQualifier — the strict address grammar", () => {
    const TYPES = new Set(["skill", "doc", "being"]);
    const PACKAGES = new Set(["sohl", "thalorna"]);

    // `[[[[<package>-]<system>-]<type>-]<shortcode>]` — omission is strictly
    // left-to-right, so the written forms are exactly the suffixes of the
    // canonical one. There is no `<package>-<type>-<shortcode>`.
    it("reads the fully qualified form", () => {
        expect(readQualifier("thalorna-sohl-being-grod", TYPES, PACKAGES)).toEqual({
            package: "thalorna",
            system: "sohl",
            type: "being",
            shortcode: "grod",
            itemDoc: false,
        });
    });

    it("reads the system-qualified form, leaving the package to default", () => {
        const read = readQualifier("sohl-skill-lang", TYPES, PACKAGES);
        expect(read).toMatchObject({ system: "sohl", type: "skill", shortcode: "lang" });
        expect(read).not.toHaveProperty("package");
    });

    it("reads `none` as a system, for a document no game system defines", () => {
        expect(readQualifier("sohl-none-doc-gear", TYPES, PACKAGES)).toMatchObject({
            package: "sohl",
            system: "none",
            type: "doc",
            shortcode: "gear",
        });
    });

    it("leaves both undefined on a bare address", () => {
        const read = readQualifier("skill-lang", TYPES, PACKAGES);
        expect(read).toMatchObject({ type: "skill", shortcode: "lang" });
        expect(read).not.toHaveProperty("package");
        expect(read).not.toHaveProperty("system");
    });

    // The form that does not exist. `thalorna` is a package and not a system,
    // so this states a package with its system omitted — which the grammar has
    // no spelling for, because omission runs left to right.
    it("refuses a package with its system omitted", () => {
        expect(readQualifier("thalorna-being-grod", TYPES, PACKAGES)).toBeNull();
    });

    // `sohl` is *both* a package and a system, so a three-segment target
    // beginning with it is unambiguous only because the grammar is positional:
    // three segments is `<system>-<type>-<shortcode>`, whatever the first
    // segment could also have named.
    it("reads a three-segment `sohl-` target as a system, never as a package", () => {
        const read = readQualifier("sohl-skill-lang", TYPES, PACKAGES);
        expect(read).toMatchObject({ system: "sohl" });
        expect(read).not.toHaveProperty("package");
    });

    it("refuses a first segment that is neither a system nor a known package", () => {
        expect(readQualifier("nosuch-skill-lang", TYPES, PACKAGES)).toBeNull();
        expect(readQualifier("nosuch-sohl-skill-lang", TYPES, PACKAGES)).toBeNull();
    });

    it("refuses a middle segment that is not a system", () => {
        expect(readQualifier("thalorna-nosuch-being-grod", TYPES, PACKAGES)).toBeNull();
    });

    it("ignores the package reading when no packages are supplied", () => {
        // The pack build passes none, so a four-segment target is not an
        // address there at all.
        expect(readQualifier("thalorna-sohl-being-grod", TYPES)).toBeNull();
        // Three segments still read, because a system needs no package list.
        expect(readQualifier("sohl-skill-lang", TYPES)).toMatchObject({ system: "sohl" });
    });

    it("does not treat a note name as an address just because it has hyphens", () => {
        expect(readQualifier("Grukar-ahk", TYPES, PACKAGES)).toBeNull();
        expect(readQualifier("sohl-notatype-x", TYPES, PACKAGES)).toBeNull();
    });

    // Positional counting is sound only because every segment is
    // `^[A-Za-z0-9]+$` — verified across four content trees: 138,204
    // shortcodes, none carrying a separator. A fifth segment is therefore not a
    // hyphenated shortcode; it is not an address.
    it("refuses more segments than the grammar has", () => {
        expect(readQualifier("sohl-sohl-skill-lang-extra", TYPES, PACKAGES)).toBeNull();
    });

    it("still reads the virtual doc<type> form at every depth", () => {
        expect(readQualifier("docskill-wpnc", TYPES, PACKAGES)).toMatchObject({
            type: "skill",
            shortcode: "wpnc",
            itemDoc: true,
        });
        expect(readQualifier("thalorna-sohl-docskill-wpnc", TYPES, PACKAGES)).toMatchObject({
            package: "thalorna",
            system: "sohl",
            type: "skill",
            shortcode: "wpnc",
            itemDoc: true,
        });
    });

    it("still reads the legacy slash form, which states no system", () => {
        expect(readQualifier("skill/lang", TYPES, PACKAGES)).toMatchObject({
            type: "skill",
            shortcode: "lang",
        });
    });
});

describe("an unresolved link keeps its text and is marked", () => {
    const index = buildWikilinkIndex(DOCS, "sohl");
    const from = { type: "doc", id: "1111111111111111", index };

    it("keeps the label, so the sentence still reads", () => {
        const { markdown } = convertWikilinks("the [[skill-nosuchcode|climbing]] check", from);
        expect(markdown).toContain(">climbing</span>");
        expect(markdown).toContain("the ");
        expect(markdown).toContain(" check");
    });

    it("carries the class the stylesheet marks it with", () => {
        const { markdown } = convertWikilinks("[[skill-nosuchcode]]", from);
        expect(markdown).toContain('class="sohl-unresolved-link"');
    });

    it("names the failed address in the tooltip", () => {
        const { markdown } = convertWikilinks("[[skill-nosuchcode]]", from);
        expect(markdown).toContain('title="Unresolved link: skill-nosuchcode"');
    });

    it("escapes the text and the address, so content cannot inject markup", () => {
        const { markdown } = convertWikilinks(
            '[[skill-nosuchcode|<img src=x onerror="alert(1)">]]',
            from,
        );
        expect(markdown).not.toContain("<img");
        expect(markdown).toContain("&lt;img");
    });
});

describe("a code fence is verbatim", () => {
    it("leaves a nested array literal in a fence alone", () => {
        // `[[0]]` is not a link, and whether the old regex bit on it depended
        // on the array's shape — `[[1,2],[3,4]]` survived — so the corruption
        // looked arbitrary.
        const src = [
            "See [[doc-shock|]] for the rules.",
            "",
            "```js",
            "const first = grid[[0]];",
            "```",
            "",
            "And [[sohl-skill-climb|]] after.",
        ].join("\n");
        const { markdown, unresolved } = convert(src);
        expect(markdown).toContain("const first = grid[[0]];");
        expect(unresolved).toEqual([]);
        // The prose around it is still converted.
        expect(markdown).toContain(
            "@UUID[Compendium.sohl.journals.JournalEntry.aaaaaaaaaaaaaaa1]{Shock}",
        );
        expect(markdown).toContain("@UUID[Compendium.sohl.items.Item.bbbbbbbbbbbbbbb1]{Climbing}");
    });

    it("does not report a would-be link inside a fence as unresolved", () => {
        const { markdown, unresolved } = convert("```\n[[skill-nosuchcode]]\n```");
        expect(markdown).toBe("```\n[[skill-nosuchcode]]\n```");
        expect(unresolved).toEqual([]);
    });

    it("leaves an indented code block and an inline span alone", () => {
        const src = [
            "Example:",
            "",
            "    grid[[0]]",
            "",
            "Write `grid[[0]]` inline, and link [[doc-shock|]].",
        ].join("\n");
        const { markdown } = convert(src);
        expect(markdown).toContain("    grid[[0]]");
        expect(markdown).toContain("`grid[[0]]`");
        expect(markdown).toContain("@UUID[");
    });
});

describe("a `#section` the target does not declare", () => {
    const DOCS_WITH_ANCHORS = [
        {
            type: "doc",
            id: "fffffffffffffff1",
            shortcode: "guide",
            name: "Guide",
            anchors: new Set(["overview", "CamelCase"]),
        },
    ];
    const anchored = buildWikilinkIndex(DOCS_WITH_ANCHORS, "sohl");
    const here = { type: "doc", id: "aaaaaaaaaaaaaaa2" };
    const run = (src: string) => convertWikilinks(src, { ...here, index: anchored });

    it("resolves an anchor the target declares", () => {
        const out = run("[[doc-guide#overview|Overview]]");
        expect(out.markdown).toContain("@UUID[");
    });

    it("refuses one it does not, rather than hashing a page id for it", () => {
        // `anchorPageId` will hash any slug into a page id, so before this the
        // link compiled and dead-ended for the reader: the build emitted a
        // `@UUID` naming a JournalEntryPage that no heading declares.
        const out = run("[[doc-guide#missing|Missing]]");
        expect(out.markdown).not.toContain("@UUID[");
        const reasons = (out.unresolved ?? []).map((u: any) => u.reason);
        expect(reasons).toContain("unknown-anchor");
    });

    it("reports it with the shared reason the foreign path already used", () => {
        const out = run("[[doc-guide#missing|Missing]]");
        const finding = (out.unresolved ?? []).find((u: any) => u.reason === "unknown-anchor");
        expect(finding?.anchor).toBe("missing");
        expect(finding?.addressed).toBe(true);
    });

    it("matches the anchor exactly, capitals included", () => {
        expect(run("[[doc-guide#CamelCase|Cased]]").markdown).toContain("@UUID[");
    });

    it("says nothing when the index carries no anchor set", () => {
        // An index built without anchors cannot answer the question, and must
        // not answer it wrongly — the foreign path behaves the same way when a
        // manifest publishes no `anchors` map.
        const out = convertWikilinks("[[doc-extshock#whatever|X]]", { ...here, index });
        const reasons = (out.unresolved ?? []).map((u: any) => u.reason);
        expect(reasons).not.toContain("unknown-anchor");
    });
});
