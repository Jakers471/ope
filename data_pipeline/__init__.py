"""Data pipeline: load and normalize the raw schedule TSV into an enriched table."""
from .loader import build, DATA_PATH

__all__ = ["build", "DATA_PATH"]
