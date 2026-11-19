/* SPDX-License-Identifier: GPL-3.0-or-later */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCanonicalKey } from "../engine/address.mjs";

vi.mock("../engine/art-package.mjs", () => ({
    loadArtPackage: vi.fn(async (_dir, expected) => ({
        records: [
            {
                address: {
                    canonical: readCanonicalKey(`${expected.contentPackage}-none-image-first`),
                },
            },
        ],
        files: new Map([["images/first.webp", path.join(_dir, "images/first.webp")]]),
    })),
}));
import { resolveArtPackages } from "../engine/art-package-resolve.mjs";
import { loadArtPackage } from "../engine/art-package.mjs";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(names = ["@heroiclands/art-test"]) {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "art-resolve-"));
    roots.push(rootDir);
    const deps = Object.fromEntries(names.map((name) => [name, "1.2.3"]));
    const lock: any = { lockfileVersion: 3, packages: { "": { devDependencies: deps } } };
    for (const name of names) {
        const dir = path.join(rootDir, "node_modules", name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, "package.json"),
            JSON.stringify({ name, version: "1.2.3" }),
        );
        lock.packages[`node_modules/${name}`] = {
            version: "1.2.3",
            integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
        };
    }
    const manifest: any = { devDependencies: deps };
    const save = () => {
        fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify(manifest));
        fs.writeFileSync(path.join(rootDir, "package-lock.json"), JSON.stringify(lock));
    };
    save();
    return {
        config: { rootDir, contentPackage: "sohl", art: { packages: names } },
        manifest,
        lock,
        save,
    };
}
describe("resolveArtPackages", () => {
    it("loads the local exact installation with package-scoped bindings", async () => {
        const f = fixture();
        const result = await resolveArtPackages(f.config);
        expect(result[0].name).toBe("@heroiclands/art-test");
        expect(result[0].files.get("images/first.webp")).toContain("node_modules");
    });
    it("passes the consumer identity to the validator and rejects undeclared names", async () => {
        const f = fixture();
        const validatePublicNote = () => true;
        await resolveArtPackages(f.config, { validatePublicNote });
        expect(loadArtPackage).toHaveBeenCalledWith(expect.any(String), {
            name: "@heroiclands/art-test",
            version: "1.2.3",
            contentPackage: "sohl",
            validatePublicNote,
        });
        delete f.manifest.devDependencies["@heroiclands/art-test"];
        f.save();
        await expect(resolveArtPackages(f.config)).rejects.toThrow(/exact required devDependency/);
    });
    it("rejects duplicate and unsafe package names before looking outside the consumer", async () => {
        const f = fixture();
        f.config.art.packages = ["https://user:secret@example.com/art"];
        await expect(resolveArtPackages(f.config)).rejects.toThrow(
            /^art\.packages: invalid package name$/,
        );
        f.config.art.packages = ["@heroiclands/art-test", "@heroiclands/art-test"];
        await expect(resolveArtPackages(f.config)).rejects.toThrow(/duplicate package/);
    });
    it.each(["^1.2.3", "file:../art", "latest", "1.2"])(
        "rejects non-exact declaration %s",
        async (version) => {
            const f = fixture();
            f.manifest.devDependencies["@heroiclands/art-test"] = version;
            f.save();
            await expect(resolveArtPackages(f.config)).rejects.toThrow(
                /exact required devDependency/,
            );
        },
    );
    it.each(["integrity", "version", "name", "resolved", "link"])(
        "refuses a bad lock %s",
        async (field) => {
            const f = fixture();
            const entry = f.lock.packages["node_modules/@heroiclands/art-test"];
            entry[field] = (
                {
                    integrity: "sha512-notbase64",
                    version: "1.0.0",
                    name: "wrong",
                    resolved: "file:../art",
                    link: true,
                } as any
            )[field];
            f.save();
            await expect(resolveArtPackages(f.config)).rejects.toThrow(/locked identity/);
        },
    );
    it("rejects a stale root lock declaration and optional packages", async () => {
        const f = fixture();
        f.lock.packages[""].devDependencies = {};
        f.save();
        await expect(resolveArtPackages(f.config)).rejects.toThrow(/root declaration/);
        f.lock.packages[""].devDependencies = f.manifest.devDependencies;
        f.manifest.optionalDependencies = { "@heroiclands/art-test": "1.2.3" };
        f.save();
        await expect(resolveArtPackages(f.config)).rejects.toThrow(/required devDependency/);
    });
    it("refuses missing and mismatched installed packages", async () => {
        const f = fixture();
        const file = path.join(f.config.rootDir, "node_modules/@heroiclands/art-test/package.json");
        fs.writeFileSync(file, JSON.stringify({ name: "wrong", version: "1.2.3" }));
        await expect(resolveArtPackages(f.config)).rejects.toThrow(/identity or version/);
        fs.rmSync(path.dirname(file), { recursive: true });
        await expect(resolveArtPackages(f.config)).rejects.toThrow(/missing/);
    });
    it("rejects duplicate canonical addresses across independently loaded splits", async () => {
        const f = fixture(["art-one", "art-two"]);
        await expect(resolveArtPackages(f.config)).rejects.toThrow(/duplicate artwork address/);
    });
});
