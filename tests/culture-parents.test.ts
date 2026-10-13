/* SPDX-License-Identifier: GPL-3.0-or-later */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { collectContentIndex, emitContentIndex } from "../engine/content-index.mjs";
import { lintFrontmatter } from "../engine/frontmatter-lint.mjs";
import { NOTE_VOCABULARY, BEING_LOOK_VOCABULARY, dataFields } from "../engine/note-vocabulary.mjs";
import { buildLinkIndex } from "../engine/content-links.mjs";
import { parseAddress } from "../engine/address.mjs";
import { profileFindings } from "../engine/appearance-profile.mjs";
import { cultureHierarchyProblems, cultureFieldSource } from "../engine/culture-parents.mjs";
import { NOTE_SCHEMAS } from "../sohl/note-schemas.mjs";

const roots: string[] = [];
const profile = { frame: { light: 1 }, eye_color: { brown: 1 } };
function tree(entries: Record<string, any>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "culture-parents-"));
    roots.push(root);
    for (const [shortcode, data] of Object.entries(entries)) {
        const fm = { type: "lore", subType: "culture", shortcode, data };
        fs.writeFileSync(
            path.join(root, `${shortcode}.md`),
            `---\n${YAML.stringify(fm)}---\nA people.\n`,
        );
    }
    return root;
}
function records(root: string, problems?: any[]) {
    return collectContentIndex(root, { contentPackage: "sohl", skipDirectories: [], problems });
}
function dataAt(entries: any[], shortcode: string) {
    return entries.find((entry) => entry.shortcode === shortcode && entry.type === "lore").data;
}
function lint(entries: Record<string, any>) {
    const notes = Object.entries(entries).map(([shortcode, fields]) => {
        const fm = { type: "lore", subType: "culture", shortcode, ...fields };
        const raw = `---\n${YAML.stringify(fm)}---\nA people.\n`;
        return { file: `${shortcode}.md`, raw, type: fm.type, fm };
    });
    const index = {
        contentPackage: "sohl",
        types: new Set(["lore", "place", "skill"]),
        packages: new Set(["sohl"]),
        notes,
        addressHit: (key: string) =>
            notes.find((note) => key === `sohl-note-${note.type}-${note.fm.shortcode}`),
    };
    return lintFrontmatter(index, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY }).findings;
}
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("culture parents", () => {
    it("declares a checked lore Address list and scopes it to culture", () => {
        expect(dataFields("lore")?.find((field) => field.name === "parents")).toMatchObject({
            kind: "list",
            ref: "lore",
            accepts: ["lore"],
            check: expect.any(Function),
        });
        expect(lint({ child: { subType: "law", data: { parents: [] } } })).toContainEqual(
            expect.objectContaining({ message: expect.stringContaining("only culture") }),
        );
    });
    it("emits inherited fields as stated canonical JSONL and preserves source", () => {
        const root = tree({
            parent: { language: "skill-tongue", appearanceProfile: profile },
            child: { parents: ["parent"] },
        });
        const before = fs.readFileSync(path.join(root, "child.md"), "utf8");
        const result = emitContentIndex({
            config: {
                paths: { content: root, contentIndex: path.join(root, "out") },
                contentPackage: "sohl",
                skipDirectories: [],
                packs: [],
            },
        });
        const output = fs
            .readFileSync(result.file, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
        expect(dataAt(output, "child")).toEqual({
            parents: [{ address: "sohl-note-lore-parent", anchor: null, anchorKind: null }],
            language: { address: "sohl-note-skill-tongue", anchor: null, anchorKind: null },
            appearanceProfile: profile,
            culture: { address: "sohl-note-lore-child", anchor: null, anchorKind: null },
        });
        expect(fs.readFileSync(path.join(root, "child.md"), "utf8")).toBe(before);
    });
    it("resolves fields independently with first-listed depth-first precedence", () => {
        const root = tree({
            grand: { language: "skill-deep", appearanceProfile: profile },
            first: { parents: ["grand"] },
            second: { language: "skill-shallow" },
            child: { parents: ["first", "second"], appearanceProfile: { frame: { heavy: 1 } } },
        });
        const result = dataAt(records(root), "child");
        expect(result.language.shortcode).toBe("deep");
        expect(result.appearanceProfile).toEqual({ frame: { heavy: 1 } });
    });
    it("reports same-depth disagreement and withholds that inherited field", () => {
        const root = tree({
            first: { language: "skill-one" },
            second: { language: "skill-two" },
            child: { parents: ["first", "second"] },
        });
        const problems: any[] = [];
        expect(dataAt(records(root, problems), "child").language).toBeUndefined();
        expect(problems).toContainEqual(
            expect.objectContaining({
                file: path.join(root, "child.md"),
                severity: "error",
                line: expect.any(Number),
                message: expect.stringContaining("disagree"),
            }),
        );
        expect(() => records(root)).toThrow(/disagree/);
    });
    it("does not treat child-owned fields or agreeing parents as conflicts", () => {
        const root = tree({
            first: { language: "skill-one" },
            second: { language: "skill-two" },
            child: { parents: ["first", "second"], language: "skill-own" },
            agreed: { parents: ["first", "first"] },
        });
        expect(dataAt(records(root), "child").language.shortcode).toBe("own");
        expect(dataAt(records(root), "agreed").language.shortcode).toBe("one");
    });
    it("locates wrong-subtype, unresolved, and wrong-type parents individually", () => {
        const findings = lint({
            child: { data: { parents: ["law", "missing", "place-other"] } },
            law: { subType: "law" },
        });
        expect(
            findings.filter(
                (f) => /parents\./.test(f.message) || /parent.*culture/.test(f.message),
            ),
        ).toHaveLength(3);
        expect(findings.some((f) => f.message.includes("does not resolve"))).toBe(true);
        expect(findings.some((f) => f.message.includes("not culture"))).toBe(true);
    });
    it("reports every cyclic edge including self-parenting", () => {
        const findings = lint({
            one: { data: { parents: ["two"] } },
            two: { data: { parents: ["one"] } },
            self: { data: { parents: ["self"] } },
        });
        expect(findings.filter((f) => f.message.includes("cycle"))).toHaveLength(3);
        expect(findings.filter((f) => f.message.includes("cycle")).every((f) => f.line === 7)).toBe(
            true,
        );
    });
    it("ignores a broken parent edge while inheriting through a valid one", () => {
        const root = tree({
            valid: { language: "skill-good" },
            child: { parents: ["missing", "valid"] },
        });
        const problems: any[] = [];
        expect(dataAt(records(root, problems), "child").language.shortcode).toBe("good");
        expect(problems).toContainEqual(
            expect.objectContaining({ message: expect.stringContaining("does not resolve") }),
        );
    });
    it("accepts a diamond and structurally equal profiles regardless of map order", () => {
        const root = tree({
            grand: { language: "skill-one" },
            first: { parents: ["grand"], appearanceProfile: profile },
            second: {
                parents: ["grand"],
                appearanceProfile: { eye_color: { brown: 1 }, frame: { light: 1 } },
            },
            child: { parents: ["first", "second"] },
        });
        expect(dataAt(records(root), "child").language.shortcode).toBe("one");
        expect(dataAt(records(root), "child").appearanceProfile).toEqual(profile);
    });
    it("retains an explicit null child field rather than inheriting it", () => {
        const root = tree({
            parent: { language: "skill-one", appearanceProfile: profile },
            child: { parents: ["parent"], language: null },
        });
        expect(dataAt(records(root), "child").language).toBeNull();
        expect(dataAt(records(root), "child").appearanceProfile).toEqual(profile);
    });
    it("uses a foreign culture's published resolved fields without walking its parents", () => {
        const root = tree({ child: { parents: ["other-note-lore-parent"] } });
        const foreign = {
            type: "lore",
            subType: "culture",
            parents: ["unavailable"],
            data: {
                language: parseAddress("other-note-skill-tongue", {
                    package: "sohl",
                    system: "note",
                    type: "skill",
                    types: new Set(["lore", "skill"]),
                    packages: new Set(["sohl", "other"]),
                }),
                appearanceProfile: profile,
            },
        };
        const output = collectContentIndex(root, {
            contentPackage: "sohl",
            skipDirectories: [],
            foreignRecord: (key: string) =>
                key === "other-note-lore-parent" ? foreign : undefined,
        });
        expect(dataAt(output, "child").language.shortcode).toBe("tongue");
        expect(dataAt(output, "child").appearanceProfile).toEqual(profile);
    });
    it("keeps hierarchy diagnostics scoped to the selected culture and off JSONL", () => {
        const root = tree({
            broken: { parents: ["broken"] },
            parent: { language: "skill-good" },
            child: { parents: ["parent"] },
        });
        const problems: any[] = [];
        const output = records(root, problems);
        expect(cultureHierarchyProblems(output, "sohl-note-lore-broken")).toHaveLength(1);
        expect(cultureHierarchyProblems(output, "sohl-note-lore-child")).toEqual([]);
        expect(JSON.stringify(output)).not.toContain("culture-parents");
    });
    it("reports invalid parent entries once through the index and lint pipeline", () => {
        const root = tree({ child: { parents: ["missing", "law"] }, law: {} });
        fs.writeFileSync(
            path.join(root, "law.md"),
            "---\ntype: lore\nsubType: law\nshortcode: law\n---\nA law.\n",
        );
        const problems: any[] = [];
        const output = records(root, problems);
        const index = buildLinkIndex(root, { records: output, skipDirectories: [] });
        const findings = [
            ...problems,
            ...lintFrontmatter(index, { schemas: NOTE_SCHEMAS, vocabulary: NOTE_VOCABULARY })
                .findings,
        ];
        expect(findings.filter((f) => f.message.includes("does not resolve"))).toHaveLength(1);
        expect(findings.filter((f) => f.message.includes("subType is not culture"))).toHaveLength(
            1,
        );
        expect(findings.filter((f) => /data.parents/.test(f.message)).map((f) => f.line)).toEqual([
            7, 8,
        ]);
    });
    it("locates an invalid inherited profile on its authored parent without a duplicate child finding", () => {
        const root = tree({
            parent: { appearanceProfile: { frame: { impossible: 1 } } },
            child: { parents: ["parent"] },
        });
        const output = records(root);
        const index = buildLinkIndex(root, { records: output, skipDirectories: [] });
        const findings = lintFrontmatter(index, {
            schemas: NOTE_SCHEMAS,
            vocabulary: NOTE_VOCABULARY,
        }).findings;
        expect(
            findings.some(
                (f) =>
                    f.file === path.join(root, "parent.md") &&
                    f.message.includes("appearanceProfile"),
            ),
        ).toBe(true);
        expect(findings.filter((f) => f.file === path.join(root, "child.md"))).toEqual([]);
    });
    it("retains transitive inherited field sources without publishing provenance", () => {
        const root = tree({
            grand: { appearanceProfile: { frame: { impossible: 1 } } },
            parent: { parents: ["grand"] },
            child: { parents: ["parent"] },
        });
        const output = records(root);
        const source = cultureFieldSource(output, "sohl-note-lore-child", "appearanceProfile");
        expect(source).toMatchObject({
            file: path.join(root, "grand.md"),
            raw: fs.readFileSync(path.join(root, "grand.md"), "utf8"),
        });
        const findings = profileFindings(source, BEING_LOOK_VOCABULARY);
        expect(
            findings.some(
                (finding) => finding.file === path.join(root, "grand.md") && finding.line === 8,
            ),
        ).toBe(true);
        expect(
            cultureFieldSource(output, "sohl-note-lore-grand", "appearanceProfile"),
        ).toBeUndefined();
        expect(JSON.stringify(output)).not.toContain("inheritedSources");
    });

    it("retains a foreign field source without inventing a local file or position", () => {
        const root = tree({ child: { parents: ["other-note-lore-parent"] } });
        const foreign = {
            type: "lore",
            subType: "culture",
            data: { appearanceProfile: { frame: { impossible: 1 } } },
        };
        const output = collectContentIndex(root, {
            contentPackage: "sohl",
            skipDirectories: [],
            foreignRecord: (key: string) =>
                key === "other-note-lore-parent" ? foreign : undefined,
        });
        const source = cultureFieldSource(output, "sohl-note-lore-child", "appearanceProfile");
        expect(source.fm).toBe(foreign);
        expect(source.file).toBeUndefined();
        expect(source.raw).toBeUndefined();
        expect(
            profileFindings(source, BEING_LOOK_VOCABULARY).every(
                (finding) => finding.file === undefined && finding.line === undefined,
            ),
        ).toBe(true);
    });
});
