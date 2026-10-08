// Uygulama simgesini SVG'den üretir: build/icon.png (512px, kurulum dosyası
// için) ve electron/assets/icon.png (256px, pencere ve sistem tepsisi).
// Çalıştırma: npm run icon   (Electron'un kendi tarayıcısıyla çizer)

const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#059669"/>
      <stop offset="1" stop-color="#0d9488"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="110" fill="url(#g)"/>
  <path d="M120 360 L200 280 L260 320 L392 176" fill="none" stroke="#ffffff" stroke-opacity="0.28" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="256" y="338" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="280" font-weight="700" fill="#ffffff">₺</text>
</svg>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`))
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  const root = path.join(__dirname, '..')
  fs.mkdirSync(path.join(root, 'build'), { recursive: true })
  fs.mkdirSync(path.join(root, 'electron', 'assets'), { recursive: true })
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG())
  fs.writeFileSync(path.join(root, 'electron', 'assets', 'icon.png'), img.resize({ width: 256, height: 256 }).toPNG())
  fs.writeFileSync(path.join(root, 'build', 'icon.svg'), svg)
  console.log('Simgeler yazıldı: build/icon.png, electron/assets/icon.png')
  app.quit()
})
