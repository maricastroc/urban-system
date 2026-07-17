# Urban Flow — Design

An agent-based urban traffic simulation with a pure, deterministic core and a Canvas 2D render
layer. This document is the architectural map; `PROGRESS.md` tracks what's built and what's next.

## 1. Goals & principles

- **Pure functional core / imperative shell.** All simulation logic lives in `src/engine/`,
  framework-free, as **plain-data structs + free functions** (no classes with methods). The
  render/React layers depend on the engine; the engine depends on nothing.
- **Structure-of-Arrays (SoA)** typed arrays for agent state → cache-friendly and transferable
  across a Web Worker / `SharedArrayBuffer` boundary later, with no reshaping.
- **Deterministic.** Fixed timestep `dt = 0.2s`, seeded PRNG, fixed iteration order, and a
  two-phase (read-all-then-write-all) update. Same world + same seed → identical state, so the
  core is testable offline with fixtures.
- **Correctness & simplicity before optimization.** WebGL, WASM, real A* heuristics, etc. are
  deferred until the shape is proven.

## 2. Layering

```
src/engine/     pure sim (no DOM, no React) — the functional core
src/render/     geometry + Canvas2D renderer + scene builders (framework-free)
src/components/ React: SimulationCanvas ('use client') — the fixed-step loop + controls
src/app/        Next.js page/layout
```

Rendering **geometry lives only in `src/render/`** — the engine's `LaneGraph` is metric/topological
(lengths, connections), never pixel coordinates.

## 3. Coordinate model

The simulation is **1D per lane**: each agent has a longitudinal position `s ∈ [0, laneLength]`
along its current lane. The 2D world position is a render concern: `placementAt(geom, lane, s)`
maps `(lane, s)` to `(x, y, heading)` along the lane's straight segment.

## 4. Engine modules

| File | Responsibility |
|---|---|
| `types.ts` | id aliases, `NONE = -1` sentinel, `VParams` (per-vehicle IDM params) |
| `constants.ts` | `DT`, `B_MAX`, `STOP_OFFSET`, `T_SAFE`, `V_EPS`, `EPS`, `SPAWN_CLEARANCE`, `DEFAULT_VPARAMS` |
| `laneGraph.ts` | `LaneGraph` (typed arrays + CSR connections), `buildLaneGraph` |
| `agents.ts` | `AgentStore` (SoA) + `allocAgent`/`freeAgent` (free-list) |
| `laneList.ts` | `LaneOccupancy` (per-lane head/tail) + `pushBack`/`popFront` |
| `neighbors.ts` | `findLeader` (§H) |
| `idm.ts` | `idmAcceleration` (pure) + `integrate` (stable) (§I) |
| `intersection.ts` | `nextConnection`, `connectionFromTo`, `mustYield` (§J) |
| `routing.ts` | `computeRoute` (Dijkstra + binary min-heap), `addRoute` |
| `rng.ts` | `nextRandom` (mulberry32, explicit state) |
| `spawn.ts` | `spawn` (FASE 0) |
| `movement.ts` | `advance` (FASE 3, transitions + despawn) |
| `control.ts` | `ScenarioControl` overlay + `SignalController`, closures/incidents/priority/signals, `updateSignals` (FASE S) (§16) |
| `world.ts` | `World`, `SpawnSource`, `RouteRef`, `SimMetrics`, `createWorld` |
| `simulation.ts` | `tick`, `run` |

## 5. Data contracts

**`LaneGraph`** (static): per-lane `length`, `speedLimit`, `fromNode`/`toNode` (unused by the sim),
and connections stored CSR-style (`connStart`/`connEnd` per lane → `connections[]`). A
`Connection` is `{ fromLane, toLane, length, rank, conflicts[] }`. `buildLaneGraph` accepts
conflicts by index (`conflicts`) **or** by `(from,to)` movement pair (`conflictsWith`, resolved to
indices) — the latter is what the grid generator uses.

**`AgentStore`** (SoA, capacity-fixed, free-list): `active, lane, s, v, a, type, ahead, behind,
routeStart, routeEnd, routeIdx, enterTime` + `nextFree/freeHead/activeCount`. `ahead`/`behind` form
a **per-lane doubly-linked list ordered by descending s**.

