/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * **One declaration of the top-level vocabulary, read by everything that needs
 * it.**
 *
 * The region is closed, so five surfaces have to agree about which keys are in
 * it: the frontmatter lint that refuses the rest, the message that lint prints,
 * the formatter's key order, the author-facing reference, and the authoring
 * guide's sentence. Each one restated independently is a key that goes
 * unmentioned by one of them — the measured case being a diagnostic naming nine
 * keys where the vocabulary holds ten.
 *
 * So every assertion below derives its expectation rather than spelling it: the
 * fixed keys come from the declaration and the system blocks from the system
 * registry, which is what lets a further system be a one-line change.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { lintNote } from "../engine/frontmatter-lint.mjs";
import { formatNoteFrontmatter } from "../engine/note-format.mjs";
import { NOTE_LEVEL_KEYS } from "../engine/content-format-check.mjs";
import {
    NOTE_TOP_LEVEL_FIELDS,
    NOTE_TOP_LEVEL_KEYS,
    NOTE_TOP_LEVEL_KEY_SET,
    NOTE_VOCABULARY,
    requiredNoteFields,
    subTypes,
} from "../engine/note-vocabulary.mjs";
import { SYSTEM_IDS } from "../engine/systems.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

/** The keys a note writes that are not one system's block. */
const FIXED_KEYS = NOTE_TOP_LEVEL_FIELDS.filter((field) => !field.system).map(
    (field) => field.name,
);

/** Every backticked key in one line of prose or one table, in order. */
const quoted = (text: string) => [...text.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1]);

function findings(source: string) {
    const raw = `---\n${source}\n---\n\nBody.\n`;
    return lintNote(
        { file: "note.md", type: "lore", raw, fm: YAML.parse(source) },
        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
    );
}

/* -------------------------------------------------------------------- */
/*  The declaration                                                      */
/* -------------------------------------------------------------------- */

describe("the top-level vocabulary", () => {
    it("declares the fixed keys and one block per declared system", () => {
        expect(NOTE_TOP_LEVEL_KEYS).toEqual([...FIXED_KEYS, ...[...SYSTEM_IDS].sort()]);
    });

    it("recognizes every system the toolchain does", () => {
        // A system this toolchain knows and the note format refuses would be a
        // package whose own block is unauthorable.
        const blocks = NOTE_TOP_LEVEL_FIELDS.filter((field) => field.system).map((f) => f.name);
        expect(new Set(blocks)).toEqual(new Set(SYSTEM_IDS));
    });

    it("says what each key means", () => {
        for (const field of NOTE_TOP_LEVEL_FIELDS) {
            expect(field.describe, field.name).toMatch(/\S/);
        }
    });

    it("names each key once", () => {
        expect(NOTE_TOP_LEVEL_KEY_SET.size).toBe(NOTE_TOP_LEVEL_KEYS.length);
    });
});

/* -------------------------------------------------------------------- */
/*  The readers, which must be reading that one declaration              */
/* -------------------------------------------------------------------- */

