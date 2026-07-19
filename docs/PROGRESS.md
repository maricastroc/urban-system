# Urban Flow — Progress

Built incrementally in small, tested steps ("Etapas"). See `DESIGN.md` for the architecture.
Status: **17 etapas done, 105 vitest tests passing, typecheck + lint clean.**

## Done

| Etapa | What it delivered |
|---|---|
| 1 — Foundation | Pure engine skeleton: `LaneGraph`, Agent SoA + free-list, per-lane ordered list (`laneList`), `World`, empty `tick`. Plain-data + free-functions. |
| 2 — IDM | Car-following: `idmAcceleration` (pure) + stable ballistic `integrate` (no reversing, no overlap). FASE 1/2 wired. |
| 3 — First render | Canvas 2D: geometry + renderer + scene, `SimulationCanvas` with a fixed-step accumulator loop + interpolation. Tailwind controls (play/speed/demand). |
| 4 — Spawn/despawn | FASE 0/3: demand-driven Bernoulli spawn (seeded mulberry32 RNG) + despawn at trip end with travel-time metrics. |
| 5 — Intersection | Priority crossing: `mustYield` (strict-priority gap acceptance) + `moveToLane`. Render: give-way crossing scene. |
| 6 — Routing | `computeRoute` (Dijkstra + binary min-heap), per-OD routes in `routeBuffer`, route-aware `nextConnection`. Render: routing fork scene. |
| 7 — Network | `buildGrid` procedural one-way Manhattan grid; combines routing + give-way across multiple junctions. Validated by a 1500-tick no-overlap test on the generated grid. |
| 8 — Scenario control | Live experimentation overlay (`control.ts` §16): close/reopen roads (reroute new traffic), incidents (mid-lane block), per-entry demand + destinations, priority flips, traffic signals (2-phase, FASE S), and an A/B throughput compare. Interactive canvas (click a road/entry/junction → contextual inspector) with closed/incident/signal/priority overlays. Grid now emits `Junction`s + node ids. +7 engine tests. |
| 9 — Experience redesign | "Mission-control" UI (§17): map-hero full-bleed layout, live top-bar HUD (tweened numerals), a guided coach (baseline → disrupt → compare), a progressive inspector (empty legend → road → junction with live stats), an A/B panel reframed as before → after → impact with semantic deltas, floating instrument dock, and a depth-cued canvas (cased roads, live congestion tint, animated selection). Design tokens + motion in `globals.css`. No engine/API change. |
| 10 — Living mesh | Canvas-only pass (§18): one thermal colour language across cars/roads/junctions/flow, an always-on downstream flow field (direction without cars), roads that light + halo with congestion, junction nodes that breathe with activity and warm with queues, car motion trails, a spotlight focus mode (dims the rest, keeps the target + its topology lit), and a 5×5 mesh. Pure `renderer.ts` (+ `GRID`); no engine/data/interaction change, 51 tests untouched. |
| 11 — Controlled A/B + fast-forward | The A/B panel became a **controlled experiment** (`runExperiment`, §19): baseline vs. the staged intervention, both run headless on two freshly-seeded worlds for the same duration, so the delta is the intervention's effect — not time or noise. Deterministic and tested. A headless **fast-forward** (+60s) skips the wait for the network to fill. Also split the 1072-line `SimulationCanvas.tsx` into `components/sim/*` and extracted `render/thermal.ts`. +3 tests. |
| 12 — Metrics time-series | A rolling **sparkline** on the two dynamic HUD vitals (§20): Flow /min (accent, auto-scaled) and km/h (green, scaled to free-flow) each carry a 60s live trace, newest pinned right. Pure geometry (`render/sparkline.ts`: ring buffer + SVG path strings) with an imperative shell (`components/sim/Sparkline.tsx`) fed once per sim-second from the RAF loop — no React re-render, consistent window at any speed. Cars/Trips stay counters. Presentation-only; +9 tests. |
| 13 — Experiment presets | One-click **scenario presets** (§21): *Rush hour* (flood every entry), *Close the artery* (shut the central road → new traffic reroutes), *Signalize the centre* (lights on the middle junction). Each stages a **fresh same-seed network** — its demand + its one intervention — ready to watch live or run the A/B on. Deterministic central-junction pick from grid geometry (`render/presets.ts`, unit-tested & idempotent). Also gave the HUD header room to breathe now that the sparklines sit under the numerals. Presentation-only; +6 tests. |
| 14 — Trace a car's route | Click a car → its **Dijkstra route** lights up across the grid (§22): remaining path in accent with dashes flowing to a pulsing destination marker, covered path faint, the rest of the network dimmed (reusing the spotlight), and an accent halo on the car. A **Vehicle inspector** shows destination, live speed, and route progress. Robust car identity across free-list slot reuse via an `enterTime` key. Pure route/progress helpers (`render/carTrace.ts`); presentation-only; +3 tests. |
| 15 — Experiment optimizer | The determinism payoff at scale (§23): an **auto-optimizer** that sweeps every single-junction intervention (signalize / flip priority) as a controlled experiment against one shared baseline — same seed, same demand, headless — and ranks them by throughput. A chunked driver keeps the ~50-run search responsive with live progress; the **leaderboard** is clickable → stages the winning fix on the live network (junction selected + spotlit) so you confirm it with the full A/B. Turns the sandbox into a **decision engine**. Pure sweep (`render/optimize.ts`); also fixed `scenarioChanged` to count priority flips (so staged/optimizer flips enable the A/B). +4 tests. |
| 16 — Shareable URL | Hand a specific run to anyone (§24): a **copy-link control** in the dock serializes the whole experimentation overlay — per-entry demand + destinations, closures, incidents, priority flips, signals — into a compact, URL-safe string; opening that link **rebuilds the exact scene**. Pure `render/shareLink.ts` (`encode`/`decode`/`apply`) serializes *semantically* against the fixed seed + grid (stable lane/junction ids) and replays the same `scene.ts` helpers the UI uses, so a link is byte-identical to a hand-built scene. Loaded via the server component's `searchParams` → a prop → the scene initializer, so SSR and the first client render agree (no hydration flash, no setState-in-effect); malformed links fall back to the default. Closes the experimentation arc. +9 tests. |
| — Scale groundwork | Measure-first before the scale leap. Parameterized `createScene(rate, {grid, capacity})` (byte-identical defaults → determinism + all tests intact), a headless sim-compute benchmark (`npm run bench`, `render/bench.ts`, excluded from `npm test`), and a dev perf overlay (`?debug` → live tick-ms vs draw-ms) + scale override (`?grid=N&cap=M`, SSR-passed through `page.tsx`). **Finding:** compute is *not* the wall (~0.13ms/tick at 782 agents ≈ 1500× under the 200ms budget); the single-lane model caps the moving population in the mid-hundreds regardless of capacity, and the Canvas2D render is the first wall (~7ms/frame at 1500 congested cars, super-linear via the congestion `shadowBlur`). So the model (this Etapa's green wave, then multi-lane) gates the scale story; the Worker is architectural, not a perf fix. |
| 17 — Green-wave | The first richer-model lever (§25) and first engine-logic change since Etapa 8. Baseline is pure give-way, so a green wave **signalizes a whole one-way arterial and staggers its phases** by travel time — a platoon rides a wave of greens. One engine change: `createSignal(…, offset)` seeds a controller into its cycle (bit-for-bit deterministic; `offset=0` unchanged). `buildGrid` emits `corridors` (rows/cols, ordered in travel direction); `greenWave(scene, i)` derives offsets from geometry. Wired into the **whole decision frame**: an optimizer `greenwave` candidate per corridor, corridor-level A/B capture/apply (so the offsets reproduce), `scenarioSignature`/share-link `w` field, and a **"Green-wave the artery"** preset. Verified live: A/B **+4% trips / +66% mean speed** vs. priority at 1.2 cars/s. +13 tests. |

## Key decisions (rationale)

- **Plain data + free functions** (no classes) → worker/WASM-transferable state later.
- **`agents.a` doubles as the FASE1→FASE2 handoff** (no extra buffer); FASE 2 integrates front→back
  so the overlap guard sees updated leaders.
- **Point junctions (`conn.length = 0`)** — crossing is instantaneous, so conflicts are pure timing;
  keeps the downstream-gap and on-lane-gap arithmetic consistent (no overlap on entry).
- **Over-declared per-node conflicts** in the grid — conservative but provably collision-free;
  covers crossings AND merges without a geometric conflict matrix. Distinct ranks per node ⇒ no
  deadlock at a junction.
- **Routes per-OD, not per-car** (shared `routeBuffer`, agents index a slice).
- **Dijkstra (A* with h=0)** — correct shortest path without node coordinates in the pure engine.
- **`nextConnection` falls back to single-exit** when a car has no route, so hand-placed test cars
  and single-exit scenes work without routing.
- **Scenario Control is a flat overlay, not a graph rebuild** (§16) — closures/incidents/priority/
  signals are typed arrays keyed by lane or connection on the `World`, defaulting to a no-op, so the
  static graph stays immutable and every pre-Etapa-8 test passes unchanged.
- **Closures reroute new traffic, in-flight cars queue** — routes are per-OD and `routeBuffer` is
  append-only, so recompute re-points sources at fresh slices while live cars keep valid old ones.
- **Signals replace priority per-junction and skip the yield check when green** — safe because each
  signalized junction is a conflict-free 2-phase H/V controller; no amber needed with point junctions.
- **One shared camera** (`geometry.ts`) for render (world→screen) and click hit-testing
  (screen→world), so the two projections can never drift.
- **The redesign (Etapa 9) is presentation-only** — no engine/render-data or API change. It reads
  the same `World`/`Scene` and calls the same scene helpers; all 51 tests passed untouched. Live
  numerals update imperatively (refs, tweened) to avoid 60fps React renders; discrete UI stays in
  state. The design system (tokens, motion, instrument slider) lives in `globals.css`.
- **One thermal colour language (Etapa 10)** unifies cars/roads/junctions/flow (cool = flowing, hot =
  suffering), so the mesh is read as a heat map with no numbers. The flow field animates off the
  wall-clock `now`, so it lives even when the sim is paused/throttled. Focus mode dims to context
  rather than drawing a border. All canvas — no engine/data/interaction change.
- **Three legible layers, ranked by luminance (Etapa 10 refinement)** — sharing the thermal palette
  made cars vanish into the road glow. Fix without losing elegance: congestion is carried by road
  *hue* (bloom cut), the flow field is a faint streak (never a dot), and each car is lifted to a top
  luminance tier — a near-white-nosed capsule dark-separated from the road, so agents stay pickable
  over any background at 20+ cars without being enlarged.
- **Controlled A/B is the payoff of determinism (Etapa 11)** — `runExperiment` builds two fresh,
  same-seed worlds, applies the demand config to both but the intervention only to B, and ticks each
  headlessly for the same number of ticks. The delta is attributable to the change alone (not elapsed
  time or noise). Pure and headless, so it's unit-testable *and* it runs even when the live RAF loop
  is throttled. The `pushBack` fix in `laneList.ts` must stay — see the note there.
- **Sparkline = pure geometry + imperative shell (Etapa 12)** — the same split as the live numerals.
  `render/sparkline.ts` is DOM-free (ring buffer + SVG path strings), so the hard part (normalization,
  clamping, right-pinning the newest sample) unit-tests in Node; the component only writes those strings
  to the SVG. Sampling is keyed on **sim-time** (one sample per `SAMPLE_DT`), not wall-clock, so the 60s
  window holds at any playback speed and freezes when paused. Fed from the RAF loop via a `push` handle,
  so the trace never triggers a React render — matching the HUD-numeral discipline.
- **Presets stage a fresh scene, not a diff (Etapa 13)** — each preset rebuilds the world at its demand
  and re-applies only its own intervention, so scenarios never stack and are reproducible (idempotent,
  unit-tested). The central junction/artery is derived from grid geometry (nearest the centroid), so it
  stays stable without hard-coding lane/node indices. They feed the same controlled A/B (§19): one click
  to a runnable experiment. Demand-only presets (rush hour) leave the A/B disabled — nothing to compare.
- **Car identity needs a key, not just a slot (Etapa 14)** — agent ids are recycled by the free-list, so
  a bare id would silently re-target the route trace when a despawn+respawn reuses the slot. Pinning the
  selection to `(id, enterTime)` (the spawn stamp) fixes it: the trace clears the instant *its* car
  arrives, even if a new car lands in the same slot the next tick. The route itself is read straight from
  the agent's `routeBuffer` slice — no recompute, and the traversed/remaining split is just `routeIdx`.
- **The optimizer is one shared baseline, not N A/Bs (Etapa 15)** — `runExperiment` recomputes its
  baseline each call; the sweep computes the demand-only baseline **once** and measures every candidate
  against it, so ~50 candidates cost ~51 headless runs, not ~100. It runs chunked over `setTimeout`
  (2 candidates/slice) so a background tab still finishes and the UI shows live progress. Candidates are
  demand-only + one intervention on a fresh same-seed world — the §19 controlled discipline, at scale.
- **Shareable link = semantic replay, not a state dump (Etapa 16)** — because `createScene` bakes a
  constant seed + grid, lane/junction ids are stable, so the URL serializes the overlay **semantically**
  (which lanes/junctions, not raw typed arrays) and rebuilds it by replaying the same `scene.ts` helpers
  the UI calls. That keeps the payload tiny, uses only RFC-3986 unreserved chars (no percent-encoding),
  and is byte-identical to a hand-built scene — verified by `scenarioSignature` round-trips. The scene
  loads through the server component's `searchParams` → a prop → the `useState` initializer (**not** an
  effect), so the server-rendered HTML and the first client render agree: no hydration flash and no
  setState-in-effect. Anything malformed decodes to `null` → the default scene, so a stale or hand-edited
  link can never crash or index out of the grid (all ids are bounds-checked on apply).
