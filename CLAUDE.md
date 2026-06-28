# CLAUDE.md

Project conventions for the Oakville Grill & Cellar / 167 Events scheduling-analytics app.

## Hard rules

- **NEVER use emojis.** Not in UI, not in code comments, not in commit messages, not in
  documentation, not in chat responses about this project. No exceptions.
- Dark, professional, sharp UI only. No toy styling, no rounded cartoon look, no clip-art icons.
  Charts must look like real analytics-product charts: precise axes, gridlines, legends, tooltips.
- No invented data in shipped views. Mockups may use clearly-labeled fake data; production views
  must be computed from `schedule_data/`.

## Project shape

- Restaurant: **The Oakville Grill & Cellar**, with **167 Events** as its catering/events arm.
- Source data: `schedule_data/schedule_full.tsv` (tab-separated, ~39.4k shift rows).
- Keep the structure modular and clearly labeled in the file tree. One concern per folder:
  - `schedule_data/`   raw source data
  - `ui_mockups/`      design mockups only (no production logic)
  - `docs/`            project documentation (`PROJECT.md` lives at root for visibility)
  - future: `data_pipeline/` (parsing/derivation), `analytics/` (metric computation),
    `app/` (backend + served UI)

## Data conventions

- A "shift" is one row. There are four shift categories, classified in priority order:
  1. **167 / event** = Catering-Banquets department, OR the comment tags it as an event
     (schedulers write both "167" and "Events: ..." - upstairs, buyout, courtyard, boat,
     private event, offsite, PASE - so match "event" as well as "167"), OR an offsite event
     venue. (The raw `Transfer = YES` flag is NOT used - it also covers training and
     cross-department coverage, which are not events.)
  2. **Training** = Training department, or a "Training" shift role.
  3. **PM** = starts at/after 3:00 PM.
  4. **AM** = starts before 3:00 PM.
- The `Date` column holds the day-of-week, and its text format differs between exports
  ("Sat 4/12" vs "Saturday"), so day-of-week is derived from the start timestamp, not this column.
- `ShiftJob` is a 4-part path: `Org / Venue / Department / Job`.
- **Role vs title.** `PrimaryJob` is the person's current title. The `ShiftJob` leaf (4th segment)
  is the role they actually worked that shift. Job-type grouping and hours attribution use the
  **role** (normalized, Option A), so a server's food-running hours count under Runner. A person
  appears in every role roster they worked. Their page shows their main role (most hours) plus
  their title.
- **Data sources** are merged and de-duplicated on shift content (`Name + Start + End + ShiftJob +
  Duration`), never the whole row: `foh_complete` + `foh_tail` (FOH backbone) + `schedule_clean` +
  `schedule_full` (Kitchen/BOH + stragglers). `my_shifts (1).tsv` is intentionally not loaded.

## UI standards

- Color: deep dark background, restrained accent (one primary accent, one warning/amber).
- Numbers everywhere: counts, percentages, totals, deltas. Pair every chart with the raw figure.
- Tables are first-class: sortable, dense, monospaced numerics.
- Charts: line (trends/timelines), bar/stacked bar (composition), heatmap (day x week coverage),
  horizontal bar (rankings), donut (share), gantt-style timeline (tenure/turnover).
