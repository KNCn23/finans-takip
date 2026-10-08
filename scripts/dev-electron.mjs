// Geliştirme: Vite sunucusunu başlatır, ardından Electron'u ona bağlar.
// Veri, gerçek kurulumu etkilememesi için ayrı bir klasörde tutulur.
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const electron = require('electron')

const server = await createServer({ server: { port: 5173 } })
await server.listen()
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/'

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: url,
    FINANS_TAKIP_USER_DATA: process.env.FINANS_TAKIP_USER_DATA ?? join(tmpdir(), 'finans-takip-dev'),
  },
})
child.on('exit', async (code) => {
  await server.close()
  process.exit(code ?? 0)
})
