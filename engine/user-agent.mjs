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
import fs from "node:fs";
import path from "node:path";
import { positionOfYamlPath, emitDiagnostic } from "./diagnostics.mjs";
import { configSourcePath, loadPackConfig, resolveConfigFile } from "./pack-config.mjs";
import {
    CONTACT_RULE,
    HOST_RULE,
    bareHostSuffix,
    contactIsValid,
    hostSuffixIsValid,
} from "./user-agent-rules.mjs";

/**
 * The User-Agent every outbound request carries:
 *
 * ```text
 * <name>/<version> (<url>[; <email>]) <client>/<version>
 * ```
 *
 * `<name>` and `<version>` come from the consuming repository's `package.json`.
 * The contact comes from `userAgentUrl`, `userAgentEmail` and
 * `userAgentEmailHosts` in its configuration, each overridden by
 * `PACKAGE_BUILD_USER_AGENT_URL`, `PACKAGE_BUILD_USER_AGENT_EMAIL` and
 * `PACKAGE_BUILD_USER_AGENT_EMAIL_HOSTS` (comma-separated). The email is sent
 * only to a host that equals a listed suffix or is a subdomain of one.
 */

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
const warned = new Set();
let ambientFailure = false;

/**
 * Print a diagnostic once per process.
 * @param {{file?: string, line?: number, column?: number, severity: string, message: string}} diagnostic - The diagnostic.
 * @returns {void}
 */
function warnOnce(diagnostic) {
    const key = `${diagnostic.file ?? ""}:${diagnostic.message}`;
    if (warned.has(key)) return;
    warned.add(key);
    emitDiagnostic(diagnostic);
}

/**
 * Reduce a package name to a valid HTTP product token.
 * @param {unknown} value - The `package.json` name.
 * @returns {string} A token of RFC 9110 `tchar` characters.
 */
function productToken(value) {
    const token = String(value ?? "")
        .replace(/[^!#$%&'*+.^_`|~0-9A-Za-z-]+/gu, "-")
        .replace(/^-+|-+$/gu, "");
    return token || "package-build";
}

/**
 * Resolve the three contact settings, naming each refused value by its key or
 * variable and never by its content.
 * @param {{userAgentUrl?: string|null, userAgentEmail?: string|null, userAgentEmailHosts?: readonly string[]}|undefined} config - The resolved configuration.
 * @param {NodeJS.ProcessEnv} env - The environment.
 * @returns {{url?: string, email?: string, hosts: string[], emailFromEnv: boolean, problems: string[]}} The settings.
 */
export function userAgentSettings(config, env = process.env) {
    const problems = [];
    const contact = (name, fromConfig) => {
        const fromEnv = env[name]?.trim();
        if (fromEnv) {
            if (contactIsValid(fromEnv)) return fromEnv;
            problems.push(`${name} ${CONTACT_RULE}; the value is ignored`);
        }
        return typeof fromConfig === "string" && fromConfig !== "" ? fromConfig : undefined;
    };
    const hostsEnv = env.PACKAGE_BUILD_USER_AGENT_EMAIL_HOSTS?.trim();
    const entries = hostsEnv ? hostsEnv.split(",") : (config?.userAgentEmailHosts ?? []);
    const hosts = [];
    for (const entry of entries) {
        if (String(entry).trim() === "") continue;
        if (hostSuffixIsValid(String(entry))) hosts.push(bareHostSuffix(String(entry)));
        else if (hostsEnv)
            problems.push(
                `PACKAGE_BUILD_USER_AGENT_EMAIL_HOSTS has an entry that ${HOST_RULE}; the entry is ignored`,
            );
    }
    const email = contact("PACKAGE_BUILD_USER_AGENT_EMAIL", config?.userAgentEmail);
    return {
        url: contact("PACKAGE_BUILD_USER_AGENT_URL", config?.userAgentUrl),
        email,
        hosts,
        emailFromEnv: email !== undefined && email === env.PACKAGE_BUILD_USER_AGENT_EMAIL?.trim(),
        problems,
    };
}

/**
 * Whether a host equals a listed suffix or is a subdomain of one.
 * @param {string} host - The request host.
 * @param {readonly string[]} suffixes - Lowercase suffixes without a leading dot.
 * @returns {boolean} True for a match.
 */
function hostListed(host, suffixes) {
    const name = host.toLowerCase().replace(/\.$/u, "");
    return suffixes.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}

/**
 * The name of the HTTP client in use: Node's built-in `fetch` is undici.
 * @returns {string} A `<client>/<version>` token.
 */
function clientToken() {
    const undici = process.versions.undici;
    return undici ? `undici/${undici}` : `node/${process.versions.node}`;
}

/**
 * The consuming repository's name and version.
 * @param {string} rootDir - The directory holding its `package.json`.
 * @returns {string} A `<name>/<version>` token.
 */
function repositoryToken(rootDir) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
        return `${productToken(pkg.name)}/${productToken(pkg.version ?? "0")}`;
    } catch {
        return "package-build/0";
    }
}

/**
 * Load the consuming repository's configuration. No configuration anywhere is
 * the library-outside-a-repository case and is silent; a configuration that is
 * found and cannot be loaded is reported once and not retried.
 * @returns {import("../content-config.mjs").ContentBuildConfig|undefined} The configuration.
 */
function ambientConfig() {
    if (ambientFailure) return undefined;
    try {
        return loadPackConfig();
    } catch {
        ambientFailure = true;
        let present = !!process.env.PACKAGE_BUILD_CONFIG;
        if (!present) {
            try {
                present = !!resolveConfigFile().path;
            } catch {
                present = true;
            }
        }
        if (present)
            warnOnce({
                severity: "warning",
                message:
                    "the package-build configuration could not be loaded, so outbound requests carry no configured contact",
            });
        return undefined;
    }
}

