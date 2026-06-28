# UI mockups

Design-only mockups for the Oakville Grill & Cellar / 167 Events schedule-analytics app.
Everything here uses **fake data** (clearly badged) shaped like the real dataset. Nothing in
this folder reads the real TSV or contains production logic.

## How to view

Open `index.html` in a browser. Charts load Apache ECharts from a CDN, so an internet
connection is required for the mockups. The production build will bundle the library locally.

## Files

| File | Purpose |
|---|---|
| `index.html` | Landing page linking all mockups |
| `chart-gallery.html` | Every chart type, labeled, with a teal/amber style switch |
| `01-overview.html` | Restaurant-wide overview dashboard |
| `03-job-breakdown.html` | One job type (Server) drilled down, with roster table |
| `02-employee.html` | One employee deep dive (timeline, streaks, job history) |
| `assets/theme.css` | Shared dark theme and components |
| `assets/mock-data.js` | Fake data generator + shared ECharts dark theme |

## Charting engine

Apache ECharts 5. Chosen for crisp, detailed, real-analytics output (precise axes, gridlines,
rich tooltips, heatmaps, custom gantt timelines) and clean dark theming. Plotly is the alternate
if heavier interactive exploration is wanted later.

No emojis anywhere (see ../CLAUDE.md).
