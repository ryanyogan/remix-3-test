import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

// Apply flags to BOTH builds. In particular --dry-run must never deploy either Worker.
let args = process.argv.slice(2)
let secretIndex = args.indexOf('--secrets-file')
if (secretIndex !== -1) {
  if (!args[secretIndex + 1]) throw Error('--secrets-file requires a path')
  // Resolve once from workspace root so both Workers receive exactly the same file.
  args[secretIndex + 1] = resolve(args[secretIndex + 1])
}
for (let name of ['@trellix/api', '@trellix/web']) {
  let result = spawnSync('pnpm', ['--filter', name, 'cf:deploy', ...args], { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
