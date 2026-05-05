/**
 * Development seed. Invoke via `npm run db:seed -w @nuoma/db`.
 */
import argon2 from "argon2";

import { createRepositories, openDb } from "./index.js";

async function main() {
  const url = process.env.DATABASE_URL ?? "../../data/nuoma-v2.db";
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@nuoma.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "nuoma-dev-admin-123";

  const handle = openDb(url);
  const repos = createRepositories(handle);

  try {
    const existing = await repos.users.findByEmail(adminEmail);
    if (existing) {
      console.log(`[@nuoma/db] admin already exists: ${adminEmail}`);
      return;
    }

    const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
    const user = await repos.users.create({
      email: adminEmail,
      passwordHash,
      role: "admin",
      displayName: "Admin",
    });

    await repos.auditLogs.create({
      userId: user.id,
      actorUserId: user.id,
      action: "seed_admin",
      targetTable: "users",
      targetId: user.id,
      after: JSON.stringify({ email: adminEmail, role: "admin" }),
    });

    console.log(`[@nuoma/db] seeded admin: ${adminEmail}`);
  } finally {
    handle.close();
  }
}

main().catch((err) => {
  console.error("[@nuoma/db] seed failed", err);
  process.exit(1);
});
