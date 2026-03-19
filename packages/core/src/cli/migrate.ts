import { getDb } from "../db/connection.js";

getDb();
console.log("SQLite migrations applied.");
