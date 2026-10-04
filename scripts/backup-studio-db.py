#!/usr/bin/env python3
"""Create a consistent SQLite backup while the Studio API is running."""

from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def backup(source: Path, destination: Path, keep: int) -> Path:
    if not source.is_file():
        raise SystemExit(f"database not found: {source}")
    destination.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = destination / f"studio-{stamp}.db"
    with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
        src.backup(dst)
        if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            target.unlink(missing_ok=True)
            raise SystemExit("backup integrity check failed")
    backups = sorted(destination.glob("studio-*.db"), key=lambda path: path.stat().st_mtime, reverse=True)
    for old in backups[max(1, keep):]:
        old.unlink()
    return target


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("workspace/studio.db"))
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--keep", type=int, default=14)
    args = parser.parse_args()
    if args.keep < 1:
        raise SystemExit("--keep must be at least 1")
    print(backup(args.source.resolve(), args.destination.resolve(), args.keep))


if __name__ == "__main__":
    main()
