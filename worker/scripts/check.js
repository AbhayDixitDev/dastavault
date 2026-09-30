// Runs `node --check` on every .js file under src/ and scripts/ (syntax check, cross-platform).
import { readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.js')) out.push(p)
  }
  return out
}

const files = [...walk(join(root, 'src')), ...walk(join(root, 'scripts'))]
let failed = 0
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
  if (r.status === 0) console.log(`ok   ${f}`)
  else {
    failed++
    console.error(`FAIL ${f}\n${r.stderr}`)
  }
}
console.log(`\n${files.length - failed}/${files.length} files passed`)
process.exit(failed ? 1 : 0)
