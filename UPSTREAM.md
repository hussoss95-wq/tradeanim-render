# Upstream provenance

This repository is an independent, maintained fork of **tradeanim**.

| | |
|---|---|
| Upstream project | [ufvg/tradeanim](https://github.com/ufvg/tradeanim) |
| Upstream license | MIT — Copyright (c) 2026 ufvg (see [`LICENSE`](LICENSE)) |
| Imported commit | `1f7836e` — "Update README to mention AI assistance" |
| Import method | `git merge --allow-unrelated-histories` (full upstream history is preserved in `git log`) |

The upstream `LICENSE` file is kept unmodified. Its copyright and permission
notice must remain included in all copies or substantial portions of this
software, per the MIT license terms.

## Syncing with upstream

```bash
git remote add upstream https://github.com/ufvg/tradeanim.git   # once
git fetch upstream
git merge upstream/main
```

## Local changes relative to upstream

Baseline import (no library behavior changes):

- `setup.py`: added `Pillow>=10.0` to `install_requires` (already listed in
  `requirements.txt` and imported by the renderer for post-processing).
- Added `tests/` smoke tests and the `Tests` GitHub Actions workflow.
- `Render Tradeanim Full HD` workflow now renders from this repository's own
  copy of the library instead of checking out `ufvg/tradeanim` on every run.

## Known upstream gaps (left as-is for now)

- The upstream README references `examples/basic_candles.py`,
  `examples/with_indicators.py`, `examples/ict_concepts.py` and
  `examples/manim_demo.py`, which are not present upstream. Only
  `examples/showcase.py` exists.
