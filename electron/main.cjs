const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  Notification,
  dialog,
  ipcMain,
  nativeImage,
  net,
  session,
  shell,
} = require('electron')
const fs = require('fs')
const path = require('path')
const { createStorage } = require('./storage.cjs')

// Veri klasörü sabit: ürün adı değişse bile eski veri bulunur.
// FINANS_TAKIP_USER_DATA yalnızca test/geliştirme içindir.
app.setPath('userData', process.env.FINANS_TAKIP_USER_DATA || path.join(app.getPath('appData'), 'finans-takip'))
app.setAppUserModelId('com.kaancanolcay.finanstakip')

// Aynı anda iki pencere aynı veriyi yazarsa biri diğerinin değişikliklerini
// siler. İkinci açılış mevcut pencereyi öne getirir.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  main()
}

function main() {
  const storage = createStorage(app.getPath('userData'))
  const devUrl = process.env.VITE_DEV_SERVER_URL
  const iconPath = path.join(__dirname, 'assets', 'icon.png')
  const windowStateFile = path.join(app.getPath('userData'), 'window-state.json')
  /** @type {BrowserWindow | null} */
  let win = null
  /** @type {Tray | null} */
  let tray = null
  let quitting = false

  app.on('second-instance', () => showWindow())

  function readWindowState() {
    try {
      const s = JSON.parse(fs.readFileSync(windowStateFile, 'utf8'))
      if (typeof s.width === 'number' && typeof s.height === 'number') return s
    } catch {
      /* ilk açılış */
    }
    return { width: 1280, height: 860 }
  }

  function saveWindowState() {
    if (!win || win.isDestroyed()) return
    const maximized = win.isMaximized()
    const b = maximized ? win.getNormalBounds() : win.getBounds()
    try {
      fs.writeFileSync(windowStateFile, JSON.stringify({ ...b, maximized }))
    } catch {
      /* önemsiz */
    }
  }

  function createWindow() {
    const st = readWindowState()
    win = new BrowserWindow({
      x: st.x,
      y: st.y,
      width: st.width,
      height: st.height,
      minWidth: 900,
      minHeight: 620,
      title: 'Finans Takip',
      icon: fs.existsSync(iconPath) ? iconPath : undefined,
      backgroundColor: '#f2f5f4',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        devTools: !app.isPackaged,
      },
    })
    if (st.maximized) win.maximize()
    win.once('ready-to-show', () => win && win.show())

    // Uygulama dışına gezinme ve yeni pencere açma yasak; https bağlantıları
    // varsayılan tarayıcıda açılır.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (e, url) => {
      if (devUrl && url.startsWith(devUrl)) return
      if (url.startsWith('file://')) return
      e.preventDefault()
    })

    win.on('close', (e) => {
      saveWindowState()
      if (!quitting && storage.readConfig().closeToTray && tray) {
        e.preventDefault()
        win && win.hide()
      }
    })
    win.on('closed', () => {
      win = null
    })

    if (devUrl) win.loadURL(devUrl)
    else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  function showWindow() {
    if (!win) createWindow()
    else {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  }

  function sendMenu(action) {
    showWindow()
    win && win.webContents.send('menu', action)
  }

  function buildMenu() {
    const template = [
      {
        label: 'Dosya',
        submenu: [
          { label: 'Harcama Ekle', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new-expense') },
          { type: 'separator' },
          { label: 'JSON Yedeği Al…', click: () => sendMenu('backup-json') },
          { label: 'Excel Yedeği Al…', click: () => sendMenu('backup-excel') },
          { label: 'Yedek Klasörünü Aç', click: () => shell.openPath(storage.paths.backupDir) },
          { type: 'separator' },
          { label: 'Ayarlar', accelerator: 'CmdOrCtrl+,', click: () => sendMenu('settings') },
          { type: 'separator' },
          { label: 'Çıkış', accelerator: 'CmdOrCtrl+Q', click: () => quit() },
        ],
      },
      {
        label: 'Düzen',
        submenu: [
          { role: 'undo', label: 'Geri Al' },
          { role: 'redo', label: 'Yinele' },
          { type: 'separator' },
          { role: 'cut', label: 'Kes' },
          { role: 'copy', label: 'Kopyala' },
          { role: 'paste', label: 'Yapıştır' },
          { role: 'selectAll', label: 'Tümünü Seç' },
        ],
      },
      {
        label: 'Görünüm',
        submenu: [
          { role: 'zoomIn', label: 'Yakınlaştır', accelerator: 'CmdOrCtrl+=' },
          { role: 'zoomOut', label: 'Uzaklaştır' },
          { role: 'resetZoom', label: 'Gerçek Boyut' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Tam Ekran' },
          ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
        ],
      },
      {
        label: 'Yardım',
        submenu: [
          { label: 'Nasıl Kullanılır?', accelerator: 'F1', click: () => sendMenu('help') },
          { label: 'Güncellemeleri Denetle', click: () => checkForUpdates(true) },
          { label: `Sürüm ${app.getVersion()}`, enabled: false },
        ],
      },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  function createTray() {
    if (tray || !fs.existsSync(iconPath)) return
    const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    tray = new Tray(img)
    tray.setToolTip('Finans Takip')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Finans Takip’i Aç', click: () => showWindow() },
        { label: 'Harcama Ekle', click: () => sendMenu('new-expense') },
        { type: 'separator' },
        { label: 'Çıkış', click: () => quit() },
      ]),
    )
    tray.on('click', () => showWindow())
  }

  function quit() {
    quitting = true
    app.quit()
  }

  // ------------------------------------------------------------ Güncelleme

  // electron-builder, yayın ayarı olan derlemelere app-update.yml ekler
  // (GitHub deposu git remote'tan otomatik bulunur).
  function updaterConfigured() {
    return app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))
  }

  async function checkForUpdates(manual) {
    if (!app.isPackaged || !updaterConfigured()) {
      const reason = !app.isPackaged ? 'Geliştirme sürümünde güncelleme denetlenmez.' : 'Bu kurulum GitHub Releases üzerinden yayınlanmadığı için otomatik güncelleme kapalı.'
      if (manual) dialog.showMessageBox({ type: 'info', message: 'Güncelleme', detail: reason })
      return { status: 'disabled', reason }
    }
    try {
      const { autoUpdater } = require('electron-updater')
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      const res = await autoUpdater.checkForUpdatesAndNotify({
        title: 'Finans Takip güncellemesi hazır',
        body: 'Yeni sürüm {version} indirildi; uygulamayı kapattığınızda kurulacak.',
      })
      const latest = res && res.updateInfo ? res.updateInfo.version : app.getVersion()
      const available = latest !== app.getVersion()
      if (manual) {
        dialog.showMessageBox({
          type: 'info',
          message: available ? `Yeni sürüm bulundu: ${latest}` : 'Uygulama güncel',
          detail: available ? 'Arka planda indiriliyor; kapattığınızda kurulacak.' : `Sürüm ${app.getVersion()}`,
        })
      }
      return { status: available ? 'available' : 'latest', version: latest }
    } catch (err) {
      if (manual) dialog.showMessageBox({ type: 'warning', message: 'Güncelleme denetlenemedi', detail: String(err) })
      return { status: 'error', reason: String(err) }
    }
  }

  // ------------------------------------------------------------ IPC

  function registerIpc() {
    ipcMain.handle('storage:load', () => storage.load())
    ipcMain.handle('storage:save', (_e, text) => storage.save(text))
    ipcMain.on('storage:saveSync', (e, text) => {
      try {
        e.returnValue = storage.save(text)
      } catch (err) {
        e.returnValue = false
      }
    })
    ipcMain.handle('backup:list', () => storage.listBackups())
    ipcMain.handle('backup:read', (_e, name) => storage.readBackup(name))
    ipcMain.handle('backup:create', (_e, label, text) => storage.createBackup(label, text))
    ipcMain.handle('backup:openFolder', () => shell.openPath(storage.paths.backupDir))

    ipcMain.handle('config:get', () => ({
      ...storage.readConfig(),
      encryptionAvailable: storage.encryptionAvailable(),
      paths: storage.paths,
    }))
    ipcMain.handle('config:set', (_e, patch) => {
      const before = storage.readConfig()
      const next = storage.writeConfig(patch)
      if ('encrypt' in patch && patch.encrypt !== before.encrypt) storage.rewriteWithCurrentEncoding()
      if ('startAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.startAtLogin, args: ['--hidden'] })
      if ('closeToTray' in patch && patch.closeToTray) createTray()
      return next
    })
    ipcMain.handle('config:chooseMirrorDir', async () => {
      const r = await dialog.showOpenDialog(win, { title: 'İkinci yedek konumu seçin', properties: ['openDirectory', 'createDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      storage.writeConfig({ backupMirrorDir: r.filePaths[0] })
      return r.filePaths[0]
    })

    ipcMain.handle('file:save', async (_e, { defaultName, data, filters }) => {
      const r = await dialog.showSaveDialog(win, {
        defaultPath: path.join(app.getPath('documents'), defaultName),
        filters,
      })
      if (r.canceled || !r.filePath) return null
      fs.writeFileSync(r.filePath, typeof data === 'string' ? data : Buffer.from(data))
      return r.filePath
    })
    ipcMain.handle('file:open', async (_e, { filters }) => {
      const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters })
      if (r.canceled || !r.filePaths[0]) return null
      const file = r.filePaths[0]
      return { name: path.basename(file), data: new Uint8Array(fs.readFileSync(file)) }
    })
    ipcMain.handle('file:showInFolder', (_e, file) => shell.showItemInFolder(file))

    ipcMain.handle('print:pdf', async (_e, { defaultName, landscape }) => {
      if (!win) return null
      const pdf = await win.webContents.printToPDF({ printBackground: true, landscape: !!landscape, pageSize: 'A4' })
      const r = await dialog.showSaveDialog(win, {
        defaultPath: path.join(app.getPath('documents'), defaultName),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (r.canceled || !r.filePath) return null
      fs.writeFileSync(r.filePath, pdf)
      return r.filePath
    })

    ipcMain.handle('notify', (_e, { title, body }) => {
      if (!Notification.isSupported()) return false
      const n = new Notification({ title, body, icon: fs.existsSync(iconPath) ? iconPath : undefined })
      n.on('click', () => sendMenu('weekly'))
      n.show()
      return true
    })

    // TCMB döviz kurları — yalnızca kullanıcı istediğinde, veri gönderilmez.
    ipcMain.handle('rates:tcmb', async () => {
      const res = await net.fetch('https://www.tcmb.gov.tr/kurlar/today.xml')
      if (!res.ok) throw new Error(`TCMB yanıtı: ${res.status}`)
      const xml = await res.text()
      const pick = (code) => {
        const block = new RegExp(`<Currency[^>]*Kod="${code}"[\\s\\S]*?</Currency>`).exec(xml)
        if (!block) return 0
        const v = /<ForexSelling>([\d.]+)<\/ForexSelling>/.exec(block[0])
        return v ? Number(v[1]) : 0
      }
      const date = (/Tarih="([^"]+)"/.exec(xml) || [])[1] || ''
      return { USD: pick('USD'), EUR: pick('EUR'), GBP: pick('GBP'), date }
    })

    ipcMain.handle('app:info', () => ({
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform,
      userData: app.getPath('userData'),
      updaterConfigured: updaterConfigured(),
      loginItem: app.getLoginItemSettings().openAtLogin,
    }))
    ipcMain.handle('update:check', () => checkForUpdates(true))
  }

  app.whenReady().then(() => {
    // Uygulama hiçbir tarayıcı izni (kamera, konum…) istemez.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    registerIpc()
    buildMenu()
    if (storage.readConfig().closeToTray) createTray()
    const hidden = process.argv.includes('--hidden')
    createWindow()
    if (hidden && tray) win && win.once('ready-to-show', () => win && win.hide())
    setTimeout(() => checkForUpdates(false), 15000)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    quitting = true
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
