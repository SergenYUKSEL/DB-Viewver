# Bun Sidecar: Postgres Introspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Bun sidecar's Postgres introspection so that, given a connection string, it returns the project's unified `Graph` (tables, columns, PKs, FK edges, row-count estimates) and can fetch paged rows for one table.

**Architecture:** A standalone Bun + TypeScript package under `sidecar/`. A pure-data `schema.ts` defines the `Graph` contract every consumer shares. `postgres.ts` runs `information_schema`/`pg_catalog` queries through the `postgres` (porsager) driver and assembles a `Graph`. Tests run against a real Postgres started via `docker compose` (no mocks for DB behavior — `information_schema` is the thing under test).

**Tech Stack:** Bun (runtime + `bun test` + `bun build --compile`), TypeScript, `postgres` (porsager/postgres) driver, Docker (test Postgres only).

## Global Constraints

- Runtime: **Bun** (latest). No Node-only APIs.
- Language: **TypeScript**, `strict` mode on.
- This sidecar is the only place DB credentials/drivers live; it exposes only the normalized `Graph` + rows. (Transport/WebSocket is a *later* plan — this plan stops at in-process functions + tests.)
- The unified schema contract is fixed (copied verbatim from the design spec):
  ```
  Graph {
    nodes: [{ id, name, kind: "table"|"view"|"collection",
              columns: [{ name, type, nullable, isPK, isFK }],
              rowCount }]
    edges: [{ from, to, fromColumns, toColumns,
              kind: "fk"|"inferred", confidence }]
  }
  ```
