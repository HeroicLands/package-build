/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { encodingsFromRecords } from "../engine/encoding-notes.mjs";
import { renderPreview } from "../engine/site-preview.mjs";

const config = { contentPackage: "demo", languages: { vyl: { tag: "art-x-vyl" } } };
const fonts = (root: string, missing = false) => ({
    root,
    manifest: {
        families: [
            {
                class: "hl-face",
                codepoints: [{ codepoint: "U+03B1", ...(missing ? {} : { code: "A" }) }],
            },
        ],
    },
});
const raw =
    "---\ntype: doc\nshortcode: bad\ndata:\n  language: vyl\n  font: face\n  mappings: {a: A}\n  rules:\n    normalization: NFD\n    matching: longest-first\n---\n";
const load = (root: string, missing = false) =>
    encodingsFromRecords(
        [
            {
                ...YAML.parse(raw.split("---")[1]),
                package: "demo",
                file: path.join(root, "Bad.md"),
                raw,
            },
        ],
        config,
        fonts(root, missing),
    );

describe("indexed preview preserves external encoding finding positions", () => {
    it.each(["\n", "\r\n"])(
        "keeps the bad document rule location with %j buffer endings",
        (ending) => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "encoding-preview-"));
            try {
                const loaded = load(root);
                const index = {
                    runs: {
                        ...config,
                        encodings: loaded.encodings,
                        encodingFindings: loaded.findings,
                    },
                    expand: (markdown: string) => ({ markdown, figures: [] }),
                };
                const source = [
                    "---",
                    "name: Preview",
                    "type: lore",
                    "---",
                    "",
                    "[a]{enc=bad} [b]{enc=bad}",
                ].join(ending);
                const result = renderPreview(source, {
                    file: "buffer.md",
                    infobox: false,
                    index: index as any,
                });
                expect(result.ok).toBe(false);
                expect(result.findings).toEqual([
                    {
                        file: path.join(root, "Bad.md"),
                        severity: "error",
                        line: 9,
                        column: 20,
                        message: loaded.findings[0].message,
                    },
                ]);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    );
    it("reports unavailable selected-font glyph codes once at their own location", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "encoding-preview-missing-"));
        try {
            const loaded = load(root, true);
            const index = {
                runs: { ...config, encodings: loaded.encodings, encodingFindings: loaded.findings },
                expand: (markdown: string) => ({ markdown, figures: [] }),
            };
            const result = renderPreview("---\nname: Preview\n---\n\n[a]{enc=bad} [b]{enc=other}", {
                file: "buffer.md",
                infobox: false,
                index: index as any,
            });
            expect(result.findings).toEqual([{ ...loaded.findings[0], line: 1, column: 1 }]);
            expect(result.findings[0]).toMatchObject({
                file: path.join(root, "fonts.json"),
                line: 1,
                column: 1,
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
