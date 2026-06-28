# Oakville Grill & Cellar / 167 Events — Schedule Analytics

A dark, professional analytics application for dissecting ~3.2 years of restaurant scheduling
data. The goal is to learn every meaningful thing about the workforce: who works the most, who
works which shifts, turnover and tenure, job changes, coverage, and restaurant-wide totals —
broken down per person and per job type.

This document is the single source of truth for what the data contains and how the product is
organized. No emojis anywhere in this project (see `CLAUDE.md`).

---

## 1. Dataset at a glance

| Fact | Value |
|---|---|
| Source files | `foh_complete` + `foh_tail` + `schedule_clean` + `schedule_full` (merged, content-deduped) |
| Shift records (rows) | 49,985 |
| Unique employees | 358 |
| Date range | 2023-02-23 to 2026-07-08 (~3.4 years) |
| Total labor hours | 353,247 |
| Role buckets (ShiftJob leaf, normalized) | 33 |
| Departments | 7 |
| Venues touched | ~30 (home base: The Oakville & 167 Events) |
| People who worked more than one role | 153 of 250 FOH (~61%) |

Job-type grouping is by **role actually worked** (ShiftJob leaf), not the person's title
(`PrimaryJob`). See `CLAUDE.md` for the role-vs-title rule and the source/dedup details.

---

## 2. Data dictionary (column by column)

The file has **11 columns**. Each row is one scheduled shift for one person.

### 1. `Week`
Pay/schedule week as a range string, e.g. `2023-04-20_2023-04-26`. 165 distinct weeks. This is
the natural time axis for trend lines and the unit for per-week aggregation.

### 2. `Name`
Employee, formatted `Last, First M`. 295 distinct. Primary entity for all per-person analytics.

### 3. `PrimaryJob`
The person's role classification. 25 values. This is the **top-level category** for the UI.

| Job | Rows | Job | Rows |
|---|---|---|---|
| Server | 15,788 | Bar Back | 195 |
| Busser | 6,056 | Polisher | 120 |
| Line Cook | 5,293 | Lead Line Cook | 62 |
| Runner | 3,006 | Lead Employee-FOH | 41 |
| Bar | 2,367 | Host | 30 |
| Prep Cook | 1,620 | Server- Banquet | 23 |
| Dishwasher | 1,566 | Captain- Banquet | 18 |
| Wine Sommelier | 716 | Intern | 17 |
| Steward-Receiver | 573 | Stocker - Bar | 8 |
| Wine Sommelier-Steward | 519 | Office Coordinator | 5 |
| Captain | 425 | Sales-Catering Assistant | 5 |
| Stocker - Front of House | 380 | | |
| Pastry | 298 | | |
| Hourly Kitchen Manager | 286 | | |

### 4. `Date`
**Day of week** (Monday … Sunday), not a calendar date. Distribution skews to weekends
(Saturday 7,208, Friday 6,427 — the busy service nights). The real calendar date lives in
`Start` / `End`.

### 5. `Start` / 6. `End`
ISO timestamps, e.g. `2023-04-22T15:00:00`. Source of:
- the actual calendar date,
- shift start hour (drives AM/PM classification),
- shift length cross-check against `Duration`.

### 7. `Range`
Human-readable shift window, e.g. `3:00 PM - 11:00 PM`. Display field; redundant with Start/End.

### 8. `Duration`
Bracketed `[H:MM]`, e.g. `[8:00]`. Parsed to decimal hours for all labor-hour math. Most common
lengths: 7:00 (8,403), 8:00 (7,108), 6:00 (6,289).

### 9. `Transfer`
`YES` (4,949 rows) or blank (34,468). A `YES` is a **167 Events / catering-banquet transfer** —
the employee was pulled to work an event rather than their home station. This is the third shift
category. 49% of transfers are in the Catering-Banquets department; the rest scatter across
off-site venues (RPM Steak, RPM Seafood, Aba, etc.).

### 10. `ShiftJob`
A 4-part path: `Org / Venue / Department / Job`. Always depth 4.

- **Org** (1): always `Restaurant Personnel Inc`.
- **Venue** (~30): `The Oakville & 167 Events` (37,708) dominates; transfers reach RPM Steak (480),
  RPM Seafood (422), Summer House (311), RPM Italian (112), and ~25 others.
- **Department** (7): Dining Room 24,785 · Kitchen 10,463 · Catering-Banquets 2,466 · Bar 1,397 ·
  Training 261 · Guest Services 40 · Administrative 4.
- **Job**: the specific station for that shift (can differ from `PrimaryJob` on transfer days).

### 11. `Comments`
Free text, mostly blank (3,508 non-empty). Common tags: `Other: upstairs`, `Closer`,
`Events: upstairs`, `Opener`, `Events: 167`, `Mandatory Meeting`. Useful as a secondary signal
(closer/opener counts, event flags) but noisy.

---

## 3. Derived concepts (computed, not in the raw file)

