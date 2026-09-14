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

/**
 * One authored pathname, and the four addresses it resolves to.
 *
 * A note names a file once — in `img:`, in `data.portrait:`, in the body of a
 * markdown image — and four surfaces have to serve it: a Foundry install, this
 * repository's own working tree, the website, and the book. Each addresses the
 * same file differently, so the authored pathname is a *statement of
 * ownership* and every surface derives its own address from it. One statement,
 * four derivations, one rule.
 *
 * ## The rule
 *
 * **The first segment says which package owns the file, when it is followed by
 * `assets/`.** Everything after `assets/` is the *suffix* — the path inside
 * that package's shipped tree, and the one piece every form is built from.
 *
 * | Authored                    | Owner            | Suffix              |
 * | --------------------------- | ---------------- | ------------------- |
 * | `sohl/assets/icons/a.svg`   | the `sohl` package | `icons/a.svg`     |
 * | `images/beings/b.webp`      | **this** package | `images/beings/b.webp` |
 *
 * A pathname that does not open with `<package>/assets/` belongs to the package
 * being built, and the whole of it is the suffix. That is the ordinary case and
 * the one nearly every note writes.
 *
 * The four forms, for a `thalorna` note writing `images/map.webp` (`thalorna`
 * ships as the Foundry module `sohl-thalorna`):
 *
 * | Form      | Address                                            |
 * | --------- | -------------------------------------------------- |
 * | `foundry` | `modules/sohl-thalorna/assets/images/map.webp`      |
 * | `local`   | `assets/images/map.webp`                            |
 * | `web`     | `https://cdn.heroiclands.org/thalorna/images/map.webp` |
 * | `pdf`     | `assets/images/map.webp`                            |
 *
 * **`<package>` and `<foundry-id>` are two different names.** The package is
 * `thalorna` — what the content is called, what the website serves it under,
 * and what a note writes. The Foundry id is `sohl-thalorna` — what Foundry
 * installs the module as, and the only place that name appears. They coincide
 * for `sohl` and `hm3`, which is exactly why the two are kept apart here rather
 * than treated as one value.
 *
 * `local` and `pdf` read the same and mean different places: `local` is the file
 * in the owning repository's working tree, `pdf` is where the book stages a copy
 * beside its Typst source. They are derived separately because only one of them
 * is a file a build may open — see {@link PathnameForms.own}.
 *
 * ## What is not a package pathname
 *
 * **An off-install address passes through on every surface**: a URL, a
 * protocol-relative `//host/…`, or a `/`-rooted path, which Foundry serves from
 * the data root and which names no package at all. That is how a note addresses
 * core Foundry art (`/icons/svg/mystery-man.svg`) or a package this build knows
 * nothing about (`/systems/dnd5e/icons/spell.webp`).
 *
 * **A package this build has never heard of keeps its ownership.** The website
 * and the book need only the package's name and the suffix, so both resolve;
 * the Foundry address needs the package's kind and its Foundry id, which only a
 * declared relationship carries, so that one form comes back `null` and the
 * caller that needs it refuses. Reading such a pathname as this package's own
 * would file one package's name inside another's tree and say nothing.
 *
 * **A `systems/…` or `modules/…` pathname is refused.** It is a Foundry address
 * written where an ownership statement belongs: it resolves for Foundry and for
 * nothing else, because neither the website nor the book has any such directory.
 * {@link pathnameProblem} names the replacement, and every surface refuses the
 * value rather than deriving an address from it — a wrong address that resolves
 * to a 404 is the failure this module exists to remove, and inventing one here
 * would reintroduce it one directory along.
 *
 * ## The two empties
 *
 * `null` — or an absent key, which arrives as `undefined` — means **unset**: the
 * note names no file and the caller's default applies. `""` means **blank on
 * purpose**: the note names no file and wants none, so no default may replace
 * it. `resolvePathname` returns `null` for the first and a form object whose
 * every address is `""` for the second, so the two stay distinguishable all the
 * way to the caller.
 *
 * @module
 */

/**
 * The directory a package ships its files in, and the segment that marks a
 * pathname's first segment as a package name.
 *
 * One constant rather than a literal in six places: it is the second segment of
 * an authored package pathname, the last segment of a Foundry asset root, the
 * whole of the `local` form's prefix, and the directory the book stages into.
 *
 * @type {string}
 */
export const ASSETS_SEGMENT = "assets";

/**
 * The Foundry roots that mark a pathname as written in Foundry's own spelling.
 *
 * `worlds/` is left out for the reason it was always left out: a package may not
 * ship files out of a world, so a note writing one has made a different mistake
 * and gets the ordinary "this package owns it" reading, which yields a plainly
 * broken path rather than a plausible one.
 *
 * @type {readonly string[]}
 */
