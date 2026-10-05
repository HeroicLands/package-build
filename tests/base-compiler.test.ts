/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Build-time pack compilers (plain ESM, no Foundry). Imported by relative path
// because the pack-build scripts live outside the `@src` alias tree.
import { BasePackCompiler } from "../engine/base-compiler.mjs";
import { documentId } from "../engine/content-address.mjs";
import { contentPackage } from "../engine/content-package.mjs";
import { Items } from "../sohl/items.mjs";
import { Journals } from "../engine/journals.mjs";
import { Actors } from "../sohl/actors.mjs";
import { Macros } from "../engine/macros.mjs";
import { Scenes } from "../engine/scenes.mjs";
import { anchorPageId } from "../engine/wikilinks.mjs";
/**
 * A note in the tree's shape. It declares no package: a note's package is the
 * repository's configured `contentPackage` and `package:` is retired.
 */
function note(body: string, fm: Record<string, unknown>): string {
    const lines = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

/**
 * A minimal consumer-style compiler: it declares which notes it claims and how
 * one becomes a document, and inherits the whole walk → filter → expand →
 * convert → build → write → count loop.
 *
 * This is the contract this exists to establish — a consumer adds a pack by
 * writing this much, not by copying the loop.
 */
class Probe extends BasePackCompiler {
    static override id = "probes";
    static override label = "probe";

    /** Every body this pass was handed, so a test can assert the conversion. */
    seen: string[] = [];

    override selects(fm: any): boolean {
        return fm.type === "probe";
    }

    override buildEntry(fm: any, markdown: string): any {
        this.seen.push(markdown);
        if (fm.shortcode === "boom") throw new Error("deliberate failure");
        return {
            name: fm.name.full,
            _id: fm.id,
            body: markdown,
            folder: this.folderResolver(null),
            _key: `!probes!${fm.id}`,
        };
    }
}

/** A pass that wants the note exactly as authored — the macros arrangement. */
class RawProbe extends Probe {
    static override convertsWikilinks = false;
}

/** A pass that tolerates a note with no id — the journals arrangement. */
class LenientProbe extends Probe {
    static override requiresId = false;
}

const TREE: Record<string, string> = {
    "Target.md": note("The target.", {
        name: { full: "Probe Target" },
        id: "TARGETTARGET0001",
        shortcode: "probetarget",
        type: "doc",
    }),
    "One.md": note("Links to [[doc-probetarget|Target]].", {
        name: { full: "Probe One" },
        id: "PROBEPROBE000001",
        shortcode: "one",
        type: "probe",
    }),
    "Two.md": note("Plain prose.", {
        name: { full: "Probe Two" },
        id: "PROBEPROBE000002",
        shortcode: "two",
        type: "probe",
    }),
    // The retired field, which no value makes acceptable.
    "Declares.md": note("Declares a package.", {
        name: { full: "Probe Declares" },
        id: "PROBEPROBE000004",
        shortcode: "declares",
        type: "probe",
        package: "not-this-package",
    }),
    "Boom.md": note("Explodes.", {
        name: { full: "Probe Boom" },
        id: "PROBEPROBE000005",
        shortcode: "boom",
        type: "probe",
    }),
};

let tmp: string;
let content: string;

/** A fresh destination directory. */
function dest(name: string): string {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/** Every emitted document in a directory, by name. */
function read(dir: string): Record<string, any> {
    const out: Record<string, any> = {};
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        out[doc.name] = doc;
    }
    return out;
}

beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sohl-base-compiler-"));
    content = path.join(tmp, "content");
    fs.mkdirSync(content, { recursive: true });
    for (const [file, text] of Object.entries(TREE)) {
        fs.writeFileSync(path.join(content, file), text);
    }
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("every shipped pack compiler is a BasePackCompiler", () => {
    // The point of the base class is that the loop exists once. A compiler
    // that is not a subclass has its own copy of it.
    it.each([
        ["Items", Items],
        ["Journals", Journals],
        ["Actors", Actors],
        ["Macros", Macros],
        ["Scenes", Scenes],
    ])("%s subclasses it", (_name, cls) => {
        expect(Object.create(cls.prototype)).toBeInstanceOf(BasePackCompiler);
    });
});

describe("BasePackCompiler's shared compile loop", () => {
    let pack: Probe;
    let out: string;

    beforeAll(async () => {
        out = dest("probes");
        pack = new Probe({ skipDirectories: [], contentBase: content, dest: out });
        await pack.compile();
    });

    it("compiles the notes its subclass selects, and no others", () => {
        const docs = read(out);
        expect(Object.keys(docs).sort()).toEqual(["Probe One", "Probe Two"]);
    });

    it("declines a note declaring the retired `package:` field", () => {
        // Refused rather than skipped, and counted as an error below: a note
        // the compiler would not compile used to vanish into the "belongs to
        // another pass" tally.
        expect(read(out)["Probe Declares"]).toBeUndefined();
    });

    it("counts a failed entry rather than aborting the pass", () => {
        // Two: the entry whose `buildEntry` threw, and the note declaring the
        // retired field.
        expect(pack.errorCount).toBe(2);
        expect(read(out)["Probe Boom"]).toBeUndefined();
    });

    it("reports how many entries it wrote", () => {
        expect(pack.compiledCount).toBe(Object.keys(read(out)).length);
        expect(pack.compiledCount).toBe(2);
    });

    it("expands tables and converts wikilinks before building the entry", () => {
        const doc = read(out)["Probe One"];
        expect(doc.body).toContain("@UUID[");
        expect(doc.body).not.toContain("[[doc-probetarget");
    });

    it("names each file from the document's name and id", () => {
        const files = fs.readdirSync(out).filter((f) => f.endsWith(".json"));
        expect(files).toContain("Probe_One_PROBEPROBE000001.json");
    });
});

describe("BasePackCompiler's per-pass switches", () => {
    it("hands the raw body over when a pass does not convert wikilinks", async () => {
        const out = dest("raw");
        const pack = new RawProbe({ skipDirectories: [], contentBase: content, dest: out });
        await pack.compile();
        expect(read(out)["Probe One"].body).toContain("[[doc-probetarget|Target]]");
    });

    it("compiles a note that authors no id, deriving one from its address", async () => {
        // `id:` is optional, not mandatory: the document is filed
        // under `makeId("document", <canonical address>)`, an identity the note
        // already had and `content-lint` already guards.
        const noId = path.join(tmp, "noid-derived");
        fs.mkdirSync(noId, { recursive: true });
        fs.writeFileSync(
            path.join(noId, "NoId.md"),
            note("No id at all.", {
                name: { full: "Probe No Id" },
                shortcode: "noid",
                type: "probe",
            }),
        );
        const out = dest("noid-out");
        const pack = new Probe({ skipDirectories: [], contentBase: noId, dest: out });
        await pack.compile();
        expect(pack.compiledCount).toBe(1);
        expect(read(out)["Probe No Id"]._id).toBe(
            documentId(contentPackage(), "none", "probe", "noid"),
        );
    });

    it("fails the build on a note with no address to derive an id from", async () => {
        // What is fatal now is a note that cannot be addressed at all. A
        // missing `shortcode:` is the real defect the old "missing id" check
        // was standing in front of: such a note has no identity, so nothing can
        // link to it and no id can be derived for it.
        const noAddr = path.join(tmp, "noaddress");
        fs.mkdirSync(noAddr, { recursive: true });
        fs.writeFileSync(
            path.join(noAddr, "NoAddress.md"),
            note("No shortcode at all.", {
                name: { full: "Probe No Address" },
                type: "probe",
            }),
        );
        const pack = new Probe({
            skipDirectories: [],
            contentBase: noAddr,
            dest: dest("noaddr-out"),
        });
        await expect(pack.compile()).rejects.toThrow(/has no address, so it has no document id/);
    });

    it("skips an unaddressable note when the pass tolerates one", async () => {
        const noAddr = path.join(tmp, "noaddress");
        const out = dest("lenient");
        const pack = new LenientProbe({ skipDirectories: [], contentBase: noAddr, dest: out });
        await pack.compile();
        expect(pack.errorCount).toBe(0);
        expect(pack.compiledCount).toBe(0);
    });
});

describe("BasePackCompiler's convertBody reports every finding in one run", () => {
    // Two malformed figures, each carrying a class the construct does not
    // declare — the scanner returns both as `errors[0]` and `errors[1]`, and
    // what is under test is that the compiler reports both rather than only
    // the first.
    const TWO_FIGURE_PROBLEMS = path.join(os.tmpdir(), "sohl-base-compiler-two-figure-problems");

    beforeAll(() => {
        fs.mkdirSync(TWO_FIGURE_PROBLEMS, { recursive: true });
        fs.writeFileSync(
            path.join(TWO_FIGURE_PROBLEMS, "TwoProblems.md"),
            note(
                [
                    ":@ Caption. {type=bogus}",
                    "",
                    "A paragraph.",
                    "",
                    ":@ Caption. {type=bogus}",
                    "",
                    "Another paragraph.",
                ].join("\n"),
                {
                    name: { full: "Probe Two Problems" },
                    id: "PROBEPROBE000006",
                    shortcode: "twoproblems",
                    type: "probe",
                },
            ),
        );
    });

    afterAll(() => fs.rmSync(TWO_FIGURE_PROBLEMS, { recursive: true, force: true }));

    it("reports every figure finding, not only the first", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const out = dest("two-figure-problems");
            const pack = new Probe({
                skipDirectories: [],
                contentBase: TWO_FIGURE_PROBLEMS,
                dest: out,
            });
            await pack.compile();
            // Both figures carry a class the construct does not declare, and
            // both are counted — a single rebuild cycle sees the whole note's
            // problem, not just the first figure's.
            expect(pack.errorCount).toBe(2);
            expect(read(out)["Probe Two Problems"]).toBeUndefined();
            const messages = spy.mock.calls.map((call) => String(call[0]));
            expect(messages.filter((m) => m.includes("unsupported caption type"))).toHaveLength(2);
            // Each finding is reported once, at its own line — not wrapped in
            // a generic "failed to compile" line on top of it.
            expect(messages.some((m) => m.includes("failed to compile"))).toBe(false);
        } finally {
            spy.mockRestore();
        }
    });
});

