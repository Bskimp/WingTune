# Test checklist — session 2026-05-17

Verify everything shipped from commit `fafbea6` (M6 SPA) onward.
That's the cutoff where remote browser tools became available
during the session; nothing before that needs a fresh check
(step-response math in `d6781fc` was visually verified live in
the experiment loop).

**Setup**

```
git pull            # ensure local is at or past e8f6f0a
npm install         # picks up @tauri-apps/api + plugin-dialog + plugin-fs
npm run dev         # web dev server at http://localhost:5174
```

Test logs used in the boxes below:
- `LOG00113.BFL` — 3.43 MB, BF 4.6+ wing, axisS present, no GPS lock, no DEBUG_*
- `btfl_002.bbl` — has GPS lock entire flight, no DEBUG_* modes

---

## `fafbea6` — M6 SPA effectiveness

- [ ] Load any log → tab bar shows **SPA** between Airspeed and Spectrum
- [ ] Click SPA tab on `LOG00113` (no DEBUG_SPA) → pending message reads roughly: *"set `debug_mode = SPA` in BF to log per-axis SPA multiplier"*
- [ ] R / P / Y chip selector renders, click each — pending message unchanged (no SPA data on any axis)
- [ ] No crash, no Vue errors in browser console
- [ ] Recommend tab does NOT show a stray SPA rec on this log (no SPA data → recommender skips)

**Failure mode:** if SPA tab is missing entirely, the tab bar wiring broke. If clicking the tab shows a blank chart instead of the pending message, the `checkSpaEffectiveness` predicate path isn't routing the moduleState through. Either is straightforward to fix; flag the commit and the symptom.

**Cannot fully validate without:** a DEBUG_SPA wing flight (held in flight-data queue).

---

## `f53b85e` — M7 S-term TPA viz

- [ ] Tab bar shows **S-Term** between SPA and Spectrum
- [ ] Click S-Term on `LOG00113` → pending message references `debug_mode = S_TERM` or `axisS[i]` missing depending on which signal failed to resolve first
- [ ] R / P / Y chip selector works
- [ ] No console errors

**Failure mode:** S-Term tab also depends on `axisS[i]` from main frame; if you see "USE_WING firmware build required" that's the post-TPA branch failing, not the pre-TPA debug branch — different fix.

**Cannot fully validate without:** a DEBUG_S_TERM wing flight.

---

## `ed9acb1` — Estimated scan-progress bar

- [ ] Refresh entry page → file drop zone shows EMPTY state
- [ ] Drag `LOG00113` onto the drop zone
- [ ] During decode (very brief on a 3 MB log), the bar shows:
  - [ ] A **percentage** in the top-right (not just "…size MB")
  - [ ] A **determinate bar that fills left-to-right**, not the indeterminate diagonal-stripe animation
  - [ ] Copy reads: *"Decoding · estimated progress (real % needs Rust callback wiring)"*
- [ ] After decode: page transitions to the analysis view normally

**Note:** on small logs the bar may finish faster than you can read it. To slow it down for verification, use a larger log (10 MB+) or temporarily change `SCAN_BYTES_PER_MS = 5_120` to `512` in `src/stores/log.ts` (10× slower estimate; revert after).

**Failure mode:** if you still see diagonal stripes, the FileDropZone template didn't pick up — hard refresh (Ctrl+Shift+R). If the bar jumps straight to 100%, the animation loop never ran — check requestAnimationFrame is firing (browser console).

---

## `0d07207` — Tauri shell native file open

The only commit that **requires `tauri:dev`** to verify — the web build skips the Tauri-only button.

```
npm run tauri:dev
```

First run will compile the new Rust plugin deps (tauri-plugin-dialog + tauri-plugin-fs). Budget 3-5 minutes on a clean target. Subsequent runs are fast.

- [ ] Tauri desktop window opens
- [ ] Entry page EMPTY state shows TWO buttons now: **Select file** + **Open file…**
- [ ] The web build (`npm run dev` in browser) shows **Select file** + the disabled **Sample log** placeholder — i.e. NO "Open file…" button. (Sanity check that `isTauri()` is correctly false in the browser.)
- [ ] Click **Open file…** → native OS file dialog opens, filtered to `.bbl / .BBL / .bfl / .BFL / .txt`
- [ ] Pick a real log → loads identically to drag-and-drop, scan-progress bar runs, analysis view appears

**Failure modes:**
- Compile error during `tauri:dev`: probably a plugin registration mismatch in `src-tauri/src/lib.rs` or a missing capability in `src-tauri/capabilities/default.json`. Read the cargo error verbatim.
- Dialog opens but file read fails: capability scope is wrong; the path didn't match `**/*.bbl` etc. (Tauri 2.x glob behaviour). Check the FS permission allow list.
- Button shows in the BROWSER build (not just Tauri): `isTauri()` is returning true where it shouldn't — verify the `__TAURI_INTERNALS__` global isn't somehow present in vanilla Chromium.
- Dialog reports access denied: Windows may need the binary to be in a trusted location; try running from a non-Downloads folder.

---

## `1d30234` — Airspeed predicate split + latent rec-bug fix

