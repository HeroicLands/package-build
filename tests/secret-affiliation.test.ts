/* SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { indexRecordsFor, serializeContentIndex } from "../engine/content-index.mjs";
import { dictionaryAndTermRows } from "../engine/dictionary-rows.mjs";
import { lexicalSectionsFor } from "../engine/lexical-sections.mjs";
import { encodeAddresses } from "../engine/address-values.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { derivedSections } from "../engine/derived-sections.mjs";
import { officeHolders } from "../engine/office-holders.mjs";
import { noteInfobox } from "../engine/infobox.mjs";
import { projectPopulationFrontmatter } from "../engine/population-values.mjs";
import { checkSocialTies } from "../engine/social-ties.mjs";
import { checkDataKeys } from "../engine/data-keys.mjs";
import { dataFields } from "../engine/note-vocabulary.mjs";
import { publicStandings, readStandings } from "../engine/standings.mjs";
import { STANDING_KEYS } from "../engine/standing-terms.mjs";
import { decodeNoteAddresses } from "../engine/note-addresses.mjs";

const note = (fm: object, body = "Written.") => `---\n${YAML.stringify(fm)}---\n\n${body}\n`;

const crownNote = (extra: object = {}, holders: object[] = []) =>
    note({
        type: "affiliation",
        subType: "polity",
        shortcode: "crown",
        name: { full: "The Crown" },
        ...extra,
        data: {
            glossary: [{ name: "Spymaster" }, { name: "Subject" }],
            governance: {
                ranks: [{ level: 1, title: "Subject", description: "Of the realm." }],
                offices: {
                    King: "Rules the realm.",
                    Spymaster: { description: "Keeps the secrets.", holders },
                },
            },
        },
    });
const crown = crownNote();

const being = (
    shortcode: string,
    full: string,
    standing: object,
    data: object = {},
    body = "Written.",
) =>
    note(
        {
            type: "being",
            subType: "npc",
            shortcode,
            name: { full },
            data: { archetypes: ["Ruler"], affiliations: { crown: standing }, ...data },
        },
        body,
    );

const realm = () => ({
    "Crown.md": crown,
    "Aldwyn.md": being("aldwyn", "Aldwyn", { rank: 1, office: "King" }),
    "Mara.md": being("mara", "Mara", { rank: 1, office: "Spymaster", secret: true }),
});

function withTree<T>(files: Record<string, string>, run: (root: string) => T): T {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cb-secret-affiliation-"));
    try {
        for (const [file, raw] of Object.entries(files))
            fs.writeFileSync(path.join(root, file), raw);
        return run(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

const recordsOf = (root: string) => indexRecordsFor({ contentBase: root, skipDirectories: [] });

describe("a secret affiliation", () => {
    it("is a declared key of a standing", () => {
        expect(STANDING_KEYS).toContain("secret");
    });

    it("is accepted as a boolean and refused as anything else", () => {
        const subject = (secret: unknown) => ({
            fm: {
                type: "being",
                shortcode: "subject",
                data: { affiliations: { "affiliation-crown": { rank: 1, secret } } },
            },
            file: "subject.md",
            raw: "---\nshortcode: subject\ntype: being\ndata:\n  affiliations:\n    affiliation-crown: {}\n---",
        });
        expect(checkDataKeys(subject(true), dataFields("being"))).toEqual([]);
        expect(checkDataKeys(subject(false), dataFields("being"))).toEqual([]);
        expect(checkDataKeys(subject("yes"), dataFields("being"))).toHaveLength(1);
    });

    it("is dropped from the public projection and kept in the full one", () => {
        const fm = {
            type: "being",
            data: { affiliations: { crown: { rank: 1, secret: true }, wardens: { rank: 1 } } },
        };
        expect(Object.keys(projectPopulationFrontmatter(fm, "public").data.affiliations)).toEqual([
            "wardens",
        ]);
        expect(Object.keys(projectPopulationFrontmatter(fm, "all").data.affiliations)).toEqual([
            "crown",
            "wardens",
        ]);
    });

    it("is dropped from decoded Address entries too", () => {
        const fm = decodeNoteAddresses(
            {
                type: "being",
                shortcode: "subject",
                data: {
                    affiliations: {
                        "affiliation-crown": { rank: 1, secret: true },
                        "affiliation-wardens": { rank: 1 },
                    },
                },
            },
            { package: "sohl", types: new Set(["being", "affiliation"]) } as any,
        ) as any;
        const decoded = fm.data?.affiliations ?? fm.fm?.data?.affiliations;
        expect(readStandings(decoded).entries).toHaveLength(2);
        expect(readStandings(publicStandings(decoded)).entries).toHaveLength(1);
    });

    it("leaves a being's public infobox and keeps the full one", () => {
        const fm = {
            type: "being",
            name: { full: "Mara" },
            data: { affiliations: { crown: { rank: 1, secret: true } } },
        };
        const sections = (audience: string) =>
            noteInfobox(fm, { audience }).sections.map((entry: { id: string }) => entry.id);
        expect(sections("public")).not.toContain("affiliations");
        expect(sections("all")).toContain("affiliations");
    });

    it("leaves the society's office-holder list unless the audience is the GM's", () =>
        withTree(realm(), (root) => {
            const records = recordsOf(root);
            const named = (audience: "public" | "all") =>
                [...(officeHolders(records, audience).get("sohl-affiliation-crown") ?? [])].map(
                    ([office]) => office,
                );
            expect(named("public")).toEqual(["King"]);
            expect(named("all")).toEqual(["King", "Spymaster"]);

            const section = (audience: "public" | "all") =>
                derivedSections(records, {
                    fileOf: (record: any) => path.join(root, record.file.path),
                    audience,
                })
                    .get(path.join(root, "Crown.md"))
                    ?.get("officeholders") ?? "";
            expect(section("public")).not.toContain("mara");
            expect(section("all")).toContain("mara");
        }));

    it("leaves the published content index", () =>
        withTree(realm(), (root) => {
            const lines = serializeContentIndex(recordsOf(root))
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            const mara = lines.find((r) => r.shortcode === "mara" && !r.documents);
            expect(mara.data.affiliations).toEqual({});
            const body = lines.find((r) => r.shortcode === "crown" && !r.documents);
            expect(JSON.stringify(body.officeHolders)).not.toContain("mara");
            expect(JSON.stringify(body.officeHolders)).toContain("aldwyn");
        }));

    it("is refused as a public social tie to the same body", () => {
        const index = {
            contentPackage: "sohl",
            types: new Set(["being", "affiliation"]),
            packages: new Set(["sohl"]),
            addressHit: () => true,
        };
        const subject = (ties: object) => ({
            fm: {
                type: "being",
                shortcode: "subject",
                data: {
                    affiliations: { "affiliation-crown": { rank: 1, secret: true } },
                    socialTies: ties,
                },
            },
            file: "subject.md",
            raw: "---\n---\n",
        });
        const findings = checkSocialTies(subject({ "affiliation-crown": "patron" }), { index });
        expect(findings.map((f: any) => f.message).join("\n")).toMatch(/secret: true/);
        expect(checkSocialTies(subject({ "affiliation-wardens": "patron" }), { index })).toEqual(
            [],
        );
    });

    it("leaves the published index's officeHolders of a GM-only body", () =>
        withTree({ ...realm(), "Crown.md": crownNote({ tags: ["gm"] }) }, (root) => {
            const lines = serializeContentIndex(recordsOf(root))
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            const body = lines.find((r) => r.shortcode === "crown" && !r.documents);
            expect(JSON.stringify(body.officeHolders)).toContain("aldwyn");
            expect(JSON.stringify(body.officeHolders)).not.toContain("mara");
        }));

    it("is not cited by a rank or office term of a public audience", () =>
        withTree(realm(), (root) => {
            const records = encodeAddresses(recordsOf(root));
            const usage = (audience?: "all") => {
                const { terms } = dictionaryAndTermRows(
                    records,
                    records,
                    audience ? { audience } : {},
                );
                return terms
                    .filter((row: any) => row.name === "Spymaster" || row.name === "Subject")
                    .flatMap((row: any) => row.usage);
            };
            expect(usage()).toContain("sohl-note-being-aldwyn");
            expect(usage()).not.toContain("sohl-note-being-mara");
            expect(usage("all")).toContain("sohl-note-being-mara");
        }));

    it("is not cited by the generated glossary of a public audience", () =>
        withTree(realm(), (root) => {
            const records = recordsOf(root);
            const rows = (audience?: "all") =>
                [...lexicalSectionsFor(records, records, audience ? { audience } : {}).values()]
                    .flat()
                    .flatMap((section: any) => section.result.rows)
                    .flatMap((row: any) => row.usage);
            expect(rows()).not.toContain("sohl-note-being-mara");
            expect(rows("all")).toContain("sohl-note-being-mara");
        }));
});

describe("a public mention of a secret affiliation is refused", () => {
    const lint = (files: Record<string, string>) =>
        withTree(files, (root) =>
            lintFrontmatter(buildLinkIndex(root, { skipDirectories: [] }), {
                schemas: NOTE_SCHEMAS as never,
                vocabulary: NOTE_VOCABULARY,
            }).findings.filter((f) => /secret: true/.test(f.message)),
        );
    const secret = { rank: 1, secret: true };

    it("names none for a being that states the membership once", () =>
        expect(lint({ "Crown.md": crown, "Mara.md": being("mara", "Mara", secret) })).toEqual([]));

    it("refuses a data.seeAlso entry", () => {
        const found = lint({
            "Crown.md": crown,
            "Mara.md": being("mara", "Mara", secret, {
                seeAlso: [{ address: "affiliation-crown" }],
            }),
        });
        expect(found).toHaveLength(1);
        expect(found[0].message).toMatch(/seeAlso/);
    });

    it("refuses a wikilink outside a secret block and allows one inside", () => {
        const outside = lint({
            "Crown.md": crown,
            "Mara.md": being("mara", "Mara", secret, {}, "Serves [[affiliation-crown|]]."),
        });
        expect(outside).toHaveLength(1);
        expect(outside[0].line).toBeGreaterThan(1);
        const inside = lint({
            "Crown.md": crown,
            "Mara.md": being(
                "mara",
                "Mara",
                secret,
                {},
                ":::secret\nServes [[affiliation-crown|]].\n:::",
            ),
        });
        expect(inside).toEqual([]);
        const section = lint({
            "Crown.md": crown,
            "Mara.md": being(
                "mara",
                "Mara",
                secret,
                {},
                "# Public\n\nNothing.\n\n# Hidden {#hidden .secret}\n\nServes [[affiliation-crown|]].",
            ),
        });
        expect(section).toEqual([]);
    });

    it("allows the wikilink of a being whose membership is public", () =>
        expect(
            lint({
                "Crown.md": crown,
                "Mara.md": being("mara", "Mara", { rank: 1 }, {}, "Serves [[affiliation-crown|]]."),
            }),
        ).toEqual([]));

    it("refuses the society's holders list naming a secret member", () => {
        const found = lint({
            "Crown.md": crownNote({}, [{ being: "being-mara" }]),
            "Mara.md": being("mara", "Mara", secret),
        });
        expect(found).toHaveLength(1);
        expect(found[0].file).toMatch(/Crown\.md$/);
        expect(
            lint({
                "Crown.md": crownNote({}, [{ being: "being-mara" }]),
                "Mara.md": being("mara", "Mara", { rank: 1 }),
            }),
        ).toEqual([]);
    });
});
