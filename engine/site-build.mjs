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
 * Publishing a content tree as a website (#63).
 *
 * Compiling a content tree into compendium packs is `content-build package
 * compile`. Publishing the *same tree* as a website was a script each consumer
 * wrote for itself — 473 code lines in `sohl` and 462 in `sohl-thalorna`, 87 of
 * them identical — and the copies drifted in ways neither repository could see.
 * `sohl-thalorna` reimplemented four things this package already exported, not
 * because it needed different behaviour but because its script predates the
 * extraction. That is the failure a command removes: a consumer cannot
 * accidentally reimplement one.
 *
 * **What is here is the pass, not the framing.** The walk, the frontmatter read,
 * the address derivation, the address index, table expansion, wikilink
 * resolution, code-fence protection, the foreign-manifest merge, the page
 * emission and the section-landing backfill are the same job everywhere. Where a
 * page's address comes from (`publish.address`), what a section is called, and
 * what a repository's own rewrites are, are not — they arrive as configuration
 * and as a **named** pass bundle, since a configuration is data and cannot hold
 * a function.
 *
 * **Every gate reports; none exits.** The integrity checks a site build needs —
 * a wikilink authored in frontmatter, a name that yields no slug, two pages
 * claiming one URL, an unusable or unaddressable foreign manifest, an address
 * two packages both claim, a table directive that cannot be honoured, a dead
 * wikilink — were inline `process.exit` calls in both scripts, with no test
 * between them. Here each returns its findings and the command decides. That is
 * the rule `engine/site-index.mjs` already follows, and it is the only reason
 * these cases can be tested at all.
 *
 * @module
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import matter from "gray-matter";

import { contentSlug, findSlugCollisions, slugify } from "./content-slug.mjs";
import { sectionOf } from "./content-address.mjs";
import { protectCode } from "./code-fences.mjs";
import { expandContentTables } from "./content-tables.mjs";
import { buildSiteIndex, wikiContext } from "./site-index.mjs";
import { frontmatterWikilinks, resolveWebWikilinks } from "./web-wikilinks.mjs";
import { loadForeignManifests, manifestsComplete } from "./kb-manifest.mjs";
import { formatUnaddressableFinding, unaddressableForeignPackages } from "./foreign-manifests.mjs";
import { deriveBeingInfo, isBeing } from "../sohl/being-info.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import { searchableFrontmatter } from "./note-package.mjs";
import {
    HOMEPAGE_DESTINATION,
    checkHomepageCount,
    homepageFrontmatter,
    homepageTitle,
    isHomepage,
} from "./homepage.mjs";
import { publishesContentPages } from "../content-config.mjs";

const require = createRequire(import.meta.url);

/**
 * Every `.md` file under `dir`, depth-first in directory order.
 *
 * Deliberately *not* {@link walkMarkdownTree}, whose stack-based walk yields a
 * tree in reverse. Order was load-bearing here when the address index carried
 * first-writer-wins fallbacks for a page's name, filename and slug — reversing
 * the walk silently changed which page an ambiguous name resolved to. Those
 * fallbacks are gone with the bare `[[Name]]` form (#180), so this is now
 * ordinary reading order rather than a dependency; it is kept because a site's
 * emitted pages should not reorder for no reason.
 *
 * @param {string} dir - Directory to walk.
 * @param {readonly string[]} skip - Directory names to ignore at any depth.
 * @returns {string[]} Absolute paths.
 */
export function walkSiteTree(dir, skip = []) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    const skipped = new Set(skip);
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (skipped.has(e.name)) continue;
            out.push(...walkSiteTree(full, skip));
        } else if (e.isFile() && e.name.endsWith(".md")) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Reads a note, returning `null` for one that cannot be parsed.
 *
 * A file that is not front-mattered markdown is skipped rather than reported: a
 * content tree is edited in Obsidian, which leaves files of its own about, and
 * failing on one would make the build hostage to the editor.
 *
 * @param {string} file - Absolute path.
 * @returns {{fm: object, body: string}|null}
 */
function readNote(file) {
    try {
        const { data, content } = matter(fs.readFileSync(file, "utf8"));
        return { fm: data, body: content };
    } catch {
        return null;
    }
}

/**
 * The content tree's pages, and what could not be addressed.
 *
 * @param {string} contentBase - Absolute path to the content tree.
 * @param {object} ctx - `{ packages, contentPackage, skipDirectories, mount,
 *   scheme }`. `contentPackage` is the package a note that declares none
 *   belongs to.
 * @returns {{pages: object[], slugFindings: object[], fmLinkFindings: object[]}}
 */
