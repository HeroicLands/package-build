---
type: lore
subType: concept
shortcode: corpus
name:
    full: The Corpus
---

The corpus opens with a plain paragraph. It holds _emphasis_, **strong text**, ~~struck text~~, a `code span`, a [plain link](https://example.org/plain), a hard break  
and a soft break
within one paragraph.

Span emphasis reads [marked softly]{.emph} and [marked strongly]{.strong}.

> A plain quotation stands apart.

- A bullet item
- A second bullet item

1. A numbered item
2. A second numbered item

---

# Basics {#basics}

A Setext Heading
----------------

An indented code block follows.

    indented code line

A reference [link][ref], an autolink <https://example.org/auto>, an entity &amp; and an escape \*star\*.

The keeper said "not yet" -- it's late... and dark.

[ref]: https://example.org/reference

# Names and secrets {#names}

[Hidden Hand]{.name data-type="being/npc"} keeps watch, and **a phrase with [Joe Blow]{.name} in it** is emphasised.

[The Hand]{.name ref="#hand"} is the same watcher, and [the watcher]{.name ref="#hand"} is the same again.

The key is [under the **third** stair]{.secret}, and no one has looked.

:::secret {title="For the GM"}
The harbor master works for the smugglers.
:::

## The Cellar {#cellar .secret}

The cellar door opens onto a cistern.

# Alerts and blocks {#alerts}

> [!NOTE]
> Note alert body.

> [!TIP]
> Tip alert body.

> [!IMPORTANT]
> Important alert body.

> [!WARNING] {#flood-warning .seasonal title="Seasonal closure"}
> Warning alert body.

::: {#harbor-note .border lang=en}
The harbor remains open through winter.
:::

# Lists and entries {#lists}

Janapada
: A territorial community with its own institutions.
: Also the land associated with that community.

[harbour]{#harbour .dictionary-entry} _n._ A sheltered place where ships lie at anchor.

# Verse {#verse}

```verse {form=ballad lang=en}
The lantern burns beside the gate,/
.The harbor sleeps below.

***

The keeper guards the road till dawn,/
.And keeps a light aglow.
```

```verse {scan=trimeter lang=tar}
Taruna velomi sarandi
```

```verse {work=boundary lang=en}
the hallowed boundary I sing

and the one who walked it
```

```verse {work=boundary lang=vyl enc=vylsemaronenc font=semaron-kuriale}
thirun sorima

mamu anthrasos
```

# Figures and tables {#figures}

:@ A listing of the code. {#fig-code}

```js
const lantern = "lit";
```

:@ A worked example. {#fig-example type=example}

An example paragraph for the numbered example.

:@ Regional trade routes {#trade .border}

| Route | Days | Toll |
| :---- | :--: | ---: |
| North | 4    | 12   |
| South | 9    | 30   |

:@ The harbor pennant. {#fig-pennant}

![A small pennant](images/pennant.png)

:@ The coast. {#fig-coast}

![[image-coast|The coast]]

:@ A song sung by the harbor watch. {#fig-song}

```verse
The watch has gone to sea,
The lantern marks the shore.
```

:@ A caption on a quoted passage. {#fig-prose type=prose}

A passage the caption describes.

An image directive sits on its own line:

![A floated pennant](images/pennant.png){size=small float=top-right}

# Signs {#signs}

The name [Ra]{.glyph slug=ra size=inline} is written with one sign, [the sun god]{.glyph slug=ra frame=tablet} sits in a frame, and [the sun]{.glyph slug=ra size=block} stands alone.

A seal stands in the middle of a sentence, [Ta Kheperu]{.cartouche slug=takheperu caption="The Land of Kheper"}, and the line goes on.

A seal floats to the right, [Ta Kheperu]{.cartouche slug=takheperu align=right height=6rem}, or to the left, [Ta Kheperu]{.cartouche slug=takheperu align=left}, of the words around it.

[Ta Kheperu]{.cartouche slug=takheperu} opens this paragraph, which goes on with _stress_ and a link to [[place-harbor|the harbor]].

# Links and expressions {#links}

The resolved link is [[place-harbor|the harbor]], the concealed one is [[lore-vault|the vault]].

The count of places is {{words (sql "SELECT COUNT(1) FROM notes WHERE type = 'place'")}}, the digits are {{digits (sql "SELECT COUNT(1) FROM notes WHERE type = 'place'")}}, the table is {{ref "#trade"}}, and the syntax is shown literally as \{{ref "#trade"}}.

The helpers read:

- eq reads {{eq 2 2}}
- gt reads {{gt 3 2}}
- gte reads {{gte 3 3}}
- lt reads {{lt 2 3}}
- lte reads {{lte 3 3}}
- not reads {{not (eq 1 2)}}
- and reads {{and (eq 1 1) (gt 2 1)}}
- or reads {{or (eq 1 2) (gt 2 1)}}

The date reads {{dateformat 720}}.

The map is {{ref "#fig-coast"}}.

```sql
SELECT shortcode FROM notes WHERE type = 'place' ORDER BY shortcode
```

# Footnotes {#footnotes}

The road is passable in summer.[^season] The bridge has a toll.[^toll] A ford crosses upstream.^[The inline note is written in the sentence.]

[^season]: Spring flooding closes it for several weeks.

[^toll]: The toll is collected at the eastern gate.

    A second paragraph belongs to the same footnote.

# Marked text {#marked}

The greeting is [Daimela, helthos.]{lang=vyl} and the motto is [ad astra]{lang=la}.

The lintel is cut with [thirun sorima]{lang=vyl font=semaron-kuriale enc=vylsemaronenc}.

The stressed word is [thirun _sorima_]{lang=en font=semaron-kuriale enc=ensemaronenc} in red, and the doubly stressed one [thirun **sorima**]{lang=en font=semaron-kuriale enc=ensemaronenc} under a line.

Code reads as [lantern()]{font=mono}, titles as [Harbor Ledger]{font=serif}, and labels as [Plain Label]{font=sans}.

::: {lang=vyl font=semaron-kuriale enc=vylsemaronenc}
thirun sorima.

mamu anthrasos.
:::

```verse {form=epic lang=vyl font=semaron-kuriale enc=vylsemaronenc}
thirun sorima/
.mamu anthrasos.
```

```scroll {rows=3 cols=3 lang=tsu font=teng-chou enc=tsutengenc}
chen teng
chou _hing_

tan tsou dou rou
```

The seal reads [chen teng]{lang=tsu font=teng-chou enc=tsutengenc} across the line.

The south gate is cut as [thirun sorima]{lang=prv enc=prvsemaronenc}, and its ledger as [thirun sorima]{lang=prv font=serif}.

::: {lang=prv enc=prvsemaronenc}
sorima thirun.
:::

```scroll {rows=3 cols=3 lang=tsu enc=tsutengenc}
tan tsou
```

# Icons and raw markup {#icons}

A star :icon star:{size=lg} marks the entry.

A phrase with an <abbr title="abbreviation">abbr</abbr> tag inline.

<div class="raw-block">A raw block of markup.</div>
