"""
Load the raw schedule TSV and derive every field the analytics layer needs.

One row in the source equals one scheduled shift. This module parses the raw
columns once and attaches derived fields so the rest of the app never re-parses
strings. No emojis anywhere (see CLAUDE.md).
"""
from __future__ import annotations

import os
import re

import numpy as np
import pandas as pd

# Resolve the data file relative to the repository root regardless of cwd.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DATA_DIR = os.path.join(_ROOT, "schedule_data")

# foh_complete.tsv is the authoritative, complete front-of-house export (Dining
# Room, Bar, Guest Services, Catering-Banquets, Training). It is far more complete
# per-person than the older exports - e.g. it carries 110 shifts for a 2025-hire
# server the others only had a handful of - so it is read FIRST and its row wins
# when the same shift appears in more than one file. It is FOH-only, however
# (almost no Kitchen rows), so the older exports below are still merged in to keep
# the Back-of-House (Kitchen) shifts and the most recent weeks foh_complete lacks.
DATA_PATH = os.path.join(_DATA_DIR, "foh_complete.tsv")

# Additional shift files merged in, in priority order. schedule_clean/full carry
# the Kitchen/BOH shifts foh_complete omits; schedule_full also extends a few weeks
# later. Overlapping shifts are de-duplicated on a content key in build() (the raw
# Date string differs between exports - "Sat 4/12" vs "Saturday" - so it is
# excluded from the key).
EXTRA_PATHS = [
    os.path.join(_DATA_DIR, "foh_tail.tsv"),       # FOH weeks after foh_complete's cutoff
    os.path.join(_DATA_DIR, "schedule_clean.tsv"),
    os.path.join(_DATA_DIR, "schedule_full.tsv"),
]
# Note: my_shifts (1).tsv is intentionally NOT listed - every shift in it is already
# present in foh_complete/foh_tail, so it adds nothing after content de-duplication.

# Columns that identify a unique shift regardless of which export it came from.
# Excludes the free-text Date column, whose format varies between exports.
DEDUP_KEY = ["Name", "Start", "End", "ShiftJob", "Duration"]

RAW_COLUMNS = ["Week", "Name", "PrimaryJob", "Date", "Start", "End",
               "Range", "Duration", "Transfer", "ShiftJob", "Comments"]

# Department -> navigation group. Front of House, Back of House, Events, Other.
DEPT_GROUP = {
    "Dining Room": "FOH",
    "Bar": "FOH",
    "Guest Services": "FOH",
    "Kitchen": "BOH",
    "Catering-Banquets": "Events",
    "Training": "Other",
    "Administrative": "Other",
    "R & M Hourly": "Other",
}

# A few roles are coded into a department that misleads navigation (the wine
# cellar is coded as Kitchen, bar stockers appear only on transfers). These
# overrides keep the FOH/BOH grouping intuitive.
JOB_GROUP_OVERRIDE = {
    "Wine Sommelier": "FOH",
    "Wine Sommelier-Steward": "FOH",
    "Stocker - Bar": "FOH",
    "Office Coordinator": "Other",
    "Sales-Catering Assistant": "Events",
    "Intern": "Other",
}

# The actual role worked per shift is the ShiftJob leaf. A few leaves are payroll
# or synonym variants that should collapse into the core role; genuinely different
# work (Banquet, Bar Back, Captain) is kept as its own role. (Option A.)
ROLE_NORMALIZE = {
    "Server - Minimum Wage": "Server",
    "AM Busser": "Busser",
    "Hourly Training - FOH": "Hourly Training",
}

PM_CUTOFF_HOUR = 15  # shifts starting at or after 3:00 PM are PM shifts


def _duration_to_hours(value: str) -> float:
    """Convert a '[H:MM]' duration string to decimal hours."""
    m = re.match(r"^\[(\d+):(\d+)\]$", value.strip())
    if not m:
        return 0.0
    return int(m.group(1)) + int(m.group(2)) / 60.0


