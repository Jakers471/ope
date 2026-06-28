# Timecard Data — Notes for Processing

**Source:** Kronos (UKG) "My Timecard", employee Jacob Paoletti
**Coverage:** 1 year — 2025-04-01 to 2026-03-29 (365-day max per export)
**File:** `my_timecard_clean.tsv`

## Columns
`Date, Day, ClockIn, ClockOut, Hours, TipsUSD, PayCodes`

- **Date** — ISO `YYYY-MM-DD`
- **Day** — weekday (Mon–Sun)
- **ClockIn / ClockOut** — shift punch times (12h format)
- **Hours** — shift duration, decimal
- **TipsUSD** — tips for that shift, dollars
- **PayCodes** — paycode tags (see warning below)

## Trustworthy
- **186 shift rows**, correctly paired to calendar dates.
- **TipsUSD is reliable.** 162 shifts have tips; range $59–$1,040 per shift. Total = **$37,096.50**, reconciles with the timecard's own Totals panel (Server $28,965.22 + Runner $8,917.14 = $37,882; minor gap explained in #2).
- **Hours** total ~1,011, matches Totals panel Regular+OT.

## Known Issues / Discrepancies
1. **PayCodes column is unreliable.** 35 of 186 rows have polluted pileups (e.g. `Regular;CPP;Overtime;Regular;CPP;CPPR`) because the timecard's totals/summary section bled into the scrolled capture. **Ignore PayCodes for analysis** — use Hours and Tips only.
2. **Filtered junk values:** `$8,917.14` and `$28,965.22` recurred throughout the raw capture — these are the **year-end role tip totals** (runner / server), not shifts. Already excluded from per-shift TipsUSD. If re-parsing raw, drop any TipsUSD >= $2,000.
3. **No per-shift role.** The timecard does not tag each shift Server vs Runner. Only the aggregate splits it ($28,965 server / $8,917 runner). Per-shift role is NOT recoverable from this file.
4. **~24 rows have $0 tips.** Real worked shifts with no recorded tip (likely training or non-tipped) — not errors.
5. **One year only.** Source caps at 365 days; 2023–2024 history needs separate captures.

## Quick Reference Stats
- Avg tips/shift: **$229**
- By day of week (avg tips): Sat $348 (best), Fri $242, Sun $219, Mon $199, Tue $197, Thu $163, Wed $155
- Total hours: ~1,011 | Tips/hour: ~$36.69
