import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

import { hashPassword } from 'better-auth/crypto'
import { Pool } from 'pg'

const mode = process.argv[2]
const passwordFromStdin = process.argv.includes('--password-stdin')
const positionalArguments = process.argv.slice(3).filter((argument) => argument !== '--password-stdin')
const emailArgument = positionalArguments[0]
if (!['bootstrap', 'recover'].includes(mode)) {
  console.error('Usage: node scripts/manage-owner.mjs <bootstrap|recover> [email] [--password-stdin]')
  process.exit(2)
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required; run the command inside the backend container or export it first.')
  process.exit(2)
}

if (passwordFromStdin && !emailArgument) {
  console.error('An email address argument is required with --password-stdin.')
  process.exit(2)
}

const readline = passwordFromStdin ? null : createInterface({ input: stdin, output: stdout })

function question(prompt) {
  if (!readline) throw new Error('An email argument is required when reading the password from stdin.')
  return new Promise((resolve) => readline.question(prompt, resolve))
}

async function hiddenQuestion(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('A terminal is required so the password is not echoed. Use docker compose exec -it backend ...')
  }
  stdout.write(prompt)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  let value = ''
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          cleanup()
          reject(new Error('Cancelled'))
          return
        }
        if (char === '\r' || char === '\n') {
          cleanup()
          stdout.write('\n')
          resolve(value)
          return
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
        } else if (char >= ' ') {
          value += char
        }
      }
    }
    const cleanup = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
    }
    stdin.on('data', onData)
  })
}

async function readPasswordInput() {
  let input = ''
  for await (const chunk of stdin) input += chunk
  const lines = input.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  if (lines.length !== 2) throw new Error('Password input must contain exactly two lines.')
  return lines
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
const client = await pool.connect()

try {
  const email = (emailArgument ?? (mode === 'bootstrap' ? await question('Owner email: ') : '')).trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email address is required.')
  const [password, confirmation] = passwordFromStdin
    ? await readPasswordInput()
    : [await hiddenQuestion('New owner password (12+ characters): '), await hiddenQuestion('Repeat password: ')]
  if (password.length < 12 || password.length > 128) throw new Error('Password must contain 12–128 characters.')
  if (password !== confirmation) throw new Error('Passwords do not match.')
  const passwordHash = await hashPassword(password)

  await client.query('BEGIN')
  await client.query("SELECT pg_advisory_xact_lock(hashtext('aircheck-owner-bootstrap'))")

  if (mode === 'bootstrap') {
    const owner = await client.query("SELECT user_id FROM aircheck_access_roles WHERE role = 'owner' LIMIT 1")
    if (owner.rowCount) throw new Error('An owner already exists. Use recover with that owner email instead.')
  }

  let user = await client.query('SELECT id FROM "user" WHERE lower(email) = $1 FOR UPDATE', [email])
  let userId = user.rows[0]?.id
  if (!userId) {
    if (mode === 'recover') throw new Error('No account exists for this email.')
    userId = randomUUID()
    const name = email.split('@')[0].slice(0, 80) || 'AirCheck owner'
    await client.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, TRUE, NOW(), NOW())`,
      [userId, name, email],
    )
  }

  if (mode === 'recover') {
    const role = await client.query("SELECT role FROM aircheck_access_roles WHERE user_id = $1", [userId])
    if (role.rows[0]?.role !== 'owner') throw new Error('The requested account is not the configured owner.')
  }

  await client.query(
    `INSERT INTO "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
     VALUES ($1, $2, 'credential', $2, $3, NOW(), NOW())
     ON CONFLICT ("providerId", "accountId") DO UPDATE SET password = EXCLUDED.password, "updatedAt" = NOW()`,
    [randomUUID(), userId, passwordHash],
  )
  if (mode === 'bootstrap') {
    await client.query(
      `INSERT INTO aircheck_access_roles (user_id, role, operator_expires_at)
       VALUES ($1, 'owner', NULL)
       ON CONFLICT (user_id) DO UPDATE SET role = 'owner', operator_expires_at = NULL, updated_at = NOW()`,
      [userId],
    )
  }
  await client.query('DELETE FROM "session" WHERE "userId" = $1', [userId])
  await client.query(
    `INSERT INTO aircheck_access_audit (actor_user_id, subject_user_id, action, previous_role, new_role)
     VALUES ($1, $1, $2, $3, $4)`,
    [userId, mode === 'bootstrap' ? 'owner.bootstrapped' : 'owner.password_recovered', mode === 'bootstrap' ? null : 'owner', 'owner'],
  )
  await client.query('COMMIT')
  console.log(mode === 'bootstrap' ? `Owner created for ${email}.` : `Owner password recovered for ${email}.`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  console.error(error instanceof Error ? error.message : 'Owner operation failed.')
  process.exitCode = 1
} finally {
  readline?.close()
  client.release()
  await pool.end()
}
