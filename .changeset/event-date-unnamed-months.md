---
"@heroiclands/package-build": patch
---

**Content and notes**

- A date in a month with no name prints as `day 120 of 709 AF`, or `month 4 of 709 AF`.
- It no longer leaves a blank where the month goes.
- The plain form uses the calendar's own year and era, and keeps the clock and the `~` mark.
- `package-build dateto` reports that a date cannot be expressed when `std` names a month that has no name.
