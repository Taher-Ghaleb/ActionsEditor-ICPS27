import { spawn } from 'node:child_process'

const processes = [
  {
    name: 'backend',
    color: '\x1b[36m',
    command: 'python3',
    args: ['backend/server.py'],
  },
  {
    name: 'frontend',
    color: '\x1b[35m',
    command: 'npm',
    args: ['run', 'dev'],
  },
]

const reset = '\x1b[0m'
const children = []
let shuttingDown = false

function log(name, color, chunk) {
  const text = chunk.toString().split('\n').filter(Boolean)
  text.forEach(line => {
    process.stdout.write(`${color}[${name}]${reset} ${line}\n`)
  })
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true

  children.forEach(child => {
    if (!child.killed) child.kill('SIGTERM')
  })

  setTimeout(() => process.exit(code), 100)
}

processes.forEach(proc => {
  const child = spawn(proc.command, proc.args, {
    cwd: process.cwd(),
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  })

  children.push(child)

  child.stdout.on('data', chunk => log(proc.name, proc.color, chunk))
  child.stderr.on('data', chunk => log(proc.name, proc.color, chunk))

  child.on('exit', code => {
    if (shuttingDown) return
    process.stderr.write(`${proc.color}[${proc.name}]${reset} exited with code ${code ?? 0}\n`)
    shutdown(code ?? 0)
  })
})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
