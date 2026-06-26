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
