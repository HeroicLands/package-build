/* Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    prepareSettlementEdit,
    writeSettlementPreview,
    commitSettlementEdit,
} from "../engine/settlement-source.mjs";

const roots: string[] = [];
const address = "example-note-affiliation-crown";
const row = { settlement: "Example", households: 7, notes: "A quoted: fact" };
const heading = "---\ntype: affiliation\nsubType: polity\nshortcode: crown\n";
const ending = "---\n\nUnrelated body.\n  Keep spacing.\n";
const fixtureRoot = new URL("./fixtures/settlement-source/", import.meta.url);

function fixture(raw: Buffer | string, relative = "arbitrary/renamed.md") {
    const projectRoot = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "settlement-write-")),
    );
    roots.push(projectRoot);
    const contentRoot = path.join(projectRoot, "content");
    const file = path.join(contentRoot, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, raw);
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
    const frontmatter = YAML.parse(text.slice(text.indexOf("\n") + 1, text.indexOf("\n---", 4)));
    const records = [{ ...frontmatter, package: "example", address: { canonical: address } }];
    const sources = new Map([[file, { frontmatter, raw: Buffer.from(raw) }]]);
    const args = {
        contentRoot,
        contentPackage: "example",
        polityAddress: address,
        records,
        sources,
        rows: [row],
    };
    return { projectRoot, contentRoot, file, args };
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("settlement source edits", () => {
    it.each(["block", "flow", "missing-data", "empty-sequence"])(
        "preserves exact %s fixture bytes",
        (name) => {
            const before = fs.readFileSync(new URL(`${name}.before.txt`, fixtureRoot));
            const after = fs.readFileSync(new URL(`${name}.after.txt`, fixtureRoot));
            const f = fixture(before);
            const saved = f.args.sources.get(f.file)!.frontmatter.data?.settlements ?? [];
            f.args.rows = [...saved, row];
            const edit = prepareSettlementEdit(f.args);
            expect(fs.readFileSync(f.file)).toEqual(before);
            const preview = writeSettlementPreview(edit, { projectRoot: f.projectRoot });
            expect(path.relative(path.join(f.projectRoot, "build"), preview.directory)).not.toMatch(
                /^\.\./,
            );
            expect(fs.readFileSync(path.join(preview.directory, "before.md"))).toEqual(before);
            expect(fs.readFileSync(path.join(preview.directory, "after.md"))).toEqual(after);
            expect(fs.readFileSync(path.join(preview.directory, "change.patch"), "utf8")).toContain(
                "@@",
            );
            expect(commitSettlementEdit(edit).written).toBe(true);
            expect(fs.readFileSync(f.file)).toEqual(after);
            const current = fixture(after, "moved/another-name.md");
            current.args.rows = f.args.rows;
            const repeat = prepareSettlementEdit(current.args);
            expect(repeat.changed).toBe(false);
            expect(commitSettlementEdit(repeat).written).toBe(false);
            expect(fs.readFileSync(current.file)).toEqual(after);
        },
    );

    it.each([
        [
            "data: {note: kept}\n",
            'data: {note: kept, settlements: [{"settlement":"Example","households":7,"notes":"A quoted: fact"}]}\n',
        ],
        [
            "data: {}\n",
            'data: {settlements: [{"settlement":"Example","households":7,"notes":"A quoted: fact"}]}\n',
        ],
        [
            "data:\n    note: kept\n",
            'data:\n    note: kept\n    settlements: [{"settlement":"Example","households":7,"notes":"A quoted: fact"}]\n',
        ],
        [
            "data: {settlements: [ ], note: kept}\n",
            'data: {settlements: [ {"settlement":"Example","households":7,"notes":"A quoted: fact"}], note: kept}\n',
        ],
        [
            "data: {settlements: [{settlement: Existing}, ], note: kept}\n",
            'data: {settlements: [{settlement: Existing}, {"settlement":"Example","households":7,"notes":"A quoted: fact"}], note: kept}\n',
        ],
    ])("inserts into supported mappings and sequences", (input, output) => {
        const f = fixture(heading + input + ending);
        f.args.rows = [...(f.args.sources.get(f.file)!.frontmatter.data?.settlements ?? []), row];
        commitSettlementEdit(prepareSettlementEdit(f.args));
        expect(fs.readFileSync(f.file, "utf8")).toBe(heading + output + ending);
    });

    it("uses UTF-8 byte offsets and preserves the BOM and Unicode body", () => {
        const before = Buffer.from(
            "\uFEFF" + heading + 'name: {full: "Example 🗺"}\n' + ending + "🗺\r\n",
        );
        const f = fixture(before);
        const edit = prepareSettlementEdit(f.args);
        const patch = edit.patch;
        const expected = Buffer.concat([
            before.subarray(0, patch.start),
            Buffer.from(patch.replacement),
            before.subarray(patch.end),
        ]);
        commitSettlementEdit(edit);
        expect(fs.readFileSync(f.file)).toEqual(expected);
        expect(fs.readFileSync(f.file).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
        expect(fs.readFileSync(f.file, "utf8")).toContain(ending + "🗺\r\n");
    });

    it("preserves multiline flow comments and trailing commas", () => {
        const source =
            heading +
            "data: {settlements: [\n  {settlement: Existing}, # keep row comment\n  # keep next comment\n  ], note: kept}\n" +
            ending;
        const f = fixture(source);
        f.args.rows = [...f.args.sources.get(f.file)!.frontmatter.data.settlements, row];
        commitSettlementEdit(prepareSettlementEdit(f.args));
        const actual = fs.readFileSync(f.file, "utf8");
        expect(actual).toBe(
            heading +
                'data: {settlements: [\n  {settlement: Existing}, # keep row comment\n  # keep next comment\n  {"settlement":"Example","households":7,"notes":"A quoted: fact"}], note: kept}\n' +
                ending,
        );
    });

    it("preserves existing values and refuses removal, reordering or silent refresh", () => {
        const f = fixture(
            heading +
                "data:\n  settlements:\n    - settlement: Existing\n      households: null # authored unknown\n      notes: |\n        Keep this text.\n" +
                ending,
        );
        expect(() => prepareSettlementEdit(f.args)).toThrow(/existing rows/);
        const saved = f.args.sources.get(f.file)!.frontmatter.data.settlements;
        f.args.rows = [...saved, row];
        const edit = prepareSettlementEdit(f.args);
        f.args.rows[0].households = 50;
        commitSettlementEdit(edit);
        expect(fs.readFileSync(f.file, "utf8")).toContain("households: null # authored unknown");
    });

    it.each([
        "data: null\n",
        "data: {settlements: null}\n",
        "data: {settlements: [*missing]}\n",
        "data: &held {settlements: []}\n",
        "data: {settlements: [], settlements: []}\n",
        "data: {<<: {settlements: []}}\n",
        "data: {settlements: !!seq []}\n",
    ])("refuses ambiguous YAML without touching source", (source) => {
        const raw = heading + source + ending;
        const f = fixture(heading + "data: {}\n" + ending);
        fs.writeFileSync(f.file, raw);
        f.args.sources.get(f.file)!.raw = Buffer.from(raw);
        expect(() => prepareSettlementEdit(f.args)).toThrow(/\.md:\d+:\d+: error:/);
        expect(fs.readFileSync(f.file, "utf8")).toBe(raw);
    });

    it("requires exactly one local indexed polity and its captured source identity", () => {
        const f = fixture(heading + ending);
        expect(() => prepareSettlementEdit({ ...f.args, records: [] })).toThrow(/exactly one/);
        expect(() =>
            prepareSettlementEdit({ ...f.args, records: [...f.args.records, ...f.args.records] }),
        ).toThrow(/exactly one/);
        expect(() => prepareSettlementEdit({ ...f.args, contentPackage: "other" })).toThrow(
            /local polity/,
        );
        expect(() => prepareSettlementEdit({ ...f.args, sources: new Map() })).toThrow(
            /exactly one/,
        );
        expect(() =>
            prepareSettlementEdit({
                ...f.args,
                records: [
                    {
                        ...f.args.records[0],
                        address: { canonical: "example-hm3-affiliation-crown" },
                    },
                ],
            }),
        ).toThrow(/exactly one/);
        const source = f.args.sources.get(f.file)!;
        source.raw = Buffer.from(
            (heading + ending).replace("shortcode: crown", "shortcode: other"),
        );
        fs.writeFileSync(f.file, source.raw);
        expect(() => prepareSettlementEdit(f.args)).toThrow(/identity/);
    });

    it("refuses stale captures and stale commits, including same-size changes", () => {
        const f = fixture(heading + ending);
        const edit = prepareSettlementEdit(f.args);
        const changed = (heading + ending).replace("Unrelated", "Different");
        fs.writeFileSync(f.file, changed);
        expect(() => prepareSettlementEdit(f.args)).toThrow(/stale/);
        expect(() => commitSettlementEdit(edit)).toThrow(/stale/);
        expect(fs.readFileSync(f.file, "utf8")).toBe(changed);
        expect(fs.readdirSync(path.dirname(f.file))).toEqual([path.basename(f.file)]);
    });

    it("refuses a replacement inode even with identical bytes", () => {
        const f = fixture(heading + ending);
        const edit = prepareSettlementEdit(f.args);
        const replacement = path.join(f.contentRoot, "replacement.md");
        fs.writeFileSync(replacement, heading + ending);
        fs.renameSync(replacement, f.file);
        expect(() => commitSettlementEdit(edit)).toThrow(/identity/);
    });

    it("preserves mode, confines writes and keeps unrelated notes byte-identical", () => {
        const f = fixture(heading + ending);
        const other = path.join(f.contentRoot, "other.md");
        fs.writeFileSync(other, "unrelated\r\n");
        fs.chmodSync(f.file, 0o640);
        commitSettlementEdit(prepareSettlementEdit(f.args));
        expect(fs.statSync(f.file).mode & 0o777).toBe(0o640);
        expect(fs.readFileSync(other)).toEqual(Buffer.from("unrelated\r\n"));
        const source = f.args.sources.get(f.file)!;
        expect(() =>
            prepareSettlementEdit({
                ...f.args,
                sources: new Map([[other + "/../../outside.md", source]]),
            }),
        ).toThrow(/outside/);
    });

    it("refuses symlinks, linked parents and hard-linked source files", () => {
        const f = fixture(heading + ending);
        const target = path.join(f.contentRoot, "target.md");
        fs.renameSync(f.file, target);
        fs.symlinkSync(target, f.file);
        expect(() => prepareSettlementEdit(f.args)).toThrow(/symbolic link/);
        fs.unlinkSync(f.file);
        fs.linkSync(target, f.file);
        expect(() => prepareSettlementEdit(f.args)).toThrow(/hard link/);
        fs.unlinkSync(f.file);
        fs.renameSync(target, f.file);
        const parent = path.dirname(f.file);
        fs.renameSync(parent, `${parent}-real`);
        fs.symlinkSync(`${parent}-real`, parent);
        expect(() => prepareSettlementEdit(f.args)).toThrow(/symbolic link/);
    });

    it("checks changed paths and hard links again at commit", () => {
        const f = fixture(heading + ending);
        const edit = prepareSettlementEdit(f.args);
        const linked = path.join(f.contentRoot, "linked.md");
        fs.linkSync(f.file, linked);
        expect(() => commitSettlementEdit(edit)).toThrow(/hard link/);
        expect(fs.readFileSync(f.file, "utf8")).toBe(heading + ending);
    });

    it("refuses a symlink introduced after preparation", () => {
        const f = fixture(heading + ending);
        const edit = prepareSettlementEdit(f.args);
        const target = path.join(f.contentRoot, "target.md");
        fs.renameSync(f.file, target);
        fs.symlinkSync(target, f.file);
        expect(() => commitSettlementEdit(edit)).toThrow(/symbolic link/);
        expect(fs.readFileSync(target, "utf8")).toBe(heading + ending);
        expect(fs.lstatSync(f.file).isSymbolicLink()).toBe(true);
    });

    it("keeps the temporary file private during writing and cleans a failed write", () => {
        const f = fixture(heading + ending);
        const edit = prepareSettlementEdit(f.args);
        vi.spyOn(fs, "writeFileSync").mockImplementationOnce((fd) => {
            expect(typeof fd).toBe("number");
            expect(fs.fstatSync(fd as number).mode & 0o777).toBe(0o600);
            throw new Error("temporary write failed");
        });
        expect(() => commitSettlementEdit(edit)).toThrow(/temporary write failed/);
        expect(fs.readFileSync(f.file, "utf8")).toBe(heading + ending);
        expect(fs.readdirSync(path.dirname(f.file))).toEqual([path.basename(f.file)]);
    });

    it("cleans temporary files and retains original bytes on precommit failure", () => {
        const f = fixture(heading + ending);
        const edit = prepareSettlementEdit(f.args);
        vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
            throw new Error("replacement refused");
        });
        expect(() => commitSettlementEdit(edit)).toThrow(/replacement refused/);
        expect(fs.readFileSync(f.file, "utf8")).toBe(heading + ending);
        expect(fs.readdirSync(path.dirname(f.file))).toEqual([path.basename(f.file)]);
    });

    it("catches a write during temporary-file preparation", () => {
        const f = fixture(heading + ending);
        const edit = prepareSettlementEdit(f.args);
        const originalSync = fs.fsyncSync;
        vi.spyOn(fs, "fsyncSync").mockImplementationOnce((fd) => {
            fs.writeFileSync(f.file, heading + "# concurrent edit\n" + ending);
            originalSync(fd);
        });
        expect(() => commitSettlementEdit(edit)).toThrow(/stale/);
        expect(fs.readFileSync(f.file, "utf8")).toContain("# concurrent edit");
        expect(fs.readdirSync(path.dirname(f.file))).toEqual([path.basename(f.file)]);
    });

    it("refuses an occupied cooperating-writer lock and forged handles", () => {
        const f = fixture(heading + ending);
        const edit = prepareSettlementEdit(f.args);
        const lock = path.join(
            path.dirname(f.file),
            `.${path.basename(f.file)}.settlement-write.lock`,
        );
        fs.writeFileSync(lock, "occupied");
        expect(() => commitSettlementEdit(edit)).toThrow(/lock/);
        expect(fs.readFileSync(lock, "utf8")).toBe("occupied");
        expect(() => commitSettlementEdit({ ...edit })).toThrow(/prepared edit/);
    });

    it("refuses preview paths through a symlink", () => {
        const f = fixture(heading + ending);
        const other = fixture(heading + ending);
        fs.symlinkSync(other.projectRoot, path.join(f.projectRoot, "build"));
        expect(() =>
            writeSettlementPreview(prepareSettlementEdit(f.args), { projectRoot: f.projectRoot }),
        ).toThrow(/symbolic link/);
        expect(fs.existsSync(path.join(other.projectRoot, "settlement-previews"))).toBe(false);
    });
});