describe("a {{ref}} resolves in a compiled journal entry", () => {
    // An image this repository's own default pack config resolves — the same
    // asset `figure-pages.test.ts` draws on.
    const THORN = "sohl/assets/images/other/thorn.webp";
    const SECOND_IMAGE = "sohl/assets/images/other/second.webp";
    const REF_JOURNAL = path.join(os.tmpdir(), "sohl-base-compiler-ref-journal");

    beforeAll(() => {
        fs.mkdirSync(REF_JOURNAL, { recursive: true });
        fs.writeFileSync(
            path.join(REF_JOURNAL, "RefJournal.md"),
            note(
                [
                    'See {{ref "#thorn"}} for the image, and the plate in full: ' +
                        '{{ref "#plate" form="full"}}.',
                    "",
                    " :@ The great beast. {#thorn}".trim(),
                    "",
                    `![Thorn](${THORN})`,
                    "",
                    ":@ Two together. {#plate}",
                    "",
                    `![A](${THORN})`,
                    "",
                    `![B](${SECOND_IMAGE})`,
                ].join("\n"),
                {
                    name: { full: "Ref Journal" },
                    id: "0123456789abcdef",
                    shortcode: "refjournal",
                    type: "doc",
                },
            ),
        );
    });

    afterAll(() => fs.rmSync(REF_JOURNAL, { recursive: true, force: true }));

    it("addresses a figure that became a page of its own, and one inside a text page", async () => {
        const out = dest("ref-journal");
        const pack = new Journals({ skipDirectories: [], contentBase: REF_JOURNAL, dest: out });
        await pack.compile();
        expect(pack.errorCount).toBe(0);
        const doc = read(out)["Ref Journal"];
        const intro = doc.pages.find((p: any) => p.name === "Introduction");
        const imagePage = doc.pages.find((p: any) => p.type === "image");
        const textPage = doc.pages.find((p: any) => p.type === "text" && p.name !== "Introduction");

        // The image page is the figure fence wholesale, addressed by its own
        // anchor — the same id an authored `[[#thorn|Text]]` would resolve to.
        expect(imagePage._id).toBe(anchorPageId(doc._id, "thorn"));
        // The grouped fence stays a text page, addressed the same way.
        expect(textPage._id).toBe(anchorPageId(doc._id, "plate"));

        expect(intro.text.content).toContain(`JournalEntryPage.${imagePage._id}]{Figure 1}`);
        expect(intro.text.content).toContain(
            `JournalEntryPage.${textPage._id}]{Figure 2: Two together.}`,
        );
        // A plain Markdown link to an anchor fragment resolves nowhere in
        // Foundry, and none is emitted.
        expect(intro.text.content).not.toContain("](#thorn)");
        expect(intro.text.content).not.toContain("](#plate)");
    });

    it("refuses an anchor matching no figure, before anything compiles", async () => {
        const broken = path.join(os.tmpdir(), "sohl-base-compiler-ref-journal-broken");
        fs.mkdirSync(broken, { recursive: true });
        try {
            fs.writeFileSync(
                path.join(broken, "Broken.md"),
                note('See {{ref "#nosuch"}}.', {
                    name: { full: "Ref Broken" },
                    id: "0123456789abcdef",
                    shortcode: "refbroken",
                    type: "doc",
                }),
            );
            const spy = vi.spyOn(console, "error").mockImplementation(() => {});
            try {
                const out = dest("ref-journal-broken");
                const pack = new Journals({ skipDirectories: [], contentBase: broken, dest: out });
                await pack.compile();
                expect(pack.errorCount).toBe(1);
                expect(read(out)["Ref Broken"]).toBeUndefined();
                const messages = spy.mock.calls.map((call) => String(call[0]));
                expect(
                    messages.some((m) => m.includes('names no figure for anchor "#nosuch"')),
                ).toBe(true);
            } finally {
                spy.mockRestore();
            }
        } finally {
            fs.rmSync(broken, { recursive: true, force: true });
        }
    });
});

