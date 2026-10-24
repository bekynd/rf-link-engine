# Modified copy of NTIA ITM

This directory contains software developed by employees of the National Telecommunications and
Information Administration (NTIA), Institute for Telecommunication Sciences (ITS): the Irregular
Terrain Model, https://github.com/NTIA/itm, commit `183ad95bd813a8be11009df396e1c631356864b2`
(2024-09-24; release v1.4 plus const-correctness commits). See `LICENSE.md` (NTIA software
disclaimer / release).

**This copy has been modified.** Per NTIA's release, the changes are:

| Date | Files | Change |
|---|---|---|
| 2026-10-24 | `src/*.cpp` | `#include "..\include\X.h"` changed to `#include "../include/X.h"` (portable paths) |
| 2026-10-24 | `include/itm.h` | `DLLEXPORT` defined as `extern "C"` without `__declspec(dllexport)` when `_WIN32` is not defined |

No change affects any computation. The edits are applied by `scripts/patch-ntia-itm.py`.
