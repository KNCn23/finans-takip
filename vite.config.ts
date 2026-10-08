/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// Üretim derlemesinde sıkı bir Content-Security-Policy ekler. Geliştirme
// sunucusu (HMR) satır içi betik kullandığı için orada eklenmez.
function csp(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      ),
  }
}

export default defineConfig({
  plugins: [react(), csp()],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // xlsx (SheetJS) ~500 kB'lık ayrı bir parça; yalnızca Excel işlemlerinde yüklenir
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 600 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
