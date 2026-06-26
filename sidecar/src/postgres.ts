import postgres, { type Sql } from "postgres";
import type { Node, Column, Edge } from "./schema";

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