def build(path: str = DATA_PATH) -> tuple[pd.DataFrame, dict]:
    """
    Read the TSV and return (enriched DataFrame, meta dict).

    meta contains:
      job_group     : {role -> FOH/BOH/Events/Other}
      job_dept      : {role -> dominant department}
      name_to_id    : {name -> stable integer id}
      id_to_name    : {id -> name}
      max_date      : latest calendar date in the data (pandas Timestamp)
    """
    frames = [pd.read_csv(path, sep="\t", dtype=str)]
    for extra in EXTRA_PATHS:
        if os.path.exists(extra):
            frames.append(pd.read_csv(extra, sep="\t", dtype=str))
    df = pd.concat(frames, ignore_index=True).fillna("")
    # Drop shifts that appear in more than one export. Keying on content (not the
    # raw row) tolerates the differing Date-string formats between files; keep the
    # first occurrence so the authoritative foh_complete row wins.
    df = df.drop_duplicates(subset=DEDUP_KEY, keep="first").reset_index(drop=True)

    # Trim stray whitespace on the key text columns.
    for col in ["Week", "Name", "PrimaryJob", "Date", "Transfer", "ShiftJob"]:
        df[col] = df[col].str.strip()

    # Time fields.
    df["start_dt"] = pd.to_datetime(df["Start"], errors="coerce")
    df["end_dt"] = pd.to_datetime(df["End"], errors="coerce")
    df["date"] = df["start_dt"].dt.normalize()
    df["start_hour"] = df["start_dt"].dt.hour
    df["hours"] = df["Duration"].map(_duration_to_hours)

    # Week ordering key (week column is "YYYY-MM-DD_YYYY-MM-DD").
    df["week"] = df["Week"]
    df["week_start"] = pd.to_datetime(df["Week"].str.slice(0, 10), errors="coerce")

    # ShiftJob path: Org / Venue / Department / Job.
    parts = df["ShiftJob"].str.split("/", expand=True)
    for i in range(4):
        if i not in parts.columns:
            parts[i] = ""
    df["org"] = parts[0].fillna("").str.strip()
    df["venue"] = parts[1].fillna("").str.strip()
    df["department"] = parts[2].fillna("").str.strip()
    df["shift_job"] = parts[3].fillna("").str.strip()

    df["primary_job"] = df["PrimaryJob"]  # the person's title / current job
    # The role actually worked this shift = ShiftJob leaf (normalized). Job-type
    # analytics group on this, so hours land under the role worked - a server's
    # food-running hours count as Runner.
    df["role"] = df["shift_job"].where(df["shift_job"] != "", other=pd.NA)
    # A handful of rows have a blank ShiftJob. Do NOT fall back to the title (a
    # server-titled runner would be mislabeled): infer the person's dominant actual
    # role that month, then their overall dominant role, then the title as a last resort.
    blank = df["role"].isna()
    if blank.any():
        month = df["date"].dt.to_period("M")
        nb = df[df["role"].notna()]
        nb_month = month[df["role"].notna()]
        mode1 = lambda s: s.mode().iloc[0] if not s.mode().empty else None
        dom_nm = nb.groupby([nb["Name"], nb_month])["role"].agg(mode1)
        dom_n = nb.groupby("Name")["role"].agg(mode1)

        def _fill(r):
            v = dom_nm.get((r["Name"], r["_m"]))
            if v is None or (isinstance(v, float) and pd.isna(v)):
                v = dom_n.get(r["Name"])
            return v if v else r["primary_job"]

        df["_m"] = month
        df.loc[blank, "role"] = df.loc[blank].apply(_fill, axis=1)
        df.drop(columns=["_m"], inplace=True)
    df["role"] = df["role"].replace(ROLE_NORMALIZE)

    # Derive the day-of-week from the shift's actual start timestamp rather than the
    # raw Date column, whose format varies between exports ("Sat 4/12" vs "Saturday").
    df["dow"] = df["start_dt"].dt.day_name()
    df["is_weekend"] = df["dow"].isin(["Friday", "Saturday"])
    df["comments"] = df["Comments"].str.strip()
    df["transfer"] = df["Transfer"].eq("YES")  # raw flag, kept for reference

    # Shift classification.
    # A 167/event shift means the person worked a 167 Event. Signals:
    #  - the Catering-Banquets department (the events arm), OR
    #  - a comment tagging the shift as an event - schedulers write both "167" and
    #    "Events: ..." (upstairs, buyout, courtyard, boat, private event, offsite,
    #    PASE, etc.), so match "event" as well as the literal "167", OR
    #  - an offsite event venue.
    # The raw Transfer flag is NOT used - it also covers training and cross-department
    # coverage, which are not events.
    df["is_167"] = (
        df["department"].eq("Catering-Banquets")
        | df["comments"].str.contains("167|event", case=False, na=False, regex=True)
        | df["venue"].str.contains("Offsite", case=False, na=False)
    )
    # Training shifts (onboarding / shadowing / training-role) are their own category,
    # so they are not mistaken for events or counted as ordinary AM/PM service.
    df["is_training"] = (
        df["department"].eq("Training")
        | df["shift_job"].str.contains("Training", case=False, na=False)
    )
    # Priority: an event wins over training, training wins over plain AM/PM.
    pm = df["start_hour"] >= PM_CUTOFF_HOUR
    df["shift_type"] = np.select(
        [df["is_167"], df["is_training"], pm.fillna(False)],
        ["167", "Training", "PM"],
        default="AM",
    )

    # Dominant department per role (from non-event rows, fall back to all). Used to
    # place each role in a FOH/BOH/Events/Other navigation group.
    non_event = df[~df["is_167"]]
    job_dept: dict[str, str] = {}
    for role in df["role"].unique():
        sub = non_event[non_event["role"] == role]["department"]
        if sub.empty:
            sub = df[df["role"] == role]["department"]
        mode = sub.mode()
        job_dept[role] = mode.iat[0] if len(mode) else ""

    # Navigation group per role.
    job_group: dict[str, str] = {}
    for role, dept in job_dept.items():
        job_group[role] = JOB_GROUP_OVERRIDE.get(role, DEPT_GROUP.get(dept, "Other"))
    df["group"] = df["role"].map(job_group)

    # Stable integer ids per employee (sorted by name for determinism).
    names = sorted(df["Name"].unique())
    name_to_id = {n: i for i, n in enumerate(names)}
    id_to_name = {i: n for n, i in name_to_id.items()}
    df["name"] = df["Name"]
    df["pid"] = df["name"].map(name_to_id)

    meta = {
        "job_group": job_group,
        "job_dept": job_dept,
        "name_to_id": name_to_id,
        "id_to_name": id_to_name,
        "max_date": df["date"].max(),
    }
    return df, meta
