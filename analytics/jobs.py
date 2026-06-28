"""Per-job-type rollups and job-detail (roster) views."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .shifts import ACTIVE_WINDOW_DAYS, num, shift_counts


def _active_names(df, max_date) -> set:
    last = df.groupby("name")["date"].max()
    return set(last[(max_date - last).dt.days <= ACTIVE_WINDOW_DAYS].index)


def build_jobs(df, meta) -> list[dict]:
    """One row per primary job, ranked by hours."""
    max_date = meta["max_date"]
    active = _active_names(df, max_date)
    rows = []
    for job, g in df.groupby("role"):
        names = g["name"].unique()
        # tenure within job per person
        span = g.groupby("name")["date"].agg(["min", "max"])
        tenures = (span["max"] - span["min"]).dt.days
        pm = int((g["shift_type"] == "PM").sum())
        rows.append({
            "job": job,
            "group": meta["job_group"].get(job, "Other"),
            "department": meta["job_dept"].get(job, ""),
            "people": int(len(names)),
            "active": int(sum(1 for n in names if n in active)),
            "shifts": int(len(g)),
            "hours": num(g["hours"].sum()),
            "pm_pct": num(pm / len(g) * 100, 1) if len(g) else 0,
            "transfers": int(g["is_167"].sum()),
            "median_tenure": num(tenures.median() if len(tenures) else 0),
        })
    rows.sort(key=lambda r: r["hours"], reverse=True)
    return rows


def build_job_dynamics(df, meta, job: str, min_weeks: int = 4) -> dict | None:
    """
    Per-person consistency and trend for a job over the selected period.

    For each person with at least `min_weeks` worked weeks, returns average
    hours/week, a consistency score (from the coefficient of variation of weekly
    hours), a trend (change in hours/week, early vs recent quarter of their span),
    and their weekly hours for a sparkline. The min-weeks filter keeps rankings
    meaningful (a one-week server is not "perfectly consistent").
    """
    sub = df[df["role"] == job]
    if sub.empty:
        return None
    wk = (
        sub.groupby(["week_start", "week"]).size().reset_index(name="n")
        .sort_values("week_start")
    )
    weeks = wk["week"].tolist()
    piv = (
        sub.pivot_table(index="name", columns="week", values="hours", aggfunc="sum", fill_value=0)
        .reindex(columns=weeks, fill_value=0)
    )
    # Trim sparse boundary weeks (a ragged data edge would distort shares).
    week_totals = piv.sum(axis=0)
    if len(weeks) > 4:
        thresh = week_totals.median() * 0.25
        kept = [i for i, w in enumerate(weeks) if week_totals[w] >= thresh]
        if kept:
            weeks = weeks[kept[0]:kept[-1] + 1]
            piv = piv.reindex(columns=weeks, fill_value=0)
    labels = [w[:10] for w in weeks]
    id_of = sub.groupby("name")["pid"].first()
    active = _active_names(df, meta["max_date"])
    people = []
    for name, row in piv.iterrows():
        hours = row.to_numpy(dtype=float)
        worked = hours[hours > 0]               # only the weeks they actually worked
        weeks_worked = int(len(worked))
        if weeks_worked < min_weeks:
            continue
        # Consistency and trend judge the weeks worked only - time off / vacation
        # weeks are ignored, not counted against steadiness.
        avg = float(worked.mean())
        cv = float(worked.std() / avg) if avg > 0 else 0.0
        consistency = max(0, round(100 * (1 - min(cv, 1))))
        q = max(1, weeks_worked // 4)
        early = float(worked[:q].mean())
        late = float(worked[-q:].mean())
        people.append({
            "id": int(id_of[name]),
            "name": name,
            "status": "active" if name in active else "inactive",
            "total_hours": num(float(worked.sum())),
            "avg_week": num(avg, 1),
            "weeks_worked": weeks_worked,
            "consistency": int(consistency),
            "trend": num(late - early, 1),  # change in hours/week, early vs recent worked weeks
            "weekly": [num(v, 1) for v in worked],
        })
    people.sort(key=lambda r: r["consistency"], reverse=True)
    return {
        "job": job,
        "weeks": labels,
        "people": people,
        "min_weeks": min_weeks,
    }


def build_job_detail(df, meta, job: str) -> dict | None:
    sub = df[df["role"] == job]
    if sub.empty:
        return None
    max_date = meta["max_date"]
    active = _active_names(df, max_date)

    # Weekly hours trend for the job.
    wk = (
        sub.groupby(["week_start", "week"])
        .agg(hours=("hours", "sum"), shifts=("name", "size"))
        .reset_index()
        .sort_values("week_start")
    )
    weekly = [{"label": r["week"][:10], "hours": num(r["hours"]), "shifts": num(r["shifts"])}
              for _, r in wk.iterrows()]

    # Roster: one row per person who held this job (their slice for this job).
    roster = []
    for name, g in sub.groupby("name"):
        first, last = g["date"].min(), g["date"].max()
        pm = int((g["shift_type"] == "PM").sum())
        frisat_pm = int(((g["shift_type"] == "PM") & g["is_weekend"]).sum())
        roster.append({
            "id": int(g["pid"].iat[0]),
            "name": name,
            "status": "active" if name in active else "inactive",
            "shifts": int(len(g)),
            "hours": num(g["hours"].sum()),
            "AM": int((g["shift_type"] == "AM").sum()),
            "PM": pm,
            "167": int((g["shift_type"] == "167").sum()),
            "frisat_pm": frisat_pm,
            "tenure": int((last - first).days),
            "first": str(first.date()),
            "last": str(last.date()),
        })
    roster.sort(key=lambda r: r["hours"], reverse=True)

    tenures = [r["tenure"] for r in roster]
    pm_total = int((sub["shift_type"] == "PM").sum())
    return {
        "job": job,
        "group": meta["job_group"].get(job, "Other"),
        "department": meta["job_dept"].get(job, ""),
        "kpis": {
            "people": int(sub["name"].nunique()),
            "active": int(sum(1 for r in roster if r["status"] == "active")),
            "inactive": int(sum(1 for r in roster if r["status"] == "inactive")),
            "shifts": int(len(sub)),
            "hours": num(sub["hours"].sum()),
            "pm_pct": num(pm_total / len(sub) * 100, 1),
            "transfers": int(sub["is_167"].sum()),
            "median_tenure": num(pd.Series(tenures).median() if tenures else 0),
        },
        "shift_mix": shift_counts(sub),
        "weekly": weekly,
        "roster": roster,
    }
