/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";

const ambient = vi.hoisted(() =>
    vi.fn(() => {
        throw new Error("ambient configuration read");
    }),
);

vi.mock("../engine/pack-config.mjs", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    loadPackConfig: ambient,
}));

import { renderNoteFile } from "../engine/note-page.mjs";
import { CORPUS_NOTE, copyFixture } from "./helpers/parity";

const roots = [copyFixture(), copyFixture()];
afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

it("renders interleaved repositories without loading ambient configuration", async () => {
    const note = path.join("assets", "content", CORPUS_NOTE);
    for (const [i, root] of roots.entries()) {
        fs.appendFileSync(
            path.join(root, note),
            `\nRepository marker ${i}. [[docbeing-guard|Guard]]\n`,
        );
        fs.writeFileSync(
            path.join(root, "assets/content/Lore/guard.md"),
            "---\ntype: being\nshortcode: guard\nname:\n    full: Guard\n---\n\nGuard text.\n",
        );
        const file = path.join(root, "package-build.config.yaml");
        fs.writeFileSync(
            file,
            fs.readFileSync(file, "utf8").replace("label: star", `label: marker${i}`),
        );
    }
    const pages = await Promise.all(
        roots.map((root) => renderNoteFile(note, { root, cache: false })),
    );
    expect(pages[0].html).toContain("Repository marker 0");
    expect(pages[1].html).toContain("Repository marker 1");
    expect(pages[0].html).toContain("marker0");
    expect(pages[1].html).toContain("marker1");
    const cached = await Promise.all(roots.map((root) => renderNoteFile(note, { root })));
    expect(cached.map((page) => page.html)).toEqual(pages.map((page) => page.html));
    expect(ambient).not.toHaveBeenCalled();
}, 60000);
