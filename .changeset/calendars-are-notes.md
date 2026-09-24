---
"@heroiclands/package-build": minor
---

**Calendars are content, not configuration.** The `calendar:` block retires from `package-build.config.yaml`, and a configuration that still declares it is refused by name.

**A calendar is a note.** A `lore` note with `subType: calendar` states the months it keeps, the weekdays it names, the seasons it marks and the year-counts kept in it, and a date names one of those by writing `<calendar shortcode>.<era shortcode>`. Days that belong to no month are a short month like any other, sitting in the list where they fall in the year.

**The world states its own year.** How long the year is, how the day divides and how the moon moves are written once on the world's own `place` note and on its moon's, so no calendar restates them — and a calendar whose months do not add up to that year is refused, naming the year rather than the arithmetic.

**A body is a place.** `place` gains `celestial`, for something observed from a world rather than located on one.

**A written day is bounded by the month it names.** A five-day month accepts five days and a thirty-day month accepts thirty, in whatever order a calendar keeps them; a package that names no calendar bounds nothing.
