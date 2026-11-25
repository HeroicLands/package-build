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
 * The forge `package-build deps fetch` reads dependency releases from.
 *
 * The forge is chosen by the `PACKAGE_BUILD_FORGE_URL` environment variable
 * and is GitHub when it is unset. No configuration key names it. The kind of forge follows from the URL alone: `github.com` and
 * `api.github.com` name GitHub, and every other HTTPS host is taken for a Gitea forge, which the fetch confirms before use.
 * This module is pure: it reads no file and makes no request.
 *
 * @module engine/forge-url
 */

/** The environment variable that names the forge. */
export const FORGE_URL_VARIABLE = "PACKAGE_BUILD_FORGE_URL";

/** The environment variable that carries a GitHub API token. */
export const GITHUB_TOKEN_VARIABLE = "PACKAGE_BUILD_GITHUB_API_TOKEN";

/** The environment variable that carries a Gitea forge token. */
export const FORGE_TOKEN_VARIABLE = "PACKAGE_BUILD_FORGE_TOKEN";

/**
 * A forge a dependency's releases are read from.
 *
 * @typedef {object} Forge
 * @property {"github"|"gitea"} kind The API the forge speaks.
 * @property {string} origin The origin release and download URLs name.
 * @property {string} apiOrigin The origin the API is served from.
 * @property {string} name The forge's short name in a diagnostic.
 * @property {string} label How a diagnostic introduces the forge.
 * @property {string} tokenVariable The environment variable that carries its token.
 */

const GITHUB = Object.freeze({
    kind: "github",
    origin: "https://github.com",
    apiOrigin: "https://api.github.com",
    name: "GitHub",
    label: "GitHub",
    tokenVariable: GITHUB_TOKEN_VARIABLE,
});

const GITHUB_HOSTS = new Set(["github.com", "api.github.com"]);

/**
 * Why a forge URL is unusable.
 *
 * @param {unknown} value - The environment value.
 * @returns {string} A clause naming the problem, or `""` when the URL is usable.
 */
export function forgeUrlProblem(value) {
    const shape =
        "must be the HTTPS origin of a forge, such as `https://github.com` or " +
        "`https://git.example.org`, with no credentials, path, query or fragment";
    if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) return shape;
    let url;
    try {
        url = new URL(value);
    } catch {
        return shape;
    }
    if (url.protocol !== "https:") return `${shape}; only https is accepted`;
    if (url.username || url.password) return `${shape}; credentials in the URL are refused`;
    if (url.search || url.hash || value.includes("?") || value.includes("#"))
        return `${shape}; a query or fragment is refused`;
    const host = url.hostname;
    if (host.includes("github") && !(GITHUB_HOSTS.has(host) && !url.port))
        return `${shape}; \`${url.host}\` is a GitHub-looking host, and only \`github.com\` and \`api.github.com\` name GitHub`;
    if (url.pathname !== "/" || /\/\/$|[^/]\/{2,}$/u.test(value)) return shape;
    return "";
}

/**
 * The forge a URL names.
 *
 * @param {string} value - A URL that {@link forgeUrlProblem} accepts.
 * @returns {Readonly<Forge>} The forge.
 */
export function forgeFromUrl(value) {
    const problem = forgeUrlProblem(value);
    if (problem) throw new Error(`forge URL ${problem}`);
    const url = new URL(value);
    if (GITHUB_HOSTS.has(url.hostname) && !url.port) return GITHUB;
    return Object.freeze({
        kind: "gitea",
        origin: url.origin,
        apiOrigin: url.origin,
        name: url.host,
        label: `the Gitea forge ${url.host}`,
        tokenVariable: FORGE_TOKEN_VARIABLE,
    });
}

/**
 * The forge dependency releases are read from.
 *
 * @param {Record<string, string|undefined>} [env] - The environment.
 * @returns {Readonly<Forge>} The forge: the one `PACKAGE_BUILD_FORGE_URL` names, or GitHub when it is
 *   unset or empty.
 * @throws {Error} When the variable holds an unusable URL.
 */
export function resolveForge(env = process.env) {
    const value = env[FORGE_URL_VARIABLE];
    if (value === undefined || value === "") return GITHUB;
    const problem = forgeUrlProblem(value);
    if (problem) throw new Error(`${FORGE_URL_VARIABLE} ${problem}`);
    return forgeFromUrl(value);
}

/**
 * The credential for a forge, from the variable that forge reads.
 *
 * @param {Readonly<Forge>} forge - The forge.
 * @param {Record<string, string|undefined>} [env] - The environment.
 * @returns {string|undefined} The token, or `undefined` when none is set.
 * A GitHub token set to the empty string counts as unset; an empty Gitea forge token is refused.
 * @throws {Error} When the variable is set but empty (Gitea) or not one visible-ASCII token.
 */
export function forgeToken(forge, env = process.env) {
    const token = env[forge.tokenVariable];
    if (token === undefined || (token === "" && forge.kind === "github")) return undefined;
    if (token === "" || /[^\x21-\x7e]/u.test(token))
        throw new Error(`${forge.tokenVariable} must contain one non-empty token`);
    return token;
}

/**
 * Where a release asset URL points on a forge, or the URL unchanged.
 *
 * A dependency declares its release URLs on the host that publishes it
 * (`https://github.com/<owner>/<repo>/releases/download/<tag>/<file>`). A
 * Gitea forge serves the same path shape, so the declared origin is replaced
 * by the forge's own.
 *
 * @param {Readonly<Forge>} forge - The forge.
 * @param {string} value - The declared URL.
 * @returns {string} The URL to read.
 */
export function forgeAssetUrl(forge, value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return value;
    }
    if (forge.kind !== "gitea" || url.protocol !== "https:") return value;
    if (url.hostname !== "github.com" || url.port || url.username || url.password) return value;
    if (!/^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+$/u.test(url.pathname)) return value;
    return `${forge.origin}${url.pathname}${url.search}${url.hash}`;
}