const FOUNDRY_ROOTS = Object.freeze(["systems", "modules"]);

/**
 * The relationship kinds whose packages a note may address.
 *
 * `conflicts` is absent: a package this one cannot run beside is not one whose
 * artwork it cites.
 *
 * @type {readonly string[]}
 */
const ADDRESSABLE_RELATIONSHIPS = Object.freeze(["systems", "requires", "recommends"]);

/**
 * The surfaces one authored pathname resolves for.
 *
 * Exported so a test can assert that every form a resolution carries is one of
 * these, and that none is missing — the guard against a fifth surface being
 * added to one caller and forgotten in the resolver.
 *
 * @type {readonly string[]}
 */
export const PATHNAME_SURFACES = Object.freeze(["foundry", "local", "web", "pdf"]);

/**
 * One authored pathname, resolved.
 *
 * @typedef {object} PathnameForms
 * @property {string} authored  The pathname exactly as the note wrote it.
 * @property {"blank"|"external"|"package"} state  `blank` for `""`, `external`
 *   for an address no package owns, `package` for an owned file.
 * @property {string|null} package  The content package that owns the file, or
 *   `null` when no package does.
 * @property {string|null} suffix  The path inside that package's shipped tree.
 * @property {boolean} own  Whether the owner is the package being built, and so
 *   whether `local` names a file this build may open.
 * @property {string|null} foundry  The address inside a Foundry install.
 * @property {string|null} local  The file in the owning repository's tree.
 * @property {string|null} web  The address the website serves.
 * @property {string|null} pdf  Where the book stages its copy.
 */

/**
 * Whether a pathname addresses something outside every package.
 *
 * Three shapes, each a different kind of "no package owns this": a URI scheme
 * (`https:`, `data:`), a protocol-relative `//host/…`, and a `/`-rooted path,
 * which Foundry serves from the data root rather than from any package.
 *
 * @param {string} s - A non-empty authored pathname.
 * @returns {boolean} Whether every surface emits it unchanged.
 */
function isExternal(s) {
    // Checked before the single-slash case, which would otherwise claim it.
    if (s.startsWith("//")) return true;
    if (s.startsWith("/")) return true;
    return /^[a-z][a-z0-9+.-]*:/i.test(s);
}

/**
 * The pathname a Foundry-spelled one should be written as.
 *
 * Both shapes a tree carries fold into the same answer: a served path that
 * already names an `assets/` directory keeps its suffix, and one that does not —
 * `hm3` serves its pictures from `images/` at its own root — gains the segment,
 * because `assets/` is where a package's files sit in every form this module
 * derives.
 *
 * @param {string} s - A pathname opening with a Foundry root.
 * @returns {string} What to write instead.
 */
function convertedSpelling(s) {
    const [, id, ...rest] = s.split("/");
    const tail = rest.join("/");
    if (rest[0] === ASSETS_SEGMENT) return `${id}/${tail}`;
    return `${id}/${ASSETS_SEGMENT}/${tail}`;
}

/**
 * What is wrong with an authored pathname, or `""` when nothing is.
 *
 * Config-free, and a sentence rather than a code, so the lint that has a line
 * and a column to attach it to and the resolver that has only a file say the
 * same thing about the same value.
 *
 * @param {string|null|undefined} raw - The pathname, as authored.
 * @returns {string} The problem, as a finding's sentence, or `""`.
 */
export function pathnameProblem(raw) {
    if (raw == null) return "";
    const s = String(raw);
    if (!s || isExternal(s)) return "";
    const root = s.split("/")[0];
    if (!FOUNDRY_ROOTS.includes(root)) return "";
    return (
        `\`${s}\` is a Foundry address — write \`${convertedSpelling(s)}\`. A pathname ` +
        "names the package that owns the file and the path inside that package's " +
        "`assets/`, and each surface derives its own address from it: Foundry gets " +
        "the path inside the install, the website gets one on the asset host, and " +
        "the book gets a staged copy. A `" +
        `${root}/` +
        "` path is only one of those three, so the other two serve a file that " +
        "is not there"
    );
}

/**
 * Every game system this build compiles content for.
 *
 * Four declarations say so, and a package makes whichever of them its situation
 * calls for: `systems:` states a system it stamps content against, `packs[].system`
 * gates a pack on one, `requiresSystem` restricts the package to one, and
 * `relationships.systems` names one in the shipped manifest. `harn-ensemble`
 * ships an HM3 pack and a SoHL pack and declares neither relationship, because
 * naming a system in a relationship is what would stop Foundry loading the
 * module in the other one's world — so reading any single declaration would
 * miss the package whose content cites both systems' artwork.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {string[]} The system ids, deduplicated.
 */
