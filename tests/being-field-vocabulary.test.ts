/* SPDX-License-Identifier: GPL-3.0-or-later */

import { describe, expect, it } from "vitest";
import { NOTE_VOCABULARY } from "../engine/note-vocabulary.mjs";
import { noteInfobox } from "../engine/infobox.mjs";

/** The declaration for one `data.` field of a note type. */
function field(type: string, name: string) {
    const declared = NOTE_VOCABULARY[type]?.data?.find((entry: any) => entry.name === name);
    if (!declared) throw new Error(`${type} declares no ${name}`);
    return declared;
}

describe("a being's described fields", () => {
    it("states the whole gender vocabulary, and what an absent field means", () => {
        const { describe: text } = field("being", "gender");
        for (const value of ["male", "female", "nonbinary", "none", "other"]) {
            expect(text).toContain(`\`${value}\``);
        }
        expect(text).toMatch(/no gender/);
        expect(text).toMatch(/unrecorded/);
    });

    it("names heavy as the frame between medium and massive", () => {
        const { describe: text } = field("being", "frame");
        for (const value of ["scant", "light", "medium", "heavy", "massive"]) {
            expect(text).toContain(`\`${value}\``);
        }
        expect(text).not.toContain("large");
    });

    it("lets a complexion hold one value or several", () => {
        const declared = field("being", "appearance.complexion");
        expect(declared.kind).toBe("string-or-list");
        expect(declared.shape).toBe("string or list");
    });

    it("leaves the other appearance colours holding one value each", () => {
        for (const name of [
            "appearance.eye_color",
            "appearance.hair_color",
            "appearance.skin_color",
        ]) {
            expect(field("being", name).kind).toBe("string");
        }
    });
});

describe("a complexion of several values", () => {
    /** The appearance clause an infobox composes for one being. */
    const clause = (complexion: unknown) => {
        const box = noteInfobox({
            type: "being",
            subType: "character",
            name: { full: "A Person" },
            data: { appearance: { complexion } },
        });
        const row = box.sections
            .flatMap((section: any) => section.rows)
            .find((entry: any) => entry.label === "Appearance");
        return (row?.value ?? []).join(" | ");
    };

    it("says complexion once however many values there are", () => {
        expect(clause("weathered")).toBe("weathered complexion");
        expect(clause(["weathered"])).toBe("weathered complexion");
        expect(clause(["weathered", "ruddy"])).toBe("weathered and ruddy complexion");
        expect(clause(["weathered", "ruddy", "scarred"])).toBe(
            "weathered, ruddy and scarred complexion",
        );
    });

    it("opens an underscored value out into words", () => {
        expect(clause(["sun_kissed", "battle_scarred"])).toBe(
            "sun kissed and battle scarred complexion",
        );
    });

    it("shows no clause for a complexion that states nothing", () => {
        expect(clause([])).toBe("");
        expect(clause(null)).toBe("");
    });
});
