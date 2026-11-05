// Antigravity lifecycle hook. Only local RPC credentials are retained, in
// /run/user (cleared on logout/reboot). Never read or echo hook stdin/chat data.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

try {
  if (process.platform === 'linux') {
    const address = process.env.ANTIGRAVITY_LS_ADDRESS?.match(/^(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)$/)
    const port = Number(address?.[1])
    const csrf = process.env.ANTIGRAVITY_CSRF_TOKEN
    if (port > 0 && port < 65536 && csrf && csrf.length < 4096 && !/[\r\n\0]/.test(csrf)) {
      let pid = String(process.ppid)
      for (let depth = 0; depth < 64 && pid !== '0'; depth++) {
        const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
        const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)
        if ((await readFile(`/proc/${pid}/comm`, 'utf8')).trim() === 'agy') {
          const runtimeDir = `/run/user/${process.getuid()}/codeburn-antigravity`
          await mkdir(runtimeDir, { recursive: true, mode: 0o700 })
          const path = join(runtimeDir, `${pid}.json`)
          const temp = `${path}.${process.pid}.tmp`
          await writeFile(temp, JSON.stringify({ port, csrf, started: fields[19] }), { mode: 0o600 })
          await rename(temp, path)
          break
        }
        pid = fields[1]
      }
    }
  }
} catch { /* Local quota integration must never interfere with agy. */ }
console.log('{}')
