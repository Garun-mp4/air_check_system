import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export async function migrate(client, directory) {
  await client.query('SELECT pg_advisory_lock(612347819)')
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())')
    const files = (await readdir(directory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort()
    if (!files.length) throw new Error('No migration files found')
    for (const name of files) {
      const sql = await readFile(path.join(directory, name), 'utf8')
      const sha = createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex')
      const existing = await client.query('SELECT sha256 FROM schema_migrations WHERE name=$1', [name])
      if (existing.rowCount) {
        if (existing.rows[0].sha256 !== sha) throw new Error(`Applied migration changed: ${name}`)
        continue
      }
      await client.query('BEGIN')
      try {
        // Existing scripts are idempotent and some have their own outer transaction.
        // Remove only standalone transaction delimiters; PL/pgSQL BEGIN blocks remain.
        await client.query(sql.replace(/^(?:BEGIN|COMMIT);\r?$/gm, ''))
        await client.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)', [name, sha])
        await client.query('COMMIT')
        process.stdout.write(`Applied ${name}\n`)
      } catch (error) { await client.query('ROLLBACK'); throw error }
    }
    return files.length
  } finally { await client.query('SELECT pg_advisory_unlock(612347819)') }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  try {
    await client.connect()
    const count = await migrate(client, process.env.MIGRATIONS_DIR ?? '/migrations')
    process.stdout.write(`Schema ready: ${count} migrations\n`)
  } catch (error) {
    // A DB error may contain credentials/SQL. Report only safe identity.
    process.stderr.write(`Migration failed (${error.code ?? error.name}); schema was not declared ready\n`)
    process.exitCode = 1
  } finally { await client.end() }
}