**`LaneOccupancy`** (dynamic): per-lane `head` (frontmost, largest s) and `tail` (last, smallest s).

> **No-overtaking invariant (V1):** with no lane changing, cars never reorder within a lane, so
> the list is only mutated at the back (entry, `pushBack`) and front (exit, `popFront`) — it stays
> sorted without any sorting. This is the subtle correctness core; keep all list logic in
> `laneList.ts`.

**`World`** (all mutable state): `graph, agents, occ, vparams, dt, demand[], routeBuffer[],
metrics, rngState, time, tickCount`. Plain data → worker-transferable.

## 6. The tick (`simulation.ts`)

```
tick(world):
  FASE S  updateSignals(world)        # advance traffic-signal phases before decisions read them (§16)
  FASE 0  spawn(world)               # demand injection
  FASE 1  computeAccelerations(world) # read-only: write a[i] from current s/v (order-independent)
  FASE 2  integrateAgents(world)      # write s/v from a[i], per lane front→back
  FASE 3  advance(world)              # lane transitions + despawn (records metrics)
  world.time += dt; world.tickCount++
```

Two phases (compute all `a`, then integrate all) keep the step order-independent and deterministic.
`agents.a` doubles as the FASE1→FASE2 handoff. FASE 2 iterates **front→back per lane** so the
overlap guard in `integrate` sees the leader's already-updated position.

## 7. Car-following — IDM (`idm.ts`, §I)

`idmAcceleration(v, v0, gap, leadV, p)` is the pure Intelligent Driver Model:
`a = aMax·(1 − (v/v0)^δ − (s*/gap)²)`, `s* = s0 + max(0, v·T + v·Δv/(2√(aMax·b)))`. Open road →
`gap = Infinity` → interaction term 0.

`integrate(world, i)` uses the **ballistic scheme** and a **stop-handling branch** so a car never
reverses (`vNew < 0` → stop within the step, advance by the stopping distance), clamps accel to
`[−B_MAX, aMax]`, and applies an overlap guard against the (updated) car ahead. These two details
are what make the integration stable.

## 8. Neighbour finding (`neighbors.ts`, §H)

`findLeader(world, i)` returns `{ gap, leadV }`:
1. leader in the same lane (`ahead[i]`), else the front car looks beyond:
2a. **must yield** → a virtual stopped leader at the stop line;
2b. else the **last car of the downstream lane** it's about to enter (this is what keeps merges
    overlap-safe — an approaching car spaces off the outgoing lane's tail);
2c. else open road (a sink lane returns open road; its end is handled by despawn).

## 9. Intersections (`intersection.ts`, §J)

- `nextConnection(world, i)` — the connection the car will take at its lane end. **Route-aware:**
  a routed car reads the next lane from its route and picks the connection leading there; a car
  with no route falls back to the single outgoing connection (a multi-exit lane then *requires* a
  route → throws). Returns `NONE` at the destination / a sink.
- `mustYield(world, c)` — **strict-priority gap acceptance.** Yields iff a strictly-higher-rank
  conflicting movement has an approaching car within `T_SAFE` seconds (`tta = distToJunction / v`).
  Ranks are unique per node ⇒ the top movement never yields ⇒ no deadlock.
- **Junctions are points** (`conn.length = 0`): crossing is instantaneous, so conflicts are pure
  timing. `advance` does the transition (`moveToLane`): carry overflow, advance `routeIdx`,
  `pushBack` onto the downstream lane.

## 10. Routing (`routing.ts`)

`computeRoute(graph, from, to)` is **Dijkstra with a binary min-heap** over the lane graph (lanes
are nodes, connections are edges, edge cost = lane length + junction length). It is A* with a zero
heuristic; a Euclidean heuristic slots in once node coordinates exist. Returns the lane sequence or
`null`.

Routes are **per-OD, not per-car**: `addRoute(world, lanes)` appends to the shared `routeBuffer`
and returns a `{start, end}` slice. A `SpawnSource` carries candidate `routes`; `spawn` picks one
uniformly (seeded) and points the agent's `routeStart/End/Idx` at the slice.

## 11. Spawn / despawn (`spawn.ts` §0, `movement.ts` §3)

