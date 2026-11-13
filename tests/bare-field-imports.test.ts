/* SPDX-License-Identifier: GPL-3.0-or-later */
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it.each(["culture-choice", "item-entries", "culture-terms", "item-terms"])(
    "imports %s independently without package configuration",
    (name) => {
        const env = { ...process.env };
        delete env.PACKAGE_BUILD_CONFIG;
        delete env.CONTENT_BUILD_CONFIG;
        expect(() =>
            execFileSync(
                process.execPath,
                [
                    "--input-type=module",
                    "-e",
                    `await import("@heroiclands/package-build/engine/${name}")`,
                ],
                { cwd: process.cwd(), env, stdio: "pipe" },
            ),
        ).not.toThrow();
    },
);

it("preserves the shared field declarations and their checks", async () => {
    const { CULTURE_FIELD, checkCultureChoice } = await import("../engine/culture-choice.mjs");
    const { ITEMS_FIELD, ITEM_ENTRY, checkItems } = await import("../engine/item-entries.mjs");
    const { dataFields } = await import("../engine/note-vocabulary.mjs");
    const culture = dataFields("being").find((field: any) => field.name === "culture") as any;
    const items = dataFields("being").find((field: any) => field.name === "items") as any;
    expect(culture).toMatchObject({
        kind: CULTURE_FIELD.kind,
        ref: CULTURE_FIELD.ref,
        accepts: CULTURE_FIELD.accepts,
        check: checkCultureChoice,
    });
    expect(items).toMatchObject({ kind: ITEMS_FIELD.kind, entries: ITEM_ENTRY, check: checkItems });
    expect(items.entries).toBe(ITEM_ENTRY);
});