export function collectContentPages(contentBase, ctx) {
    const pages = [];
    const slugFindings = [];
    const fmLinkFindings = [];

    for (const file of walkSiteTree(contentBase, ctx.skipDirectories)) {
        const note = readNote(file);
        if (!note) continue;
        const { fm, body } = note;
        // The configuration's, never a note's: `package:` is retired, so every
        // note in the tree belongs to the package this repository compiles
        // (#56).
        const pkg = ctx.contentPackage;
        if (!ctx.packages.has(pkg) || !fm.type) continue;
        // A homepage is addressed by the *package*, not by its own name, so it
        // never takes a section and a slug (#51). {@link collectHomepages}
        // gathers it instead.
        if (isHomepage(fm)) continue;

        for (const hit of frontmatterWikilinks(fm)) {
            fmLinkFindings.push({ file, ...hit });
        }

        const name = fm.name?.full ?? path.basename(file, ".md");
        // The URL segment derives from the name (#1278), never from the
        // shortcode, which is identity referenced by saved world data rather
        // than presentation.
        let slug;
        try {
            slug = contentSlug(name);
        } catch (err) {
            slugFindings.push({ file, reason: err.message });
            continue;
        }

        const base = path.basename(file);
        const isReadme = base.toLowerCase() === "readme.md";
        const sec = sectionOf(fm);
        const rel = path.relative(contentBase, file);
        pages.push({
            kind: "content",
            fm,
            // The page's package, recorded once here so every consumer — the
            // index's canonical keys, the table universe, the local-package set
            // — reads one configured value and never frontmatter (#56).
            pkg,
            body,
            name,
            slug,
            base,
            // Top-level content directory ("Rules", "Skills", …). Wikilinks do
            // not use it: a note is addressed as `type/shortcode` wherever it
            // is filed.
            tld: rel.split(path.sep)[0],
            // Location below the content root, POSIX-separated — what a
            // generated table reads as `file.path` and scopes on with `FROM`.
            relPath: rel.split(path.sep).join("/"),
            // The immediate source subfolder, the only surviving record of the
            // authoring folder, for grouped landings.
            folder: path.basename(path.dirname(file)),
            sec,
            url: isReadme ? `${ctx.mount}${sec}/` : `${ctx.mount}${sec}/${slug}/`,
            isReadme,
        });
    }
    return { pages, slugFindings, fmLinkFindings };
}

/**
 * An extra tree's pages — a documentation tree published alongside the content.
 *
 * These preserve their **source layout** below the section rather than being
 * addressed by type and slug: they are a book with chapters, and a reader
 * follows their paths. A `README` is its directory's landing.
 *
 * @param {object} tree - `{ from, rel, section, route }`.
 * @param {object} ctx - `{ mount }`.
 * @returns {{pages: object[], fmLinkFindings: object[]}}
 */
export function collectTreePages(tree, ctx) {
    const pages = [];
    const fmLinkFindings = [];

    for (const file of walkSiteTree(tree.from)) {
        const note = readNote(file);
        if (!note) continue;
        const { fm, body } = note;

        for (const hit of frontmatterWikilinks(fm)) {
            fmLinkFindings.push({ file, ...hit });
        }

        const rel = path.relative(tree.from, file).replace(/\\/g, "/");
        const base = path.basename(rel);
        const isReadme = base.toLowerCase() === "readme.md";
        const sec = fm.subType ?? tree.section;
        const h1 = /^#\s+(.+?)\s*$/m.exec(body);
        const h1Title = h1 ? h1[1].replace(/\{@link\s+[^}]*\}/g, "").trim() : null;
        const name = fm.name?.full ?? fm.title ?? h1Title ?? path.basename(base, ".md");
        const slug = fm.slug ?? slugify(path.basename(base, ".md"));
        const relNoExt = rel.slice(0, -3).toLowerCase();
        const dir = path.posix.dirname(relNoExt);
        pages.push({
            kind: "tree",
            tree,
            fm,
            // The H1 is stripped: the page title renders it.
            body: body.replace(/^\s*#\s+.*$\r?\n?/m, ""),
            name,
            slug,
            base,
            rel,
            sec,
            url:
                isReadme ?
                    dir === "." ?
                        `${ctx.mount}${sec}/`
                    :   `${ctx.mount}${sec}/${dir}/`
                :   `${ctx.mount}${sec}/${relNoExt}/`,
            isReadme,
        });
    }
    return { pages, fmLinkFindings };
}

