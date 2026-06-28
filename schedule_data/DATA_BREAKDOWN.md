# Schedule Data Sources - What To Use

Breakdown of the five files in `schedule_data/`, focused on getting the four
priority front-of-house positions perfect with no discrepancy: **Server, Busser,
Food Runner, Bar**. Other job types (Kitchen, Sommelier, etc.) are still usable in
the app; they just come from a different file.

## Per-file summary

| File | Rows | People | Date range | Server | Busser | Runner | Bar | Kitchen | Christy |
|---|---|---|---|---|---|---|---|---|---|
| foh_complete.tsv | 35,589 | 248 | 2023-02-23 to 2026-05-27 | 19,147 | 7,126 | 4,310 | 1,177 | 48 | 110 |
| foh_tail.tsv | 1,303 | 53 | 2026-05-28 to 2026-07-08 | 743 | 217 | 168 | 23 | 0 | 13 |
| schedule_clean.tsv | 39,987 | 303 | 2023-03-30 to 2026-05-27 | 14,803 | 5,699 | 3,056 | 1,093 | 10,539 | 6 |
| schedule_full.tsv | 39,417 | 295 | 2023-04-20 to 2026-06-17 | 14,699 | 5,680 | 2,689 | 1,055 | 10,463 | 2 |
| my_shifts (1).tsv | 644 | 1 | 2023-08-05 to 2026-07-08 | 213 | 0 | 409 | 0 | 0 | 0 |

## How the four positions complete out

Counting unique shifts (deduplicated on Name + Start + End + ShiftJob + Duration,
which ignores the differing `Date` text formats between files):

| Source combination | Complete core-role shifts | Gain |
|---|---|---|
| foh_complete + foh_tail | 32,911 | backbone (99.1%) |
| + schedule_clean | 33,191 | +280 |
| + schedule_full | 33,200 | +9 |
| + my_shifts (1) | 33,200 | +0 |

**The complete list for Server/Busser/Runner/Bar is 33,200 shifts.**

- `foh_complete` + `foh_tail` carry 32,911 of them - the overwhelming majority,
  and far more than the old files alone (clean had 24,651, full had 24,123).
- `schedule_clean` adds 280 core-role shifts the foh files are missing. These are
  real, spread thinly across 2023-2026, and none overlap an existing foh shift for
  the same person/day - so they are genuinely additional, not double-counts.
- `schedule_full` adds 9 more beyond that.
- `my_shifts (1)` adds **zero** new core-role shifts. Everything in it is already
  covered.

## Which files to use

**USE (these four, deduplicated together):**

1. **foh_complete.tsv** - the authoritative FOH service export. Backbone for all
   four positions. Widest history (starts 2023-02-23, earlier than any other file).
2. **foh_tail.tsv** - the continuation. Picks up exactly the day after
   foh_complete ends (2026-05-28) and runs to 2026-07-08. This is the "more weeks"
   that completes the recent end of the timeline.
3. **schedule_clean.tsv** - needed for two reasons: it fills 280 core-role shifts
   the foh files miss, AND it is the source of all Kitchen/Back-of-House and other
   job types (~10,500 kitchen rows) that you still want in the app.
4. **schedule_full.tsv** - fills the last 9 core-role gaps and is a second source
   of Kitchen/other roles.

**DO NOT NEED:**

- **my_shifts (1).tsv** - a single person's partial history (Jacob Paoletti, 644
  rows). It contributes nothing the other files do not already have. Safe to drop.

## The one rule that prevents discrepancies

Always deduplicate on shift **content** - `Name + Start + End + ShiftJob +
Duration` - not on the whole raw row. The exports write the `Date` column
differently (`foh_*` use `"Sat 4/12"`, `schedule_*` use `"Saturday"`), so an
exact-row match would treat the same shift as two and **double-count** every
overlapping FOH shift. Keying on content collapses them correctly.

## Why the extra data was needed

The original `schedule_full` / `schedule_clean` exports were short on FOH service
shifts - roughly 5,000 missing servers, 1,600 bussers, 1,400 runners. The clearest
example is Christy Webb: the old files showed 6 and 2 shifts; the foh files show her
true 123 shifts (a 2025 hire who started as a trainee and became a server). The
foh_complete + foh_tail pair closes that gap; schedule_clean/full close the final
~289 stragglers and supply the non-FOH roles.
