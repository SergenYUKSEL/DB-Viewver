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
