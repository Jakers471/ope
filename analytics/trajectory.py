"""
Favorability trajectory: how a server's standing among their peers moves over
time, in rolling 12-week windows. Powers the ascent/descent line and the scatter
trail.

For each window a server's reward is scored against the other servers active in
that window (a 0-100 percentile = "standing vs the pack"). Rising = ascending
toward favored; falling = descending toward snubbed.

The heavy per-window cohort matrix is built once per (scope, range) and cached;
extracting one person's series from it is fast, so switching the selected server
is instant.
"""
from __future__ import annotations

import pandas as pd

from .shifts import ACTIVE_WINDOW_DAYS, SRV_EVENT_ROLES, num

WIDTH = pd.Timedelta(weeks=12)
STEP = pd.Timedelta(weeks=4)
MIN_WEEKS = 6
METRIC_KEYS = ["avg_week", "recent_hours", "total_hours", "events_167",
               "weekend_pm", "pm", "am", "pm_share"]


def _server_names(df, meta) -> list[str]:
    max_date = meta["max_date"]
    names = []
    for name, g in df.groupby("name"):
        if g.sort_values("date")["primary_job"].iloc[-1] != "Server":
            continue
        if (max_date - g["date"].max()).days > ACTIVE_WINDOW_DAYS:
            continue
        if int(g["week"].nunique()) < MIN_WEEKS:
            continue
        names.append(name)
    return names


def _metrics_of(scoped, event_sub) -> dict:
    """All windowed reward values for one server in one window, in a single pass.
    event_sub is the scope-appropriate slice for counting 167 events (server roles
    in server scope, all roles in all scope) - same rule used by the seniority tab."""
    pm = int((scoped["shift_type"] == "PM").sum()) if not scoped.empty else 0
    am = int((scoped["shift_type"] == "AM").sum()) if not scoped.empty else 0
    service = pm + am
    hours = float(scoped["hours"].sum()) if not scoped.empty else 0.0
    weeks = int(scoped["week"].nunique()) if not scoped.empty else 0
    wknd = int(((scoped["shift_type"] == "PM") & scoped["is_weekend"]).sum()) if not scoped.empty else 0
    return {
        "avg_week": round(hours / weeks, 1) if weeks else 0,
        "recent_hours": round(hours, 1),
        "total_hours": round(hours, 1),
        "events_167": int(event_sub["is_167"].sum()),
        "weekend_pm": wknd,
        "pm": pm, "am": am,
        "pm_share": round(pm / service * 100) if service else 0,
    }


def build_matrix(df, meta, scope: str = "srv") -> dict:
    """Per-window cohort values for every server in the population (cached)."""
    names = _server_names(df, meta)
    # "Serving" = Server + Server- Banquet (banquet serving is server work); used for every
    # metric so the scope is consistent across the whole seniority analysis.
    role_filter = (lambda g: g[g["role"].isin(SRV_EVENT_ROLES)]) if scope == "srv" else (lambda g: g)
    by = {n: g.sort_values("date") for n, g in df[df["name"].isin(names)].groupby("name")}

    start, end = df["date"].min(), meta["max_date"]
    ends, e = [], start + WIDTH
    while e < end:
        ends.append(e)
        e += STEP
    ends.append(end)

    first = {}  # scope-aware first shift date per server (for tenure)
    for n, g in by.items():
        scoped = role_filter(g)
        first[n] = (scoped if not scoped.empty else g)["date"].min()

    wins = []
    for e in ends:
        w0 = e - WIDTH
        vals = {}
        for n, g in by.items():
            fw = g[(g["date"] > w0) & (g["date"] <= e)]
            if fw.empty:
                continue
            scoped = role_filter(fw)
            if scoped.empty:
                continue  # they did not work in this scope that window (e.g. pre-serving)
            vals[n] = _metrics_of(scoped, scoped)
        wins.append(vals)

    return {"names": names, "labels": [str(e.date()) for e in ends],
            "ends": ends, "wins": wins, "first": first, "scope": scope}


def build_grid(matrix, meta) -> dict:
    """Per-server, per-metric, per-window percentile grid for the heatmap."""
    names = matrix["names"]
    n2id = meta["name_to_id"]
    rows = {n: {"id": n2id[n], "name": n, "pct": {k: [] for k in METRIC_KEYS}} for n in names}
    for vals in matrix["wins"]:
        for k in METRIC_KEYS:
            present = [v[k] for v in vals.values()]
            n_act = len(present)
            for n in names:
                if n in vals:
                    tv = vals[n][k]
                    below = sum(1 for v in present if v <= tv)
                    rows[n]["pct"][k].append(round((below - 1) / (n_act - 1) * 100) if n_act > 1 else 50)
                else:
                    rows[n]["pct"][k].append(None)
    return {"windows": matrix["labels"], "servers": list(rows.values())}


def extract(matrix, meta, pid: int) -> dict | None:
    name = meta["id_to_name"].get(pid)
    if name is None or name not in matrix["names"]:
        return None
    ends, wins, first = matrix["ends"], matrix["wins"], matrix["first"].get(name)
    out = {k: {"value": [], "pct": []} for k in METRIC_KEYS}
    tenure = []
    for e, vals in zip(ends, wins):
        if name not in vals:
            tenure.append(None)
            for k in METRIC_KEYS:
                out[k]["value"].append(None)
                out[k]["pct"].append(None)
            continue
        tenure.append(int((e - first).days) if pd.notna(first) else None)
        for k in METRIC_KEYS:
            tv = vals[name][k]
            arr = [v[k] for v in vals.values()]
            n_act = len(arr)
            below = sum(1 for v in arr if v <= tv)
            out[k]["value"].append(num(tv, 1))
            out[k]["pct"].append(round((below - 1) / (n_act - 1) * 100) if n_act > 1 else 50)
    return {
        "id": int(pid), "name": name, "scope": matrix["scope"],
        "windows": matrix["labels"], "tenure": tenure, "metrics": out,
        "n": len(matrix["names"]),
    }