/**
 * The package's homepage notes — the authored page at `/<contentPackage>/`.
 *
 * A separate walk from {@link collectContentPages} rather than a branch inside
 * it, because in homepage-only mode it is the **whole** of the site build: the
 * content tree is never read for pages at all, so the licensing constraint two
 * packages ship under is a property of the code path rather than of a
 * configuration that happens to be empty (#55).
 *
 * Returned as a list rather than as the one note there should be, because the
 * count is what {@link checkHomepageCount} judges (#52) — this walk reports
 * what it found, and {@link buildSite} decides whether that is one.
 *
 * @param {string} contentBase - Absolute path to the content tree.
 * @param {object} ctx - `{ skipDirectories }`.
 * @returns {{pages: object[]}} The homepage notes, in walk order.
 */
export function collectHomepages(contentBase, ctx) {
    const pages = [];
    for (const file of walkSiteTree(contentBase, ctx.skipDirectories)) {
        const note = readNote(file);
        if (!note || !isHomepage(note.fm)) continue;
        pages.push({ kind: "homepage", file, fm: note.fm, body: note.body });
    }
    return { pages };
}

/**
 * Writes each homepage at the package's own root.
 *
 * Its own writer, deliberately small. A homepage is authored markdown published
 * verbatim — no table expansion, no section landing and no link resolution — so
 * routing it through {@link renderPages} would buy it a pipeline it has no input
 * for, and would make homepage-only mode depend on the index, the foreign
 * manifests and the table universe that mode exists to not build.
 *
 * **Verbatim is the answer to #54, not a gap left by it.** A landing's links
 * could not be *resolved* here without giving `homepage` mode the index its
 * licensing fence exists to not build, so they are **checked** instead:
 * {@link auditHomepageLinks} reads the `landing:` addresses and the body's
 * markdown links, and reports a wikilink on the page rather than resolving one.
 *
 * @param {string} outRoot - The package's site root — the configured `site.out`,
 *   one level above the content mount.
 * @param {readonly object[]} pages - From {@link collectHomepages}.
 * @param {object} config - The resolved configuration, for the package name and
 *   the default title.
 * @returns {number} How many pages were written.
 */
export function writeHomepages(outRoot, pages, config) {
    for (const page of pages) {
        const data = homepageFrontmatter(page.fm, {
            contentPackage: config.contentPackage,
            title: homepageTitle(page.fm, config),
        });
        const dest = path.join(outRoot, HOMEPAGE_DESTINATION);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, matter.stringify(page.body, data));
    }
    return pages.length;
}

/**
 * The integrity gates a site build runs before it writes anything.
 *
 * Every one of these was an inline `process.exit` in both consumer scripts, so
 * none of them had a test. They are grouped here, reporting rather than exiting,
 * because the order matters and the reasons are worth stating once:
 *
 * - **Frontmatter wikilinks** first, because frontmatter is copied to the page
 *   verbatim and a link written in one reaches the reader as literal `[[…]]`.
 * - **Slugs and collisions** next: a note that derives no URL, or two that
 *   derive the same one, would silently drop or overwrite a page.
 * - **Foreign manifests** last, in two steps. *Unusable* is a file this build
 *   cannot read; *unaddressable* is one it can read but cannot look anything up
 *   in — a distinction worth keeping, because the second surfaces as a pile of
 *   dead links blaming the notes that cite them rather than the file at fault.
 *
 * @param {object[]} pages - Every page, from both walks.
 * @param {object} findings - `{ slugFindings, fmLinkFindings }` from collection.
 * @param {object} options - `{ manifestDir }`.
 * @returns {object} The gate results and, when they pass, the built index.
 */
