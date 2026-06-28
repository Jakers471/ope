# Oakville Grill & Cellar / 167 Events - Schedule Analytics

A dark, professional desktop app for dissecting ~3.2 years of restaurant scheduling data
(39,417 shifts, 295 employees, 165 weeks, 281,401 labor hours). Built with a Python analytics
backend and an Apache ECharts front end, served into a PyWebView desktop window.

See `PROJECT.md` for the full data dictionary and analytics catalog, and `CLAUDE.md` for project
rules (notably: no emojis, ever).

## Run it

```
pip install -r requirements.txt
python -m app.server          # opens the desktop window (PyWebView)
```

Or run in the browser instead of the desktop window:

```
python -m app.server --web    # then open http://127.0.0.1:8731
```

On Windows you can also double-click `run.bat` (point a Start-menu shortcut / .lnk at it).

## Global time filter

A persistent time-period bar at the top scopes the entire app. Pick a preset (all time, last
12/6 months, last 90/30 days) or a custom date range. Everything recomputes for that window:
all metrics and charts, the people directory, the job rosters, and the left sidebar itself -
jobs and employees with no shifts in the period are hidden, not just greyed out. The choice
persists across sessions.

## What you get

- **Restaurant overview** - total hours, shifts, active vs inactive headcount, 167/transfer share,
  weekly labor-hour trend, shift mix, department hours, headcount over time, a coverage heatmap
  (day-of-week x month), workforce turnover, and a sortable job-type table.
- **Job-type breakdown** - one role drilled down: weekly trend, shift mix, hours and Fri/Sat-PM
  leaderboards, and the full roster (sortable, click through to a person).
- **People directory** - all 295 employees. Search by name; filter by group, job, or status; sort
  every column. Filtering by a job shows everyone who worked it, with that job's slice of activity
  (people who changed roles appear under each job they held).
- **Employee deep dive** - activity timeline with break/vacation gaps, longest streaks on/off,
  shift breakdown, day-of-week distribution, full job history, and 167 transfer destinations.

## Project layout

```
schedule/
  schedule_data/        raw source TSV
  data_pipeline/        TSV load + derived fields (shift type, venue/dept split, FOH/BOH group)
  analytics/            metric computation (overview, jobs, people, shared helpers)
  app/
    server.py           Flask API + PyWebView launcher
    static/             UI (index.html, css/, js/ with charts, components, router, ECharts bundle)
  ui_mockups/           early design mockups (fake data; superseded by the real app)
  CLAUDE.md             project rules
  PROJECT.md            data dictionary, analytics catalog, decisions
```

## Architecture

The TSV is parsed once at startup into an enriched pandas DataFrame (`data_pipeline.build`).
The `analytics.Analytics` facade computes summaries eagerly and per-entity detail on demand,
caching results. Flask exposes JSON endpoints (`/api/overview`, `/api/jobs`, `/api/job/<job>`,
`/api/people`, `/api/person/<id>`); the static single-page UI fetches from them and renders with
ECharts. Everything runs locally and offline (the ECharts library is bundled in `app/static/js`).

## Notes

- `playwright` is used only for headless render testing and is not a runtime dependency.
