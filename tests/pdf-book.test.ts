// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import sharp from "sharp";

const ROOT = path.resolve(__dirname, "..");

/** Whether a Typst compiler is reachable, which the PDF-level cases need. */
const HAS_TYPST = spawnSync("typst", ["--version"], { encoding: "utf8" }).status === 0;

let root = "";

/**
 * A repository with a small content tree and a document tree over it.
 *
 * @param mode - Whether the tree contains only a homepage or also content pages.
 * @param withPdf - Whether a `pdf:` block is configured.
 * @param withTree - Whether the content tree exists at all.
 */
function makeRepo(mode: "homepage" | "content", withPdf = true, withTree = true): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-book-"));
    fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
            name: "bookpkg",
            version: "2.0.0",
            // The address the book resolves every page link against, and the one
            // the site reads its `baseURL` from. A package publishing either
            // declares it, so a fixture without one is not a package.
            homepage: "https://www.heroiclands.org/sohl/",
        }),
    );

    if (withTree) {
        const content = path.join(dir, "assets", "content", "Gear");
        fs.mkdirSync(content, { recursive: true });
        const note = (file: string, fm: string, body: string) =>
            fs.writeFileSync(path.join(content, file), `---\n${fm}\n---\n\n${body}\n`);
        if (mode === "content") {
            note(
                "dagger.md",
                "type: weapongear\nshortcode: dagger\nname:\n  full: Dagger",
                [
                    "## Description {#description}",
                    "",
                    "A short blade of Saṃgha. See [[weapongear-sword|the sword]].",
                    "",
                    "| Attribute | Value |",
                    "| --------- | ----: |",
                    "| Weight    |     1 |",
                ].join("\n"),
            );
            note(
                "sword.md",
                "type: weapongear\nshortcode: sword\nname:\n  full: Sword",
                "A blade.",
            );
            // A body opening with an H1 repeating the note's own title is the
            // repeated title case: the entry heading already carries the name, so
            // the body's H1 must stay unbookmarked or the sidebar shows "Shield"
            // twice for one page.
            note(
                "shield.md",
                "type: weapongear\nshortcode: shield\nname:\n  full: Shield",
                ["# Shield", "", "A round shield."].join("\n"),
            );
        }
        fs.writeFileSync(
            path.join(dir, "assets", "content", "homepage.md"),
            "---\ntype: homepage\nshortcode: root\nname:\n  full: Book Package\n---\n\nFront.\n",
        );
    }

    fs.writeFileSync(
        path.join(dir, "book.yaml"),
        [
            "contents:",
            "  - sectionName: Gear",
            "    contents:",
            "      - filter: \"type = 'weapongear'\"",
        ].join("\n") + "\n",
    );

    const config = [
        "contentPackage: sohl",
        "packageKind: modules",
        "compatibility:",
        '    minimum: "14.359"',
        '    verified: "14.359"',
        "stats:",
        "    lastModifiedBy: sohlbuilder00000",
        "packs:",
        "    - name: items",
        "      type: Item",
    ];
    if (withPdf) {
        config.push(
            "pdf:",
            "    title: The Test Volume",
            "    document: book.yaml",
            "    fonts:",
            "        serif: Libertinus Serif",
        );
    }
    fs.writeFileSync(path.join(dir, "package-build.config.yaml"), config.join("\n") + "\n");
    return dir;
}

/** Run `package-build pdf` against a fixture repository. */
function build(dir: string, ...args: string[]) {
    const r = spawnSync(
        process.execPath,
        [path.join(ROOT, "bin", "package-build.mjs"), "pdf", ...args],
        {
            cwd: dir,
            env: {
                ...process.env,
                PACKAGE_BUILD_CONFIG: path.join(dir, "package-build.config.yaml"),
            },
            encoding: "utf8",
        },
    );
    return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, status: r.status };
}

afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

