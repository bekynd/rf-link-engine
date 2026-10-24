# rf-link-engine

Propagation engine of the RF Link Planner: NTIA's Irregular Terrain Model (ITM, Longley-Rice) and
NTIA's implementation of ITU-R P.2108 compiled to one WebAssembly module, with a validating
wrapper, terrain profiles, the P.2108 terminal-clutter recipe, mode-dependent antenna angles, a
link budget, and the verification suite that checks the WebAssembly build against a native build.

Apache-2.0. Includes NTIA software (US public domain); see `NOTICE`.

## Verification

- **Native vs WebAssembly:** 4,040 deterministic cases (NTIA's vectors plus generated inputs across
  the valid, warning and error domains) run through a native g++ build and the WebAssembly build of
  the same sources. Basic transmission loss agrees within **1e-6 dB** (measured maximum 4e-13 dB),
  with identical return codes and warning flags. The WebAssembly module rebuilds byte-identically.
- **Unit tests** for each method below, including real terrain profiles between public places.

```sh
npm ci
npm test                        # vitest
sh native/build.sh              # inside emscripten/emsdk:4.0.10 (Docker)
node scripts/native-golden.ts   # regenerate native reference results
node scripts/t4-report.ts       # P.2108 combination reference report
```

## Methods

| Topic | Implementation |
|---|---|
| ITM | NTIA ITM `183ad95`, point-to-point, all outputs (loss, warnings, horizons, effective heights, Nₛ, mode) |
| Refractivity | Input N₀; Nₛ = N₀·exp(−h_sys/9460) with h_sys the mean of profile elevations excluding the first and last 10 % (as ITM computes it); the same effective curvature is used for geometry |
| Profiles | Distances strictly increasing; resampled to uniform spacing in NTIA's format; elevations only need be finite; the stored profile is exactly what ITM receives |
| Validity | NTIA's warning and error zones; paths under 1 km labeled extrapolated (no model switch); relative permittivity must be ≥ 2 (at exactly 1, ITM's ground-impedance check is a floating-point tie whose outcome differs between C libraries) |
| Variability | Broadcast mode by default; columns labeled by their exact percentages |
| Terminal clutter | ITU-R P.2108-1 §3.1 (NTIA v1.1): for suburban/urban/trees/dense-urban terminals below the representative height R, ITM runs at R and A_h is added; open/rural and water get no correction (an application choice, quantified in the T4 report) |
| Antenna angles | Direct terminal-to-terminal angle when the direct ray is geometrically clear; raw terrain horizon angle when obstructed. ITM's "line-of-sight" mode is not used for this: it means d < d_sML from effective heights and can hold on ridge-blocked paths |
| Link budget | Explicit power terms, ERP or power + gains (never both), feedline, components, polarization, body/enclosure losses skipped when the antenna gain includes them |
| Terrain | Terrarium tiles at z14, great-circle sampling with bilinear interpolation, dataset-boundary and implausible-step flags; missing data is an error, never a guess |
| Coverage | One profile per radial; ITM on each prefix of it, so every point equals the point-to-point result on the truncated profile; receiver clutter per point; pointing angles per point when a pattern needs them; resolution labels (2πR/N, step, terrain cell); a fast radial sampler (tiles fetched once, exact great-circle positions every 32 samples) |
| Robust point sets | Worst margin within a location-uncertainty radius (center plus rings); an unsupported sample makes the point unknown |
| Worker pool | Hard cancel (terminate and respawn) for long tasks, soft cancel (drop queued, let a short running task finish) for coverage radials |
| Inputs hash | One canonical inputs definition (sorted keys, ECMAScript number formatting, SHA-256) for cache keys and result ids, for links and for coverage maps |

Results are model predictions: unvalidated against field measurements unless a validation status
says otherwise.
