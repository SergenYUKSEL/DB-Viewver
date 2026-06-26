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
