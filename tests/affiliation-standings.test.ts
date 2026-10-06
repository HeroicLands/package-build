/* SPDX-License-Identifier: GPL-3.0-or-later */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    checkStandings,
    officeAnchor,
    officeRoster,
    rankLadder,
    readStandings,
    standingPhrase,
    standingsDigest,
} from "../engine/standings.mjs";
import { STANDING_KEYS } from "../engine/standing-terms.mjs";
import { decodeNoteAddresses } from "../engine/note-addresses.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { noteInfobox } from "../engine/infobox.mjs";
import { infoboxesToHtml } from "../engine/infobox-render.mjs";
import { buildReferenceTargets } from "../engine/reference-targets.mjs";
import { catalogueKey } from "../engine/actor-compiler.mjs";
import { contentPackage } from "../engine/content-package.mjs";
// eslint-disable-next-line
import { Actors } from "../sohl/actors.mjs";

/** The body every case below points at: six rungs and two posts. */
const tribes = {
    type: "affiliation",
    shortcode: "vrystwldtrbs",
    name: { full: "Vrystwald Tribes" },
    data: {
        governance: {
            ranks: [
                { level: 0, title: "Vrystrith", description: "Outcast." },
                { level: 4, title: "Fródrád", description: "Respected." },
                { level: 5, title: "Hárár", description: "First among them." },
            ],
            offices: {
                "War Chief": { description: "Leads the muster.", holders: [] },
                Treasurer: "Keeps the tally.",
            },
        },
    },
};

/** A body with no governance at all. */
const wardens = { type: "affiliation", shortcode: "greenwardens", name: { full: "Green Wardens" } };

const bodies: Record<string, { fm: object }> = {
    "thalorna-note-affiliation-vrystwldtrbs": { fm: tribes },
    "thalorna-note-affiliation-greenwardens": { fm: wardens },
};

const index = {
    contentPackage: "thalorna",
    types: new Set(["being", "affiliation", "place"]),
    packages: new Set(["thalorna"]),
    addressHit: (address: string) => bodies[address],
};

const raw = [
    "---",
    "shortcode: subject",
    "type: being",
    "data:",
    "  affiliations:",
    "    vrystwldtrbs:",
    "      rank: 4",
    "      office: War Chief",
    "---",
].join("\n");

const note = (affiliations: unknown) => ({
    fm: { type: "being", shortcode: "subject", data: { affiliations } },
    file: "subject.md",
    raw,
});

