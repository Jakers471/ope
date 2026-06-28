"""Restaurant-wide overview metrics."""
from __future__ import annotations

import datetime

import pandas as pd

from .shifts import ACTIVE_WINDOW_DAYS, DOW_ORDER, SHIFT_TYPES, num, shift_counts

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _nth_weekday(year, month, weekday, n):
    """The nth weekday of a month. weekday: Mon=0 .. Sun=6."""
    d = datetime.date(year, month, 1)
    return d + datetime.timedelta(days=(weekday - d.weekday()) % 7 + 7 * (n - 1))


def _last_weekday(year, month, weekday):
    last = (datetime.date(year, 12, 31) if month == 12
            else datetime.date(year, month + 1, 1) - datetime.timedelta(days=1))
    return last - datetime.timedelta(days=(last.weekday() - weekday) % 7)


def _easter(year):
    a, b, c = year % 19, year // 100, year % 100
    d, e, f = b // 4, b % 4, (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    ll = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * ll) // 451
    month = (h + ll - 7 * m + 114) // 31
    return datetime.date(year, month, ((h + ll - 7 * m + 114) % 31) + 1)


def _holidays_for(year):
    """Major US (and restaurant-relevant) holidays for a year."""
    return {
        "New Year's Day": datetime.date(year, 1, 1),
        "Valentine's Day": datetime.date(year, 2, 14),
        "St. Patrick's Day": datetime.date(year, 3, 17),
        "Easter": _easter(year),
        "Cinco de Mayo": datetime.date(year, 5, 5),
        "Mother's Day": _nth_weekday(year, 5, 6, 2),
        "Memorial Day": _last_weekday(year, 5, 0),
        "Father's Day": _nth_weekday(year, 6, 6, 3),
        "July 4th": datetime.date(year, 7, 4),
        "Labor Day": _nth_weekday(year, 9, 0, 1),
        "Halloween": datetime.date(year, 10, 31),
        "Thanksgiving": _nth_weekday(year, 11, 3, 4),
        "Christmas Eve": datetime.date(year, 12, 24),
        "Christmas Day": datetime.date(year, 12, 25),
        "New Year's Eve": datetime.date(year, 12, 31),
    }


def _holiday_rows(df):
    shifts_by_date = df.groupby(df["date"].dt.date).size()
    years = range(int(df["date"].dt.year.min()), int(df["date"].dt.year.max()) + 1)
    agg = {}
    for y in years:
        for name, d in _holidays_for(y).items():
            s = int(shifts_by_date.get(d, 0))
            a = agg.setdefault(name, {"shifts": 0, "years": 0})
            a["shifts"] += s
            if s > 0:
                a["years"] += 1
    rows = [{"name": k, "shifts": v["shifts"], "years": v["years"]}
            for k, v in agg.items() if v["shifts"] > 0]
    rows.sort(key=lambda r: r["shifts"], reverse=True)
    return rows


def _person_status(df, max_date):
    """Series name -> True/False active (worked within ACTIVE_WINDOW_DAYS)."""
    last = df.groupby("name")["date"].max()
    return (max_date - last).dt.days <= ACTIVE_WINDOW_DAYS


def _empty_overview() -> dict:
    return {
        "totals": {
            "hours": 0, "shifts": 0, "employees": 0, "weeks": 0,
            "active": 0, "inactive": 0, "transfers": 0, "transfer_pct": 0,
            "date_start": None, "date_end": None, "avg_shifts_week": 0,
        },
        "shift_mix": {t: 0 for t in SHIFT_TYPES},
        "weekly": [], "departments": [],
        "heatmap": {"months": [], "dow": DOW_ORDER, "data": []},
        "turnover": [],
        "staffing": [],
        "total_staff": 0,
        "by_dow": [],
        "by_month": [],
        "holidays": [],
    }


