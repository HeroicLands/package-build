/*
 * This file is part of the Song of Heroic Lands (SoHL) system for Foundry VTT.
 * Copyright (c) 2024-2026 Tom Rodriguez ("Toasty") — <toasty@heroiclands.org>
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALERT_TYPES } from "../engine/content-alerts.mjs";
import { renderPreview } from "../engine/site-preview.mjs";

const config = readFileSync(path.resolve(__dirname, "../assets/preview/gitea.ini"), "utf8");
const rules = config
    .split(/\[markup\.sanitizer\.markdown\.[^\]]+\]/)
    .slice(1)
    .map((rule) => {
        const value = (name: string) => rule.match(new RegExp(`^${name} = (.*)$`, "m"))?.[1] ?? "";
        return {
            element: value("ELEMENT"),
            attribute: value("ALLOW_ATTR"),
            pattern: new RegExp(value("REGEXP")),
        };
    });

// The registry supplies every alert type. The rest exercises renderer wrappers.
export const fixture = `---
type: being
data:
  born: "42"
  portrait: "![[art-face|Face]]{width=10}"
---

# Preview

Dictionary term
: A **definition**.
: A second definition.

[[place-demo#anchor|**Literal label**]]{title="<&>"}

[Visible span]{.test}

[Secret source]{.secret}

[[place-hidden|Secret destination]]{.secret}

![[image-hidden|Portrait]]{.secret}

## Secret section {#secret-section .secret}

Spoiler body.

## Public section

| Left | Center | Right |
| :--- | :----: | ----: |
| A | B | C |

{{dateformat data.born}}

${Object.keys(ALERT_TYPES)
    .map(
        (type) =>
            `> [!${type.toUpperCase()}]\n> A [[place-demo|label]] and {{dateformat data.born}}.`,
    )
    .join("\n\n")}

> [!NOTE] {title="Custom [[place-demo|label]]"}
> Body.
>
> > [!TIP]
> > Nested tip.

\`\`\`sql
SELECT '<&>';
\`\`\`

\`\`\`pagelist
#place
\`\`\`

\`\`\`map
place-demo
\`\`\`

\`\`\`verse
A line.
  Indented line.
\`\`\`

\`\`\`verse {numstep=1 lang=en col1=en col2=en/x:en}
[A verse line]{lang=en}

***

[Another]{lang=en}
\`\`\`

\`\`\`scroll {rows=3 cols=2 lang=tsu map=tengchou}
chen teng chou

hing
\`\`\`

:@ A picture {#picture .border}

![A picture](images/a.png){size=small float=top-right}

\`\`\`js
const lantern = "lit"; // a note
\`\`\`

:::secret
A **secret** with a footnote.[^one]
:::

[^one]: Footnote.
`;

describe("the Gitea sanitizer configuration", () => {
    it("is renderer-specific, anchored and applied after the renderer definition", () => {
        expect(config.indexOf("[markup.markdown]")).toBeLessThan(
            config.indexOf("[markup.sanitizer."),
        );
        expect(rules.length).toBeGreaterThan(10);
        for (const rule of rules) {
            expect(rule.element).not.toBe("");
            expect(rule.attribute).not.toBe("");
            expect(rule.pattern.source.startsWith("^")).toBe(true);
            expect(rule.pattern.source.endsWith("$")).toBe(true);
        }
    });

    it.each([false, true])(
        "retains every emitted class in the complete fixture (dark=%s)",
        (dark) => {
            const { html } = renderPreview(fixture, { dark });
            const classes = [...html.matchAll(/<([a-z][\w-]*)\b[^>]*\bclass="([^"]+)"/g)];
            expect(classes.length).toBeGreaterThan(20);
            const missing = classes
                .filter(
                    ([, element, value]) =>
                        !rules.some(
                            (rule) =>
                                rule.element === element &&
                                rule.attribute === "class" &&
                                rule.pattern.test(value),
                        ),
                )
                .map(([, element, value]) => `${element}.${value}`);
            expect(missing).toEqual([]);
            for (const type of Object.keys(ALERT_TYPES)) expect(html).toContain(`alert-${type}`);
            expect(html).toContain('class="alert-icon"');
            expect(html).toContain('<dl class="dictionary">');
            expect(html).toContain("<circle");
        },
    );
});