describe("a being's standing names the body that confers it", () => {
    it("declares the map form, with the list form still accepted", () => {
        const field = NOTE_VOCABULARY.being.data.find(
            (entry: { name: string }) => entry.name === "affiliations",
        );
        expect(field.kind).toBe("list-or-map");
        expect(field.keyKind).toBe("address");
        expect(field.entryKind).toBe("address");
        expect(field.standings).toBe(true);
        expect(field.check).toBe(checkStandings);
        expect(STANDING_KEYS).toEqual(["rank", "office"]);
    });

    it("stops advertising standings on data.lore", () => {
        const lore = NOTE_VOCABULARY.being.data.find(
            (entry: { name: string }) => entry.name === "lore",
        );
        expect(lore.describe).not.toMatch(/standing/i);
    });

    it("reads the map, the decoded map and the list as one set of entries", () => {
        expect(readStandings(undefined).form).toBe("absent");
        expect(readStandings([]).entries).toEqual([]);
        expect(readStandings("nonsense").form).toBe("malformed");

        const asMap = readStandings({ vrystwldtrbs: { rank: 4 } });
        expect(asMap.form).toBe("map");
        expect(asMap.entries[0]).toMatchObject({
            sourceKey: "vrystwldtrbs",
            standing: { rank: 4 },
        });

        const asList = readStandings(["vrystwldtrbs"]);
        expect(asList.form).toBe("list");
        expect(asList.entries[0]).toMatchObject({ body: "vrystwldtrbs", standing: undefined });

        const decoded: any = decodeNoteAddresses(
            { type: "being", data: { affiliations: { vrystwldtrbs: { rank: 5 } } } },
            { package: "thalorna", system: "note" },
        );
        const typed = readStandings(decoded.data.affiliations);
        expect(typed.form).toBe("map");
        expect(typed.entries[0].body.shortcode).toBe("vrystwldtrbs");
        expect(typed.entries[0].sourceKey).toBe("vrystwldtrbs");
        expect(typed.entries[0].standing).toEqual({ rank: 5 });
    });

    it("accepts a rung on its own and a rung with a post", () => {
        expect(checkStandings(note({ vrystwldtrbs: { rank: 4 } }), { index })).toEqual([]);
        expect(
            checkStandings(note({ vrystwldtrbs: { rank: 5, office: "War Chief" } }), { index }),
        ).toEqual([]);
        expect(checkStandings(note(["vrystwldtrbs"]), { index })).toEqual([]);
        expect(checkStandings(note([]), { index })).toEqual([]);
    });

    it("refuses an entry that states no rung, in whichever way it states nothing", () => {
        // `{}`, a key with nothing after it, and the `[]` an emptied map
        // arrives from the property editor as all say one thing.
        for (const nothing of [{}, null, []]) {
            const findings = checkStandings(note({ vrystwldtrbs: nothing }), { index });
            expect(findings.map((f) => f.severity)).toEqual(["error"]);
            expect(findings[0].message).toMatch(/thalorna-note-affiliation-vrystwldtrbs/);
            expect(findings[0].message).toMatch(/states no `rank`/);
            expect(findings[0].message).toMatch(/ordinary member is `1`/);
            expect(findings[0].message).toMatch(/`0` is the rung for someone cast out/);
            expect(findings[0].file).toBe("subject.md");
            expect(findings[0].line).toBeGreaterThan(0);
        }
    });

    it("refuses an office with no rung once, naming the body and the post", () => {
        // The same fault, not a second one — so one finding, on the entry, with
        // the office named as the reason it looked complete.
        const findings = checkStandings(note({ vrystwldtrbs: { office: "War Chief" } }), { index });
        expect(findings.map((f) => f.severity)).toEqual(["error"]);
        expect(findings[0].message).toMatch(/thalorna-note-affiliation-vrystwldtrbs/);
        expect(findings[0].message).toMatch(
            /states no `rank`, and the office "War Chief" is not one/,
        );
        expect(findings[0].message).toMatch(/ordinary member is `1`/);
        expect(findings[0].line).toBeGreaterThan(0);
        expect(findings[0].column).toBeGreaterThan(0);
    });

    it("keeps a rank with no office valid, because `office` is the optional half", () => {
        expect(checkStandings(note({ vrystwldtrbs: { rank: 4 } }), { index })).toEqual([]);
        expect(
            checkStandings(note({ greenwardens: {} }), { index }).map((f) => f.severity),
        ).toEqual(["error"]);
    });

    it("leaves a rung of 0 alone, because being cast out is a standing", () => {
        expect(checkStandings(note({ vrystwldtrbs: { rank: 0 } }), { index })).toEqual([]);
        expect(
            checkStandings(note({ vrystwldtrbs: { rank: 0, office: "War Chief" } }), { index }),
        ).toEqual([]);
    });

    it("refuses a rung the named body does not confer", () => {
        const [finding] = checkStandings(note({ vrystwldtrbs: { rank: 3 } }), { index });
        expect(finding.message).toMatch(/rank 3 is not a level/);
        expect(finding.message).toMatch(/0, 4, 5/);
        expect(finding.severity).toBe("error");
        expect(finding.file).toBe("subject.md");
        expect(finding.line).toBeGreaterThan(0);
        expect(finding.column).toBeGreaterThan(0);

        expect(checkStandings(note({ vrystwldtrbs: { rank: "4" } }), { index })[0].message).toMatch(
            /whole number/,
        );
        expect(checkStandings(note({ greenwardens: { rank: 1 } }), { index })[0].message).toMatch(
            /declares no `data.governance.ranks`/,
        );
    });

    it("refuses a post the named body does not name", () => {
        const [finding] = checkStandings(
            note({ vrystwldtrbs: { rank: 4, office: "Harbour-reeve" } }),
            { index },
        );
        expect(finding.message).toMatch(/is not an office/);
        expect(finding.message).toMatch(/War Chief, Treasurer/);
        expect(finding.line).toBeGreaterThan(0);

        expect(
            checkStandings(note({ greenwardens: { rank: 1, office: "Speaker" } }), { index })
                .map((f: any) => f.message)
                .join(" "),
        ).toMatch(/declares no `data.governance.offices`/);
        expect(
            checkStandings(note({ vrystwldtrbs: { rank: 4, office: 7 } }), { index })[0].message,
        ).toMatch(/must name a post/);
    });

    it("refuses an unknown standing key, a non-map standing, and a body named twice", () => {
        expect(checkStandings(note({ vrystwldtrbs: { grade: 4 } }), { index })[0].message).toMatch(
            /unknown key `grade`/,
        );
        expect(checkStandings(note({ vrystwldtrbs: "Hárár" }), { index })[0].message).toMatch(
            /must hold that body's standing as a map/,
        );
        expect(
            checkStandings(
                note({
                    vrystwldtrbs: { rank: 4 },
                    "thalorna-note-affiliation-vrystwldtrbs": { rank: 5 },
                }),
                { index },
            )[0].message,
        ).toMatch(/twice/);
    });

    it("refuses a key that is not an affiliation that resolves, in either form", () => {
        expect(checkStandings(note({ "place-village": {} }), { index })[0].message).toMatch(
            /accepts affiliation, not place/,
        );
        expect(checkStandings(note({ nosuchbody: {} }), { index })[0].message).toMatch(
            /does not resolve/,
        );
        expect(checkStandings(note(["nosuchbody"]), { index })[0].message).toMatch(
            /does not resolve/,
        );
        expect(checkStandings(note("nonsense"), { index })[0].message).toMatch(
            /must be a map keyed by an affiliation Address/,
        );
    });
});

