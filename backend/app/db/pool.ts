import { Pool } from "pg";

// Singleton pool — reused across all API route invocations in the same
// Node.js process. Next.js dev mode hot-reloads modules, so we store the
// pool on the global object to avoid exhausting connections on every edit.
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. " +
        "Add it to backend/.env.local before starting the server."
    );
  }
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    application_name: "claimguard-web",
  });
  pool.on("error", (err) => {
    console.error("[pg pool] Unexpected error on idle client:", err);
  });
  return pool;
}

const pool: Pool =
  process.env.NODE_ENV === "development"
    ? (global.__pgPool ??= createPool())
    : createPool();

export default pool;