- **Spawn:** each `SpawnSource` (`{lane, rate, routes?}`) is a Bernoulli arrival per tick
  (`p = rate·dt`, discrete Poisson approx). Arrivals with no room at the source (`SPAWN_CLEARANCE`)
  are dropped. Deterministic given the seed and demand order.
- **Despawn:** a car reaching a sink lane's end completes its trip → `metrics.completedTrips++`,
  `totalTravelTime += now − enterTime`, `freeAgent`.

## 12. Render layer

- `geometry.ts` — `LaneGeometry` (per-lane `a`/`b` endpoints), `placementAt`.
- `renderer.ts` — `drawScene(ctx, w, h, scene, cars)`: fits a single **uniform camera** to the
  bounding box of all lanes (so vertical roads read as vertical), draws road segments + centre
  dashes + cars (rounded capsules, HSL colour from speed: red stopped → green free-flow).
- `scene.ts` — `createScene(rate)` builds the current demo (a grid via `grid.ts`), computes routes
  from each source to each reachable sink, and sets up demand. `setDemandRate` tunes it live.
- `grid.ts` — `buildGrid(rows, cols)` **procedurally generates a one-way Manhattan grid**: streets
  alternate direction by row/column; each junction wires straight + turn movements with
  **over-declared per-node conflicts** (every movement conflicts with every movement from another
  incoming lane, distinct ranks) — conservative but provably collision-free, covering crossings and
  merges. Returns `{graph, geometry, sources, sinks}`.

## 13. The render loop (`SimulationCanvas.tsx`)

A `requestAnimationFrame` loop with a **fixed-step accumulator**: accumulate real elapsed time
(× speed), run whole `dt` ticks (capped by `MAX_STEPS`), and **interpolate** between the last two
tick states for smooth 60fps from the 5 Hz sim. Interpolation snapshots `prevS/prevActive/prevLane`
each tick and only interpolates cars present in both snapshots **and still on the same lane** —
fresh spawns and cars that just crossed a junction render at their current spot (no backward sweep).

## 14. Testing

Vitest, Node environment (engine is pure). The `@` alias is mirrored in `vitest.config.ts`. Tests
target the hard logic and the invariants, not snapshots. Fixtures place agents by hand
(`allocAgent` + `pushBack`) or drive demand with a fixed seed. Key asserted invariants: no
reversing (`v ≥ 0`), no overlap on any lane (`gap ≥ −EPS`), stable stop at the jam gap `s0`,
shortest-path correctness, priority gap-acceptance, and bit-for-bit determinism.

## 15. Known simplifications / limitations

- Single lane per direction, no lane changing (MOBIL) yet.
- Point junctions (zero length); over-declared conflicts serialize each junction (lower throughput
  than a real conflict matrix; under heavy demand a grid can **gridlock** — realistic).
- Routing is Dijkstra (no heuristic); no node coordinates in the engine.
- **Scenario Control (§16) simplifications:** signals are a fixed-time 2-phase cycle with no
  amber/all-red interphase (safe here only because junctions are points and the tick is atomic);
  closures reroute *new* traffic but in-flight cars queue at the barrier until it reopens (they do
  not re-plan); incidents never reroute (that is the point). Metrics are aggregate (throughput,
  speed, trip time) — no per-lane time series yet.
- Preview quirks: the managed preview targets the sibling portfolio project — run the dev server
  manually (`npm run dev -- --port 3477`). RAF is throttled in a hidden tab, so screenshots show
  the network with 0 cars; it animates in a real visible browser. Turbopack can cache stale after
  many-file edits (`rm -rf .next` + restart; typecheck + vitest are the source of truth).

## 16. Scenario Control — the experimentation layer (Etapa 8)

A live overlay on top of the immutable `LaneGraph` that lets the user run "what if" experiments
without rebuilding the world. It is the same discipline as the rest of the engine: **plain-data
struct + free functions**, deterministic, engine-owns-no-pixels.

**`ScenarioControl`** (on the `World`, built by `createControl`) is flat typed arrays keyed by lane
or connection, so the static graph stays untouched:

| Field | Keyed by | Meaning |
|---|---|---|
| `laneClosed` | lane | 1 = closed: routing avoids it and its entrance is a wall |
| `incidentAt` | lane | `s` of a stopped mid-lane obstruction; `Infinity` = none |
| `rank` | connection | **effective** give-way priority (a priority flip swaps entries) |
| `signal` | connection | `SIGNAL_NONE` (priority) \| `SIGNAL_GREEN` \| `SIGNAL_RED` |
| `signals` | — | active `SignalController`s, advanced each tick by `updateSignals` |

Defaults reproduce the plain priority network exactly (nothing closed, ranks copied from the graph,
no signals), so an untouched World behaves as before this layer existed — every pre-Etapa-8 test
still passes unchanged.

**Where the sim reads the overlay:**
- `findLeader` (§8) gains two obstacles ahead of the junction look-beyond: a **mid-lane incident**
  (a stopped point obstacle → the car queues `s0` behind it) and a **held junction** — a red
  signal, a **closed downstream lane**, or a priority give-way all resolve to a virtual stopped
  leader at the stop line. A closed lane is therefore overlap-safe: cars pause at the barrier and
  `advance` never carries them across.
- `mustYield` (§J) reads `control.rank[c]` instead of the graph's baked rank, and is **only**
  consulted when the movement is unsignalized (`SIGNAL_NONE`) — a green movement goes without a
  yield check because its conflicts are all red (the scene guarantees conflict-free phases).
- `spawn` drops arrivals at a closed entry, or at a source a closure has cut off from every
  destination (empty `routes`), after the arrival PRNG draw so the stream is unperturbed.

**Traffic signals.** A `SignalController` owns a set of connection groups (`phases`) and round-robins
them off the fixed `dt` in `updateSignals` (FASE S). For the grid each signalized junction is a
2-phase H/V controller (one approach green, the other red). Disabling a controller resets its
connections to `SIGNAL_NONE`, reverting the junction to priority give-way.

**Routing around closures.** `computeRoute(graph, from, to, closed?)` skips edges into closed lanes,
so new paths detour. Routes are per-OD and appended to the shared `routeBuffer` (append-only), so
recomputing on a closure re-points each source at fresh slices while in-flight cars keep their old,
still-valid slices.

**Render + interaction** (`render/` + `SimulationCanvas`):
- `grid.ts` also emits `Junction`s (position + per-approach connection ids, straight-before-turn)
  and assigns real integer node ids, giving the UI what it needs to hit-test and control junctions.
- `scene.ts` is the orchestration API — per-entry demand (`setSourceRate`), destinations
  (`toggleDestination` → `applyRoutes`), `toggleLaneClosed` (reroutes), `toggleIncident`,
  `flipPriority` (`swapRanks`), `toggleSignal`, and `sampleStats` for the A/B compare.
- `geometry.ts` exports one shared camera (`fitCamera`/`project`/`unproject`/`nearestLane`) so the
  renderer (world→screen) and the canvas click hit-testing (screen→world) can never disagree.
- `renderer.ts` draws the overlay: closed lanes as a red dashed barrier, incidents as a warning
  marker, signal heads (green/red) and a priority right-of-way tick per junction, plus entry/exit
  markers and the selection glow. `SimulationCanvas` turns a click into a lane or junction
  selection and drives a contextual inspector; the A/B panel snapshots metrics before and after.

## 17. Experience layer — "mission control" (Etapa 9)

A presentation-only redesign: **no engine, render-data, or API change** — it reads the same
`World`/`Scene` and calls the same `scene.ts` helpers, so all engine tests pass untouched. The goal
is a portfolio-grade tool that communicates the engine's power in the first ten seconds.

**Concept.** The map is the protagonist; every panel serves it (a Figma-like canvas + rails model,
with Linear/Vercel restraint and Arc/Raycast microinteractions). One accent (electric blue) for
interaction, semantic green/amber/red for status and deltas, Geist Mono for every numeral.

**Layout (`SimulationCanvas.tsx`, `page.tsx`).** A full-viewport shell: a top bar (brand + live
HUD), a full-bleed map, a right rail (inspector + experiment), a floating instrument dock, and a
floating guided coach. Collapses to a single column on mobile.

**Design system (`globals.css`).** CSS-variable tokens (surfaces, borders, text ramps, accent,
status), motion keyframes + easing, an instrument-styled range input, and thin scrollbars. The
canvas palette in `renderer.ts` mirrors the same hex so chrome and map read as one system.