export function siteGates(pages, findings, { manifestDir }) {
    const out = {
        // Always empty here: the homepage count is decided in `buildSite`
        // before the content walk, and a failing count returns without ever
        // reaching these gates (#52). Present so every caller reads one shape.
        homepages: [],
        frontmatterLinks: findings.fmLinkFindings ?? [],
        slugErrors: findings.slugFindings ?? [],
        collisions: [],
        staleManifests: [],
        unaddressable: [],
        conflicts: [],
        index: null,
        foreign: null,
        manifests: null,
    };
    if (out.frontmatterLinks.length || out.slugErrors.length) return out;

    const content = pages.filter((p) => p.kind === "content");
    out.collisions = findSlugCollisions(
        content.map((p) => ({
            sec: p.sec,
            slug: p.slug,
            src: `${p.tld}/${p.base}`,
        })),
    );
    if (out.collisions.length) return out;

    // Which packages are *local* is what decides which manifests are foreign,
    // and that is only known once the tree is walked — reading it from a
    // configured list instead silently discarded the manifest of any package
    // the list named but the tree did not contain.
    const localPackages = new Set(content.map((p) => p.pkg));
    const foreign = loadForeignManifests(manifestDir, localPackages);
    out.foreign = foreign;
    if (foreign.stale.length) {
        out.staleManifests = foreign.stale;
        return out;
    }

    out.unaddressable = unaddressableForeignPackages(foreign.index);
    if (out.unaddressable.length) return out;

    out.manifests = manifestsComplete(localPackages, foreign.packages);
    const index = buildSiteIndex(pages, { foreignIndex: foreign.index });
    out.conflicts = index.conflicts;
    if (out.conflicts.length) return out;

    out.index = index;
    return out;
}

/**
 * The gate result of a build that ran none of them.
 *
 * Homepage-only publishes one authored page and resolves nothing, so every gate
 * here is about a surface that mode does not have. The shape is returned all the
 * same, because a caller reads the same fields whichever mode ran and a `null`
 * would make each of them a special case.
 *
 * @returns {object} An all-clear gate result.
 */
export function emptyGates() {
    return {
        homepages: [],
        frontmatterLinks: [],
        slugErrors: [],
        collisions: [],
        staleManifests: [],
        unaddressable: [],
        conflicts: [],
        index: null,
        foreign: null,
        manifests: null,
    };
}

/** Whether any gate produced a finding. */
export function gatesFailed(gates) {
    return Boolean(
        gates.homepages.length ||
        gates.frontmatterLinks.length ||
        gates.slugErrors.length ||
        gates.collisions.length ||
        gates.staleManifests.length ||
        gates.unaddressable.length ||
        gates.conflicts.length,
    );
}

/**
 * The universe a generated table searches, grouped by package.
 *
 * Reference pages only, and grouped so a page never tabulates another package's
 * content: a table is a claim about what this package ships.
 *
 * @param {object[]} pages - Every page.
 * @returns {Map<string, object[]>} Package → the notes it may tabulate.
 */
export function tableUniverse(pages) {
    const byPackage = new Map();
    for (const p of pages) {
        if (p.kind !== "content") continue;
        const pkg = p.pkg;
        if (!byPackage.has(pkg)) byPackage.set(pkg, []);
        byPackage.get(pkg).push({
            // Package present for a `WHERE … package = "…"` clause,
            // synthesised rather than authored — see
            // {@link searchableFrontmatter} (#56).
            fm: searchableFrontmatter(p.fm, pkg),
            path: p.relPath,
            tld: p.tld,
            folder: p.folder,
        });
    }
    return byPackage;
}

/**
 * The front matter a section's landing states about itself.
 *
 * The section metadata a configuration resolved, ready to be written or merged
 * onto a page. Two things happen here and nothing else does:
 *
 * - **`title` leads.** It is the one key every landing has carried since the
 *   first one, and a landing whose block opened with `banner:` would be a
 *   gratuitous diff on every consumer's tree.
 * - **An absent value is left off**, not written as `undefined` — which is not
 *   a value YAML can carry, and would abort the serializer.
 *
 * Everything else the section declared is passed through. That is the point of
 * the function: before #91 both writers transcribed `title` and `banner` by
 * name, so the vocabulary lived in three places — the schema that admits a key
 * and the two writers that copy it — and a key added to the schema alone
 * validated cleanly and then reached no page. The *schema* is the bound worth
 * keeping (see `normalizeSectionMeta`, which refuses a key it does not know and
 * names it); a second, silent bound in the writers is not.
 *
 * @param {object} meta - A resolved `site.sections` / `site.readmeSections`
 *   entry.
 * @returns {object} Its front matter, `title` first.
 */
export function sectionFrontmatter(meta) {
    const data = { title: meta.title };
    for (const [key, value] of Object.entries(meta)) {
        if (key === "title" || value === undefined) continue;
        data[key] = value;
    }
    return data;
}