describe("BasePackCompiler's constructor contract", () => {
    it("requires a content root", () => {
        expect(() => new Probe({ skipDirectories: [], dest: tmp } as any)).toThrow(
            /Probe compiler requires `contentBase`/,
        );
    });

    it("rejects a content root that does not exist", () => {
        expect(
            () =>
                new Probe({ skipDirectories: [], contentBase: path.join(tmp, "nope"), dest: tmp }),
        ).toThrow(/Content tree not found/);
    });
});

describe("BasePackCompiler's convertBody agrees with the lint about an image", () => {
    // `lintContentImages` already refuses this exact shape — an image sharing
    // its paragraph with prose — so the pack compile must refuse it too,
    // rather than compiling the directive as though it were absent.
    const INLINE_IMAGE = path.join(os.tmpdir(), "sohl-base-compiler-inline-image");
    const FENCED_IMAGE = path.join(os.tmpdir(), "sohl-base-compiler-fenced-image");

    beforeAll(() => {
        fs.mkdirSync(INLINE_IMAGE, { recursive: true });
        fs.writeFileSync(
            path.join(INLINE_IMAGE, "Inline.md"),
            note("A ranger. ![A ranger](ranger.webp) stands watch.", {
                name: { full: "Probe Inline Image" },
                id: "PROBEPROBE000007",
                shortcode: "inlineimage",
                type: "probe",
            }),
        );
        fs.mkdirSync(FENCED_IMAGE, { recursive: true });
        fs.writeFileSync(
            path.join(FENCED_IMAGE, "Fenced.md"),
            note([":@ A ranger.", "", "![A ranger](ranger.webp)"].join("\n"), {
                name: { full: "Probe Fenced Image" },
                id: "PROBEPROBE000008",
                shortcode: "fencedimage",
                type: "probe",
            }),
        );
    });

    afterAll(() => {
        fs.rmSync(INLINE_IMAGE, { recursive: true, force: true });
        fs.rmSync(FENCED_IMAGE, { recursive: true, force: true });
    });

    it("refuses an inline embed sharing its paragraph with prose", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const out = dest("image-problems-inline");
            const pack = new Probe({
                skipDirectories: [],
                contentBase: INLINE_IMAGE,
                dest: out,
            });
            await pack.compile();
            expect(read(out)["Probe Inline Image"]).toBeUndefined();
            const messages = spy.mock.calls.map((call) => String(call[0]));
            expect(messages.some((m) => m.includes("shares its paragraph with other text"))).toBe(
                true,
            );
        } finally {
            spy.mockRestore();
        }
    });

    it("still compiles a picture that stands alone inside a `:::figure` fence", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const out = dest("image-problems-fenced");
            const pack = new Probe({
                skipDirectories: [],
                contentBase: FENCED_IMAGE,
                dest: out,
            });
            await pack.compile();
            expect(read(out)["Probe Fenced Image"]).toBeDefined();
            expect(pack.errorCount).toBe(0);
        } finally {
            spy.mockRestore();
        }
    });
});
