import { Pool } from "pg";
declare global { var telegramDbPool: Pool | undefined; }
export const db = globalThis.telegramDbPool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000, ssl: process.env.DATABASE_URL?.includes("neon.tech") ? { rejectUnauthorized: true } : undefined });
if (process.env.NODE_ENV !== "production") globalThis.telegramDbPool = db;
