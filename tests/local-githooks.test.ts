/* SPDX-License-Identifier: GPL-3.0-or-later */

import { afterAll, expect, it } from "vitest";
import {
    cpSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { subprocessTimeout } from "./subprocess-timeout.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = mkdtempSync(path.join(tmpdir(), "local git hooks "));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "commit.gpgsign",
    GIT_CONFIG_VALUE_0: "false",
    GIT_AUTHOR_NAME: "Hook Test",
    GIT_AUTHOR_EMAIL: "hook@example.com",
    GIT_COMMITTER_NAME: "Hook Test",
    GIT_COMMITTER_EMAIL: "hook@example.com",
    LC_ALL: "C",
};
for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];

function run(cwd: string, command: string, args: string[], overrides = {}) {
    return spawnSync(command, args, { cwd, env: { ...env, ...overrides }, encoding: "utf8" });
}
function succeeds(cwd: string, command: string, args: string[], overrides = {}) {
    const result = run(cwd, command, args, overrides);
    expect(result.status, `${command} ${args.join(" ")}\n${result.stderr}`).toBe(0);
    return result;
}

it(
    "installs the tracked hooks in a fresh clone and worktree, with no Node needed at commit time",
    () => {
        const source = path.join(scratch, "source");
        mkdirSync(source);
        cpSync(path.join(root, ".githooks"), path.join(source, ".githooks"), { recursive: true });
        const { scripts } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
        writeFileSync(
            path.join(source, "package.json"),
            JSON.stringify({ scripts: { prepare: scripts.prepare } }),
        );
        succeeds(source, "git", ["init", "-q", "-b", "feature"]);
        succeeds(source, "git", ["add", ".githooks", "package.json"]);
        succeeds(source, "git", ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "Fixture"]);
        const clone = path.join(scratch, "fresh clone");
        succeeds(scratch, "git", ["clone", "-q", source, clone]);
        const worktree = path.join(clone, "nogit", ".worktrees", "fresh worktree");
        succeeds(clone, "git", ["worktree", "add", "-q", "-b", "other", worktree]);
        const bin = path.join(scratch, "bin");
        mkdirSync(bin);
        for (const tool of ["sh", "git", "sed", "awk", "locale", "dirname"]) {
            const found = succeeds(root, "sh", ["-c", 'command -v "$1"', "sh", tool]);
            symlinkSync(found.stdout.trim(), path.join(bin, tool));
        }
        expect(run(clone, "node", ["--version"], { PATH: bin }).error?.code).toBe("ENOENT");
        for (const checkout of [clone, worktree]) {
            succeeds(checkout, "npm", ["run", "prepare"]);
            expect(succeeds(checkout, "git", ["config", "core.hooksPath"]).stdout.trim()).toBe(
                ".githooks",
            );
            const commit = (message: string) =>
                run(checkout, "git", ["commit", "--allow-empty", "-m", message], { PATH: bin });
            const ordinary = commit("Ordinary developer prose");
            expect(ordinary.status, ordinary.stderr).toBe(0);
            for (const message of [
                "Co-Authored-By: Codex <codex@openai.com>",
                "Generated with Claude Code",
            ]) {
                const refused = commit(message);
                expect(refused.status).toBe(1);
                expect(refused.stderr).toMatch(
                    /error: (Co-Authored-By trailer|assistant signature)/,
                );
            }
            expect(commit("Co-Authored-By: Jean-Claude Martin <jean@example.com>").status).toBe(0);
            succeeds(checkout, "git", ["config", "hooks.noAttribution", "false"]);
            expect(commit("Generated with Codex").status).toBe(0);
            succeeds(checkout, "git", ["config", "--unset", "hooks.noAttribution"]);
            succeeds(checkout, "git", [
                "switch",
                "-q",
                "-c",
                path.basename(checkout) === "fresh clone" ? "main" : "master",
            ]);
            const protectedCommit = commit("Ordinary developer prose");
            expect(protectedCommit.status).toBe(1);
            expect(protectedCommit.stderr).toContain("protected branch");
            succeeds(checkout, "git", ["config", "hooks.protectedBranch", "false"]);
            expect(commit("Protected-branch opt-out").status).toBe(0);
            succeeds(checkout, "git", ["config", "--unset", "hooks.protectedBranch"]);
            succeeds(checkout, "git", ["config", "hooks.allowCommitOnMain", "true"]);
            expect(commit("Explicit protected-branch opt-out").status).toBe(0);
            succeeds(checkout, "git", ["config", "--unset", "hooks.allowCommitOnMain"]);
        }
    },
    subprocessTimeout(46),
);
