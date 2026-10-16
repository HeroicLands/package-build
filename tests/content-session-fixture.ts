/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { configFromData } from "../engine/pack-config.mjs";

export function write(file: string, text: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, "utf8");
}

export function note(fm: object, body = "Written prose.") {
    return `---\n${YAML.stringify(fm)}---\n\n${body}\n`;
}

export function fixture(size = 8, pkg = "sessionproof") {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pb-content-session-")));
    write(path.join(root, "package.json"), JSON.stringify({ name: pkg, version: "1.0.0" }));
    const data = {
        contentPackage: pkg,
        packageKind: "modules",
        compatibility: { minimum: "14", verified: "14.367" },
        stats: { lastModifiedBy: "sessionproof0000" },
        skipDirectories: ["Templates"],
        systems: { sohl: { compatibility: { verified: "0.9.0" } } },
        itemBuilders: ["sohl"],
        packs: [
            { name: "items", type: "Item", system: "sohl", default: true, mayBeEmpty: true },
            { name: "journals", type: "JournalEntry", default: true },
        ],
    };
    const configFile = path.join(root, "package-build.config.yaml");
    write(configFile, YAML.stringify(data));
    const config = configFromData(data, configFile);
    const files = new Map<string, string>();
    for (let n = 0; n < size; n++) {
        const fm =
            n === 2 ?
                {
                    type: "skill",
                    subType: "language",
                    shortcode: "tongue",
                    name: { full: "Tongue" },
                    data: {
                        fields: [{ name: "Nature", holds: "Natural things." }],
                        words: [{ form: "men", class: "n", field: "Nature", gloss: "stone" }],
                    },
                }
            : n === 3 ?
                {
                    type: "lore",
                    subType: "culture",
                    shortcode: "folk",
                    name: { full: "The Folk" },
                    data: {
                        language: "skill-tongue",
                        glossary: [{ name: "men", definition: "a stone raised to mark a meeting" }],
                    },
                }
            :   {
                    type: n === size - 2 ? "homepage" : "lore",
                    ...(n === size - 2 ? {} : { subType: "history" }),
                    shortcode: n === size - 2 ? "root" : `n${n}`,
                    name: { full: `Note ${n}` },
                    description: `Note ${n}.`,
                    ...(n === size - 1 ? { tags: ["gm"] } : {}),
                };
        const body =
            n === 0 ?
                [
                    "# Here {#here}",
                    "",
                    "😀 Before [[lore-n1#here|One]] and [[lore-n1#here|One]].\r",
                    "",
                    "> [!NOTE]{#notice}",
                    "> An alert.",
                    "",
                    "A [named span]{#inline}.",
                    "",
                    "```sql",
                    `SELECT CASE WHEN count(*) > 0 THEN 'Private' ELSE 'Public' END AS Audience FROM notes WHERE shortcode = 'n${size - 1}'`,
                    "```",
                ].join("\n")
            : n === 2 ? ""
            : "# Here {#here}\n\nWritten prose.";
        const file = path.join(config.paths.content, `Note${n}.md`);
        const raw = note(fm, body);
        write(file, raw);
        files.set(file, raw);
    }
    write(
        path.join(config.paths.content, "Templates/Skipped.md"),
        note({ type: "doc", shortcode: "skipped" }),
    );
    return { root, config, configFile, files, size };
}

export function outputBytes(dir: string) {
    const bytes: Record<string, string> = {};
    const walk = (where: string) => {
        if (!fs.existsSync(where)) return;
        for (const entry of fs.readdirSync(where, { withFileTypes: true })) {
            const file = path.join(where, entry.name);
            if (entry.isDirectory()) walk(file);
            else bytes[path.relative(dir, file)] = fs.readFileSync(file).toString("base64");
        }
    };
    walk(dir);
    return bytes;
}
