---
title: Note A
type: lore
subType: concept
package: feat
description: A note with everything.
tags: [alpha, draft, "two words"]
date: 2024-03-02
infoboxes:
  - id: note
    kind: note
    title: Profile
    sections:
      - id: profile
        layout: rows
        label: Basics
        rows:
          - { label: Name, kind: text, value: Note A }
          - { label: Population, kind: number, value: 500000 }
          - { label: Zero, kind: number, value: 0 }
          - { label: Height, kind: number, value: "1.5 m" }
          - { label: Home, kind: link, value: { text: Harbor, url: /notes/note-b/ } }
          - {
              label: Homes,
              kind: links,
              value: [{ text: Harbor, url: /notes/note-b/ }, { text: Nowhere }],
            }
          - { label: Tongues, kind: list, value: [One, Two] }
      - id: attrs
        layout: grid
        cells:
          - { label: STR, value: 12 }
          - { label: DEX, value: 0 }
      - id: skills
        layout: runin
        groups:
          - label: Combat
            entries:
              - { text: Sword, url: /notes/note-b/ }
              - { lead: "the ", text: Axe }
      - id: gifts
        layout: list
        entries:
          - { text: Flight }
      - id: empty
        layout: rows
        label: Nothing
        rows: []
      - id: weird
        layout: mystery
        label: Odd
  - id: sohl
    kind: system
    system: sohl
    title: Song of Heroic Lands
    statement: Not available
  - id: hm3
    kind: system
    system: hm3
    title: HarnMaster
    sections: []
  - id: vacant
    kind: note
    title: Vacant
    sections:
      - { id: x, layout: list, entries: [] }
related:
  seeAlso:
    - { title: Note B, url: /notes/note-b/, gloss: the other one }
    - { title: Note B again, url: /notes/note-b/ }
  mentions:
    - { title: Note B, url: /notes/note-b/, type: lore }
    - { title: A Place, url: /notes/place/, type: place }
    - { title: Odd, url: /notes/odd/, type: weird-kind }
  backlinks:
    - { title: A Place, url: /notes/place/, type: place }
    - { title: A Post, url: /blog/post-one/, type: blog-post }
---

Intro.

## One

Text.

## Two

Text.

### Two A

Text.

## Three

Text.

## Four

Text.

<dl><dt>Raw</dt><dd><p>Raw definition</p></dd><dt>Second</dt><dd>Another</dd></dl>

```js
const a = 1;
```
