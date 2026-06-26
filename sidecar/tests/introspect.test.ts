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