it.skipIf(!HAS_TYPST)(
    "reduces a book's embedded raster image while keeping authored art",
    async () => {
        const dir = makeRepo("content");
        try {
            const imageDir = path.join(dir, "assets", "images");
            fs.mkdirSync(imageDir, { recursive: true });
            const image = path.join(imageDir, "portrait.webp");
            const source = await sharp(randomBytes(900 * 600 * 3), {
                raw: { width: 900, height: 600, channels: 3 },
            })
                .webp({ quality: 95 })
                .toBuffer();
            fs.writeFileSync(image, source);
            fs.appendFileSync(
                path.join(dir, "assets/content/Gear/dagger.md"),
                "\n![Portrait](images/portrait.webp){size=medium}\n",
            );

            const built = build(dir);
            expect(built.status, built.out).toBe(0);
            const dist = path.join(dir, "build", "dist");
            const pdf = path.join(
                dist,
                fs.readdirSync(dist).find((file) => file.endsWith(".pdf"))!,
            );
            expect(fs.statSync(pdf).size).toBeGreaterThan(0);
            expect(fs.statSync(path.join(dist, "assets/images/portrait.webp")).size).toBeLessThan(
                source.length,
            );
            expect(
                (await sharp(path.join(dist, "assets/images/portrait.webp")).metadata()).width,
            ).toBe(Math.round((3.2 / 2.54) * 300));
            expect(fs.readFileSync(image)).toEqual(source);
            expect(built.out).toContain("book image assets/images/portrait.webp");
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    },
);

describe("book publication follows the authored tree", () => {
    it("builds no book from a homepage-only tree, and says why", () => {
        const dir = makeRepo("homepage");
        const { out, status } = build(dir);

        expect(out).toMatch(/contains only a homepage/);
        expect(out).not.toMatch(/Book:/);
        // A homepage-only tree is a successful build with no book.
        expect(status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("writes no file for a homepage-only tree", () => {
        const dir = makeRepo("homepage");
        build(dir);

        expect(fs.existsSync(path.join(dir, "build", "dist"))).toBe(false);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("builds a book from a tree with content pages", () => {
        const dir = makeRepo("content");
        const { out } = build(dir, "--no-compile");

        expect(out).toMatch(/Typst source:/);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

it("renders draft and unresolved links as book text", () => {
    const dir = makeRepo("content");
    try {
        const shield = path.join(dir, "assets/content/Gear/shield.md");
        fs.writeFileSync(
            shield,
            fs
                .readFileSync(shield, "utf8")
                .replace("  full: Shield\n---", "  full: Shield\ntags: [draft]\n---"),
        );
        const dagger = path.join(dir, "assets/content/Gear/dagger.md");
        fs.appendFileSync(
            dagger,
            "A [[weapongear-shield|Shield]] rests beside [[weapongear-missing|missing gear]].\n",
        );

        const built = build(dir, "--no-compile");
        expect(built.out).toMatch(/Typst source:/);
        const sourceFile = fs
            .readdirSync(path.join(dir, "build/dist"))
            .find((file) => file.endsWith(".typ"))!;
        const source = fs.readFileSync(path.join(dir, "build/dist", sourceFile), "utf8");
        expect(source).toContain("Shield");
        expect(source).toContain("draft");
        expect(source).toContain("missing gear (unresolved link)");
        expect(source).not.toContain("sohl-draft-link");
        expect(source).not.toContain("sohl-unresolved-link");
        // An **error**, as the same address is from the pack build and the site
        // build. The source is written and the compiler still runs — a reader
        // can see which page the marker is on — and the run fails, because a
        // reader holding paper is the one who cannot act on the defect.
        expect(built.status).toBe(1);
        expect(built.out).toMatch(
            /dagger\.md:\d+:\d+: error: address \[\[weapongear-missing\]\] resolves to no note/,
        );
        // A draft link is not a defect: the note exists and renders marked.
        expect(built.out).not.toMatch(/weapongear-shield.*error/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it("keeps an HTML comment in a front-matter file off the typeset page", () => {
    const dir = makeRepo("content");
    try {
        // The pair a verbatim legal notice needs: the notice carries bare URLs
        // that MD034 would otherwise reject and that may not be rewritten as
        // links, so the rule is suppressed rather than the wording changed.
        fs.writeFileSync(
            path.join(dir, "book-front.md"),
            [
                "<!-- markdownlint-disable MD034 -->",
                "",
                "This is unofficial fan material (https://example.com/).",
                "",
                "<!-- markdownlint-enable MD034 -->",
            ].join("\n") + "\n",
        );
        fs.appendFileSync(
            path.join(dir, "package-build.config.yaml"),
            ["    front:", "        - book-front.md"].join("\n") + "\n",
        );

        const built = build(dir, "--no-compile");
        expect(built.status, built.out).toBe(0);
        const dist = path.join(dir, "build/dist");
        const source = fs.readFileSync(
            path.join(
                dist,
                fs.readdirSync(dist).find((file) => file.endsWith(".typ"))!,
            ),
            "utf8",
        );
        expect(source).toContain("This is unofficial fan material");
        expect(source).not.toContain("markdownlint");
        expect(source).not.toContain("<!--");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it("sets every page link in the book as an address a reader can follow", () => {
    const dir = makeRepo("content");
    try {
        // One entry printed, so the dagger's link to the sword addresses a page
        // the reader does not have in their hand — which is the case that is set
        // as a URL rather than as a cross-reference.
        fs.writeFileSync(
            path.join(dir, "book.yaml"),
            [
                "contents:",
                "  - sectionName: Gear",
                "    contents:",
                "      - filter: \"shortcode = 'dagger'\"",
            ].join("\n") + "\n",
        );

        const built = build(dir, "--no-compile");
        expect(built.status, built.out).toBe(0);
        const dist = path.join(dir, "build/dist");
        const source = fs.readFileSync(
            path.join(
                dist,
                fs.readdirSync(dist).find((file) => file.endsWith(".typ"))!,
            ),
            "utf8",
        );
        expect(source).toContain('#link("https://www.heroiclands.org/sohl/weapongear-sword/")');
        // Not one link in the book is a path: a PDF viewer has no document to
        // resolve one against.
        expect(source).not.toMatch(/#link\("\//);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

it("places infoboxes after authored content and before the next entry", () => {
    const dir = makeRepo("content");
    try {
        const built = build(dir, "--no-compile");
        expect(built.status).toBe(0);
        const dist = path.join(dir, "build/dist");
        const source = fs.readFileSync(
            path.join(
                dist,
                fs.readdirSync(dist).find((file) => file.endsWith(".typ"))!,
            ),
            "utf8",
        );
        const prose = source.indexOf("A short blade");
        const panel = source.indexOf("#infobox-panel[", prose);
        const nextProse = source.indexOf("A round shield.");
        expect(prose).toBeGreaterThan(0);
        expect(panel).toBeGreaterThan(prose);
        expect(panel).toBeLessThan(nextProse);
        const entryStart = source.lastIndexOf("#entry", prose);
        expect(source.slice(entryStart, prose)).not.toContain("#infobox-panel[");
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("--book-version", () => {
    // `--version` collides with yargs' own reserved top-level option, so the
    // CLI accepts the stamp under this name instead; this is what proves the
    // renamed flag still reaches `buildPdf` and lands in the emitted document.
    it("stamps the file name and the title page", () => {
        const dir = makeRepo("content");
        const { out } = build(dir, "--no-compile", "--book-version", "3.1.4");

        const typMatch = out.match(/Typst source: (.+\.typ)/);
        expect(typMatch).not.toBeNull();
        const typPath = typMatch![1].trim();

        expect(path.basename(typPath)).toContain("3.1.4");
        const source = fs.readFileSync(typPath, "utf8");
        expect(source).toContain("3.1.4");
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe("a package with nothing to print", () => {
    it("is a no-op when no `pdf:` block is configured", () => {
        const dir = makeRepo("content", false);
        const { out, status } = build(dir);

        expect(out).toMatch(/publishes no book/);
        expect(status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("is a no-op when there is no content tree", () => {
        const dir = makeRepo("content", true, false);
        const { out, status } = build(dir);

        expect(out).toMatch(/no content tree/);
        expect(status).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

describe("the emitted document", () => {
    let source = "";

    beforeAll(() => {
        root = makeRepo("content");
        build(root, "--no-compile");
        const dist = path.join(root, "build", "dist");
        const typ = fs.readdirSync(dist).find((f) => f.endsWith(".typ"))!;
        source = fs.readFileSync(path.join(dist, typ), "utf8");
    });

    it("gives every section and entry its own heading, which is the bookmarks panel", () => {
        // Typst builds the PDF bookmark outline from every heading regardless of
        // `outlined`, so a heading per entry *is* the navigational interface a
        // 2,500-entry roster needs.
        expect(source).toContain(
            "#heading(level: 1, outlined: true, bookmarked: true)[Gear] <gear>",
        );
        expect(source).toContain(
            "#heading(level: 2, outlined: false, bookmarked: true)[Dagger] <weapongear-dagger>",
        );
        expect(source).toContain(
            "#heading(level: 2, outlined: false, bookmarked: true)[Sword] <weapongear-sword>",
        );
    });

    it("gives a note opening with an H1 repeating its title no duplicate on either surface", () => {
        // The entry heading already carries "Shield" as the bookmarked node;
        // the body's own `# Shield` must stay a plain link target so the
        // sidebar does not show the same page twice.
        expect(source).toContain(
            "#heading(level: 2, outlined: false, bookmarked: true)[Shield] <weapongear-shield>",
        );
        expect(source).toContain(
            "#heading(level: 2, outlined: false, bookmarked: false)[Shield] " +
                "<weapongear-shield--shield>",
        );
        const bookmarkedShield = source.match(/#heading\([^)]*bookmarked: true\)\[Shield\]/g);
        expect(bookmarkedShield).toHaveLength(1);
    });

    it("marks a note body's own heading as neither printed nor bookmarked", () => {
        // Description is a heading inside the dagger's body, not a section the
        // document tree declared and not the note's own leaf heading — it must
        // stay a real, labelled heading (a link target) without surfacing on
        // either the printed contents or the bookmarks panel.
        expect(source).toContain(
            "#heading(level: 3, outlined: false, bookmarked: false)[Description] " +
                "<weapongear-dagger--description>",
        );
    });

    it("opens on a table of contents with no depth limit", () => {
        expect(source).toContain("#outline(title: [Contents])");
        expect(source).not.toMatch(/#outline\([^)]*depth/);
    });

    it("orders entries by name rather than by the order notes were walked", () => {
        expect(source.indexOf("[Dagger]")).toBeLessThan(source.indexOf("[Sword]"));
    });

    it("resolves a wikilink between two notes of the book to an internal destination", () => {
        expect(source).toContain("#link(<weapongear-sword>)[the sword]");
        expect(source).not.toMatch(/#link\("[^"]*weapongear-sword/);
    });

    it("strips a heading's anchor markup and namespaces the label", () => {
        expect(source).toContain("<weapongear-dagger--description>");
        expect(source).not.toContain("{#description}");
    });

    it("keeps the table's header as a repeating header", () => {
        expect(source).toContain("table.header([Attribute], [Value])");
    });

    it("carries the corpus's diacritics through unescaped", () => {
        expect(source).toContain("Saṃgha");
    });
});

describe.runIf(HAS_TYPST)("the compiled PDF", () => {
    let pdf = Buffer.alloc(0);

    beforeAll(() => {
        const dir = makeRepo("content");
        build(dir);
        const dist = path.join(dir, "build", "dist");
        const file = fs.readdirSync(dist).find((f) => f.endsWith(".pdf"));
        if (file) pdf = fs.readFileSync(path.join(dist, file));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("is produced at all", () => {
        expect(pdf.length).toBeGreaterThan(0);
        expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    });

    it("carries a bookmark outline", () => {
        // `/Outlines` is the PDF object a viewer's sidebar reads. Without it the
        // reader of a thousand-page roster has no way in.
        expect(pdf.toString("latin1")).toContain("/Outlines");
    });

    it("is searchable, because every embedded font maps back to Unicode", () => {
        // `/ToUnicode` is precisely what makes text extraction, search and
        // copy-paste work on a subsetted font. A book of names that cannot be
        // searched for a name is the failure that matters most here.
        expect(pdf.toString("latin1")).toContain("/ToUnicode");
    });

    it("names the document, so a viewer's title bar is not the file name", () => {
        expect(pdf.toString("latin1")).toMatch(/Title/);
    });

    it("sets its headings in the sans, on a machine carrying no copy of it", () => {
        // The embedded subsets are the only evidence that survives a compile:
        // a heading rule naming a family the compiler cannot resolve falls back
        // to the serif silently, and the source looks identical either way.
        // The fixture configures a serif and leaves the other two roles to
        // their defaults, so this is the shipped face being found.
        expect(pdf.toString("latin1")).toMatch(/\+LibertinusSans/);
    });
});

describe("full-page place maps", () => {
    it("stages vector itineraries only for selected places with relations", () => {
        const dir = makeRepo("content");
        const placeDir = path.join(dir, "assets", "content", "Places");
        fs.mkdirSync(placeDir, { recursive: true });
        const place = (name: string, relation: string) =>
            fs.writeFileSync(
                path.join(placeDir, `${name}.md`),
                `---\nshortcode: ${name}\nname: { full: ${name} }\ntype: place\nsubType: settlement\n${relation}---\n\nA place.\n`,
            );
        place("alpha", "data:\n  routes:\n    - { to: beta, bearing: E, mode: land, days: 1 }\n");
        place("beta", "data:\n  routes:\n    - { to: alpha, bearing: W, mode: land, days: 1 }\n");
        place("gamma", "");
        const artDir = path.join(dir, "assets", "images");
        fs.mkdirSync(artDir, { recursive: true });
        fs.writeFileSync(
            path.join(artDir, "regional.svg"),
            '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="10" y="30">Regional Chart</text></svg>',
        );
        fs.writeFileSync(
            path.join(placeDir, "Regional_Chart.md"),
            "---\nshortcode: regionalchart\nname: { full: Regional Chart }\ntype: map\nsubType: regionalmap\ndata:\n  bgImage: regional\n  scale: { distance: 5, unit: leagues }\n---\n\nA chart.\n",
        );
        fs.writeFileSync(
            path.join(dir, "book.yaml"),
            "contents:\n  - sectionName: Places\n    contents:\n      - filter: \"type = 'place'\"\n      - filter: \"type = 'map'\"\n",
        );

        const { out, status } = build(dir, "--no-compile");
        expect(status, out).toBe(0);
        const dist = path.join(dir, "build", "dist");
        const typ = fs.readdirSync(dist).find((f) => f.endsWith(".typ"))!;
        const source = fs.readFileSync(path.join(dist, typ), "utf8");
        expect(source).toContain('#book-place-map([From here: alpha], "maps/from-alpha.svg")');
        expect(source).toContain('#book-place-map([From here: beta], "maps/from-beta.svg")');
        expect(fs.readFileSync(path.join(dist, "maps", "from-alpha.svg"), "utf8")).toContain(
            "<svg",
        );
        expect(source).not.toContain("maps/from-gamma.svg");
        expect(source).toContain('#book-place-map([Regional Chart], "assets/images/regional.svg")');
        expect(source).toContain("page(columns: 1, flipped: true)");

        if (HAS_TYPST) {
            const compiled = build(dir);
            expect(compiled.status, compiled.out).toBe(0);
            const pdf = fs.readdirSync(dist).find((f) => f.endsWith(".pdf"));
            expect(pdf).toBeDefined();
            if (spawnSync("pdftotext", ["-v"]).status === 0) {
                const pages = spawnSync("pdftotext", ["-layout", path.join(dist, pdf!), "-"], {
                    encoding: "utf8",
                })
                    .stdout.split("\f")
                    .filter((page: string) => page.trim());
                const alphaMap = pages.find((page: string) => page.includes("From here: alpha"));
                expect(alphaMap).toBeDefined();
                expect(alphaMap).not.toContain("A place.");
                expect(pages.filter((page: string) => page.includes("From here:"))).toHaveLength(2);
                expect(pages.some((page: string) => page.includes("Regional Chart"))).toBe(true);
            }
        }
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

it("prints a Scene background on a landscape page at its print resolution", async () => {
    const dir = makeRepo("content");
    try {
        const imageDir = path.join(dir, "assets", "images");
        fs.mkdirSync(imageDir, { recursive: true });
        const image = path.join(imageDir, "battle.webp");
        const original = await sharp(randomBytes(3200 * 900 * 3), {
            raw: { width: 3200, height: 900, channels: 3 },
        })
            .webp({ quality: 95 })
            .toBuffer();
        fs.writeFileSync(image, original);
        fs.writeFileSync(
            path.join(dir, "assets/content/Gear/Battle_Map.md"),
            [
                "---",
                "shortcode: battle",
                "name: { full: Battle Map }",
                "type: map",
                "subType: battlemap",
                "data:",
                "  fixup:",
                "    - { path: '.levels[level0000000000].background.src', type: address, value: battle }",
                "  scene:",
                "    name: Battle Map",
                "    width: 3200",
                "    height: 900",
                "    levels:",
                "      - { _id: level0000000000, name: Ground, background: { src: modules/maps/battle.webp } }",
                "---",
                "",
                "A map.",
                "",
            ].join("\n"),
        );
        fs.writeFileSync(
            path.join(dir, "book.yaml"),
            "contents:\n  - sectionName: Maps\n    contents:\n      - filter: \"type = 'map'\"\n",
        );

        const built = build(dir, "--no-compile");
        expect(built.status, built.out).toBe(0);
        const dist = path.join(dir, "build", "dist");
        const staged = path.join(dist, "assets/images/battle.webp");
        expect((await sharp(staged).metadata()).width).toBe(
            Math.round((11 - (2 * 1.9) / 2.54) * 300),
        );
        expect(fs.readFileSync(image)).toEqual(original);
        const typ = fs.readFileSync(
            path.join(
                dist,
                fs.readdirSync(dist).find((file) => file.endsWith(".typ"))!,
            ),
            "utf8",
        );
        expect(typ).toContain('#book-place-map([Battle Map: Ground], "assets/images/battle.webp")');
        expect(typ).toContain("page(columns: 1, flipped: true)");
        if (HAS_TYPST) expect(build(dir).status).toBe(0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}, 20000);
