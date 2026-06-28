"""
Seniority-vs-reward analysis for servers.

Tests the restaurant's stated policy that senior staff get priority: do the
longest-tenured servers actually get the most hours and the most premium shifts
(167 events, Friday/Saturday PM)?

Seniority is overall tenure (time at the restaurant). Reward is measured two ways
- counting only the person's Server-role shifts, and counting all their shifts -
so a title-server's food-running hours do not mask whether they get served work.
Each is shown normalized (per week, recent window) plus raw all-time.
"""
from __future__ import annotations

import pandas as pd

from .shifts import ACTIVE_WINDOW_DAYS, SRV_EVENT_ROLES, num

RECENT_WEEKS = 12      # the "what are they getting now" window
MIN_WEEKS = 6          # ignore servers too new to assess
METRIC_KEYS = ["avg_week", "recent_hours", "total_hours", "events_167",
               "weekend_pm", "pm", "am", "pm_share"]


def _metrics(sub, recent_sub) -> dict:
    """
    Seniority + reward over a (possibly role-filtered) set of a person's shifts.
    Tenure is first-to-last within this scope, so in the server-only scope it is
    how long they have actually been serving, not their overall employment.
    """
    recent_hours = num(float(recent_sub["hours"].sum()), 1)
    if sub.empty:
        return {"tenure": 0, "first": None, "last": None, "weeks": 0, "total_hours": 0,
                "avg_week": 0, "recent_hours": recent_hours, "events_167": 0, "weekend_pm": 0,
                "pm": 0, "am": 0, "pm_share": 0}
    first, last = sub["date"].min(), sub["date"].max()
    weeks = int(sub["week"].nunique())
    total = float(sub["hours"].sum())
    pm = int((sub["shift_type"] == "PM").sum())
    am = int((sub["shift_type"] == "AM").sum())
    service = pm + am  # regular AM/PM service shifts (excludes 167 and training)
    return {
        "tenure": int((last - first).days),
        "first": str(first.date()),
        "last": str(last.date()),
        "weeks": weeks,
        "total_hours": num(total),
        "avg_week": num(total / weeks, 1) if weeks else 0,
        "recent_hours": recent_hours,
        "events_167": int(sub["is_167"].sum()),
        "weekend_pm": int(((sub["shift_type"] == "PM") & sub["is_weekend"]).sum()),
        "pm": pm,
        "am": am,
        "pm_share": num(pm / service * 100, 0) if service else 0,
    }


def _spearman(df, a, b):
    if len(df) < 3:
        return 0.0
    r = df[a].corr(df[b], method="spearman")
    return num(0.0 if pd.isna(r) else r, 2)


def build_seniority(df, meta) -> dict:
    max_date = meta["max_date"]
    empty = {"n": 0, "servers": [], "correlations": {"srv": {}, "all": {}}, "recent_weeks": RECENT_WEEKS}
    if df.empty:
        return empty

    recent_cutoff = max_date - pd.Timedelta(weeks=RECENT_WEEKS)
    rows = []
    for name, g in df.groupby("name"):
        title = g.sort_values("date")["primary_job"].iloc[-1]
        if title != "Server":
            continue
        first, last = g["date"].min(), g["date"].max()
        if (max_date - last).days > ACTIVE_WINDOW_DAYS:
            continue
        if int(g["week"].nunique()) < MIN_WEEKS:
            continue

        recent = g[g["date"] >= recent_cutoff]
        # "Serving" = Server + Server- Banquet (banquet serving is server work). Used for
        # EVERY server-scope metric - hours, tenure, events, PM/AM - so the whole analysis
        # is consistent: food-running and other-role shifts never count as serving.
        srv = g[g["role"].isin(SRV_EVENT_ROLES)]
        srv_recent = recent[recent["role"].isin(SRV_EVENT_ROLES)]
        all_m = _metrics(g, recent)             # all shifts; tenure = overall employment
        srv_m = _metrics(srv, srv_recent)       # serving only; tenure = serving span
        rows.append({"id": int(g["pid"].iat[0]), "name": name, "all": all_m, "srv": srv_m})

    if not rows:
        return empty

    # Spearman correlations of seniority (scope tenure) vs each reward, per scope.
    flat = pd.DataFrame([
        {**{f"{sc}_tenure": r[sc]["tenure"] for sc in ("srv", "all")},
         **{f"{sc}_{k}": r[sc][k] for sc in ("srv", "all") for k in METRIC_KEYS}}
        for r in rows
    ])
    correlations = {
        scope: {k: _spearman(flat, f"{scope}_tenure", f"{scope}_{k}") for k in METRIC_KEYS}
        for scope in ("srv", "all")
    }

    return {
        "n": len(rows),
        "as_of": str(max_date.date()),
        "recent_weeks": RECENT_WEEKS,
        "min_weeks": MIN_WEEKS,
        "correlations": correlations,
        "servers": rows,
    }
