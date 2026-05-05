import type { Config } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL ?? "../../data/nuoma-v2.db";

export default {
  schema: "./src/schema.ts",
  out: "./src/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
} satisfies Config;
