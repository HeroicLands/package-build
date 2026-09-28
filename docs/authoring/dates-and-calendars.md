---
shortcode: authoringdatesandcalendars
name: { full: "Dates, calendars, and eras" }
type: doc
subType: howto
---

# Dates, calendars, and eras

A canonical date uses the world's year and day count without choosing a culture's calendar. Write `<year>[.<day>[:HHMMSS]]`: `720` covers year 720, `720.136` covers its day 136, and `720.136:143005` identifies 14:30:05 on that day. The dot separates the year from the **day of year**, not a month. Negative years are valid, and the day must fit the world's declared year length. Prefix a date with `~` when its uncertainty extends outside the stated year, day, or second. `unknown` records an occurrence whose date is not known, in fields that permit it.

## Define a calendar

A `lore` note with `subType: calendar` names months, weekdays, eras, and date formats. Its `data.epoch` is the **canonical day that equals calendar year 1, day 1**. For a calendar beginning on canonical day `1.1`, write `epoch: 1.1`; `720.1` would instead put its first year at canonical day 720.1. A calendar does not state the length of the world year: its months must sum to `data.year.days` on the world's `place` note.

```yaml
shortcode: commoncal
name: { full: The Common Calendar }
type: lore
subType: calendar
data:
  epoch: 1.1
  months:
    - { name: Floralis, abbreviation: Flor, days: 180 }
    - { name: Janar, abbreviation: Jana, days: 185 }
  weekdays:
    - { name: Newday, abbreviation: New }
    - { name: Tillday, abbreviation: Til }
  formats:
    std: "D MMMM [yearInEra] G"
    long: "EEEE, D MMMM [yearInEra] G"
  eras:
    - { shortcode: bvr, name: Before Vylarian Reckoning, abbreviation: BVR, start: null }
    - { shortcode: vr, name: Vylarian Reckoning, abbreviation: VR, start: 1 }
```

The `weekdays` array gives the names in order, starting at index 0. Weeks continue across month and year boundaries. Leave `weekdays` out when the calendar has no week.

Every calendar has exactly one era with `start: null` and one with `start: 1`. The null era covers the years before calendar year 1 and counts them backwards: with the example above, canonical `-50.2` prints as `2 Floralis 50 BVR`. Each other `start` is a distinct, positive **calendar year**, not a date. Another era can start at `701`; its first day is calendar year 701, day 1, and its displayed year number is 1. Eras end where the next numeric start begins. Array order does not determine chronology. The optional `marker` identifies an era in authored dates and must be unique across the corpus.

`formats` contains any number of named Calendaria patterns. `std` is the default for `dateto`, `datefrom`, and `dateformat`; if absent, the first named pattern is the default. The default pattern must contain enough information to read a day back: a complete year (`Y`, `YYYY`, or `[yearInEra]`), a day of year (`DDD`) or month and day, and an era label when using `[yearInEra]`. Other named patterns can use display-only Calendaria tokens. Use `package-build dateto <calendar> <canonical-date> --format <name>` or `{{dateformat "commoncal" data.born "long"}}` to select another output format. The [format token reference](../reference/format-details.md#calendar-format-tokens) lists every Calendaria token and the input constraints.

## Write and convert dates

A frontmatter date can use the canonical form or `datefrom <calendar> <date in the default format>`. The calendar may be a shortcode or Address. A named date keeps the precision it states: with the sample `std` pattern, `326 VR` covers a year, `Floralis 326 VR` covers a month, and `23 Floralis 326 VR` covers a day. An era-relative year names its era.

```yaml
data:
  born: datefrom commoncal 23 Floralis 326 VR
  died: ~326.114
```

The conversion commands take the same forms:

```bash
package-build datefrom commoncal '23 Floralis 326 VR'
package-build dateto commoncal 326.23
package-build dateto commoncal 326.23 --format long
```

The CLI `datefrom` command requires a day and reads the default (`std`, or first) pattern. `dateto` prints the era covering the canonical day. A clock time makes a date exact; a year or day without one spans the stated interval. `data.epoch` and `data.moon.newOn` require a day. The [detailed date rules](../reference/format-details.md#dates-and-calendars) describe precision and bounds.

In prose, `{{dateformat "commoncal" data.born}}` prints a date in the chosen calendar. `{{dateformat data.calendar data.born}}` uses the note's calendar Address. A third argument chooses another named pattern. A being or place can set `data.calendar`; its infobox uses that calendar for dates.
