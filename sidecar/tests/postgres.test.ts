import { expect, test, beforeAll } from "bun:test";
import {
  connect,
  listNodes,
  attachColumns,
  buildForeignKeyEdges,
  attachRowCounts,
  fetchRows,
} from "../src/postgres";
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