/**
 * The frontmatter a page publishes with.
 *
 * An authored `aliases` is retired (#180) and refused before a build reaches
 * here, which makes this a guard rather than a working path. It was Obsidian's
 * — a list of *names* a reader might call
 * the note, which is vault addressing and stays in the vault. Hugo reads
 * `aliases` as **URL redirects**, so passing them through would publish a
 * redirect stub at each name. They are dropped, and this build emits no
 * redirects of its own.
 *
 * A content page carries the package the build **derived** (#65). No note
 * declares one — `package:` is retired (#56) — so the note's frontmatter alone
 * would publish a page that does not say which package it belongs to. The
 * emitted page is what a
 * theme reads: `breadcrumbs.html` builds its middle crumb from
 * `.Params.package`, so without it that crumb degrades from a linked, labelled
 * section to a bare type slug. Writing the derived value keeps a page
 * self-describing and makes sweeping the field out of a content tree
 * output-preserving for a site as it already is for the packs.
 *
 * @param {object} page - The page.
 * @param {object} options - `{ sections, readmeSections, decorate }`.
 * @returns {object} The frontmatter to write.
 */
export function pageFrontmatter(page, { readmeSections = {}, decorate }) {
    const { fm, name, slug, sec, isReadme } = page;
    let data;
    if (page.kind === "content") {
        data = {
            ...fm,
            // Spread after the note's own frontmatter. Guarded because
            // `package: undefined` is not a value YAML can carry.
            ...(page.pkg ? { package: page.pkg } : {}),
            slug,
            title: fm.title ?? name,
            kbfolder: page.folder,
        };
        if (decorate) decorate(data, page);
        if (isReadme) {
            const meta = readmeSections[sec];
            // What the section says about itself wins over what its README
            // happens to carry — the landing has to match the card linking to
            // it. Assigned rather than transcribed key by key, so a section's
            // vocabulary is decided in one place (#91).
            if (meta) Object.assign(data, sectionFrontmatter(meta));
        }
    } else {
        // A tree's own landing describes the *mount*, and nothing beneath it. A
        // nested README is a sub-section's landing, and reading the section's
        // entry for it would title every one of them alike and hang the section
        // hero on each. Its title comes from its H1, like any other page's.
        const isSectionRoot = path.posix.dirname(page.rel) === ".";
        const meta = isReadme && isSectionRoot ? readmeSections[sec] : null;
        data = { ...fm, title: meta?.title ?? fm.title ?? name };
        if (meta) Object.assign(data, sectionFrontmatter(meta));
    }
    delete data.aliases;
    return data;
}

/** Where a page is written, relative to the output root. */
export function pageDestination(page) {
    if (page.kind === "content") {
        return page.isReadme ?
                path.join(page.sec, "_index.md")
            :   path.join(page.sec, `${page.slug}.md`);
    }
    const rel =
        page.isReadme ? path.posix.join(path.posix.dirname(page.rel), "_index.md") : page.rel;
    return path.join(page.sec, rel);
}

/**
 * Renders and writes every page.
 *
 * The order inside a page is load-bearing and is the same order the pack
 * compilers use:
 *
 * 1. **Tables expand first**, and outside code-fence protection. A table is
 *    authored as a fenced `dataview` block, which `protectCode` would otherwise
 *    stash away before the expander saw it. Expanding first leaves an ordinary
 *    markdown table to walk, with every other fence still protected.
 * 2. **Then, inside protection**: the consumer's `beforeLinks` pass, wikilink
 *    resolution, and the consumer's `afterLinks` pass. A `{@link}` tag may sit
 *    in prose a wikilink also touches, so the repository's own rewrites bracket
 *    the shared one rather than replacing it.
 *
 * @param {object[]} pages - Every page.
 * @param {object} options - Everything the render needs.
 * @returns {{written: number, byKind: Record<string, number>, tableErrors: object[], wikiErrors: object[]}}
 */
