---
shortcode: authoringdatesandcalendars
name: { full: "Dates, calendars, and eras" }
type: doc
subType: howto
---

# Dates, calendars, and eras

A canonical date uses the world's year and day count without choosing a culture's calendar. Write `<year>[.<day>[:HHMMSS]]`: `720` covers year 720, `720.136` covers its day 136, and `720.136:143005` identifies 14:30:05 on that day. The dot separates the year from the **day of year**, not a month. Negative years are valid, and the day must fit the world's declared year length — `data.year.days` on its `place` note. A tree whose notes declare no world year bounds no day at all: every value is read as written, however large, because there is no year length to check it against. Prefix a date with `~` when its uncertainty extends outside the stated year, day, or second. `unknown` records an occurrence whose date is not known, in fields that permit it.

**Put a date that states a day in quotes.** Write `born: "667.130"`, not `born: 667.130`. Unquoted, YAML reads the scalar as a number, and a number keeps no trailing zero — `667.130` becomes `667.13`, which is day 13 rather than day 130, and the authored digits are gone before any reader of the date can object. A date whose lost zero would still name a day inside the world's year is therefore refused, naming the line and both readings, so quoting it is the fix. A bare year such as `born: 667` loses nothing and needs no quotes.

## Define a calendar

A `lore` note with `subType: calendar` names months, weekdays, seasons, named days, eras, and date formats. Its `data.epoch` is the **canonical day that equals calendar year 1, day 1**. For a calendar beginning on canonical day `1.91`, write `epoch: "1.91"` — quoted, like every canonical date that states a day: calendar year 1 still starts at its own day 1. A calendar does not state the length of the world year: its months must sum to `data.year.days` on the world's `place` note.

```yaml
shortcode: commoncal
name: { full: The Common Calendar }
type: lore
subType: calendar
data:
  epoch: "1.1"
  months:
    - { name: Floralis, abbreviation: Flor, days: 30 }
    - { name: Lusenar, abbreviation: Luse, days: 31 }
    - { name: Murkas, abbreviation: Murk, days: 30 }
    - { name: Taranis, abbreviation: Tara, days: 31 }
    - { name: Vulcar, abbreviation: Vulc, days: 30 }
    - { name: Menaris, abbreviation: Mena, days: 31 }
    - { name: Venuris, abbreviation: Venu, days: 30 }
    - { name: Karnavar, abbreviation: Karn, days: 30 }
    - { name: Morveth, abbreviation: Morv, days: 31 }
    - { name: Thanaris, abbreviation: Than, days: 30 }
    - { name: Aetheris, abbreviation: Aeth, days: 31 }
    - { name: Janar, abbreviation: Jana, days: 30 }
  weekdays:
    - { name: Newday, abbreviation: New }
    - { name: Tillday, abbreviation: Til }
    - { name: Growday, abbreviation: Gro }
    - { name: Harvestday, abbreviation: Hrv }
    - { name: Reapday, abbreviation: Rep }
    - { name: Slowday, abbreviation: Slo }
    - { name: Setday, abbreviation: Set }
  seasons:
    - { name: Spring, abbreviation: Spr, start: 1 }
    - { name: Summer, abbreviation: Sum, start: 92 }
    - { name: Fall, abbreviation: Fal, start: 183 }
    - { name: Winter, abbreviation: Win, start: 274 }
  namedDays:
    - { name: New Years Day, abbreviation: NY, day: 1 }
  formats:
    std: "MM/DD/Y GGG"
    long: "D MMMM Y GGG"
  eras:
    - { shortcode: bvr, name: Before Vylarian Reckoning, abbreviation: BVR, start: null }
    - { shortcode: vr, name: Vylarian Reckoning, abbreviation: VR, start: 1 }
```

The `weekdays` array gives the names in order, starting at index 0. Weeks continue across month and year boundaries. Leave `weekdays` out when the calendar has no week. `seasons[].start` is the one-based day of year on which a season begins. Starts increase in array order. A season continues through the day before the next, and the last wraps through the beginning of the next year when the first season starts after day 1. `namedDays[].day` is also a one-based day of year. Its name appears through `[namedDay]`; `[namedDayAbbr]` prints the abbreviation.

