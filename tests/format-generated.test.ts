/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { formatGenerated } from "../engine/format-generated.mjs";

it("formats generated text using its destination's configuration", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "package-build-format-"));
    fs.writeFileSync(path.join(root, ".prettierrc.json"), JSON.stringify({ singleQuote: true }));
    expect(
        await formatGenerated('const title = "A note";\n', path.join(root, "generated.js")),
    ).toBe("const title = 'A note';\n");
});
