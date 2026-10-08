// Veri dosyası, otomatik yedekler ve makineye özel ayarlar.
//
// Veri artık tarayıcı deposunda (localStorage) değil, kullanıcı klasöründe
// bir JSON dosyasında tutulur:
//   %APPDATA%\finans-takip\data\finans-takip.json
//   %APPDATA%\finans-takip\backups\*.json      (günlük + işlem öncesi yedekler)
//   %APPDATA%\finans-takip\config.json          (bu bilgisayara özel ayarlar)
//
// Yazma işlemi atomiktir (geçici dosya + yeniden adlandırma): elektrik
// kesilse bile ya eski ya yeni dosya kalır, yarım dosya kalmaz.

const fs = require('fs')
const path = require('path')
const { safeStorage } = require('electron')

const ENC_PREFIX = 'FTENC1:'
const DAILY_KEEP = 30
const LABELED_KEEP = 25

function createStorage(userData) {
  const dataDir = path.join(userData, 'data')
  const backupDir = path.join(userData, 'backups')
  const dataFile = path.join(dataDir, 'finans-takip.json')
  const configFile = path.join(userData, 'config.json')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(backupDir, { recursive: true })

  const defaultConfig = {
    closeToTray: false,
    startAtLogin: false,
    encrypt: false,
    backupMirrorDir: '',
    lastPage: 'dashboard',
  }

  function readConfig() {
    try {
      return { ...defaultConfig, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) }
    } catch {
      return { ...defaultConfig }
    }
  }

  function writeConfig(patch) {
    const next = { ...readConfig(), ...patch }
    atomicWrite(configFile, JSON.stringify(next, null, 2))
    return next
  }

  function atomicWrite(file, content) {
    const tmp = `${file}.${process.pid}.tmp`
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeFileSync(fd, content, 'utf8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, file)
  }

  function encode(text) {
    const cfg = readConfig()
    if (cfg.encrypt && safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(text).toString('base64')
    }
    return text
  }

  function decode(content) {
    if (!content.startsWith(ENC_PREFIX)) return content
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Şifre çözme bu bilgisayarda kullanılamıyor.')
    return safeStorage.decryptString(Buffer.from(content.slice(ENC_PREFIX.length), 'base64'))
  }

  function stamp() {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  }

  function todayStr() {
    return stamp().slice(0, 10)
  }

  /** Veriyi okur. Bozuksa dosyayı kenara taşır, ASLA üzerine yazmaz. */
  function load() {
    if (!fs.existsSync(dataFile)) return { status: 'empty', backups: listBackups() }
    const raw = fs.readFileSync(dataFile, 'utf8')
    try {
      const text = decode(raw)
      JSON.parse(text)
      return { status: 'ok', text, encrypted: raw.startsWith(ENC_PREFIX) }
    } catch (err) {
      const corruptName = `bozuk-${stamp()}.json`
      fs.renameSync(dataFile, path.join(backupDir, corruptName))
      return { status: 'corrupt', reason: String(err && err.message ? err.message : err), movedTo: corruptName, backups: listBackups() }
    }
  }

  /** Günün ilk kaydından önce mevcut dosyanın yedeğini alır. */
  function dailyBackup() {
    if (!fs.existsSync(dataFile)) return
    const name = `gunluk-${todayStr()}.json`
    const target = path.join(backupDir, name)
    if (fs.existsSync(target)) return
    fs.copyFileSync(dataFile, target)
    mirror(target, name)
    prune()
  }

  function mirror(file, name) {
    const dir = readConfig().backupMirrorDir
    if (!dir) return
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(file, path.join(dir, name))
    } catch (err) {
      console.error('İkinci yedek konumuna yazılamadı:', err)
    }
  }

  function save(text) {
    JSON.parse(text) // geçersiz veri asla yazılmaz
    dailyBackup()
    atomicWrite(dataFile, encode(text))
    return true
  }

  /** Etiketli yedek (içe aktarma / geri yükleme / sürüm geçişi öncesi). */
  function createBackup(label, text) {
    const safe = String(label || 'elle').replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ-]/gi, '-').slice(0, 40)
    const name = `${safe}-${stamp()}.json`
    const target = path.join(backupDir, name)
    if (typeof text === 'string') atomicWrite(target, encode(text))
    else if (fs.existsSync(dataFile)) fs.copyFileSync(dataFile, target)
    else return null
    mirror(target, name)
    prune()
    return name
  }

  function listBackups() {
    try {
      return fs
        .readdirSync(backupDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const st = fs.statSync(path.join(backupDir, f))
          return { name: f, size: st.size, mtime: st.mtime.toISOString() }
        })
        .sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
    } catch {
      return []
    }
  }

  function readBackup(name) {
    const file = path.join(backupDir, path.basename(name))
    const text = decode(fs.readFileSync(file, 'utf8'))
    JSON.parse(text)
    return text
  }

  function prune() {
    const all = listBackups()
    const daily = all.filter((b) => b.name.startsWith('gunluk-'))
    const labeled = all.filter((b) => !b.name.startsWith('gunluk-') && !b.name.startsWith('bozuk-'))
    for (const b of [...daily.slice(DAILY_KEEP), ...labeled.slice(LABELED_KEEP)]) {
      try {
        fs.unlinkSync(path.join(backupDir, b.name))
      } catch {
        /* kilitli olabilir, sonraki sefere */
      }
    }
  }

  /** Şifreleme ayarı değişince mevcut dosyayı yeni biçimde yeniden yazar. */
  function rewriteWithCurrentEncoding() {
    if (!fs.existsSync(dataFile)) return
    const text = decode(fs.readFileSync(dataFile, 'utf8'))
    atomicWrite(dataFile, encode(text))
  }

  return {
    paths: { dataDir, backupDir, dataFile, configFile },
    load,
    save,
    createBackup,
    listBackups,
    readBackup,
    readConfig,
    writeConfig,
    rewriteWithCurrentEncoding,
    encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  }
}

module.exports = { createStorage }