describe("the body is the single source for what a rung is called", () => {
    it("reads the ladder by its own levels and the roster through both spellings", () => {
        expect([...rankLadder(tribes.data.governance.ranks)]).toEqual([
            [0, "Vrystrith"],
            [4, "Fródrád"],
            [5, "Hárár"],
        ]);
        expect([...officeRoster(tribes.data.governance.offices)]).toEqual([
            ["War Chief", "Leads the muster."],
            ["Treasurer", "Keeps the tally."],
        ]);
        expect(rankLadder(undefined).size).toBe(0);
        expect(officeRoster("not a map").size).toBe(0);
    });

    it("derives one anchor for an office, shared by the row and the link to it", () => {
        expect(officeAnchor("War Chief")).toBe("office-war-chief");
        expect(officeAnchor("Hirdstjóri")).toBe("office-hirdstjori");
        expect(officeAnchor("  ")).toBe("");
    });

    it("rides the ladder and the roster along a reference to the body", () => {
        const targets = buildReferenceTargets([
            { ...tribes, package: "thalorna" },
            { ...wardens, package: "thalorna" },
        ]);
        const found = targets.get("thalorna-note-affiliation-vrystwldtrbs");
        expect(found.standings.ranks["4"]).toBe("Fródrád");
        expect(found.standings.offices["War Chief"]).toBe("Leads the muster.");
        expect(targets.get("thalorna-note-affiliation-greenwardens").standings).toBeUndefined();
        expect(standingsDigest(wardens)).toBeUndefined();
    });

    it("reads a standing as a phrase closing on its body", () => {
        const digest = standingsDigest(tribes);
        expect(standingPhrase({ rank: 4 }, "Vrystwald Tribes", digest)).toBe(
            "Fródrád, of Vrystwald Tribes",
        );
        expect(standingPhrase({ office: "War Chief" }, "Vrystwald Tribes", digest)).toBe(
            "War Chief, of Vrystwald Tribes",
        );
        expect(standingPhrase({ rank: 5, office: "War Chief" }, "Vrystwald Tribes", digest)).toBe(
            "War Chief, Hárár, of Vrystwald Tribes",
        );
        expect(standingPhrase({}, "Vrystwald Tribes", digest)).toBe("Vrystwald Tribes");
        // A rung the body has not named still reads as the standing it is.
        expect(standingPhrase({ rank: 2 }, "Vrystwald Tribes", digest)).toBe(
            "Rank 2, of Vrystwald Tribes",
        );
    });
});