- MVP handles **single-column** foreign keys. Composite FKs are out of scope for this plan (note, don't crash).
- Only the `public` schema is introspected in the MVP.

---

### Task 1: Initialize the sidecar package and the `Graph` contract

**Files:**
- Create: `sidecar/package.json`
- Create: `sidecar/tsconfig.json`
- Create: `sidecar/src/schema.ts`
- Create: `sidecar/tests/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ColumnKind` unused; the exported types are:
    - `interface Column { name: string; type: string; nullable: boolean; isPK: boolean; isFK: boolean }`
    - `type NodeKind = "table" | "view" | "collection"`
    - `interface Node { id: string; name: string; kind: NodeKind; columns: Column[]; rowCount: number }`
    - `type EdgeKind = "fk" | "inferred"`
    - `interface Edge { from: string; to: string; fromColumns: string[]; toColumns: string[]; kind: EdgeKind; confidence: number }`
    - `interface Graph { nodes: Node[]; edges: Edge[] }`
  - `function emptyGraph(): Graph` — returns `{ nodes: [], edges: [] }`.

- [ ] **Step 1: Create `sidecar/package.json`**

```json
{
  "name": "db-viewver-sidecar",
  "module": "src/index.ts",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "bun test",
    "db:up": "docker compose -f docker-compose.test.yml up -d --wait",
    "db:down": "docker compose -f docker-compose.test.yml down -v"
  },
  "dependencies": {
    "postgres": "^3.4.4"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `sidecar/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd sidecar && bun install`
Expected: creates `bun.lockb` and `node_modules`, exits 0.

- [ ] **Step 4: Write the failing test**

`sidecar/tests/schema.test.ts`:

```ts
import { expect, test } from "bun:test";
import { emptyGraph, type Graph, type Node, type Edge } from "../src/schema";

test("emptyGraph returns a graph with no nodes or edges", () => {
  const g: Graph = emptyGraph();
  expect(g.nodes).toEqual([]);
  expect(g.edges).toEqual([]);
});

test("Node and Edge shapes are usable", () => {
  const node: Node = {
    id: "public.users",
    name: "users",
    kind: "table",
    columns: [{ name: "id", type: "integer", nullable: false, isPK: true, isFK: false }],
    rowCount: 0,
  };
  const edge: Edge = {
    from: "public.orders",
    to: "public.users",
    fromColumns: ["user_id"],
    toColumns: ["id"],
    kind: "fk",
    confidence: 1,
  };
  expect(node.kind).toBe("table");
  expect(edge.kind).toBe("fk");
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd sidecar && bun test tests/schema.test.ts`
Expected: FAIL — `Cannot find module "../src/schema"`.

- [ ] **Step 6: Write `sidecar/src/schema.ts`**

```ts
export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  isPK: boolean;
  isFK: boolean;
}

export type NodeKind = "table" | "view" | "collection";

export interface Node {
  id: string;
  name: string;
  kind: NodeKind;
  columns: Column[];
  rowCount: number;
}

export type EdgeKind = "fk" | "inferred";

export interface Edge {
  from: string;
  to: string;
  fromColumns: string[];
  toColumns: string[];
  kind: EdgeKind;
  confidence: number;
}

export interface Graph {
  nodes: Node[];
  edges: Edge[];
}

export function emptyGraph(): Graph {
  return { nodes: [], edges: [] };
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd sidecar && bun test tests/schema.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add sidecar/package.json sidecar/tsconfig.json sidecar/bun.lockb sidecar/src/schema.ts sidecar/tests/schema.test.ts
git commit -m "feat(sidecar): init Bun package and unified Graph schema contract"
```

---

### Task 2: Test Postgres + connection helper + list nodes (tables/views)

**Files:**
- Create: `sidecar/docker-compose.test.yml`
- Create: `sidecar/tests/fixtures/seed.sql`
- Create: `sidecar/tests/helpers/testdb.ts`
- Create: `sidecar/src/postgres.ts`
- Create: `sidecar/tests/postgres.test.ts`

**Interfaces:**
- Consumes: `Graph`, `Node` from `src/schema.ts`.
- Produces:
  - `function connect(connectionString: string): Sql` where `Sql` is the porsager client type (`import type { Sql } from "postgres"`). Implemented as a thin wrapper returning `postgres(connectionString)`.
  - `async function listNodes(sql: Sql): Promise<Node[]>` — returns one `Node` per base table/view in schema `public`, with `columns: []` and `rowCount: 0` for now. `id` is `"public.<name>"`, `kind` is `"table"` for `BASE TABLE` and `"view"` for `VIEW`.

- [ ] **Step 1: Create `sidecar/docker-compose.test.yml`**

```yaml
services:
  testdb:
    image: postgres:16
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: testdb
    ports:
      - "5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test -d testdb"]
      interval: 1s
      timeout: 5s
      retries: 30
```

- [ ] **Step 2: Create the seed schema `sidecar/tests/fixtures/seed.sql`**

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL,
  name text
);

CREATE TABLE orders (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id),
  total numeric
);

CREATE VIEW active_users AS
  SELECT id, email FROM users;

INSERT INTO users (email, name) VALUES
  ('a@x.com', 'A'), ('b@x.com', 'B'), ('c@x.com', NULL);
INSERT INTO orders (user_id, total) VALUES
  (1, 10.0), (1, 20.0), (2, 5.5);

ANALYZE;
```

- [ ] **Step 3: Create the test DB helper `sidecar/tests/helpers/testdb.ts`**

```ts
import postgres from "postgres";

export const TEST_CONN = "postgres://test:test@localhost:5433/testdb";

/** Apply the seed schema. Call once in beforeAll of integration tests. */
export async function seed(): Promise<void> {
  const sql = postgres(TEST_CONN);
  try {
    const file = Bun.file(new URL("../fixtures/seed.sql", import.meta.url));
    await sql.unsafe(await file.text());
  } finally {
    await sql.end({ timeout: 5 });
  }
}
```

- [ ] **Step 4: Start the test database**

Run: `cd sidecar && bun run db:up`
Expected: container `testdb` becomes healthy; command exits 0. (If port 5433 is taken, stop the conflicting service first.)

- [ ] **Step 5: Write the failing test `sidecar/tests/postgres.test.ts`**

```ts
import { expect, test, beforeAll } from "bun:test";
import { connect, listNodes } from "../src/postgres";
import { seed, TEST_CONN } from "./helpers/testdb";

beforeAll(async () => {
  await seed();
});

test("listNodes returns tables and views from public schema", async () => {
  const sql = connect(TEST_CONN);
  try {
    const nodes = await listNodes(sql);
    const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));

    expect(byName["users"].kind).toBe("table");
    expect(byName["orders"].kind).toBe("table");
    expect(byName["active_users"].kind).toBe("view");
    expect(byName["users"].id).toBe("public.users");
    expect(byName["users"].columns).toEqual([]);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd sidecar && bun test tests/postgres.test.ts`
Expected: FAIL — `Cannot find module "../src/postgres"`.

- [ ] **Step 7: Write `sidecar/src/postgres.ts`**

```ts
import postgres, { type Sql } from "postgres";
import type { Node } from "./schema";

export function connect(connectionString: string): Sql {
  return postgres(connectionString);
}

export async function listNodes(sql: Sql): Promise<Node[]> {
  const rows = await sql<{ table_name: string; table_type: string }[]>`
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;
  return rows.map((r) => ({
    id: `public.${r.table_name}`,
    name: r.table_name,
    kind: r.table_type === "VIEW" ? "view" : "table",
    columns: [],
    rowCount: 0,
  }));
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd sidecar && bun test tests/postgres.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add sidecar/docker-compose.test.yml sidecar/tests/fixtures/seed.sql sidecar/tests/helpers/testdb.ts sidecar/src/postgres.ts sidecar/tests/postgres.test.ts
git commit -m "feat(sidecar): list public tables/views as Graph nodes"
```

---

### Task 3: Columns + primary-key flags

**Files:**
- Modify: `sidecar/src/postgres.ts`
- Modify: `sidecar/tests/postgres.test.ts`

**Interfaces:**
- Consumes: `connect`, `listNodes`, `Node`, `Column`.
- Produces:
  - `async function attachColumns(sql: Sql, nodes: Node[]): Promise<void>` — mutates each node's `columns` array in place, filling `name`, `type` (from `data_type`), `nullable` (`is_nullable === "YES"`), and `isPK` (true if the column is part of that table's primary key). `isFK` stays `false` here (Task 4 sets it). Columns are ordered by `ordinal_position`.

- [ ] **Step 1: Add the failing test (append to `sidecar/tests/postgres.test.ts`)**

```ts
import { attachColumns } from "../src/postgres";

test("attachColumns fills columns with types, nullability and PK flags", async () => {
  const sql = connect(TEST_CONN);
  try {
    const nodes = await listNodes(sql);
    await attachColumns(sql, nodes);
    const users = nodes.find((n) => n.name === "users")!;
    const colByName = Object.fromEntries(users.columns.map((c) => [c.name, c]));

    expect(users.columns.map((c) => c.name)).toEqual(["id", "email", "name"]);
    expect(colByName["id"].isPK).toBe(true);
    expect(colByName["id"].nullable).toBe(false);
    expect(colByName["email"].isPK).toBe(false);
    expect(colByName["email"].nullable).toBe(false);
    expect(colByName["name"].nullable).toBe(true);
    expect(colByName["id"].type).toBe("integer");
  } finally {
    await sql.end({ timeout: 5 });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test tests/postgres.test.ts -t "attachColumns"`
Expected: FAIL — `attachColumns is not a function` / import error.

- [ ] **Step 3: Implement `attachColumns` in `sidecar/src/postgres.ts`**

Add this `Column` import and function:

```ts
// add Column to the existing schema import:
//   import type { Node, Column } from "./schema";

export async function attachColumns(sql: Sql, nodes: Node[]): Promise<void> {
  const cols = await sql<
    { table_name: string; column_name: string; data_type: string; is_nullable: string }[]
  >`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;

  const pks = await sql<{ table_name: string; column_name: string }[]>`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public'
  `;
  const pkSet = new Set(pks.map((p) => `${p.table_name}.${p.column_name}`));

  const byTable = new Map<string, Column[]>();
  for (const c of cols) {
    const col: Column = {
      name: c.column_name,
      type: c.data_type,
      nullable: c.is_nullable === "YES",
      isPK: pkSet.has(`${c.table_name}.${c.column_name}`),
      isFK: false,
    };
    const list = byTable.get(c.table_name) ?? [];
    list.push(col);
    byTable.set(c.table_name, list);
  }

  for (const node of nodes) {
    node.columns = byTable.get(node.name) ?? [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test tests/postgres.test.ts -t "attachColumns"`
Expected: PASS.

- [ ] **Step 5: Run the whole file to confirm no regressions**

Run: `cd sidecar && bun test tests/postgres.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/postgres.ts sidecar/tests/postgres.test.ts
git commit -m "feat(sidecar): attach columns with type, nullability and PK flags"
```

---

### Task 4: Foreign-key edges + `isFK` flags

**Files:**
- Modify: `sidecar/src/postgres.ts`
- Modify: `sidecar/tests/postgres.test.ts`

**Interfaces:**
- Consumes: `connect`, `listNodes`, `attachColumns`, `Node`, `Edge`.
- Produces:
  - `async function buildForeignKeyEdges(sql: Sql, nodes: Node[]): Promise<Edge[]>` — returns one `Edge` per single-column FK in `public`. `from`/`to` use node ids (`public.<table>`); `kind` is `"fk"`; `confidence` is `1`. As a side effect it sets `isFK: true` on each referencing column in `nodes`. Composite FKs (more than one column sharing a constraint) are skipped.

- [ ] **Step 1: Add the failing test (append to `sidecar/tests/postgres.test.ts`)**

```ts
import { buildForeignKeyEdges } from "../src/postgres";

test("buildForeignKeyEdges returns FK edges and marks isFK", async () => {
  const sql = connect(TEST_CONN);
  try {
    const nodes = await listNodes(sql);
    await attachColumns(sql, nodes);
    const edges = await buildForeignKeyEdges(sql, nodes);

    expect(edges).toHaveLength(1);
    const e = edges[0];
    expect(e.from).toBe("public.orders");
    expect(e.to).toBe("public.users");
    expect(e.fromColumns).toEqual(["user_id"]);
    expect(e.toColumns).toEqual(["id"]);
    expect(e.kind).toBe("fk");
    expect(e.confidence).toBe(1);

    const orders = nodes.find((n) => n.name === "orders")!;
    const userId = orders.columns.find((c) => c.name === "user_id")!;
    expect(userId.isFK).toBe(true);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test tests/postgres.test.ts -t "buildForeignKeyEdges"`
Expected: FAIL — `buildForeignKeyEdges is not a function`.

- [ ] **Step 3: Implement `buildForeignKeyEdges` in `sidecar/src/postgres.ts`**

Add `Edge` to the schema import (`import type { Node, Column, Edge } from "./schema";`) and the function:

```ts
export async function buildForeignKeyEdges(sql: Sql, nodes: Node[]): Promise<Edge[]> {
  const fks = await sql<
    {
      constraint_name: string;
      from_table: string;
      from_column: string;
      to_table: string;
      to_column: string;
    }[]
  >`
    SELECT
      tc.constraint_name,
      tc.table_name  AS from_table,
      kcu.column_name AS from_column,
      ccu.table_name AS to_table,
      ccu.column_name AS to_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
  `;

  // Group by constraint so we can skip composite (multi-column) FKs.
  const byConstraint = new Map<string, typeof fks>();
  for (const fk of fks) {
    const list = byConstraint.get(fk.constraint_name) ?? [];
    list.push(fk);
    byConstraint.set(fk.constraint_name, list);
  }

  const columnByTable = new Map(nodes.map((n) => [n.name, n.columns]));
  const edges: Edge[] = [];

  for (const rows of byConstraint.values()) {
    if (rows.length !== 1) continue; // MVP: single-column FKs only
    const fk = rows[0];
    edges.push({
      from: `public.${fk.from_table}`,
      to: `public.${fk.to_table}`,
      fromColumns: [fk.from_column],
      toColumns: [fk.to_column],
      kind: "fk",
      confidence: 1,
    });
    const col = columnByTable.get(fk.from_table)?.find((c) => c.name === fk.from_column);
    if (col) col.isFK = true;
  }

  return edges;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test tests/postgres.test.ts -t "buildForeignKeyEdges"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/postgres.ts sidecar/tests/postgres.test.ts
git commit -m "feat(sidecar): build single-column FK edges and mark isFK columns"
```

---

### Task 5: Row-count estimates

**Files:**
- Modify: `sidecar/src/postgres.ts`
- Modify: `sidecar/tests/postgres.test.ts`

**Interfaces:**
- Consumes: `connect`, `listNodes`, `Node`.
- Produces:
  - `async function attachRowCounts(sql: Sql, nodes: Node[]): Promise<void>` — sets `node.rowCount` from `pg_class.reltuples` (fast estimate; `0` when unknown/never analyzed). Views have no estimate and keep `rowCount: 0`.

- [ ] **Step 1: Add the failing test (append to `sidecar/tests/postgres.test.ts`)**

```ts
import { attachRowCounts } from "../src/postgres";

test("attachRowCounts sets a non-negative estimate for tables", async () => {
  const sql = connect(TEST_CONN);
  try {
    const nodes = await listNodes(sql);
    await attachRowCounts(sql, nodes);
    const users = nodes.find((n) => n.name === "users")!;
    // seed.sql runs ANALYZE, so the estimate should be the 3 seeded rows.
    expect(users.rowCount).toBe(3);

    const view = nodes.find((n) => n.name === "active_users")!;
    expect(view.rowCount).toBe(0);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test tests/postgres.test.ts -t "attachRowCounts"`
Expected: FAIL — `attachRowCounts is not a function`.

- [ ] **Step 3: Implement `attachRowCounts` in `sidecar/src/postgres.ts`**

```ts
export async function attachRowCounts(sql: Sql, nodes: Node[]): Promise<void> {
  const rows = await sql<{ table_name: string; estimate: number }[]>`
    SELECT c.relname AS table_name, c.reltuples::bigint AS estimate
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  `;
  const byName = new Map(rows.map((r) => [r.table_name, Number(r.estimate)]));
  for (const node of nodes) {
    const est = byName.get(node.name);
    node.rowCount = est && est > 0 ? est : 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test tests/postgres.test.ts -t "attachRowCounts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/postgres.ts sidecar/tests/postgres.test.ts
git commit -m "feat(sidecar): attach fast row-count estimates from pg_class"
```

---

### Task 6: Paged row fetch

**Files:**
- Modify: `sidecar/src/postgres.ts`
- Modify: `sidecar/tests/postgres.test.ts`

**Interfaces:**
- Consumes: `connect`.
- Produces:
  - `interface Page { columns: string[]; rows: unknown[][]; limit: number; offset: number }`
  - `async function fetchRows(sql: Sql, table: string, limit = 50, offset = 0): Promise<Page>` — returns rows from `public.<table>`, ordered for stable pagination, using identifier-safe interpolation (`sql(table)`), with `limit` clamped to `[1, 500]` and `offset` clamped to `>= 0`. `columns` is the ordered list of column names; each row is an array of values aligned to `columns`.

- [ ] **Step 1: Add the failing test (append to `sidecar/tests/postgres.test.ts`)**

```ts
import { fetchRows } from "../src/postgres";

test("fetchRows returns a clamped, paged slice with column order", async () => {
  const sql = connect(TEST_CONN);
  try {
    const page = await fetchRows(sql, "users", 2, 0);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(0);
    expect(page.columns).toEqual(["id", "email", "name"]);
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0][0]).toBe(1); // first user's id

    const page2 = await fetchRows(sql, "users", 2, 2);
    expect(page2.rows).toHaveLength(1); // only 3 users seeded

    const clamped = await fetchRows(sql, "users", 9999, -5);
    expect(clamped.limit).toBe(500);
    expect(clamped.offset).toBe(0);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test tests/postgres.test.ts -t "fetchRows"`
Expected: FAIL — `fetchRows is not a function`.

- [ ] **Step 3: Implement `Page` + `fetchRows` in `sidecar/src/postgres.ts`**

```ts
export interface Page {
  columns: string[];
  rows: unknown[][];
  limit: number;
  offset: number;
}

export async function fetchRows(
  sql: Sql,
  table: string,
  limit = 50,
  offset = 0,
): Promise<Page> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const safeOffset = Math.max(Math.trunc(offset), 0);

  // Order by primary key when present, else by all columns, for stable paging.
  const result = await sql`
    SELECT * FROM ${sql(table)}
    ORDER BY 1
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `;

  const columns = result.columns.map((c) => c.name);
  const rows = result.map((r) => columns.map((c) => (r as Record<string, unknown>)[c]));

  return { columns, rows, limit: safeLimit, offset: safeOffset };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test tests/postgres.test.ts -t "fetchRows"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sidecar/src/postgres.ts sidecar/tests/postgres.test.ts
git commit -m "feat(sidecar): paged, identifier-safe row fetch with clamping"
```

---

### Task 7: `introspect()` — assemble the full Graph

**Files:**
- Modify: `sidecar/src/postgres.ts`
- Create: `sidecar/tests/introspect.test.ts`

**Interfaces:**
- Consumes: `connect`, `listNodes`, `attachColumns`, `buildForeignKeyEdges`, `attachRowCounts`, `Graph`.
- Produces:
  - `async function introspect(connectionString: string): Promise<Graph>` — opens a connection, runs node listing → columns → row counts → FK edges, closes the connection (even on error), and returns the assembled `Graph`. This is the single entry point a transport layer (future plan) will call.

- [ ] **Step 1: Write the failing test `sidecar/tests/introspect.test.ts`**

```ts
import { expect, test, beforeAll } from "bun:test";
import { introspect } from "../src/postgres";
import { seed, TEST_CONN } from "./helpers/testdb";

beforeAll(async () => {
  await seed();
});

test("introspect returns a complete Graph for the seed database", async () => {
  const graph = await introspect(TEST_CONN);

  const names = graph.nodes.map((n) => n.name).sort();
  expect(names).toEqual(["active_users", "orders", "users"]);

  const users = graph.nodes.find((n) => n.name === "users")!;
  expect(users.columns.map((c) => c.name)).toEqual(["id", "email", "name"]);
  expect(users.columns.find((c) => c.name === "id")!.isPK).toBe(true);
  expect(users.rowCount).toBe(3);

  expect(graph.edges).toHaveLength(1);
  expect(graph.edges[0].from).toBe("public.orders");
  expect(graph.edges[0].to).toBe("public.users");

  const orders = graph.nodes.find((n) => n.name === "orders")!;
  expect(orders.columns.find((c) => c.name === "user_id")!.isFK).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sidecar && bun test tests/introspect.test.ts`
Expected: FAIL — `introspect is not a function`.

- [ ] **Step 3: Implement `introspect` in `sidecar/src/postgres.ts`**

```ts
import type { Node, Column, Edge, Graph } from "./schema";

export async function introspect(connectionString: string): Promise<Graph> {
  const sql = connect(connectionString);
  try {
    const nodes = await listNodes(sql);
    await attachColumns(sql, nodes);
    await attachRowCounts(sql, nodes);
    const edges = await buildForeignKeyEdges(sql, nodes);
    return { nodes, edges };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sidecar && bun test tests/introspect.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `cd sidecar && bun test`
Expected: PASS (all files: schema, postgres, introspect).

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/postgres.ts sidecar/tests/introspect.test.ts
git commit -m "feat(sidecar): introspect() assembles the full Postgres Graph"
```

---

## Self-Review

**Spec coverage (this plan's slice = MVP Postgres introspection):**
- Unified `Graph` contract → Task 1. ✅
- Tables/views as nodes → Task 2. ✅
- Columns, types, nullability, PK → Task 3. ✅
- FK relation edges + `isFK` → Task 4. ✅
- Fast row-count estimate (`pg_class.reltuples`, avoid `COUNT(*)`) → Task 5. ✅
- Rows on demand, paged (`LIMIT/OFFSET`) → Task 6. ✅
- Single `introspect()` entry point for the future transport layer → Task 7. ✅
- *Deferred (other plans, by design):* WebSocket transport, Tauri shell + keychain credentials, Mongo sampled schema, 3D frontend. Noted in Global Constraints.

**Placeholder scan:** No TBD/TODO; every code step contains full code and exact run commands. ✅

**Type consistency:** `Graph`/`Node`/`Column`/`Edge` defined in Task 1 and used unchanged in Tasks 2–7. Function names (`connect`, `listNodes`, `attachColumns`, `buildForeignKeyEdges`, `attachRowCounts`, `fetchRows`, `introspect`) are stable across their producing and consuming tasks. `Page` introduced and used only in Task 6. ✅

**Known limitations (intentional, documented):** composite FKs skipped; `public` schema only; views report `rowCount: 0`.
