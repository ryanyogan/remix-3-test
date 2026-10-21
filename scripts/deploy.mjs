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
// Migrate D1 before either Worker ships, so new code never meets an old schema. Migrations must
// therefore stay additive: the previous Workers keep serving until their deploys finish.
if (!args.includes('--dry-run')) {
  let profileIndex = args.indexOf('--profile')
  run(['cf:migrate', ...(profileIndex === -1 ? [] : ['--profile', args[profileIndex + 1]])])
}
for (let name of ['@trellix/api', '@trellix/web']) run(['--filter', name, 'cf:deploy', ...args])

function run(pnpmArgs) {
  let result = spawnSync('pnpm', pnpmArgs, { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