/**
 * The diagnostic for an email configured with no host list, or `undefined`.
 * @param {object} config - The resolved configuration.
 * @param {NodeJS.ProcessEnv} [env] - The environment.
 * @returns {{file?: string, line?: number, column?: number, severity: "warning", message: string}|undefined} The diagnostic.
 */
export function userAgentDiagnostic(config, env = process.env) {
    const settings = userAgentSettings(config, env);
    if (!settings.email || settings.hosts.length > 0) return undefined;
    const message =
        "userAgentEmail is set but userAgentEmailHosts is empty; the email is sent to no host";
    const file = config ? configSourcePath(config) : undefined;
    let position = {};
    if (file && !settings.emailFromEnv && /\.ya?ml$/iu.test(file)) {
        try {
            position = positionOfYamlPath(fs.readFileSync(file, "utf8"), ["userAgentEmail"], {
                key: true,
            });
        } catch {
            position = {};
        }
    }
    return {
        file: settings.emailFromEnv ? undefined : file,
        ...position,
        severity: "warning",
        message,
    };
}

/**
 * Build the User-Agent for a request to one URL.
 *
 * Called per request and per redirect hop, so each host gets its own header.
 * The first call that finds a refused value, or an email with no host list,
 * prints a warning.
 *
 * @param {string|URL} url - The request URL.
 * @param {object} [options] - Options.
 * @param {object} [options.config] - A resolved configuration. Defaults to the
 *   consuming repository's, when one can be loaded.
 * @param {string} [options.rootDir] - Where the repository's `package.json`
 *   sits. Defaults to the configuration's `rootDir`, else the working directory.
 * @param {NodeJS.ProcessEnv} [options.env] - The environment.
 * @returns {string} The header value.
 */
export function buildUserAgent(url, { config, rootDir, env = process.env } = {}) {
    const resolved = config ?? ambientConfig();
    const settings = userAgentSettings(resolved, env);
    for (const message of settings.problems) warnOnce({ severity: "warning", message });
    const diagnostic = userAgentDiagnostic(resolved, env);
    if (diagnostic) warnOnce(diagnostic);
    const host = new URL(url).hostname;
    const contact = [
        settings.url,
        settings.email && hostListed(host, settings.hosts) ? settings.email : undefined,
    ].filter(Boolean);
    const base = repositoryToken(rootDir ?? resolved?.rootDir ?? process.cwd());
    return [base, contact.length ? `(${contact.join("; ")})` : undefined, clientToken()]
        .filter(Boolean)
        .join(" ");
}

/**
 * The caller's headers as a plain object that keeps the names as written, so a
 * `fetch` that inspects `Range` sees `Range`. A `Headers` instance or an entry
 * list is read through `Headers`; a caller-supplied User-Agent is dropped.
 * @param {HeadersInit|undefined} value - The caller's headers.
 * @returns {Record<string, string>} The headers.
 */
function callerHeaders(value) {
    const entries =
        value && !Array.isArray(value) && !(value instanceof Headers) ?
            Object.entries(value)
        :   [...new Headers(value).entries()];
    return Object.fromEntries(entries.filter(([name]) => name.toLowerCase() !== "user-agent"));
}

/**
 * Fetch a URL, following redirects by hand so each hop carries the
 * User-Agent built for that hop's host. The email therefore reaches a host only
 * when that host is listed, however the request got there. `Authorization` is
 * dropped when a hop changes origin, and a 303 turns a non-HEAD request into a
 * GET.
 *
 * @param {string|URL} url - The first URL.
 * @param {RequestInit} [init] - Fetch options; `redirect` is ignored.
 * @param {object} [options] - Options.
 * @param {number} [options.maxHops] - Redirects followed before failing. Default 5.
 * @param {typeof globalThis.fetch} [options.fetch] - The fetch to use.
 * @param {object} [options.config] - As {@link buildUserAgent}.
 * @param {NodeJS.ProcessEnv} [options.env] - As {@link buildUserAgent}.
 * @param {(hop: {response: Response, current: URL, location: string|null, hops: number}) => string|URL} [options.onRedirect]
 *   Chooses the next URL, and may throw to refuse it. The default resolves
 *   `Location` against the current URL and refuses a missing one, a non-HTTP(S)
 *   one, or one past `maxHops`.
 * @returns {Promise<Response>} The first response that is not a redirect.
 * @throws {Error} When a redirect is refused.
 */
export async function fetchFollowingRedirects(url, init = {}, options = {}) {
    const { maxHops = 5, config, env } = options;
    const doFetch = options.fetch ?? globalThis.fetch;
    let current = new URL(url);
    let method = init.method;
    let headers = callerHeaders(init.headers);
    for (let hops = 0; ; hops++) {
        const response = await doFetch(current.href, {
            ...init,
            method,
            redirect: "manual",
            headers: { ...headers, "user-agent": buildUserAgent(current, { config, env }) },
        });
        if (!REDIRECT_STATUSES.includes(response.status)) return response;
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => {});
        let next;
        if (options.onRedirect)
            next = new URL(options.onRedirect({ response, current, location, hops }));
        else {
            if (!location || hops >= maxHops) throw new Error("redirect limit or missing location");
            next = new URL(location, current);
            if (next.protocol !== "https:" && next.protocol !== "http:")
                throw new Error("redirect to a non-HTTP URL refused");
        }
        if (next.origin !== current.origin) {
            headers = Object.fromEntries(
                Object.entries(headers).filter(([name]) => name.toLowerCase() !== "authorization"),
            );
        }
        if (response.status === 303 && method !== "HEAD") method = "GET";
        current = next;
    }
}
