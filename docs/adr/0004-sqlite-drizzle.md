# ADR 0004 - SQLite + Drizzle

## Status

Accepted after Spike 4 dry-run.

## Decision

Keep SQLite with `better-sqlite3` and use Drizzle for schema and typed queries.

Spike 4 scanned the V1 database successfully and the orphan policy was accepted:
nullable contact phone is valid, orphan dependents can be skipped, and a full
resync belongs to stabilization.