describe("the box prints a standing beside its body", () => {
    const resolve = (ref: unknown) => ({
        name: "Vrystwald Tribes",
        url: "/thalorna/affiliation-vrystwldtrbs/",
        standings: standingsDigest(tribes),
        address: ref,
    });

    const being = (affiliations: unknown) =>
        noteInfobox(
            { type: "being", name: { full: "A Person" }, data: { affiliations } },
            { resolve },
        );

    const row = (affiliations: unknown) =>
        being(affiliations).sections[0].rows.find(
            (entry: { label: string }) => entry.label === "Affiliations",
        );

    it("names the rung and the post inside the entry", () => {
        expect(row({ vrystwldtrbs: { rank: 4 } }).value[0].text).toBe(
            "Fródrád, of Vrystwald Tribes",
        );
        expect(row({ vrystwldtrbs: { rank: 5, office: "War Chief" } }).value[0].text).toBe(
            "War Chief, Hárár, of Vrystwald Tribes",
        );
    });

    it("links a post to the description the body already declares", () => {
        expect(row({ vrystwldtrbs: { office: "War Chief" } }).value[0].url).toBe(
            "/thalorna/affiliation-vrystwldtrbs/#office-war-chief",
        );
        // A post the body does not name earns no anchor, so the entry keeps
        // the body's own page rather than pointing at nothing.
        expect(row({ vrystwldtrbs: { office: "Nothing" } }).value[0].url).toBe(
            "/thalorna/affiliation-vrystwldtrbs/",
        );
    });

    it("still draws the list form as links while a tree converts", () => {
        expect(row(["vrystwldtrbs"])).toMatchObject({
            kind: "links",
            value: [{ text: "Vrystwald Tribes", url: "/thalorna/affiliation-vrystwldtrbs/" }],
        });
        expect(row([])).toBeUndefined();
        expect(row({})).toBeUndefined();
    });

    it("gives every office its own row, labelled and anchored by its name", () => {
        const box = noteInfobox({
            type: "affiliation",
            name: { full: "Vrystwald Tribes" },
            data: tribes.data,
        });
        const rows = box.sections[0].rows;
        expect(rows).toContainEqual({
            id: "office-war-chief",
            label: "War Chief",
            kind: "text",
            value: "Leads the muster.",
        });
        expect(rows).toContainEqual({
            id: "office-treasurer",
            label: "Treasurer",
            kind: "text",
            value: "Keeps the tally.",
        });
        const html = infoboxesToHtml([box]);
        expect(html).toContain('<dt id="office-war-chief">War Chief</dt>');
        expect(html).toContain("<dd>Leads the muster.</dd>");
        // A row nobody anchored emits no id rather than one this renderer made up.
        expect(html).toContain("<dt>Name</dt>");
    });
});

describe("a membership is derived into the SoHL item, never authored twice", () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-standings-"));
        fs.mkdirSync(path.join(dir, "content"));
        fs.mkdirSync(path.join(dir, "items"));
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    /** The body's own compiled Item, as the catalogue holds it. */
    const catalogue = () =>
        new Map([
            [
                catalogueKey("affiliation", "vrystwldtrbs", contentPackage()),
                {
                    type: "affiliation",
                    name: "Vrystwald Tribes",
                    system: { shortcode: "vrystwldtrbs", subType: "tribe", level: 0, office: "" },
                },
            ],
        ]);

    const build = (affiliations: unknown) => {
        const compiler = new Actors({
            skipDirectories: [],
            contentBase: path.join(dir, "content"),
            dest: path.join(dir, "out"),
            itemsSourceDirs: [path.join(dir, "items")],
        });
        const fm: any = decodeNoteAddresses(
            { type: "being", shortcode: "subject", data: { affiliations } },
            { package: contentPackage(), system: "note" },
        );
        const items = compiler.buildEmbeddedItems(
            catalogue(),
            "actor0000000000",
            fm,
            'actor "A Person"',
        );
        return { items, errors: compiler.errorCount };
    };

    it("sets the item's level and office from the standing the being wrote", () => {
        const { items, errors } = build({
            vrystwldtrbs: { rank: 5, office: "War Chief" },
        });
        expect(errors).toBe(0);
        expect(items).toHaveLength(1);
        expect(items[0].type).toBe("affiliation");
        expect(items[0].system.level).toBe(5);
        expect(items[0].system.office).toBe("War Chief");
        // The body's own declarations come through the model untouched.
        expect(items[0].system.subType).toBe("tribe");
    });

    it("keeps the body's own defaults where the being states no standing", () => {
        for (const written of [{ vrystwldtrbs: {} }, ["vrystwldtrbs"]]) {
            const { items, errors } = build(written);
            expect(errors).toBe(0);
            expect(items).toHaveLength(1);
            expect(items[0].system.level).toBe(0);
            expect(items[0].system.office).toBe("");
        }
    });

    it("reports a membership in a body that compiles to no item", () => {
        const { items, errors } = build({ greenwardens: { rank: 1 } });
        expect(items).toHaveLength(0);
        expect(errors).toBe(1);
    });

    it("embeds nothing for a being that belongs to nobody", () => {
        expect(build(undefined).items).toHaveLength(0);
        expect(build([]).items).toHaveLength(0);
    });
});
