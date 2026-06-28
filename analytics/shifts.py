"""Shared analytics helpers: shift constants, streak math, JSON-safe casting."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

SHIFT_TYPES = ["AM", "PM", "167", "Training"]
DOW_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
ACTIVE_WINDOW_DAYS = 30  # worked within this many days of the latest date == active
# A 167/event counts as "served" only when worked in a server role - banquet serving
# is event work, food-running an event is not. Applied identically to every server.
SRV_EVENT_ROLES = {"Server", "Server- Banquet"}


def num(value, digits: int = 0):
    """Cast a numpy/pandas scalar to a JSON-safe native number."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return 0
    if isinstance(value, (np.integer,)):
        value = int(value)
    elif isinstance(value, (np.floating,)):
        value = float(value)
    if isinstance(value, float):
        value = round(value, digits)
        if digits == 0:
            return int(value)
    return value


def iso(ts) -> str | None:
    """Timestamp -> 'YYYY-MM-DD' or None."""
    if ts is None or pd.isna(ts):
        return None
    return pd.Timestamp(ts).strftime("%Y-%m-%d")


def initials(name: str) -> str:
    """'Reyes, Andre M' -> 'AR' (first name initial + last name initial)."""
    try:
        last, rest = name.split(",", 1)
        first = rest.strip().split(" ")[0]
        return (first[:1] + last.strip()[:1]).upper()
    except Exception:
        return name[:2].upper()


def compute_streaks(dates) -> dict:
    """
    Given an iterable of worked calendar dates, return the longest run of
    consecutive worked days and the longest stretch off (a gap between two
    worked days), with the off-window start/end.
    """
    days = sorted({pd.Timestamp(d).normalize() for d in dates if not pd.isna(d)})
    if not days:
        return {"worked": 0, "off": 0, "off_start": None, "off_end": None}

    longest_worked = cur = 1
    longest_off = 0
    off_start = off_end = None
    for i in range(1, len(days)):
        gap = (days[i] - days[i - 1]).days
        if gap == 1:
            cur += 1
            longest_worked = max(longest_worked, cur)
        else:
            cur = 1
            off = gap - 1
            if off > longest_off:
                longest_off = off
                off_start = days[i - 1] + pd.Timedelta(days=1)
                off_end = days[i] - pd.Timedelta(days=1)
    return {
        "worked": int(longest_worked),
        "off": int(longest_off),
        "off_start": iso(off_start),
        "off_end": iso(off_end),
    }


def shift_counts(frame) -> dict:
    """Count AM / PM / 167 rows in a frame."""
    vc = frame["shift_type"].value_counts()
    return {t: int(vc.get(t, 0)) for t in SHIFT_TYPES}
