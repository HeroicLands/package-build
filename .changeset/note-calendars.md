---
"@heroiclands/package-build": patch
---

A package can name a default calendar with `defaultCalendar` in its configuration, and it replaces the world note's calendar as the one dates fall back to.

A note's dates print in its own `data.calendar`, which any note may now set, else its culture's, else for a place its parents', else the default. A place whose parents keep different calendars is a build error until it names its own.

Chronologies and the other event sections print every date in the calendar of the page showing them, and `dateformat` with no calendar named uses the note's.
