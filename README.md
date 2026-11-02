# dsh-tui-extras

Versioned local UI patches for [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI).

These are not upstream changes and not a plugin. They cover presentation details
that the current plugin seams do not expose yet:

- hide the running `esc to interrupt` and `ctrl+q to fold` hints
- give assistant prose a theme-controlled color
- tint the Goal/Todo surface very lightly
- show Todo/Goal/background-job progress in the built-in panel

## Safety model

- Patches are grouped by the exact installed dsh-TUI version.
- A version with no matching patchset is refused; files are never applied from
  a different version.
- The launcher calls the script before starting dst; failures are logged to
  `~/.dsh-tui/patch.log`.
- Every overwritten file is backed up under `~/.dsh-tui/backups/extras-*`.

## Usage

```bash
python3 scripts/apply.py --list
python3 scripts/apply.py --check
python3 scripts/apply.py
```

The local profile defaults to `~/.dsh/profiles/dsh-tui`; use `--profile` for a
different profile.

## Updating dsh-TUI

```bash
dst update
python3 scripts/apply.py --check
```

If the version has no patchset, `--check` reports the installed version and
refuses to write. Rebase the changed files against the new upstream package
before adding a new `patches/<version>/` directory.

## Relationship to the plugin

The searchable progress panel is published separately as
[dsh-tui-progress](https://github.com/AlchemicRonin/dsh-tui-progress). It uses
`ctx.tuiPanels` and needs no patchset. This repository only contains changes
that the plugin API cannot express.

## License

MIT
