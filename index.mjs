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
 * `@heroiclands/package-build` — the shared toolchain for building and shipping
 * a HeroicLands **Foundry package**, content and all.
 *
 * This package was two: `content-build`, which read `assets/content/**` and
 * produced compendium packs, site content and the link manifest, and this one,
 * which read `lang/`, `styles/`, `src/` and the manifest template. They were
 * split by *input* on the theory that a module would use either — an adventure
 * shipping only notes needs no bundler, a variant shipping only behavior needs
 * no Markdown pipeline.
 *
 * **No consumer ever used one alone.** All three installed both, and this
 * package depended on the other besides, so the packaging half dragged the
 * content half in regardless. What the boundary actually cost was a
 * configuration file with two owners, two CLIs with a colliding `manifest`
 * command, and a two-repository dance for changes that touched one idea. The
 * two halves are now one package; the split survives as the shape of this
 * barrel and nothing more.
 *
 * **Everything exported here is pure.** Functions take source text and return
 * findings or values; discovery, I/O and reporting stay with the caller. That
 * is what lets one rule set serve a `lint` script, a build step and a unit test
 * without any of them having to agree on how files are found or how findings
 * are printed.
 *
 * @module
 */

// ── Content: notes to compendium packs, site content, link manifests ────────

/** The configuration contract a consuming repository declares its build with. */
export {
    defineConfig,
    PACKAGE_KINDS,
    PACK_DOCUMENT_TYPES,
} from "./content-config.mjs";

/** The content pipeline — walking, compiling, linking, emitting. */
export * as engine from "./engine/index.mjs";

/** The `sohl` system's own item and actor builders. */
export * as sohl from "./sohl/index.mjs";

// ── Package: manifest, localization, staging, bundle, release, deployment ───

/** Foundry package manifest generation. */
export * as manifest from "./manifest.mjs";

/** Bundle construction and the bundle-loading check. */
export * as bundle from "./bundle.mjs";

/** Staging a built package into a Foundry data directory. */
export * as stage from "./stage.mjs";

/** The changesets-driven release pipeline. */
export * as release from "./release.mjs";

/** Deployment to a remote host. */
export * as deploy from "./deploy.mjs";

/** Container stages for a reproducible Foundry environment. */
export * as container from "./container.mjs";

/** The end-to-end harness. */
export * as e2e from "./e2e.mjs";

/** Localization shape and coverage rules. */
export * as lang from "./lang.mjs";

/** Coverage reporting. */
export * as coverage from "./coverage.mjs";

/** Handlebars template rules. */
export * as templates from "./templates.mjs";
