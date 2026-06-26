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