describe("every reader of the vocabulary", () => {
    it("refuses a key it does not declare, and names them all in doing so", () => {
        const [finding] = findings("shortcode: example\ntype: lore\nterran_analog: Earth").filter(
            (f) => /unknown top-level frontmatter key/.test(f.message),
        );

        expect(finding).toBeDefined();
        // The message's own list, read back off the message: derived from the
        // declaration rather than spelled into the string, which is the drift
        // this test exists for.
        const named = finding.message
            .split("Use ")[1]
            .split(".")[0]
            .replace(", or ", ", ")
            .split(", ");

        expect(named).toEqual([...NOTE_TOP_LEVEL_KEYS]);
    });

    it("orders a formatted note by the declaration", () => {
        const source = [
            "---",
            ...[...NOTE_TOP_LEVEL_KEYS].reverse().map((key) => `${key}: {}`),
            "---",
            "",
            "Body.",
        ].join("\n");
        // `shortcode` and `type` have to be real for the formatter to treat the
        // file as a note at all.
        const authored = source
            .replace("shortcode: {}", "shortcode: ex")
            .replace("type: {}", "type: lore");
        const formatted = formatNoteFrontmatter(authored);
        const order = formatted
            .split("---")[1]
            .split("\n")
            .filter((line) => /^[A-Za-z]/.test(line))
            .map((line) => line.split(":")[0]);

        expect(order).toEqual([...NOTE_TOP_LEVEL_KEYS]);
    });

    it("shares one set with the content-format check", () => {
        expect([...NOTE_LEVEL_KEYS].sort()).toEqual([...NOTE_TOP_LEVEL_KEYS].sort());
    });

    it("enumerates the vocabulary in the note-type reference", () => {
        const reference = read("docs/reference/note-types.md");
        const section = reference.split("## Top-level keys")[1]?.split("\n## ")[0];

        expect(section, "docs/reference/note-types.md needs its top-level section").toBeDefined();
        const rows = section
            .split("\n")
            .filter((line) => /^\| `/.test(line))
            .map((line) => quoted(line)[0]);

        expect(rows).toEqual([...NOTE_TOP_LEVEL_KEYS]);
    });

    it("states the same order in the authoring guide", () => {
        const guide = read("docs/authoring/frontmatter.md");
        const sentence = guide
            .split("\n")
            .find((line) => line.includes("Keep top-level keys in this order"));

        expect(sentence, "the authoring guide states the order").toBeDefined();
        const stated = quoted(sentence.split("Keep top-level keys in this order")[1].split(".")[0]);

        expect(stated).toEqual([...NOTE_TOP_LEVEL_KEYS]);
    });
});

/* -------------------------------------------------------------------- */
/*  What an author meets                                                 */
/* -------------------------------------------------------------------- */

describe("an undeclared top-level key", () => {
    it("is reported at its authored line", () => {
        const result = findings("shortcode: example\ntype: lore\nterran_analog: Earth");
        expect(result).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    file: "note.md",
                    line: 4,
                    column: 1,
                    severity: "error",
                    message: expect.stringContaining("unknown top-level frontmatter key"),
                }),
            ]),
        );
    });

    it("names the declared key it was most likely meant to be", () => {
        const [finding] = findings("shortcode: example\ntype: lore\ndecription: A place").filter(
            (f) => /unknown top-level frontmatter key/.test(f.message),
        );

        expect(finding?.message).toContain('Did you mean "description"?');
    });

    it("suggests nothing where no declared key is close", () => {
        const [finding] = findings("shortcode: example\ntype: lore\nterran_analog: Earth").filter(
            (f) => /unknown top-level frontmatter key/.test(f.message),
        );

        expect(finding?.message).not.toContain("Did you mean");
    });

    it("ignores commented-out fields", () => {
        // A comment is not an authored key, so the closed region says nothing
        // about it. The note still owes the keys every note owes.
        const result = findings("shortcode: example\ntype: lore\n# terran_analog: Earth");
        expect(result.filter((f) => /unknown top-level frontmatter key/.test(f.message))).toEqual(
            [],
        );
    });

    it("rejects underscore-prefixed fields", () => {
        const result = findings("shortcode: example\ntype: lore\n_editorial: Earth");
        expect(result.some((finding) => finding.message.includes('"_editorial"'))).toBe(true);
    });
});

/* -------------------------------------------------------------------- */
/*  What every note owes                                                 */
/* -------------------------------------------------------------------- */

/** One note of a type, with every required key supplied. */
function complete(type: string, extra: Record<string, unknown> = {}) {
    const declared = subTypes(type);
    return {
        shortcode: "example",
        name: { full: "Example", aliases: [] },
        type,
        ...(declared === undefined ? {} : { subType: declared?.[0] ?? "whatever" }),
        description: "A summary.",
        tags: [],
        ...extra,
    };
}

function lintOf(fm: Record<string, unknown>) {
    const source = YAML.stringify(fm).trimEnd();
    const raw = `---\n${source}\n---\n\nBody.\n`;
    return lintNote(
        { file: "note.md", type: String(fm.type), raw, fm },
        { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY },
    );
}

describe("the keys every note must write", () => {
    it("requires exactly what the declaration says, and nothing it does not", () => {
        // Derived both ways: the required keys come off the declaration, and
        // the optional ones are whatever is left, so a key gaining or losing
        // its requirement cannot go unnoticed here.
        const required = requiredNoteFields("lore").map((field) => field.name);
        const optional = NOTE_TOP_LEVEL_KEYS.filter((key) => !required.includes(key));

        expect(required).toEqual(["shortcode", "name", "type", "subType", "description", "tags"]);
        expect(optional).toEqual(["data", "dnd5e", "hm3", "sohl"]);
    });

    it("accepts a note that supplies all of them", () => {
        expect(lintOf(complete("lore", { subType: "culture" }))).toEqual([]);
    });

    it("reports each missing key, by the file alone rather than a guessed line", () => {
        for (const field of requiredNoteFields("lore")) {
            const fm = complete("lore", { subType: "culture" });
            delete (fm as Record<string, unknown>)[field.name];
            const finding = lintOf(fm).find((f) => new RegExp(`\`${field.name}\``).test(f.message));

            expect(finding, field.name).toBeDefined();
            // A position that is not known is dropped, never defaulted to the
            // first line of the frontmatter.
            if (!Object.hasOwn(fm, field.name)) expect(finding!.line, field.name).toBeUndefined();
        }
    });

    it("takes an empty list for the two keys an empty list satisfies", () => {
        for (const field of requiredNoteFields("lore")) {
            if (field.required !== "present") continue;
            const fm = complete("lore", { subType: "culture", [field.name]: [] });

            expect(lintOf(fm), field.name).toEqual([]);
        }
    });

    it("refuses a blank value for the keys that carry one", () => {
        for (const field of requiredNoteFields("lore")) {
            if (field.required !== "nonempty") continue;
            const fm = complete("lore", { subType: "culture", [field.name]: "" });
            const finding = lintOf(fm).find((f) =>
                f.message.includes(`\`${field.name}\` must be a nonempty string`),
            );

            expect(finding, field.name).toBeDefined();
            expect(finding!.line, field.name).toBeDefined();
        }
    });

    it("requires each key `name` declares, and takes an empty alias list", () => {
        const keys = NOTE_TOP_LEVEL_FIELDS.find((field) => field.name === "name")!.keys!;

        expect(keys.map((key) => key.name)).toEqual(["full", "aliases"]);
        for (const key of keys) {
            const fm = complete("lore", { subType: "culture" });
            delete (fm.name as Record<string, unknown>)[key.name];

            expect(
                lintOf(fm).some((f) => new RegExp(`name\\.${key.name}`).test(f.message)),
                key.name,
            ).toBe(true);
        }
    });

    it("asks for `subType` from every type that declares one, and from no other", () => {
        for (const type of Object.keys(NOTE_VOCABULARY)) {
            const declared = subTypes(type);
            const asked = requiredNoteFields(type).some((field) => field.name === "subType");

            expect(asked, type).toBe(declared !== undefined);
        }
    });

    it("states the contract in the authoring guide", () => {
        const guide = read("docs/authoring/frontmatter.md");

        expect(guide).toContain("every note writes both of its keys");
        expect(guide).toContain("every note carries a nonempty one");
        expect(guide).toContain("every type declaring subtypes requires");
    });

    it("marks each key's requirement in the note-type reference", () => {
        const reference = read("docs/reference/note-types.md");
        const section = reference.split("## Top-level keys")[1].split("\n## ")[0];
        const rows = new Map(
            section
                .split("\n")
                .filter((line) => /^\| `/.test(line))
                .map((line) => {
                    const cells = line.split("|").map((cell) => cell.trim());
                    return [quoted(cells[1])[0], cells[2]];
                }),
        );

        for (const field of NOTE_TOP_LEVEL_FIELDS) {
            expect(rows.get(field.name), field.name).toEqual(
                field.required === undefined ? "No" : expect.stringMatching(/^(Yes|Where)/),
            );
        }
/*  Nothing reads a key the region refuses                               */
/* -------------------------------------------------------------------- */

/**
 * The top-level properties a pass may read although no note writes them.
 *
 * Three, and each is a fact about the toolchain rather than a key an author
 * may author — which is what makes the scan below provable rather than a list
 * of exceptions that grows:
 *
 * - `id` is **derived**. `resolveNoteId` fills it in on the parsed frontmatter
 *   before any pass sees it, so forty-odd readers consult a value no note
 *   wrote.
 * - `package` and `folder` are **refused by name**. Each has one reader, whose
 *   whole job is to throw — a compile does not run the frontmatter lint, so
 *   without them a note carrying either key would compile silently.
 */
const READABLE_WITHOUT_DECLARATION = Object.freeze(["id", "package", "folder"]);

/** Every `.mjs` under the directories a build runs from. */
function sources(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".mjs")) found.push(full);
        }
    };
    for (const dir of ["engine", "sohl", "hm3", "bin", "ci"]) walk(path.join(root, dir));
    return found;
}

/** The source with its comments removed, so prose cannot trip the scan. */
function code(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the passes that read a note's frontmatter", () => {
    it("consult no top-level key the region does not declare", () => {
        const allowed = new Set([...NOTE_TOP_LEVEL_KEYS, ...READABLE_WITHOUT_DECLARATION]);
        const offenders: string[] = [];
        for (const file of sources()) {
            const text = code(fs.readFileSync(file, "utf8"));
            for (const match of text.matchAll(/(?:^|[^.\w])fm\??\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
                if (allowed.has(match[1])) continue;
                offenders.push(`${path.relative(root, file)}: fm.${match[1]}`);
            }
            for (const match of text.matchAll(/\.fm\??\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
                if (allowed.has(match[1])) continue;
                offenders.push(`${path.relative(root, file)}: .fm.${match[1]}`);
            }
        }

        expect([...new Set(offenders)]).toEqual([]);
    });

    it("scans a body of source large enough for the result to mean something", () => {
        // Guards the guard: a scan that found no files, or a regex that matched
        // nothing, would pass the assertion above vacuously.
        const hits = sources().reduce(
            (total, file) =>
                total +
                [...code(fs.readFileSync(file, "utf8")).matchAll(/fm\??\.[A-Za-z_]/g)].length,
            0,
        );

        expect(sources().length).toBeGreaterThan(100);
        expect(hits).toBeGreaterThan(200);
    });
});