**Progressive disclosure** (principle: show only what's relevant now):
- *Inspector empty state* doubles as the legend — three affordances (entries, junctions, roads) and
  the speed-colour key, instead of a footer paragraph.
- *Road / entry* → live cars + speed (congestion-toned), close/incident, and (entries) demand +
  destinations. *Junction* → live queue + signal phase/priority, add-signals / flip-priority.

**Live numerals** update imperatively from the rAF loop (refs → DOM, eased tween) so the HUD counts
smoothly without 60fps React renders; per-selection stats poll at ~5 Hz; discrete UI stays in React
state.

**Guided coach.** A dismissible floating stepper — *capture baseline → disrupt → watch & capture B*
— that auto-advances by observing state (`snapA`, a scenario change, `snapB`). Turns the flow into a
story with zero documentation.

**A/B as an experiment.** `before → after → impact`: each metric shows A, an arrow, B, and a
semantic delta (throughput/speed up = good, trip time up = bad) with a signed bar.

**Canvas craft (`renderer.ts`).** A depth-cued backdrop (radial wash + faint dot-grid), roads
*cased* like map tiles (curb + asphalt) with a **live congestion tint** (asphalt warms as the cars
on a lane slow), glowing speed-coloured cars, and time-animated selection/hover rings (a `now`
timestamp threads through `RenderOverlay`).

## 18. The mesh as a living thermal field (Etapa 10)

A visualization-only pass on the canvas — **no engine, data, or interaction change** (`renderer.ts`
reads the same `Scene`/`cars` and the same `RenderOverlay`; all 51 tests untouched). The goal: the
mesh should read as a *scientific visualization of a living complex system*, not a street diagram.
Every drawn element carries information; nothing is decoration.

**One thermal language.** A single ramp — cool (`#78bed8`, flowing) → amber → hot (`#eb5c54`,
jammed) — colours **cars, roads, junction nodes and flow** alike, so the whole city reads as a heat
map of stress at a glance (`thermal(t)` in `renderer.ts`; the inspector legend mirrors it).

**Three legible layers.** The read must separate *infrastructure* (roads), *flow* (an activity
property of the road) and *agents* (cars) — they must never merge. So the layers are ranked by
**luminance tier**, not just colour: roads sit in a dim mid tier; flow is fainter still; and each car
is lifted into a distinct top tier — a crisp capsule whose **nose is near-white** (heading + identity)
with a dark separation shadow + hairline edge that carves it out of any road glow, so it pops on a
dark road *and* over a hot bloom. Congestion is therefore carried by road **hue**, not bloom (the old
glow drowned the cars); the flow field is a faint streak, never a bright dot (which read as a car).

**Seven layers, back to front:**
1. *Backdrop* — radial wash + dot-grid with a slow breathing central glow (off `now`).
2. *Roads* — a dark curb + neutral asphalt; congestion adds warm hue + a restrained halo (the road
   is lit, not repainted), so load reads without cars.
3. *Flow field* — per-lane faint downstream streaks, always present (direction without cars), their
   speed and colour modulated by the lane's mean speed: free lanes flow cool and fast, jammed lanes
   crawl and warm. A road property, subordinate to the agents. Count/alpha capped for performance.
4. *Cars* — the agent tier: a crisp near-white-nosed capsule, dark-separated from the road, with a
   short directional micro-trail. Immediately pickable even at 20+ cars, without being enlarged.
5. *Incidents* — a pulsing warning marker.
6. *Junctions as living nodes* — a ring that breathes with approach activity and **warms with its
   queue** (a critical junction glows hot); signalized approaches show a green/red dot, unsignalized
   ones a queue bloom or a priority tick; selection adds an expanding sweep.
7. *Focus mode* — selecting anything dims the rest of the network to ~0.28 and keeps the target **and
   its immediate topology** (a junction's approaches + exits, or the selected lane) lit — a spotlight,
   not a border. `focus` set + `dimOf(lane)` compute this each frame.

**Scale.** The demo grid moved to **5×5** (`scene.ts` `GRID`): denser topology reads as a system, and
the auto-fit camera keeps elements legible. Engine/behaviour is untouched — only the scene's size.

**Deferred (a new interaction, out of this scope):** selecting a *car* to trace its Dijkstra route.
