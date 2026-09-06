#!/usr/bin/env sh
#
# Whether one hook is switched on, so every hook asks the same way.
#
# `hook_enabled <key> <default>` reads `hooks.<key>` with git's normal
# precedence — a plain `git config` sets it for one clone, `--global` for a
# machine — and falls back to the hook's own default when unset. Each hook has
# its own key, so they are turned on and off individually rather than as a set:
# a repository may well want the branch guard and not the workflow check, or
# the reverse.
#
# Defaults differ by hook, and deliberately: a guard that costs nothing is on
# unless refused, while one that runs a container for minutes is off unless
# asked for.

hook_enabled() {
    _key="$1"
    _default="$2"
    _value="$(git config --bool "hooks.$_key" 2>/dev/null)"
    if [ -z "$_value" ]; then
        [ "$_default" = "true" ]
        return $?
    fi
    [ "$_value" = "true" ]
}