def build_overview(df, meta) -> dict:
    if df.empty:
        return _empty_overview()
    max_date = meta["max_date"]
    status = _person_status(df, max_date)
    active = int(status.sum())
    inactive = int((~status).sum())

    total_hours = float(df["hours"].sum())
    total_shifts = int(len(df))
    transfers = int(df["is_167"].sum())

    # Weekly series (ordered by week_start).
    wk = df.groupby(["week_start", "week"]).apply(
        lambda g: pd.Series({
            "hours": g["hours"].sum(),
            "shifts": len(g),
            "headcount": g["name"].nunique(),
            "AM": int((g["shift_type"] == "AM").sum()),
            "PM": int((g["shift_type"] == "PM").sum()),
            "167": int((g["shift_type"] == "167").sum()),
        }),
        include_groups=False,
    ).reset_index().sort_values("week_start")
    weekly = [
        {
            "week": r["week"],
            "label": r["week"][:10],
            "hours": num(r["hours"]),
            "shifts": num(r["shifts"]),
            "headcount": num(r["headcount"]),
            "AM": num(r["AM"]),
            "PM": num(r["PM"]),
            "167": num(r["167"]),
        }
        for _, r in wk.iterrows()
    ]

    # Department hours, split by shift type.
    dept_rows = []
    for dept, g in df.groupby("department"):
        if not dept:
            continue
        dept_rows.append({
            "department": dept,
            "group": g["group"].mode().iat[0] if len(g["group"].mode()) else "Other",
            "hours": num(g["hours"].sum(), 1),
            "shifts": num(len(g)),
            **{f"{t}_hours": num(g[g["shift_type"] == t]["hours"].sum(), 1) for t in SHIFT_TYPES},
        })
    dept_rows.sort(key=lambda r: r["hours"], reverse=True)

    # Coverage heatmap: month (YYYY-MM) x day-of-week -> shift count.
    df = df.copy()
    df["month"] = df["date"].dt.strftime("%Y-%m")
    months = sorted(m for m in df["month"].dropna().unique())
    midx = {m: i for i, m in enumerate(months)}
    didx = {d: i for i, d in enumerate(DOW_ORDER)}
    counts = df.groupby(["month", "dow"]).size()
    heat = [
        [midx[m], didx[d], int(c)]
        for (m, d), c in counts.items()
        if m in midx and d in didx
    ]

    # Turnover: per week, how many employees first appear (started) and leave (left).
    # The data boundaries are censored: people already present in the opening week
    # are not real "starts" (we do not know their true start), and the final weeks
    # are not mass departures - a schedule that simply ends is not turnover. So a
    # departure only counts once we can confirm the person stayed gone (inactive,
    # i.e. last shift more than the active window before the period end).
    first_week = wk["week_start"].min()
    person_first_wk = df.groupby("name")["week_start"].min()
    person_last_wk = df.groupby("name")["week_start"].max()
    person_last_date = df.groupby("name")["date"].max()
    started = person_first_wk[person_first_wk != first_week].value_counts()
    inactive_names = person_last_date[(max_date - person_last_date).dt.days > ACTIVE_WINDOW_DAYS].index
    left = person_last_wk[person_last_wk.index.isin(inactive_names)].value_counts()
    turnover = [
        {
            "label": r["week"][:10],
            "started": int(started.get(r["week_start"], 0)),
            "left": int(left.get(r["week_start"], 0)),
        }
        for _, r in wk.iterrows()
    ]

    # Distinct staff per position - each person counted once, in the role they
    # worked the most hours in (so multi-position people are not double-counted).
    person_role = df.groupby(["name", "role"])["hours"].sum().reset_index()
    main = person_role.loc[person_role.groupby("name")["hours"].idxmax()]
    staffing = [
        {"role": role, "people": int(cnt), "group": meta["job_group"].get(role, "Other")}
        for role, cnt in main.groupby("role").size().sort_values(ascending=False).items()
    ]

    # Busiest day of week and month of year (shifts = staffing load).
    dow_counts = df["dow"].value_counts()
    by_dow = [{"day": d[:3], "shifts": int(dow_counts.get(d, 0))} for d in DOW_ORDER]
    moy = df["date"].dt.month.value_counts()
    by_month = [{"month": MONTHS[m - 1], "shifts": int(moy.get(m, 0))} for m in range(1, 13)]
    holidays = _holiday_rows(df)

    return {
        "totals": {
            "hours": num(total_hours),
            "shifts": total_shifts,
            "employees": int(df["name"].nunique()),
            "weeks": int(df["week"].nunique()),
            "active": active,
            "inactive": inactive,
            "transfers": transfers,
            "transfer_pct": num(transfers / total_shifts * 100, 1),
            "date_start": str(df["date"].min().date()),
            "date_end": str(max_date.date()),
            "avg_shifts_week": num(total_shifts / max(df["week"].nunique(), 1)),
        },
        "shift_mix": shift_counts(df),
        "weekly": weekly,
        "departments": dept_rows,
        "heatmap": {"months": months, "dow": DOW_ORDER, "data": heat},
        "turnover": turnover,
        "staffing": staffing,
        "total_staff": int(df["name"].nunique()),
        "by_dow": by_dow,
        "by_month": by_month,
        "holidays": holidays,
    }