| Concept | How it is derived |
|---|---|
| **Shift category** | Priority: 167/event (Catering-Banquets dept OR comment mentions "167" OR offsite venue) -> Training (Training dept/role) -> PM (start >= 3pm) -> AM. The raw `Transfer=YES` flag is not used (it conflates events with training and coverage). Totals (with merged data): AM 17,661 · PM 19,370 · 167 2,760 · Training 270. |
| **Calendar date** | Date portion of `Start`. |
| **Hours** | `Duration` `[H:MM]` -> H + MM/60. |
| **Tenure** | last calendar date - first calendar date, per person. Longest is 1,154 days. |
| **Active / inactive** | active = worked within the last 30 days of the dataset. |
| **Longest streak worked** | max run of consecutive days with a shift, per person. |
| **Longest streak off** | max gap between consecutive worked days, per person (breaks / vacations). |
| **Job transition** | change in `PrimaryJob` over time for one person, with the date it changed. |
| **Weekend PM** | shift category PM on Friday or Saturday. |

---

## 4. Analytics catalog (everything to surface)

Organized by scope. Each item maps to a chart or table in the UI.

### A. Restaurant-wide (the whole operation)
- Total labor hours (281,401) and hours by week (trend line).
- Headcount over time; active vs inactive split (82 / 213).
- Composition by department, by venue, by job type (donut / stacked bar).
- Shift mix: AM vs PM vs 167/Transfer, overall and over time.
- Coverage heatmap: day-of-week x week, intensity = shifts or hours.
- Transfers (167 Events) volume over time and as a share of all shifts.

### B. By job type (Server, Busser, Line Cook, ... — the primary drill-down)
- Roster for the job, ranked by hours / shifts.
- Shift-type mix within the job (who carries the PM and weekend load).
- Hours-per-week trend for the job category.
- Headcount and turnover within the job.
- Same metric set reused for every job type (one template).

### C. Per employee (deep dive)
- Tenure timeline: first seen -> last seen, with gaps shown (turnover view).
- Total hours, total shifts, average hours/week.
- Shift breakdown: AM / PM / 167, weekday vs weekend, Friday/Saturday PM count.
- Transfer (167) count and where they were sent.
- Longest streak worked in a row; longest stretch off in a row (breaks/vacations).
- Job history: every primary job held and the date it changed.
- Rank within their job and restaurant-wide.

### D. People comparisons / leaderboards
- Most hours, most PM shifts, most Friday/Saturday PM, most transfers, most consecutive days.
- Longest-tenured employees vs newest hires.
- Turnover timeline: when names start and stop appearing.

---

## 5. Proposed information architecture

The largest, most natural top-level category is **job type** (Server, Busser, Line Cook, ...).
Front-of-house vs back-of-house is the top grouping above that. So:

```
Overview (restaurant-wide)
  |
  +-- Front of House
  |     Server, Busser, Runner, Bar, Captain, Host, Wine Sommelier, ...
  +-- Back of House
  |     Line Cook, Prep Cook, Dishwasher, Pastry, Steward, ...
  +-- Events / 167  (Catering-Banquets, transfers)
  |
  +-- People directory  ->  Employee deep dive
  |
  +-- Leaderboards / comparisons
```

Navigation pattern: **Overview -> Job type -> Person**. Every level reuses the same metric
template so the product feels consistent and there is one place to learn anything.

---

## 6. Tech & charting recommendation

- **Backend**: Python + pandas (already proven against this file) for parsing and metric
  computation, exposed as a local app (fits the existing PyWebView desktop pattern).
- **Frontend**: dark single-page UI. Charts via **Apache ECharts** — it renders the crisp,
  detailed, real-analytics look requested (precise axes, gridlines, rich tooltips, smooth lines,
  heatmaps, gantt-style timelines) and themes cleanly to dark. Plotly is the alternate if
  interactivity-heavy exploration is wanted later.
- Mockups in `ui_mockups/` demonstrate the chart catalog and two style directions using ECharts
  with clearly-labeled fake data, so the structure can be reviewed before any real wiring.

---

## 7. Confirmed decisions

- **Style direction**: Teal / Slate dark theme.
- **Charting engine**: Apache ECharts.
- **Single connected app**: one UI, persistent sidebar, tabbed navigation, breadcrumb drill-down
  (Overview -> Job type -> Person). No separate pages/windows.
- **People directory**: full list of all 295 employees, filterable by job, department, status,
  venue, and date range; searchable by name; sortable on every metric column. Job-breakdown
  screens are the directory pre-filtered to one job plus that job's summary charts.
- **Comparison**: filtered lists + single-person deep-dives only. No side-by-side compare view.
- **Multi-job people** (29 of 295): appear under every job they held, each list showing the
  slice of their activity for that job. A person's deep-dive page shows the full job history.

## 8. Repository layout (built)

```
schedule/
  CLAUDE.md            project rules (no emojis, dark UI, conventions)
  PROJECT.md           this document
  README.md            how to run
  requirements.txt     flask, pandas, pywebview
  run.bat              desktop launcher (point a .lnk here)
  schedule_data/       raw source TSV
  data_pipeline/       TSV parsing + derived fields (loader.py)
  analytics/           metric computation (overview.py, jobs.py, people.py, shifts.py, core.py)
  app/
    server.py          Flask API + PyWebView launcher
    static/            UI: index.html, css/theme.css, js/{charts,components,app}.js, echarts.min.js
  ui_mockups/          early design mockups (fake data; superseded by the real app)
```

Launch with `python -m app.server` (desktop) or `python -m app.server --web` (browser). See README.