Every calendar has exactly one era with `start: null` and one with `start: 1`. The null era covers the years before calendar year 1 and counts them backwards: under `Y GGG`, package-build prints canonical `-50.2` as `50 BVR` when the epoch is `1.1`. This null-start era is an authoring extension and is omitted from the Calendaria definition; Foundry's calendar represents current time. Each other `start` is a distinct, positive **calendar year**, never a day-precise date: `start: 701` begins on day 1 of calendar year 701. `start: 1` begins on the canonical day given by `epoch`, even when that day is `1.91` or another date. Eras end where the next numeric start begins. Array order does not determine chronology. The optional `marker` identifies an era in authored dates and must be unique across the corpus.

`formats` contains any number of named Calendaria patterns. `std` is the default for `dateto`, `datefrom`, and `dateformat`; if absent, the first named pattern is the default. The default pattern must contain enough information to read a day back: a complete year (`Y`, `YYYY`, or `[yearInEra]`), a day of year (`DDD`) or month and day, and an era label when using `[yearInEra]`. `Y` means the calendar year in Calendaria; `[yearInEra]` means the year counted from the era's start. In package-build's null-start era, `Y`, `YY`, and `YYYY` print the positive historical year. Other named patterns can use display-only Calendaria tokens. Use `package-build dateto <calendar> <canonical-date> --format <name>` or `{{dateformat "commoncal" data.born "long"}}` to select another output format. The [format token reference](../reference/format-details.md#calendar-format-tokens) lists every Calendaria token and the input constraints.

## Write and convert dates

A frontmatter date can use the canonical form or `datefrom <calendar> <date in the default format>`. The calendar may be a shortcode or Address. A named date keeps the precision it states: with the sample `std` pattern, `326 VR` covers a year, `04/326 VR` covers Taranis, and `04/23/326 VR` covers its twenty-third day. A date with an era-relative year names its era.

```yaml
data:
  born: datefrom commoncal 04/23/326 VR
  died: ~326.114
```

The conversion commands take the same forms:

```bash
package-build datefrom commoncal '04/23/326 VR'
package-build dateto commoncal 326.114
package-build dateto commoncal 326.114 --format long
```

The CLI `datefrom` command requires a day and reads the default (`std`, or first) pattern. `dateto` prints the era covering the canonical day. A clock time makes a date exact; a year or day without one spans the stated interval. `data.epoch` and `data.moon.newOn` require a day. The [detailed date rules](../reference/format-details.md#dates-and-calendars) describe precision and bounds.

In prose, `{{dateformat "commoncal" data.born}}` prints a date in the chosen calendar. `{{dateformat data.calendar data.born}}` uses the note's calendar Address. A third argument chooses another named pattern. A being or place can set `data.calendar`; its infobox uses that calendar for dates.

## Write a recurring date

A `lore`, `place` or `affiliation` note states its dated occurrences under `data.events`, a list — a note may record a founding once and an annual festival beside it. Each entry carries `when`, the occurrence's anchor and first instance, and optionally `until` and `recurs`; it also states a `summary`, and a note holding several gives each an `id`. The [Events reference](../reference/format-details.md#events) lists every key an entry takes.

```yaml
data:
  events:
    - id: founders
      when: "412.1"
      recurs: { every: 1 }
      summary: The city keeps the day of its founding.
    - id: conjunction
      when: "689.5"
      until: "1203.9"
      recurs: { every: 514 }
      summary: The great conjunction is observed from the temple roof.
```

The first entry is annual, with no end. The second recurs every five hundred fourteen years and stopped after canonical year 1203; `recurs.every` always counts whole years on the canonical axis. In place of a period, `recurs.on` lists the dates somebody actually recorded, strictly increasing and each later than `when`:

```yaml
data:
  events:
    - when: "326.1"
      recurs:
        on: ["412.1", "689.5"]
      summary: The comet is recorded over the harbor.
```

A build resolves each occurrence on the canonical axis, and the content index carries the result under `resolvedDates.events`.

**A day that recurs every year, with no founding date of its own, writes year `0`** — quoted, since every canonical date stating a day must be:

```yaml
data:
  events:
    - when: "0.286"
      summary: The harvest rite is kept.
```

`when: "0.286"` is the two-hundred-eighty-sixth day of the year, every year — a harvest rite nobody dates to a founding. `recurs` is refused beside it, since the entry is already annual; `until` is allowed, and bounds how long the rite was kept.
