/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * List the private artwork roots declared by a producer.
 * @param {{art?:{masterRoots?:readonly string[],componentRoots?:readonly string[]}}} config Package configuration.
 * @returns {string[]} Declared private input roots.
 */
export function privateArtRoots(config) {
    return [...(config.art?.masterRoots ?? []), ...(config.art?.componentRoots ?? [])];
}