export function renderPages(pages, options) {
    const {
        outRoot,
        index,
        foreign,
        manifests,
        universe,
        pass = {},
        readmeSections,
        decorate,
        linkable = (d) => Boolean(d.fm.shortcode),
    } = options;

    const tableErrors = [];
    const wikiErrors = [];
    const byKind = {};

    for (const page of pages) {
        const src = page.rel ?? `${page.sec}/${page.base}`;
        const ctx = wikiContext(index, {
            src,
            type: page.fm.type ?? null,
            errors: wikiErrors,
            foreignIndex: foreign.index,
            manifestsComplete: manifests.complete,
        });

        const resolve = (text) => {
            let t = text;
            if (pass.beforeLinks) t = pass.beforeLinks(t, page);
            t = resolveWebWikilinks(t, ctx);
            if (pass.afterLinks) t = pass.afterLinks(t, page);
            return t;
        };

        let body = page.body;
        if (page.kind === "content") {
            const { markdown, errors } = expandContentTables(body, {
                docs: universe.get(page.pkg) ?? [],
                linkable,
                source: src,
                self: {
                    fm: searchableFrontmatter(page.fm, page.pkg),
                    path: page.relPath,
                },
            });
            tableErrors.push(...errors);
            body = markdown;
        }

        const data = pageFrontmatter(page, { readmeSections, decorate });
        const dest = path.join(outRoot, pageDestination(page));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, matter.stringify(protectCode(body, resolve), data));
        byKind[page.kind] = (byKind[page.kind] ?? 0) + 1;
    }

    return { written: pages.length, byKind, tableErrors, wikiErrors };
}

/**
 * Writes the section landings a published tree needs but no note supplies.
 *
 * Two separate jobs, and both exist because of how Hugo decides what a section
 * is:
 *
 * - **Declared sections** get a titled `_index.md` with their hero, so a landing
 *   matches the card that links to it instead of showing Hugo's auto-humanised
 *   directory name. The body is empty, which lets the theme list the section's
 *   children — or say it is empty, for a section whose content has not shipped.
 * - **Every other section directly under the mount** gets a bare `_index.md`,
 *   or its own address publishes nothing. Hugo generates a section page
 *   automatically only for a *top-level* content directory; below that, a
 *   directory without an `_index.md` is not a section, so its URL 404s while
 *   its children publish normally. Mounting a tree one level down demotes every
 *   section it holds, and the ones with no landing of their own quietly stop
 *   existing while every page inside them keeps working.
 *
 * Scoped to one level on purpose. A directory further down was not a section
 * before the move either, and giving it one here would silently re-scope the
 * prev/next navigation of every page inside it.
 *
 * @param {string} outRoot - The mount directory.
 * @param {object} options - `{ sections, landing, sectionTitle }`.
 * @returns {number} How many landings were written.
 */