function declaredSystemIds(config) {
    return [
        ...new Set(
            [
                ...Object.keys(config.systems ?? {}),
                config.requiresSystem,
                ...(config.packs ?? []).map((pack) => pack.system),
                ...(config.relationships?.systems ?? []).map((rel) => rel.id),
            ].filter(Boolean),
        ),
    ];
}

/**
 * Every content package this build can resolve a pathname against.
 *
 * The package being built; every game system it compiles content for, which
 * Foundry serves from `systems/<id>`; and every other package it declares a
 * relationship with, which states that package's Foundry id and — where the two
 * words differ — what its content is called.
 *
 * @param {object} config - The resolved build configuration.
 * @returns {Map<string, {root: string|null, id: string|null, own: boolean}>} The
 *   packages, by content package name. `root` is the Foundry directory the
 *   package is served from, `null` where the package ships no Foundry package.
 */
export function packageAddresses(config) {
    /** @type {Map<string, {root: string|null, id: string|null, own: boolean}>} */
    const out = new Map();
    if (config.contentPackage) {
        out.set(config.contentPackage, {
            // `assetRoot` is `<root>/<id>/assets`, and `null` for a
            // `documentation` package — which is the same "Foundry serves no
            // files for this" the `root` below says.
            root: config.assetRoot ? config.packageKind : null,
            id: config.foundryPackage ?? null,
            own: true,
        });
    }
    // The package being built wins every collision: it is the one whose files
    // this repository actually holds, and another declaration of the same name
    // describes that very package from outside.
    for (const id of declaredSystemIds(config)) {
        if (out.has(id)) continue;
        out.set(id, { root: "systems", id, own: false });
    }
    for (const kind of ADDRESSABLE_RELATIONSHIPS) {
        for (const rel of config.relationships?.[kind] ?? []) {
            const name = rel.contentPackage ?? rel.id;
            if (out.has(name)) continue;
            const type = rel.type ?? (kind === "systems" ? "system" : "module");
            out.set(name, { root: `${type}s`, id: rel.id, own: false });
        }
    }
    return out;
}

/**
 * Resolve one authored pathname into the address each surface serves.
 *
 * @param {string|null|undefined} raw - The pathname, as authored.
 * @param {object} config - The resolved build configuration. Required rather
 *   than defaulted, which is what keeps this module a leaf: it reads a
 *   configuration and never loads one, so the lint can import it without a
 *   repository to resolve.
 * @returns {PathnameForms|null} The four forms, or `null` when the note names
 *   no file at all.
 * @throws {Error} When the pathname is written in Foundry's own spelling, which
 *   resolves on one surface and nowhere else.
 */
export function resolvePathname(raw, config) {
    if (raw == null) return null;
    const authored = String(raw);
    if (authored === "") {
        return {
            authored,
            state: "blank",
            package: null,
            suffix: null,
            own: false,
            foundry: "",
            local: "",
            web: "",
            pdf: "",
        };
    }
    if (isExternal(authored)) {
        return {
            authored,
            state: "external",
            package: null,
            suffix: null,
            own: false,
            foundry: authored,
            local: authored,
            web: authored,
            pdf: authored,
        };
    }
    const problem = pathnameProblem(authored);
    if (problem) throw new Error(`package-build: ${problem}.`);

    const packages = packageAddresses(config);
    const segments = authored.split("/");
    // The first segment names a package when an `assets/` follows it. That is
    // the whole test, and it is deliberately not "when the name is one this
    // build knows": a pathname whose owner this build has never heard of still
    // has a package, a suffix, and a correct address on the website, and
    // reading it as this package's own would put one package's name inside
    // another's tree and report nothing.
    const named = segments.length > 2 && segments[1] === ASSETS_SEGMENT ? segments[0] : "";
    const owner = named || (config.contentPackage ?? null);
    const suffix = named ? segments.slice(2).join("/") : authored;
    const entry = owner ? packages.get(owner) : undefined;
    const host = String(config.site?.assets ?? "").replace(/\/+$/, "");

    return {
        authored,
        state: "package",
        package: owner,
        suffix,
        own: entry?.own === true,
        // `null` where the owning package ships no Foundry package, and where
        // the first segment names a package this build has never heard of:
        // both are "there is no install path to derive", and guessing one
        // writes an address into a document nobody would check.
        foundry:
            entry?.root && entry.id ?
                `${entry.root}/${entry.id}/${ASSETS_SEGMENT}/${suffix}`
            :   null,
        local: `${ASSETS_SEGMENT}/${suffix}`,
        // `null` where no asset host is configured. The website is the one
        // surface whose address is not derivable from the repository itself.
        web: host && owner ? `${host}/${owner}/${suffix}` : null,
        pdf: `${ASSETS_SEGMENT}/${suffix}`,
    };
}
