import { cp } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const projectRoot = process.cwd()
const standaloneRoot = path.join(projectRoot, '.next', 'standalone')

await cp(
  path.join(projectRoot, '.next', 'static'),
  path.join(standaloneRoot, '.next', 'static'),
  { recursive: true, force: true },
)

try {
  await cp(
    path.join(projectRoot, 'public'),
    path.join(standaloneRoot, 'public'),
    { recursive: true, force: true },
  )
} catch (error) {
  if (error?.code !== 'ENOENT') {
    throw error
  }
}

const child = spawn(process.execPath, ['server.js'], {
  cwd: standaloneRoot,
  env: {
    ...process.env,
    HOSTNAME: process.env.HOSTNAME ?? '0.0.0.0',
  },
  stdio: 'inherit',
})

const forwardSignal = (signal) => {
  child.kill(signal)
}

process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
  } else {
    process.exit(code ?? 1)
  }
})
