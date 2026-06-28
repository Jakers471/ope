"""
Analytics facade. Loads the data once and exposes cached metric methods,
each scoped to an optional [start, end] calendar-date window.

Scoping is global: when a window is given, every metric, roster, person, and
the job list itself are recomputed from only the shifts inside that window.
A job or employee with no shifts in the window simply does not appear.
"""
from __future__ import annotations

import pandas as pd

from data_pipeline import build

from .jobs import build_job_detail, build_job_dynamics, build_jobs
from .overview import build_overview
from .people import build_people, build_person
from .seniority import build_seniority
from .pay import build_pay
from . import trajectory as traj


class Analytics:
    def __init__(self):
        self.df, self.meta = build()
        self.global_min = self.df["date"].min()
        self.global_max = self.df["date"].max()
        self._cache: dict[tuple, object] = {}

    # ---- scoping -------------------------------------------------------
    def bounds(self) -> dict:
        return {
            "date_start": str(self.global_min.date()),
            "date_end": str(self.global_max.date()),
        }

    def _scoped(self, start, end):
        df = self.df
        if start:
            df = df[df["date"] >= pd.Timestamp(start)]
        if end:
            df = df[df["date"] <= pd.Timestamp(end)]
        meta = dict(self.meta)
        if not df.empty:
            meta["max_date"] = df["date"].max()
        return df, meta

    def _get(self, kind, start, end, builder, extra=None):
        key = (kind, start, end, extra)
        if key not in self._cache:
            df, meta = self._scoped(start, end)
            self._cache[key] = builder(df, meta)
        return self._cache[key]

    # ---- public metrics ------------------------------------------------
    def overview(self, start=None, end=None):
        return self._get("ov", start, end, build_overview)

    def jobs(self, start=None, end=None):
        return self._get("jobs", start, end, build_jobs)

    def job_detail(self, job, start=None, end=None):
        return self._get("job", start, end, lambda df, m: build_job_detail(df, m, job), extra=job)

    def job_dynamics(self, job, start=None, end=None):
        return self._get("jobdyn", start, end, lambda df, m: build_job_dynamics(df, m, job), extra=job)

    def people(self, start=None, end=None):
        return self._get("people", start, end, build_people)

    def person(self, pid, start=None, end=None):
        return self._get("person", start, end, lambda df, m: build_person(df, m, pid), extra=pid)

    def seniority(self, start=None, end=None):
        # Seniority is inherently an all-time concept: a windowed filter would cap
        # tenure at the window length and collapse veterans onto new servers. So this
        # tab always uses full history; recency is controlled by the metric chips.
        return self._get("seniority", None, None, build_seniority)

    def pay(self):
        # Personal timecard - its own file, independent of the schedule date filter.
        if "pay" not in self._cache:
            self._cache["pay"] = build_pay()
        return self._cache["pay"]

    def _traj_matrix(self, scope, start, end):
        mkey = ("trajmatrix", start, end, scope)
        if mkey not in self._cache:
            df, meta = self._scoped(start, end)
            self._cache[mkey] = traj.build_matrix(df, meta, scope)
        return self._cache[mkey]

    def trajectory(self, pid, scope="srv", start=None, end=None):
        # Always all-time (matches the Seniority tab). The heavy per-window cohort
        # matrix is built once per scope; extracting one person from it is instant.
        return traj.extract(self._traj_matrix(scope, None, None), self.meta, pid)

    def favorability_grid(self, scope="srv", start=None, end=None):
        gkey = ("favgrid", None, None, scope)
        if gkey not in self._cache:
            self._cache[gkey] = traj.build_grid(self._traj_matrix(scope, None, None), self.meta)
        return self._cache[gkey]
