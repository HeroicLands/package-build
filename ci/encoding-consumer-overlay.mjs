/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * This work is licensed under the GNU General Public License v3.0 (GPLv3).
 * You may copy, modify, and distribute it under the terms of that license.
 *
 * For full terms, see the LICENSE.md file in the project root or visit:
 * https://www.gnu.org/licenses/gpl-3.0.html
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import YAML from "yaml";

const fromConsumer = (file) => import(pathToFileURL(path.resolve(file)).href);
const { notePath } = await fromConsumer("utils/note-index.mjs");
const languageFile = notePath("skill-aelwthlng");
const encodingFile = notePath("doc-aelwsemaronenc");
const words = [
    ["eksakt", "ìgzà́kt"],
    ["kourteous", "kù́rtiòs"],
];

function edit(file, apply) {
    const source = fs.readFileSync(file, "utf8");
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)/);
    assert.ok(match, `${file}: expected frontmatter`);
    const document = YAML.parseDocument(match[1]);
    assert.equal(document.errors.length, 0);
    apply(document);
    fs.writeFileSync(
        file,
        `---\n${document.toString()}---${match[2]}${source.slice(match[0].length)}`,
    );
}

if (process.argv[2] === "prepare") {
    edit(languageFile, (doc) => {
        const roman = doc.getIn(["data", "roman"]);
        assert.equal(typeof roman, "string");
        assert.ok(!roman.includes("\u0301"));
        doc.setIn(["data", "roman"], roman + "\u0301");
        const entries = doc.getIn(["data", "words"], true).items;
        for (const [old, replacement] of words) {
            const hits = entries.filter((entry) => entry.get("form") === old);
            assert.equal(hits.length, 1, old);
            hits[0].set("form", replacement);
        }
    });
    edit(encodingFile, (doc) => {
        const accepted = doc.getIn(["data", "accepts"], true);
        assert.ok(!accepted.items.some((item) => item.value === "\u0301"));
        accepted.add("\u0301");
        for (const [vowel, glyph] of [
            ["à", "ANKRON_MIN"],
            ["ù", "ULMERA_MIN"],
        ]) {
            assert.deepEqual(doc.getIn(["data", "mappings", vowel]).toJSON(), [glyph, "SHORT"]);
            const key = vowel + "\u0301";
            assert.equal(doc.hasIn(["data", "mappings", key]), false);
            doc.setIn(["data", "mappings", key], [glyph, "SHORT", "STRESS"]);
        }
    });
    console.log("Prepared the two disposable note overlays.");
} else if (process.argv[2] === "verify") {
    const { aelwythiEncoding } = await fromConsumer("utils/aelwythi-encoding.mjs");
    const { encode, encoding, codes, ctx, glyphProblems } = aelwythiEncoding();
    const { decodeText } = await import("@heroiclands/package-build/engine/encoding");
    const { renderRuns } = await import("@heroiclands/package-build/engine/content-scripts");
    for (const [, word] of words) {
        const result = encode(word);
        assert.deepEqual(result.findings, []);
        assert.deepEqual(glyphProblems(result.text), []);
        assert.equal(decodeText(encoding, result.text), word);
        const rendered = renderRuns(`[${word}]{enc=aelwsemaronenc}`, ctx);
        assert.deepEqual(rendered.errors, []);
        assert.match(rendered.markdown, /hl-semaron-kuriale/);
        assert.ok(result.text.includes(codes.SHORT + codes.STRESS));
    }
    console.log("Both requested forms encode, decode and render without findings.");
} else {
    throw new Error("Expected prepare or verify");
}
