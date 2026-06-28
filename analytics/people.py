"""People directory summaries and per-person deep dives."""
from __future__ import annotations

import pandas as pd

from .shifts import (
    ACTIVE_WINDOW_DAYS,
    DOW_ORDER,
    compute_streaks,
    initials,
    iso,
    num,
    shift_counts,
)


def _title(g) -> str:
    """The person's current title (latest PrimaryJob)."""
    return g.sort_values("date")["primary_job"].iloc[-1]


def _main_role(g) -> str:
    """The role they worked the most hours in - what they mainly do."""
    return g.groupby("role")["hours"].sum().idxmax()


def build_people(df, meta) -> list[dict]:
    """One row per employee, aggregated across every job they held."""
    max_date = meta["max_date"]
    people = []
    for name, g in df.groupby("name"):
        first, last = g["date"].min(), g["date"].max()
        title = _title(g)
        main_role = _main_role(g)
        pm = int((g["shift_type"] == "PM").sum())
        frisat_pm = int(((g["shift_type"] == "PM") & g["is_weekend"]).sum())
        streaks = compute_streaks(g["date"])
        # per-role slice so the directory can filter by role and show that slice -
        # a person appears under every role they actually worked, with that role's hours
        job_slices = []
        for job, jg in g.groupby("role"):
            job_slices.append({
                "job": job,
                "group": meta["job_group"].get(job, "Other"),
                "shifts": int(len(jg)),
                "hours": num(jg["hours"].sum()),
                "PM": int((jg["shift_type"] == "PM").sum()),
                "frisat_pm": int(((jg["shift_type"] == "PM") & jg["is_weekend"]).sum()),
            })
        job_slices.sort(key=lambda r: r["hours"], reverse=True)
        people.append({
            "id": int(g["pid"].iat[0]),
            "name": name,
            "initials": initials(name),
            "main_role": main_role,
            "title": title,
            "group": meta["job_group"].get(main_role, "Other"),
            "jobs": [s["job"] for s in job_slices],
            "job_slices": job_slices,
            "status": "active" if (max_date - last).days <= ACTIVE_WINDOW_DAYS else "inactive",
            "shifts": int(len(g)),
            "hours": num(g["hours"].sum()),
            "AM": int((g["shift_type"] == "AM").sum()),
            "PM": pm,
            "167": int((g["shift_type"] == "167").sum()),
            "frisat_pm": frisat_pm,
            "tenure": int((last - first).days),
            "first": str(first.date()),
            "last": str(last.date()),
            "streak_worked": streaks["worked"],
            "streak_off": streaks["off"],
        })
    people.sort(key=lambda r: r["hours"], reverse=True)
    return people


def build_person(df, meta, pid: int) -> dict | None:
    sub = df[df["pid"] == pid]
    if sub.empty:
        return None
    name = sub["name"].iat[0]
    sub = sub.sort_values("date")
    first, last = sub["date"].min(), sub["date"].max()
    max_date = meta["max_date"]
    title = _title(sub)
    main_role = _main_role(sub)
    status = "active" if (max_date - last).days <= ACTIVE_WINDOW_DAYS else "inactive"

    # Weekly activity timeline (shifts per week across the full span, gaps == 0).
    span_weeks = (
        sub.groupby(["week_start", "week"]).size().reset_index(name="shifts")
        .sort_values("week_start")
    )
    weekly = [{"label": r["week"][:10], "shifts": int(r["shifts"])}
              for _, r in span_weeks.iterrows()]

    # Day-of-week distribution.
    dow_counts = sub["dow"].value_counts()
    dow = [{"day": d[:3], "shifts": int(dow_counts.get(d, 0))} for d in DOW_ORDER]

    # Worked-role history from the shift detail (the ShiftJob leaf), which reflects
    # the role actually worked. This can change over time (e.g. Runner -> Server)
    # even when the fixed PrimaryJob label does not. One-off / transfer roles are
    # filtered out (under 10% of shifts) and the dominant role per month determines
    # the switch points, so a stray cross-role shift does not register as a change.
    history = []
    counts = sub["role"].value_counts()
    total_roles = int(counts.sum())
    major = {r for r in counts.index if counts[r] / total_roles >= 0.10}
    major_df = sub[sub["role"].isin(major)].copy()
    if not major_df.empty:
        major_df["month"] = major_df["date"].dt.to_period("M")
        prev = None
        for _, mg in major_df.groupby("month"):
            dom = mg["role"].value_counts().idxmax()
            if dom != prev:
                d = mg[mg["role"] == dom]["date"].min()
                history.append({"date": iso(d), "from": "hired" if prev is None else prev, "to": dom})
                prev = dom

    # 167 transfers: where they were worked.
    tr = sub[sub["is_167"]]
    transfers = []
    for (venue, dept), g in tr.groupby(["venue", "department"]):
        transfers.append({
            "venue": venue,
            "department": dept,
            "shifts": int(len(g)),
            "hours": num(g["hours"].sum(), 1),
        })
    transfers.sort(key=lambda r: r["shifts"], reverse=True)

    # Rank within their main role, by hours worked in that role.
    same_role = df[df["role"] == main_role]
    job_hours = same_role.groupby("name")["hours"].sum().sort_values(ascending=False)
    rank = int(list(job_hours.index).index(name) + 1) if name in job_hours.index else None

    streaks = compute_streaks(sub["date"])
    pm = int((sub["shift_type"] == "PM").sum())
    frisat_pm = int(((sub["shift_type"] == "PM") & sub["is_weekend"]).sum())
    top_venue = sub["venue"].mode().iat[0] if len(sub["venue"].mode()) else ""

    return {
        "id": int(pid),
        "name": name,
        "initials": initials(name),
        "main_role": main_role,
        "title": title,
        "group": meta["job_group"].get(main_role, "Other"),
        "status": status,
        "first": str(first.date()),
        "last": str(last.date()),
        "home_venue": top_venue,
        "kpis": {
            "hours": num(sub["hours"].sum()),
            "shifts": int(len(sub)),
            "avg_hours": num(sub["hours"].mean(), 1),
            "tenure": int((last - first).days),
            "transfers": int(len(tr)),
            "transfer_pct": num(len(tr) / len(sub) * 100, 1),
            "rank": rank,
            "rank_of": int(len(job_hours)),
            "frisat_pm": frisat_pm,
        },
        "shift_mix": shift_counts(sub),
        "weekly": weekly,
        "dow": dow,
        "job_history": history,
        "transfers": transfers,
        "streaks": streaks,
    }
