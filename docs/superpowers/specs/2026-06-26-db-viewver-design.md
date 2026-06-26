# DB-Viewver — Design

**Date:** 2026-06-26
**Status:** Approved (brainstorming) — ready for implementation planning

## Vision

A desktop application that lets you visualize a SQL or NoSQL database **dynamically**, as an interactive 3D experience: you connect a database and every table/collection appears automatically as a glowing "planet", linked by its relations. You navigate from planet to planet with cinematic camera moves — like traveling through space — and open a planet to inspect its columns and rows. The point of difference is the *feel*: a neon/holographic aesthetic and exceptionally fluid 3D motion.

## Form factor & stack (decided)

- **Shell:** Tauri (lightweight native window, low memory → fluid feel).
- **DB engine:** a **Bun binary** (`bun build --compile`) bundled as a Tauri **sidecar**. It owns all database connections (JS/TS drivers) and exposes a normalized schema + paged rows to the frontend. This is where Bun runs as a real runtime — not just tooling.
- **Frontend:** React + TypeScript + Vite (run via Bun).
- **3D:** React Three Fiber (Three.js) + `@react-three/drei` + `@react-three/postprocessing`.
- **Layout:** `d3-force-3d`.
- **Camera animation:** GSAP.
- **State:** Zustand.
- **Front ↔ sidecar transport:** local WebSocket (supports progressive/streamed schema loading).

Rejected alternatives: Electron (heavier ~150 MB, Bun only as tooling); Tauri + pure-Rust DB layer (fastest, but removes Bun and writes the DB layer in Rust).

## 3D engine

**Scene — a stellar system of data**
- Table / collection = a **planet** (sphere). Size encodes row count; hue encodes kind (table / view / collection) and source.
- Relation (FK / inferred reference) = a curved **neon arc** (`QuadraticBezierCurve3`) with particles flowing in the direction of the dependency.
- Background: starfield (`drei/Stars`) + soft parallax nebula for depth.

**Visual style — neon / holographic**
- Wireframe / translucent hologram planets, cyan–magenta glow, holographic ground grid, pulsed neon relation arcs ("spaceship console" feel).

**Layout — force-directed**
- `d3-force-3d`: repulsion between planets, attraction along relations → strongly related tables cluster into "constellations"; isolated tables drift to the periphery. Positions freeze once stabilized; animated re-balance when nodes are added/removed.

**Navigation — cinematic on click (decided)**
- Click a planet → GSAP tweens camera position + lookAt (`power3.inOut`); the planet grows, neighbors part slightly (focus effect).
- In "orbit", an info ring deploys (columns, keys); outgoing relations light up as routes.
- Smooth zoom-out back to the galaxy view. `OrbitControls` are bridled — reserved for micro-adjustments only; scripted transitions own the camera.

**Effects (postprocessing)**
- SelectiveBloom on active planets/arcs (highest visual payoff), light depth-of-field for distant planets, vignette + subtle chromatic aberration. Light custom shaders: fresnel atmosphere, gentle pulse on hover.

**Fluidity — 60 fps contract**
- `InstancedMesh` for planets and stars (one draw call each).
- LOD (`drei/Detailed`): high-res spheres only up close.
- Frustum culling; force-layout computed off the render path (web worker if needed).
- Row data is **never** rendered in 3D — always an HTML panel (`drei/Html` or a React panel) → the 3D scene stays light.
- Graceful degradation: drop DoF/bloom if frame budget is exceeded.

## Introspection layer (Bun sidecar)

**Unified schema contract (front ↔ back).** The frontend only ever consumes one format, regardless of source:

```
Graph {
  nodes: [{ id, name, kind: "table"|"view"|"collection",
            columns: [{ name, type, nullable, isPK, isFK }],
            rowCount }]
  edges: [{ from, to, fromColumns, toColumns,
            kind: "fk"|"inferred", confidence }]
}
```

A planet = a `node`; an arc = an `edge`. The 3D engine is source-agnostic.

**SQL (Postgres) — explicit relations.** Read system catalogs (no guessing):
- tables/columns/types → `information_schema.columns`
- primary keys + **foreign keys** → `information_schema.table_constraints` + `key_column_usage`
- `rowCount` → fast estimate (`pg_class.reltuples`) to avoid costly `COUNT(*)`.
- Edges are reliable: `kind: "fk"`, confidence 1.0.

**NoSQL (Mongo) — schema by sampling.** Mongo has no declared FKs. For MVP, sample each collection (~hundreds of docs via `$sample`) to derive the **schema** (union of fields + observed types; appearance frequency → optional fields). **Relation inference is Phase 2** (see Scope).

**Connection & lifecycle**
- Sidecar holds a per-database **connection pool** (`postgres` / `mongodb` drivers), kept open while the galaxy is displayed.
- **Lazy introspection:** load the node list first (fast) → galaxy renders; per-planet column/relation detail completes on approach (prefetch neighbors during the camera transition).
- **Rows on demand:** opening a planet and requesting rows issues a paged query (`LIMIT/OFFSET` or `find().limit()`) returned to the HTML panel — never to 3D.

**Secrets.** Connection credentials never reach the frontend in clear text: Tauri stores them via the OS keychain; the sidecar reads them only at connect time.

## Scope

**MVP**
- Postgres: full introspection (tables, columns, PKs, **FK relation edges**), galaxy view, cinematic navigation, per-planet columns + paged rows.
- Mongo: collections appear as planets with **sampled schema** (columns), but **no relation edges yet**.
- Neon/holographic 3D engine with the 60 fps contract.
- Tauri shell + Bun sidecar + WebSocket transport + keychain credential storage.

**Phase 2**
- Mongo **relation inference** (heuristics: `*_id` / `ObjectId` matches against other collections' `_id`, naming conventions, embedded refs) → `kind: "inferred"` edges with confidence, rendered as dotted/diffuse arcs to distinguish from solid SQL FK arcs.
- MySQL support.

**Phase 3 (later, not designed yet)**
- "Data as a point cloud" view for very large tables (per-row 3D objects with GPU instancing + LOD/pagination).

## Out of scope (YAGNI for now)

- Editing/writing data (read-only viewer).
- Query builder / SQL console.
- Multi-user / web deployment (desktop-only).