- [ ] Load `LOG00113` (no GPS lock, no DEBUG_TPA)
- [ ] Open Summary tab, scroll to ReadinessCard
- [ ] Where there used to be **one row** "Airspeed auto-tune", there should now be **two rows**:
  - [ ] **Airspeed BASIC fit** — state `blocked` (no GPS frames in this log)
  - [ ] **DEBUG_TPA cross-check** — state `blocked` (`set debug_mode = TPA`...)
- [ ] Load `btfl_002` (GPS lock present, no DEBUG_TPA):
  - [ ] **Airspeed BASIC fit** — state `available` (or `inactive` if GPS_speed all-zero — check)
  - [ ] **DEBUG_TPA cross-check** — state `blocked` (`set debug_mode = TPA`...)
- [ ] Recommend tab on either log should show **at most ONE** "Enable TPA debug logging" rec (not duplicated from the old WING_SETPOINT spec which was stale)

**Failure mode:** if the readiness card still shows one row, TS picked up the new ModuleReport type but the template wasn't rebuilt — hard refresh. If the rec fires for `btfl_002` but the message references GPS, the bug-fix patch didn't land — check `debugMode.ts` for `tpaCrossCheck.state === 'blocked'` (correct) vs `airspeedAutoTune.state === 'blocked'` (the bug).

---

## `fd88a59` — LRU field-cache eviction

Internal infrastructure, no UI surface. Hard to verify visually unless you go out of your way to trigger it.

- [ ] Smoke test: load `btfl_002`, click through every tab (Summary, Tracking, Servos, Airspeed, TPA, SPA, S-Term, Spectrum, Step). Each tab hydrates its own fields. No crash, no console errors.
- [ ] (Optional) DevTools → Memory snapshot → search for `Float32Array` entries; total bytes should not grow unbounded if you click tabs repeatedly (rough check; the cap is 256 MB which is way over what a typical log can fill on its own, so eviction will likely not trigger on small logs anyway).
- [ ] (Optional, paranoid) Open `src/stores/log.ts`, temporarily reduce `DEFAULT_FIELD_CACHE_BYTES` to e.g. `2 * 1024 * 1024` (2 MB). Reload, hydrate fields by clicking tabs. Watch console — fields should be evicted from `fields` map after the cap is exceeded, but Recommend tab still works (pinned fields stay). Revert after.

**Failure mode:** the eviction runs but evicts a pinned field → Recommend tab goes blank because a recommender's required field disappeared. Check `pinnedFields.has(name)` skip in `maybeEvict()`.

---

## `1cd3aaa` — M5 HYPERBOLIC TPA curve fitter

- [ ] Tab bar shows **TPA** between Airspeed and SPA
- [ ] Click TPA on `LOG00113` or `btfl_002` (no DEBUG_TPA) → pending message: *"set `debug_mode = TPA` in BF to log `tpa_arg` + `tpa_factor`"* (or similar)
- [ ] Header stats area is empty (no RMS, no params)
- [ ] No crash

**Cannot fully validate without:** a DEBUG_TPA wing flight. When you have one:
- [ ] TPA tab shows a scatter of blue points (measured) + green curve (fitted)
- [ ] Header surfaces: RMS, pidThr0/pidThr100, expo, sample count, x range
- [ ] Recommend tab shows a "BF HYPERBOLIC TPA curve fit" rec with `set tpa_curve_*` CLI lines
- [ ] **Verify `tpa_factor` is DEBUG_TPA channel 2** — if the fit produces nonsense (RMS huge, curve doesn't track scatter), `tpa_factor` is on a different channel. Edit `src/lib/signalRegistry.ts` `tpa_factor.sources` to the correct channel.

---

## `bd822ba` — Generic Nelder-Mead refactor

No visual change. The Airspeed tab's BASIC fit should still recover sensible params on a real GPS+TPA flight (cannot verify without that flight). For now:

- [ ] Run `npm run test:unit -- --run airspeedFit` — all 15 tests pass
- [ ] Run `npm run test:unit -- --run tpaCurveFit` — all 9 tests pass

If those pass, the shared optimiser is fine.

---

## Cross-cutting smoke tests

After all the above, one final pass:

- [ ] Recommend tab on `btfl_002`: count the rec cards. Before this session it was around 5-6; should now be slightly more (M5 + M6 + airspeed-fixed rec wouldn't fire on this log but the SPA/S-term recs wouldn't fire either since there's no debug data). Hard to predict exact number — just confirm no duplicate recs and the cards render correctly.
- [ ] Click each rec card open/closed — detail body renders, CLI lines are copyable, evidence chips pin the cursor.
- [ ] Run `npm run test:unit` (no filter) — full suite should pass.
- [ ] Run `npx vue-tsc --noEmit` — zero type errors.

---

## What stays held

Even after this checklist, these wait on real flights (not code):
- M3 + M5 + DEBUG_TPA cross-check end-to-end validation
- M6 visual validation on DEBUG_SPA flight
- M7 visual validation on DEBUG_S_TERM flight
- M4 raw-gyro overlay on DEBUG_GYRO_RAW flight
- Step-response amplitude calibration vs PIDscope (held on PIDscope's log loader)

BF logs one debug mode per flight, so these are four separate sorties.
