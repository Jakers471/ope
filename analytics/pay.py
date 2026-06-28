"""
Personal pay & tips analytics from the Kronos timecard export (Jacob Paoletti).

Source: pay/my_timecard_clean.tsv - 186 clocked shifts, 2025-04 to 2026-03.
Hours and TipsUSD are reliable; PayCodes is polluted and ignored (see
pay/timecard_data_notes.md). This is one person's real worked time and tips,
separate from the scheduling dataset.
"""
from __future__ import annotations

import os

import pandas as pd

from .shifts import num

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAY_PATH = os.path.join(_ROOT, "pay", "my_timecard_clean.tsv")
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def build_pay(path: str = PAY_PATH) -> dict | None:
    if not os.path.exists(path):
        return None
    df = pd.read_csv(path, sep="\t", dtype=str).fillna("")
    df["hours"] = pd.to_numeric(df["Hours"], errors="coerce").fillna(0.0)
    df["tips"] = pd.to_numeric(df["TipsUSD"], errors="coerce").fillna(0.0)
    df["date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)
    df["tph"] = df.apply(lambda r: r["tips"] / r["hours"] if r["hours"] else 0, axis=1)
    tipped = df[df["tips"] > 0]

    total_hours = float(df["hours"].sum())
    total_tips = float(df["tips"].sum())

    # By day of week.
    by_dow = []
    for d in DOW:
        g = df[df["Day"] == d]
        gt = g[g["tips"] > 0]
        by_dow.append({
            "day": d,
            "shifts": int(len(g)),
            "total_tips": num(g["tips"].sum()),
            "avg_tips": num(gt["tips"].mean() if len(gt) else 0),
            "tph": num(g["tips"].sum() / g["hours"].sum(), 2) if g["hours"].sum() else 0,
        })

    # Per-week timeline.
    df["wk"] = (df["date"] - pd.to_timedelta(df["date"].dt.weekday, unit="D")).dt.date
    wk = df.groupby("wk").agg(tips=("tips", "sum"), hours=("hours", "sum"), shifts=("tips", "size")).reset_index()
    weekly = [{"label": str(r["wk"]), "tips": num(r["tips"]), "hours": num(r["hours"], 1),
               "tph": num(r["tips"] / r["hours"], 2) if r["hours"] else 0}
              for _, r in wk.iterrows()]

    # By month of year.
    by_month = []
    moy = df.groupby(df["date"].dt.month)
    for m in range(1, 13):
        if m in moy.groups:
            g = moy.get_group(m)
            by_month.append({"month": MONTHS[m - 1], "tips": num(g["tips"].sum()), "shifts": int(len(g))})
        else:
            by_month.append({"month": MONTHS[m - 1], "tips": 0, "shifts": 0})

    # Per-shift rows (for table, scatter, best/worst).
    shifts = [{
        "date": str(r["date"].date()), "day": r["Day"],
        "in": r["ClockIn"], "out": r["ClockOut"],
        "hours": num(r["hours"], 2), "tips": num(r["tips"], 2), "tph": num(r["tph"], 2),
    } for _, r in df.iterrows()]
    best = sorted(shifts, key=lambda s: s["tips"], reverse=True)[:8]

    return {
        "name": "Paoletti, Jacob",
        "source": "Kronos timecard",
        "totals": {
            "shifts": int(len(df)),
            "hours": num(total_hours, 1),
            "tips": num(total_tips),
            "tph": num(total_tips / total_hours, 2) if total_hours else 0,
            "avg_tips": num(tipped["tips"].mean() if len(tipped) else 0),
            "tipped_shifts": int(len(tipped)),
            "zero_shifts": int((df["tips"] == 0).sum()),
            "date_start": str(df["date"].min().date()),
            "date_end": str(df["date"].max().date()),
            "best_shift": num(df["tips"].max()),
        },
        "by_dow": by_dow,
        "weekly": weekly,
        "by_month": by_month,
        "shifts": shifts,
        "scatter": [[s["hours"], s["tips"]] for s in shifts],
        "best": best,
    }
