// Copyright (c) 2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
// SPDX-License-Identifier: GPL-3.0-or-later

// Replay the preview INI rules with the real bluemonday UGC sanitizer.
// Gitea also adds default rules; include the defaults needed by preview icons.
// This validates the shared policy primitives, not a deployed Gitea instance.
package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"

	"github.com/microcosm-cc/bluemonday"
)

func main() {
	if len(os.Args) != 2 {
		panic("usage: check-sanitizer path/to/gitea.ini < preview.html")
	}
	file, err := os.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer file.Close()
	policy := bluemonday.UGCPolicy()
	// Gitea modules/markup/sanitizer_default.go permits these SVG attributes.
	policy.AllowAttrs("viewBox", "width", "height", "aria-hidden", "data-attr-class").OnElements("svg")
	policy.AllowAttrs("fill-rule", "d").OnElements("path")
	policy.AllowAttrs("aria-hidden").OnElements("span", "div")
	var section string
	rule := map[string]string{}
	flush := func() {
		if !strings.HasPrefix(section, "markup.sanitizer.markdown.") {
			return
		}
		element, attr, pattern := rule["ELEMENT"], rule["ALLOW_ATTR"], rule["REGEXP"]
		if element == "" || attr == "" || pattern == "" {
			panic("incomplete sanitizer rule: " + section)
		}
		policy.AllowAttrs(attr).Matching(regexp.MustCompile(pattern)).OnElements(element)
	}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "[") {
			flush()
			section = strings.Trim(line, "[]")
			rule = map[string]string{}
			continue
		}
		if key, value, ok := strings.Cut(line, "="); ok {
			rule[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	flush()
	if err := scanner.Err(); err != nil {
		panic(err)
	}
	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		panic(err)
	}
	fmt.Print(policy.Sanitize(string(input)))
}
