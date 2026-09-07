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
 * The corpus one compile runs over, and everything derived from it (#243).
 *
 * **A compile read every note twenty times.** Measured over `sohl`'s 1,685
 * notes: 33,700 reads, exactly twenty per note. Four per pass — the
 * content-wide link index, the table-search corpus, the `sql` directive scan,
 * and the pass's own walk — across five passes that convert wikilinks. Every
 * one of those four is a pure function of the same three things: the tree, the
 * scope, and the pack router. None of the three varies between the passes of a
 * single compile, because `generatePacksJson` resolves one router and hands it
 * to all of them.
 *
 * So they are derived **once**, here, and every pass is handed the result. That
 * is #243's claim stated at the point where it costs the most: not that
 * re-deriving is wasteful, but that N passes each answering "which files are
 * the corpus?" is N answers that can differ — which is what #241 was, and what
 * the twenty reads were paying for.
 *
 * **This module exists apart from the compilers for an import reason.**
 * Deriving the index reaches the pack router and the manifest emitter, and
 * those reach the compilers — so `base-compiler.mjs` cannot import
 * `content-index.mjs` without closing a cycle. `generate.mjs` can and does; a
 * compiler built directly by a consumer falls back to importing this module
 * from inside its `async prepare`, where a dynamic import is free.
 *
 * @module
 */

import { indexRecordsFor } from "./content-index.mjs";
import { buildContentLinkIndex, collectContentDocs } from "./helpers.mjs";
import { loadPackConfig } from "./pack-config.mjs";
import { prepareTreeSqlTables } from "./sql-tables.mjs";

/**
 * Derive the corpus a compile runs over, and the three indexes built over it.
 *
 * @param {object} opts - Options.
 * @param {string} opts.contentBase - Root of the content tree.
 * @param {readonly string[]} opts.skipDirectories - The scope, stated by the
 *   caller as every corpus read requires (#243).
 * @param {object} opts.router - The pack router this compile resolved. Shared
 *   by every pass, which is what makes one link index correct for all of them.
 * @param {object} [opts.config] - The resolved configuration.
 * @param {object[]} [opts.problems] - Collects the notes the index cannot
 *   record, so one of them does not abort the compile before it reports. One is
 *   created when none is passed, and returned on the corpus either way — a note
 *   the index refuses is a note the compile must still *report*, exactly as the
 *   compile loop reported it when the loop was the first to see it.
 * @returns {Promise<{records: object[], linkIndex: object, contentDocs: object[],
 *   sqlTables: Map<string, object[]>|undefined, problems: object[]}>} The corpus,
 *   its indexes, and the notes it could not record.
 */
export async function buildCompileCorpus({
    contentBase,
    skipDirectories,
    router,
    config,
    problems,
}) {
    const resolved = config ?? loadPackConfig();
    const collected = problems ?? [];
    const records = indexRecordsFor({
        contentBase,
        config: resolved,
        skipDirectories,
        problems: collected,
    });
    const scope = { skipDirectories, config: resolved, records };
    return {
        records,
        problems: collected,
        linkIndex: buildContentLinkIndex(contentBase, router, scope),
        contentDocs: collectContentDocs(contentBase, scope),
        sqlTables: await prepareTreeSqlTables(contentBase, scope),
    };
}
