# Urban Flow — Progress

Built incrementally in small, tested steps ("Etapas"). See `DESIGN.md` for the architecture.
Status: **8 phases done, 51 vitest tests passing, typecheck + lint clean.**

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

## Quirks / gotchas

- **Sibling-dir preview:** the managed preview targets the portfolio (the session cwd), not this
  repo. Run the dev server yourself: `npm run dev -- --port 3477` (background), open the URL.
- **RAF throttled in hidden tabs:** screenshots show the road network with **0 cars** (the sim
  doesn't advance while the preview tab is hidden). It animates in a real visible browser.
- **Turbopack stale cache:** after editing many files, the browser console may show stale import
  errors (`pump`/`SPAWN_CLEARANCE` not found, etc.) even though the code is correct. Fix: kill the
  server, `rm -rf .next`, restart. **typecheck + vitest are the source of truth**, not the console.

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
- **Observability** — per-lane congestion heatmap, a throughput time-series next to the A/B compare,
  click-to-follow a car, camera pan/zoom, a "day" demand curve.

## Working rule

The user owns all git operations. **Write/modify files only — do not `git commit`/`add`/`reset`**
unless she explicitly asks. Suggested commit groupings are noted at the end of each Etapa.
