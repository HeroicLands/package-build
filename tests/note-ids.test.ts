/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * A document's `_id` is a function of its canonical address.
 *
 * The note already has an identity — `package-system-type-shortcode`, unique by
 * construction and checked by `content-lint` — so the opaque 16-character `id`
 * every note used to author was a *second* identity for one thing, guaranteed
 * by nothing. These are the properties that replace it: an id derives, an
 * authored one still wins, and two notes cannot derive one id without already
 * being a duplicate address.
 */

import { describe, it, expect } from "vitest";

import { documentId, DOCUMENT_ID_NAMESPACE, canonicalKey } from "../engine/content-address.mjs";
import { makeId } from "../engine/ids.mjs";
import { noteDocId, resolveNoteId } from "../engine/note-ids.mjs";
import {
    FOLDER_TYPE,
    collectFolderNotes,
    folderDocId,
    folderDocument,
} from "../engine/folder-notes.mjs";
import { SOHL_DOCUMENT_SUBTYPES } from "../sohl/document-subtypes.mjs";

const MAPS = [SOHL_DOCUMENT_SUBTYPES] as any;
const at = { pkg: "sohl", maps: MAPS };

describe("documentId", () => {
    it("is the canonical address, hashed under one stated namespace", () => {
        const key = canonicalKey("sohl", "sohl", "miscgear", "bowlcer");
        expect(documentId("sohl", "sohl", "miscgear", "bowlcer")).toBe(
            makeId(DOCUMENT_ID_NAMESPACE, key),
        );
    });

    it("is a 16-character Foundry id", () => {
        expect(documentId("sohl", "sohl", "miscgear", "bowlcer")).toMatch(/^[0-9a-f]{16}$/);
    });

    it("separates two packages that share a `(type, shortcode)`", () => {
        // The address is globally unique precisely because it carries the
        // package; the id inherits that and nothing else has to check it.
        expect(documentId("sohl", "sohl", "skill", "swim")).not.toBe(
            documentId("thalorna", "sohl", "skill", "swim"),
        );
    });

    it("separates the same shortcode under two types", () => {
        expect(documentId("sohl", "none", "doc", "combat")).not.toBe(
            documentId("sohl", "sohl", "skill", "combat"),
        );
    });
});

describe("noteDocId", () => {
    it("derives from the note's canonical address when it authors no id", () => {
        const fm = { type: "miscgear", shortcode: "bowlcer" };
        expect(noteDocId(fm, at)).toBe(documentId("sohl", "sohl", "miscgear", "bowlcer"));
    });

    it("takes the authored id when there is one — a pin always wins", () => {
        const fm = { type: "miscgear", shortcode: "bowlcer", id: "plaiQQm2T5zVK5mO" };
        expect(noteDocId(fm, at)).toBe("plaiQQm2T5zVK5mO");
    });

    it("reads the system from the type, so one note derives one id", () => {
        // `systemOf` is what puts `sohl` in the address of an item note and
        // `none` in a journal's. The id has to agree with the address the
        // content index publishes, or a consumer cannot recompute the UUID.
        const item = { type: "skill", shortcode: "swim" };
        const journal = { type: "doc", shortcode: "swim" };
        expect(noteDocId(item, at)).toBe(documentId("sohl", "sohl", "skill", "swim"));
        expect(noteDocId(journal, at)).toBe(documentId("sohl", "none", "doc", "swim"));
    });

    it("yields nothing for a file with no address to derive from", () => {
        // A note with no type or no shortcode is not addressable, so it has no
        // document and inventing an id for one would file it under nothing.
        expect(noteDocId({ shortcode: "bowlcer" }, at)).toBeUndefined();
        expect(noteDocId({ type: "miscgear" }, at)).toBeUndefined();
        expect(noteDocId(null, at)).toBeUndefined();
    });

    it("ignores a blank authored id rather than treating it as a pin", () => {
        expect(noteDocId({ type: "skill", shortcode: "swim", id: "   " }, at)).toBe(
            documentId("sohl", "sohl", "skill", "swim"),
        );
    });
});

describe("resolveNoteId", () => {
    it("fills the note's `id` in place, so every pass reads one value", () => {
        const fm: any = { type: "skill", shortcode: "swim" };
        resolveNoteId(fm, at);
        expect(fm.id).toBe(documentId("sohl", "sohl", "skill", "swim"));
    });

    it("leaves an authored id exactly as written", () => {
        const fm: any = { type: "skill", shortcode: "swim", id: "plaiQQm2T5zVK5mO" };
        resolveNoteId(fm, at);
        expect(fm.id).toBe("plaiQQm2T5zVK5mO");
    });

    it("leaves an unaddressable note without an id rather than throwing", () => {
        const fm: any = { type: "skill" };
        resolveNoteId(fm, at);
        expect(fm.id).toBeUndefined();
    });

    it("is idempotent — a second pass derives the same value", () => {
        const fm: any = { type: "skill", shortcode: "swim" };
        resolveNoteId(fm, at);
        const first = fm.id;
        resolveNoteId(fm, at);
        expect(fm.id).toBe(first);
    });
});

/*
 * A folder is a real Foundry `Folder`, and its `_id` is hashed under the
 * **folder** namespace against its own address — not under `document`,
 * so that a folder and an item sharing a shortcode cannot collide silently.
 *
 * `noteDocId` used to hash every note alike, so the value it returned for a
 * folder was a second derivation of one id, and the one that does not ship.
 * Nothing inside a build noticed: no pass reads a folder's id from here (the
 * folder pass reads the note from disk), and every folder note in this
 * repository pins an `id`, which wins in both paths. The content index is where
 * it surfaced, because the index is read from outside.
 */
describe("noteDocId, for a folder note", () => {
    const folderFm = { type: FOLDER_TYPE, shortcode: "cookware" };

    it("hashes under the folder namespace, which is what the packs address", () => {
        expect(noteDocId(folderFm, at)).toBe(folderDocId("sohl", "cookware"));
    });

    it("is the id the emitted Folder document carries", () => {
        // The end the issue is about: the published value and the shipped one.
        const [folder] = collectFolderNotes(
            [{ frontmatter: { ...folderFm }, absPath: "/content/Cookware.md" }],
            "sohl",
        );
        expect(noteDocId(folderFm, at)).toBe(folderDocument(folder, null, "Item", {})._id);
    });

    it("is not the id it would derive under the document namespace", () => {
        expect(noteDocId(folderFm, at)).not.toBe(documentId("sohl", "none", "folder", "cookware"));
    });

    it("still takes an authored id — a pin wins here as it does everywhere", () => {
        expect(noteDocId({ ...folderFm, id: "ONXsqZAIZr2qzxTb" }, at)).toBe("ONXsqZAIZr2qzxTb");
    });

    it("reads the type case-insensitively, as the folder pass does", () => {
        expect(noteDocId({ type: "Folder", shortcode: "cookware" }, at)).toBe(
            folderDocId("sohl", "cookware"),
        );
    });
});
