---
shortcode: authoringdatesandcalendars
name: { full: "Dates, calendars, and eras" }
type: doc
subType: howto
---

# Dates, calendars, and eras

A canonical date does not assume how a culture divides a year. Write `<year>[.<day>[:HHMMSS]]`: `720` means any time within year 720, `720.136` means any time on day 136 of that year, and `720.136:143005` specifies the time 14:30:05 on that day. Only a date with a clock time identifies an exact time. A negative year is valid. The day must fit the world's declared year length. The dot separates year from **day of year**, not month from day.

Authors can instead write a named calendar date in frontmatter:

```yaml
data:
  born: datefrom vrcal 23 Taranis 326 VR
  died: ~326.114
```

`datefrom` takes a calendar shortcode or Address, then the date in that calendar. The calendar defines month names and eras. A date can have day, month, or year precision. The written precision bounds the interval; `~` adds uncertainty outside that interval, as in `~720` for a date around year 720. The normalized record retains both precision and the `~` marker. `unknown` means an occurrence is known but its date is not recorded, in fields that accept it. These are the frontmatter date forms; do not put a Handlebars expression there.

Calendar epochs and moon phase references locate a particular day. Write `data.epoch` and `data.moon.newOn` with a day, such as `720.1`; a bare `720` leaves the day unspecified. An era's `start` may state only a year: that establishes its first year at the start of the year for conversion.

A calendar defines the order and length of months. An era defines where a year count begins. One calendar can have several eras; a multi-era date names its era. Era starts increase on the canonical timeline, with gaps allowed. Dates before the first era use a negative year in that first era; later eras count forward from their own year 1. There is no year zero. A date in a gap has no named era in that calendar.

Use the CLI to inspect a conversion:

```bash
package-build datefrom vrcal '23 Taranis 326 VR'
package-build dateto vrcal 326.114
```

`datefrom` prints the canonical value; `dateto` prints a named date in the era covering it. The [detailed calendar rules](../reference/format-details.md#dates-and-calendars) explain precision, era markers, bounds, and resolution errors.

In prose, `{{dateformat "vrcal" data.born}}` renders a date in the chosen calendar. `{{dateformat data.calendar data.born}}` uses the note's own calendar Address. A being or place can set `data.calendar`; a being's infobox displays its dates in that calendar, and a place's infobox displays its `present` there.
