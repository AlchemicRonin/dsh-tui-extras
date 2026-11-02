#!/usr/bin/env python3
"""Apply versioned dsh-TUI file patches from this repository.

The installed dsh-TUI lives in a profile's node_modules and is replaced by
`dst update`. This script only applies a patchset whose version exactly matches
the installed package; a version mismatch is a hard refusal, never a guess.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_PROFILE = Path.home() / ".dsh" / "profiles" / "dsh-tui"


def tui_root(profile: Path) -> Path:
    return profile / "node_modules" / "@deepseek-harness-tui" / "dsh-tui"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def installed_version(root: Path) -> str:
    manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
    version = manifest.get("version")
    if not isinstance(version, str) or not version:
        raise ValueError("package.json has no version")
    return version


def files_for(version: str) -> dict[str, Path]:
    patch_root = REPO / "patches" / version
    result: dict[str, Path] = {}
    if not patch_root.is_dir():
        return result
    for target in sorted(patch_root.rglob("*.js")):
        relative = target.relative_to(patch_root).as_posix()
        result[f"lib/types/{relative}"] = target
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", type=Path, default=DEFAULT_PROFILE)
    parser.add_argument("--check", action="store_true", help="verify only; do not write")
    parser.add_argument("--list", action="store_true", help="list available patchsets")
    args = parser.parse_args()

    if args.list:
        for path in sorted((REPO / "patches").glob("*")):
            if path.is_dir():
                print(path.name)
        return 0

    root = tui_root(args.profile)
    try:
        version = installed_version(root)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"dsh-tui-extras: cannot read installed dsh-TUI: {exc}", file=sys.stderr)
        return 1

    patch_files = files_for(version)
    if not patch_files:
        print(
            f"dsh-tui-extras: no patchset for dsh-TUI {version}; "
            f"available: {', '.join(p.name for p in sorted((REPO / 'patches').iterdir()) if p.is_dir())}",
            file=sys.stderr,
        )
        return 2

    failed = False
    for relative, source in patch_files.items():
        target = root / relative
        if not target.is_file():
            print(f"dsh-tui-extras: missing target {relative}", file=sys.stderr)
            failed = True

    if failed:
        return 1

    if args.check:
        for relative, source in patch_files.items():
            target = root / relative
            state = "patched" if sha256(target) == sha256(source) else "differs"
            print(f"{relative}: {state}")
        return 0

    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup_root = Path.home() / ".dsh-tui" / "backups" / f"extras-{stamp}"
    for relative, source in patch_files.items():
        target = root / relative
        if sha256(target) == sha256(source):
            continue
        backup_root.mkdir(parents=True, exist_ok=True)
        backup = backup_root / relative
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, backup)
        fd, temporary = tempfile.mkstemp(prefix=target.name + ".", dir=target.parent)
        os.close(fd)
        try:
            shutil.copy2(source, temporary)
            os.replace(temporary, target)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
        print(f"dsh-tui-extras: applied {relative} (backup {backup})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
