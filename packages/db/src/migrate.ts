/**
 * Standalone migration runner. Invoke via `npm run db:migrate -w @nuoma/db`.
 */
import { defaultMigrationsFolder, openDb, runMigrations } from "./index.js";

async function main() {
  const url = process.env.DATABASE_URL ?? "../../data/nuoma-v2.db";
  console.log(`[@nuoma/db] migrating ${url} from ${defaultMigrationsFolder}`);
  const handle = openDb(url);
  try {
    await runMigrations(handle);
    console.log("[@nuoma/db] migration done");
  } finally {
    handle.close();
  }
}

main().catch((err) => {
  console.error("[@nuoma/db] migration failed", err);
  process.exit(1);
});