export function writeSectionLandings(outRoot, { sections = {}, landing, sectionTitle }) {
    let written = 0;

    // The mount's own landing carries a `type` of its own. Hugo's template
    // lookup walks up a page's path, so a landing template at the mount would
    // also serve every section below it that has no template of its own —
    // each would render the mount's front page. Typing the landing moves its
    // template out of the path where it could be inherited.
    if (landing) {
        fs.mkdirSync(outRoot, { recursive: true });
        fs.writeFileSync(path.join(outRoot, "_index.md"), matter.stringify("", landing));
        written += 1;
    }

    for (const [sec, meta] of Object.entries(sections)) {
        const dir = path.join(outRoot, sec);
        fs.mkdirSync(dir, { recursive: true });
        // Whatever the section declared, not a list of keys named here — see
        // {@link sectionFrontmatter} for why the two lists were one too many.
        fs.writeFileSync(
            path.join(dir, "_index.md"),
            matter.stringify("", sectionFrontmatter(meta)),
        );
        written += 1;
    }

    if (!sectionTitle) return written;
    for (const entry of fs.readdirSync(outRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const index = path.join(outRoot, entry.name, "_index.md");
        if (fs.existsSync(index)) continue;
        fs.writeFileSync(index, matter.stringify("", { title: sectionTitle(entry.name) }));
        written += 1;
    }
    return written;
}

/**
 * A section landing's title, from its directory name — `macro` → `Macros`.
 *
 * Hugo derives exactly this for a section page it generates itself, but not for
 * one backed by an `_index.md`: an explicit file with no `title` renders a blank
 * heading. So a backfilled landing states its own, in plain English
 * pluralisation rather than Hugo's inflector, which spells that section
 * "Macroes".
 *
 * @param {string} name - The directory name.
 * @returns {string} The display title.
 */
export function pluralTitle(name) {
    const plural =
        /(?:s|x|z|ch|sh)$/.test(name) ? `${name}es`
        : /[^aeiou]y$/.test(name) ? `${name.slice(0, -1)}ies`
        : `${name}s`;
    return plural
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

/**
 * The named pass bundles a configuration may select.
 *
 * `site.pass` is the one part of the site contract that is *code* — a
 * repository's own body rewrites — so a configuration names a bundle instead of
 * supplying one, exactly as `itemBuilders` names an item registry. Required
 * lazily, so importing this module does not drag a package-specific half of the
 * toolchain in behind it.
 *
 * @type {Readonly<Record<string, () => Function>>}
 */
const SITE_PASSES = Object.freeze({
    sohlKb: () => require("../sohl/kb-passes.mjs").sohlKbPass,
});

/**
 * Resolves `site.pass` to its bundle.
 *
 * @param {string|undefined} name - The configured name.
 * @param {object} options - The configured options, plus `repoRoot`.
 * @returns {{beforeLinks?: Function, afterLinks?: Function}} The bundle.
 */
export function resolveSitePass(name, options) {
    if (!name) return {};
    const factory = SITE_PASSES[name];
    if (!factory) {
        throw new Error(
            `unknown site pass ${JSON.stringify(name)} — expected one of ` +
                `${Object.keys(SITE_PASSES).join(", ")}`,
        );
    }
    return factory()(options);
}

/**
 * The output root, having established that it is safe to delete.
 *
 * The whole tree is a build artifact and is wiped on every run, so this
 * resolution is the difference between clearing a build directory and clearing
 * the repository. An unset `site.out` resolves to `rootDir` itself, and the
 * wipe then deletes the working tree — which is not a hypothetical: it happened
 * while this module was being written, on a configuration that simply had no
 * `site` section yet.
 *
 * So the path is refused unless it is **strictly inside** the repository root.
 * Both failing shapes are ordinary rather than exotic — an absent setting, and a
 * `..` that climbs out — and neither should be recoverable by being careful.
 *
 * @param {string} rootDir - The repository root.
 * @param {string} out - The configured `site.out`.
 * @returns {string} The absolute output root.
 * @throws {Error} When it is unset, or is not below `rootDir`.
 */
export function resolveOutputRoot(rootDir, out) {
    if (!out) {
        throw new Error(
            "site.out is not set, so there is nowhere to write the site. " +
                "Refusing to continue: the output directory is wiped on every " +
                "run, and an unset one resolves to the repository root.",
        );
    }
    const root = path.resolve(rootDir);
    const resolved = path.resolve(root, out);
    const inside = resolved !== root && resolved.startsWith(root + path.sep);
    if (!inside) {
        throw new Error(
            `site.out (${JSON.stringify(out)}) resolves to ${resolved}, which ` +
                `is not inside ${root}. Refusing to continue: that directory ` +
                `is wiped on every run.`,
        );
    }
    return resolved;
}

/**
 * Builds a Hugo content tree from a content tree, and reports what it found.
 *
 * Returns rather than exits, in every case. A caller — the command, or a test —
 * decides what a finding means; the gates below are grouped so it can report
 * the first that fired and stop, which is what keeps a wall of dead links from
 * burying the one manifest that caused them.
 *
 * @param {object} [options] - Options.
 * @param {object} [options.config] - A resolved configuration; loaded when
 *   omitted.
 * @param {string} [options.outRoot] - Override the configured output mount.
 * @returns {{gates: object, stats: object|null, tableErrors: object[],
 *   wikiErrors: object[], manifests: object|null}}
 */
export function buildSite({ config, outRoot } = {}) {
    const resolved = config ?? loadPackConfig();
    const site = resolved.site;
    const scheme = resolved.publish.address;
    // Homepage-only or homepage-plus-content (#55). The floor is the homepage,
    // so this decides whether the *content* surfaces are published, never
    // whether anything is.
    const publishesContent = publishesContentPages(resolved);

    // Where the package is served, and where its content mounts inside it. The
    // two are separate facts: `base` is the package's own address on the site
    // that publishes it, and `prefix` is the content tree's mount within the
    // package — the same `prefix` the link manifest records against, so a page
    // and its manifest entry cannot disagree.
    const base = site.base || `/${resolved.contentPackage}/`;
    const mount = `${base}${scheme.prefix}`;

    // The Hugo content tree mirrors that mount: a page written to
    // `<out>/<prefix>/<section>/` publishes at `<base><prefix><section>/`.
    // Resolved against the repository root for the same reason every configured
    // path is — so the build reads and writes the same places whatever
    // directory it was launched from (#1508).
    const outBase = resolveOutputRoot(resolved.rootDir, site.out);
    const out =
        outRoot ? path.resolve(outRoot)
        : publishesContent ? path.join(outBase, scheme.prefix.replace(/\/$/, ""))
            // Homepage-only has no content mount, so the package's root *is*
            // the output root and `--out` redirects the whole of it.
        : outBase;
    // The homepage publishes at `/<contentPackage>/`, which is the package's
    // own root — one level above the content mount, and the same directory in
    // homepage-only mode.
    const homeRoot = publishesContent ? outBase : out;

    const packages = new Set(site.packages.length ? site.packages : [resolved.contentPackage]);

    const ctx = {
        packages,
        // The package every note in the tree belongs to. `package:` is
        // retired, so this is the only source of it (#56).
        contentPackage: resolved.contentPackage,
        skipDirectories: resolved.skipDirectories,
        mount,
        scheme,
    };

    const homepages = collectHomepages(resolved.paths.content, ctx).pages;

    // Exactly one homepage, and checked here — before the output tree is
    // cleared and before either mode branches (#52). Before the clear, because
    // a gate that fired after it would have destroyed a good site to report a
    // bad tree. Before the branch, because the requirement does not vary by
    // mode: `publish.site` chooses whether the *content* surfaces are
    // published, and the homepage is the floor beneath both.
    const homepageFindings = checkHomepageCount(homepages, {
        contentBase: resolved.paths.content,
        contentPackage: resolved.contentPackage,
    });
    if (homepageFindings.length) {
        return {
            gates: { ...emptyGates(), homepages: homepageFindings },
            manifests: null,
            tableErrors: [],
            wikiErrors: [],
            stats: null,
        };
    }

    // The whole tree is a build artifact, regenerated every run: a page whose
    // note was deleted or renamed would otherwise linger and keep publishing.
    fs.rmSync(outBase, { recursive: true, force: true });

    // Homepage-only stops here, and stopping is the point: nothing below reads
    // the content tree for pages, so `sohl-kethira-basic` and `harn-adventures`
    // cannot publish one whatever else their `site:` block declares (#55).
    if (!publishesContent) {
        return {
            gates: emptyGates(),
            manifests: null,
            tableErrors: [],
            wikiErrors: [],
            stats: {
                homepages: writeHomepages(homeRoot, homepages, resolved),
                landings: 0,
                out: homeRoot,
            },
        };
    }

    const content = collectContentPages(resolved.paths.content, ctx);
    const pages = [...content.pages];
    const fmLinkFindings = [...content.fmLinkFindings];

    const trees = site.trees.map((t) => ({
        ...t,
        from: path.resolve(resolved.rootDir, t.from),
        route: `${mount}${t.section}/`,
    }));
    for (const tree of trees) {
        const got = collectTreePages(tree, ctx);
        pages.push(...got.pages);
        fmLinkFindings.push(...got.fmLinkFindings);
    }

    const gates = siteGates(
        pages,
        { ...content, fmLinkFindings },
        { manifestDir: resolved.paths.manifests },
    );
    if (gatesFailed(gates)) {
        return {
            gates,
            stats: null,
            tableErrors: [],
            wikiErrors: [],
            manifests: gates.manifests,
        };
    }

    const pass = resolveSitePass(site.pass, {
        ...site.passOptions,
        repoRoot: resolved.rootDir,
    });

    const rendered = renderPages(pages, {
        outRoot: out,
        index: gates.index,
        foreign: gates.foreign,
        manifests: gates.manifests,
        universe: tableUniverse(pages),
        pass,
        readmeSections: site.readmeSections,
        // What counts as a being is the toolchain's to say, not a consumer's.
        // Asking in a consumer's script is how one came to still be checking
        // `character` and `creature` months after they were retired, and to
        // publish 95 pages with empty sidebars for months without noticing.
        decorate: (data, page) => {
            if (isBeing(page.fm)) {
                data.sohl = deriveBeingInfo(page.fm.sohl, gates.index.refIndex);
            }
        },
    });

    const landings = writeSectionLandings(out, {
        sections: site.sections,
        landing: site.landing,
        sectionTitle: site.backfillSections ? pluralTitle : null,
    });

    // Last, and outside the mount: the package's front page is not part of the
    // content tree it introduces.
    const homepagesWritten = writeHomepages(homeRoot, homepages, resolved);

    return {
        gates,
        manifests: gates.manifests,
        tableErrors: rendered.tableErrors,
        wikiErrors: rendered.wikiErrors,
        stats: {
            ...rendered.byKind,
            homepages: homepagesWritten,
            landings,
            out,
        },
    };
}

export { formatUnaddressableFinding };
