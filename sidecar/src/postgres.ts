import postgres, { type Sql } from "postgres";
import type { Node, Column } from "./schema";

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