- **Two clarity refinements after Etapa 16 (presentation-only)** — (1) the HUD's instantaneous km/h
  and the A/B panel's run-average km/h read as a contradiction, so a green **Live** tag now frames the
  whole top HUD and the A/B secondary metrics carry an **"Averaged over N min"** label — same unit, two
  clearly different measures. (2) The right-rail trio (Presets → A/B → Optimizer) is a sequence, so a
  numbered **stepper spine** (`WorkflowStep` in `sim/ui.tsx` — a node per card on a continuous left
  thread) makes it read top-to-bottom instead of as three loose cards. No engine/render-data change.
- **Mobile responsiveness + junction hit-test (presentation/interaction only)** — (1) the locked
  `h-dvh` shell fought small screens (the map's `flex-1` collapsed and the dock overlapped the header),
  so the layout is now `h-dvh` **only at `lg`**; below that it flows as a normal scrolling document
  (fixed `56dvh` map, panels stacked, rail scroll `lg:`-only), the HUD sheds stats by breakpoint, and
  the dock wraps to two rows. (2) Hit-testing picked cars before junctions unconditionally, so a car
  crossing a node stole every click in dense traffic — it now takes the nearer of car/junction with a
  small `JUNCTION_BIAS_PX` edge to the junction, verified live at a 154-car saturation (junction with a
  car dead-centre selects the junction; a mid-road car still selects the car).
- **Staging an optimizer pick no longer self-flags "stale" (UX)** — the leaderboard warns "Network
  changed — rerun" when the scene drifts from the sweep's baseline, but it was firing on the *intended*
  action (clicking the top fix to stage it), competing with that row's own ✓ and pointing to "rerun"
  when the designed next step is "run the A/B". `stageCandidate` now folds the staged change into
  `sweepResult.sig`, so the warning is reserved for **unrelated** edits (closure, demand, manual flip).
  Mariana's call (she picked "don't flag it as stale"). Verified live: stage → no banner (row ✓);
  then bump demand → banner returns.
- **Three clarity passes on the right rail + canvas (presentation-only)** — (P2-B) staging an optimizer
  pick lights the A/B **Run** button (`stagedNeedsRun` → `hint-ring`, cleared on run) so the
  Optimizer → A/B loop reads as a cycle; (P4) the A/B result splits into an **INPUT** strip (Tested:
  changes · N run) and a filled **RESULT** card (verdict + deltas), no metric removed; (P3) congestion
  is more legible — a **heavy** orange tier in the `thermal` ramp, a **smoothstep** on per-lane `cong`,
  and a two-segment `asphalt()` with a hot **critical** tier, all O(lanes)/frame (60fps intact, and
  `shadowBlur` fires on fewer lanes). Verified live at ~200-car saturation.
- **Extracted the click hit-test to a pure module (refactor)** — `SimulationCanvas` had grown back toward
  the pre-split size; the highest-value, lowest-risk extraction was the click→selection logic, which was
  already nearly pure. `hitTest(scene, cars, view, px, py)` now lives in `components/sim/hitTest.ts` (plain
  data in, `Selection` out — no DOM; the component keeps only a rect-reading shell), so the car/junction/
  lane priority + the `JUNCTION_BIAS_PX` rule are **unit-tested in Node** (6 cases, incl. the co-located-car
  and bias-boundary fixes). `SimulationCanvas` 553 → 513 lines. Left the RAF loop in place — it is coupled
  to ~15 refs, so extracting it would relocate lines without decoupling, at real regression risk.
- **Green wave = signalize + coordinate a corridor, captured at corridor level (Etapa 17)** — because the
  baseline is pure give-way, a green wave *creates* signals along an arterial and phase-offsets them; the
  offset is the whole value, so it must survive the A/B and optimizer. The determinism-safe way: one engine
  change (`createSignal(…, offset)` just seeds the cycle; `offset=0` is unchanged, so signal tests pass), and
  capture the intent as **which corridors are coordinated** (`ScenarioConfig.coordinated`), re-deriving the
  offsets from geometry on apply — not snapshotting the drifted per-junction phase. The optimizer's 1-min
  screening under-credits it (coordinated signals need warmup); the 5-min A/B is its fair measure. See §25.

## Quirks / gotchas

- **Sibling-dir preview:** the managed preview targets the portfolio (the session cwd), not this
  repo. Run the dev server yourself: `npm run dev -- --port 3477` (background), open the URL.
- **RAF throttled in hidden tabs:** screenshots show the road network with **0 cars** (the sim
  doesn't advance while the preview tab is hidden). It animates in a real visible browser.
- **Turbopack stale cache:** after editing many files, the browser console may show stale import
  errors (`pump`/`SPAWN_CLEARANCE` not found, etc.) even though the code is correct. Fix: kill the
  server, `rm -rf .next`, restart. **typecheck + vitest are the source of truth**, not the console.
- **Comment-cleanup can eat code — always `npm test` after one.** A "remove non-essential comments"
  pass has now corrupted logic three times by deleting the *code* line adjacent to a comment: the
  `pushBack` `else` branch in `laneList.ts` (twice) and, in `grid.ts`, the 4th junction movement
  (`vIn→hOut`) plus the `jdescs.push`. Symptoms: `conflictsWith references missing movement …` from
  `buildLaneGraph`, or `expected -1 to be 1` in the laneList tests (broken `ahead`/`behind` wiring).
  Both must stay — see the note in `laneList.ts`. Run the suite after any comment sweep.

## Commands

```bash
npm run typecheck        # tsc --noEmit
npm test                 # vitest run
npm run dev -- --port 3477   # dev server (open http://localhost:3477)
```

## Next steps (pick one)

- **Reroute in-flight cars around a fresh closure** — today they queue at the barrier; re-planning
  from the current lane (advancing `routeIdx` onto a new slice) would make closures fully dynamic.
- **Richer signals** — adjustable per-junction cycle time in the UI, an amber/all-red interphase,
  and "green wave" coordination between adjacent junctions.
- **Scale showcase** — WebGL/instanced rendering + a bigger grid (5×5+) and thousands of agents;
  eventually a WASM sim core. This is the performance story for the portfolio.
- **Lane changing (MOBIL)** + multiple lanes per direction (breaks the no-overtaking invariant —
  the per-lane list would need per-lane insertion/removal mid-lane).
- **Onboarding depth** — spotlight the exact road/button the coach references; persist "tour done".

## Working rule

The user owns all git operations. **Write/modify files only — do not `git commit`/`add`/`reset`**
unless she explicitly asks. Suggested commit groupings are noted at the end of each Etapa.
