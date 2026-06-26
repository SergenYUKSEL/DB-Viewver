import { expect, test, beforeAll } from "bun:test";
import { connect, listNodes, attachColumns } from "../src/postgres";
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
