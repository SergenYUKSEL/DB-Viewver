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
