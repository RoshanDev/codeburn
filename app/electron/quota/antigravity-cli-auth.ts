import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type LocalAuth = { port: number; csrf: string }
type ProcessIdentity = { parent: string; started: string }

// agy 1.4 passes local RPC credentials to tool subprocesses, not command-line
// flags. Retain only these local credentials in the private login runtime dir,
// bound to the server PID/start time, so polls survive the tool subprocess.
export async function discoverCliAuth(
  pid: string,
  ports: number[],
  options: { procRoot?: string; runtimeDir?: string } = {},
): Promise<LocalAuth | undefined> {
  if (process.platform !== 'linux' || !/^\d+$/.test(pid)) return undefined
  const procRoot = options.procRoot ?? '/proc'
  const runtimeDir = options.runtimeDir ?? `/run/user/${process.getuid!()}/codeburn-antigravity`
  const identity = async (id: string): Promise<ProcessIdentity> => {
    const stat = await readFile(join(procRoot, id, 'stat'), 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)
    if (!fields[19] || !/^\d+$/.test(fields[1]!)) throw new Error('Invalid process identity')
    return { parent: fields[1]!, started: fields[19]! }
  }
  try {
    const server = await identity(pid)
    const cachePath = join(runtimeDir, `${pid}.json`)
    const valid = (auth: LocalAuth) => ports.includes(auth.port)
      && typeof auth.csrf === 'string' && auth.csrf.length > 0 && auth.csrf.length < 4096
      && !/[\r\n\0]/.test(auth.csrf)
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8'))
      if (cached.started === server.started && valid(cached)) return { port: cached.port, csrf: cached.csrf }
    } catch { /* first poll, or credentials from a previous process */ }
    const parents = new Map<string, string>()
    await Promise.all((await readdir(procRoot)).filter(id => /^\d+$/.test(id)).map(async id => {
      try { parents.set(id, (await identity(id)).parent) } catch { /* process exited */ }
    }))
    for (const child of parents.keys()) {
      if (child === pid) continue
      let ancestor = child
      for (let depth = 0; depth < 64 && ancestor !== '0' && ancestor !== pid; depth++) {
        ancestor = parents.get(ancestor) ?? '0'
      }
      if (ancestor !== pid) continue
      try {
        const env = Object.fromEntries((await readFile(join(procRoot, child, 'environ'), 'utf8'))
          .split('\0').filter(entry => entry.includes('='))
          .map(entry => { const at = entry.indexOf('='); return [entry.slice(0, at), entry.slice(at + 1)] }))
        const address = env.ANTIGRAVITY_LS_ADDRESS?.match(/^(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)$/)
        const auth = { port: Number(address?.[1]), csrf: env.ANTIGRAVITY_CSRF_TOKEN! }
        if (!address || !valid(auth)) continue
        if ((await identity(pid)).started !== server.started) continue
        try {
          await mkdir(runtimeDir, { recursive: true, mode: 0o700 })
          const temp = `${cachePath}.${process.pid}.tmp`
          await writeFile(temp, JSON.stringify({ ...auth, started: server.started }), { mode: 0o600 })
          await rename(temp, cachePath)
        } catch { /* cache failure must not prevent this poll */ }
        return auth
      } catch { /* subprocesses can exit during discovery */ }
    }
  } catch { /* process exited, /proc unavailable, or permission denied */ }
  return undefined
}
