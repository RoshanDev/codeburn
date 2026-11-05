import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverCliAuth } from '../src/quota/antigravity-cli-auth.js'
import { discoverCliAuth as desktopAuth } from '../app/electron/quota/antigravity-cli-auth.js'

describe.each([['CLI', discoverCliAuth], ['Electron', desktopAuth]])('%s agy local authentication', (_name, discover) => {
  it.skipIf(process.platform !== 'linux')('discovers only descendant loopback credentials and expires them on PID reuse', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codeburn-agy-auth-'))
    const procRoot = join(root, 'proc'), runtimeDir = join(root, 'runtime')
    const processEntry = async (pid: string, parent: string, started: string, env = '') => {
      await mkdir(join(procRoot, pid), { recursive: true })
      const fields = Array(20).fill('0'); fields[0] = 'S'; fields[1] = parent; fields[19] = started
      await writeFile(join(procRoot, pid, 'stat'), `${pid} (name with spaces) ${fields.join(' ')}`)
      await writeFile(join(procRoot, pid, 'environ'), env)
    }
    const env = (address: string) => `ANTIGRAVITY_LS_ADDRESS=${address}\0ANTIGRAVITY_CSRF_TOKEN=fixture-local-token\0`
    try {
      await processEntry('10', '0', '100')
      await processEntry('11', '0', '101', env('localhost:44000'))
      expect(await discover('10', [44000], { procRoot, runtimeDir })).toBeUndefined()
      await processEntry('12', '10', '102', env('example.com:44000'))
      expect(await discover('10', [44000], { procRoot, runtimeDir })).toBeUndefined()
      await processEntry('12', '10', '102', env('localhost:44000'))
      expect(await discover('10', [44001], { procRoot, runtimeDir })).toBeUndefined()
      const auth = { port: 44000, csrf: 'fixture-local-token' }
      expect(await discover('10', [44000], { procRoot, runtimeDir })).toEqual(auth)
      expect((await stat(runtimeDir)).mode & 0o777).toBe(0o700)
      expect((await stat(join(runtimeDir, '10.json'))).mode & 0o777).toBe(0o600)
      await rm(join(procRoot, '12'), { recursive: true })
      expect(await discover('10', [44000], { procRoot, runtimeDir })).toEqual(auth)
      await processEntry('10', '0', '200')
      expect(await discover('10', [44000], { procRoot, runtimeDir })).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
