# Finans Takip

Şirketler ve kişiler için masaüstü finans yönetimi: nakit akışı, banka hesapları,
cari hesaplar, çek/senet, kredi, kredi kartı ve bütçe takibi.

Electron + React + TypeScript ile yazılmıştır. Windows, macOS ve Linux'ta çalışır.
**Verileriniz yalnızca kendi bilgisayarınızda saklanır.** İnternete veri gönderilmez.

- **Sürüm:** 2.0.0 ([değişiklikler](CHANGELOG.md))
- **Lisans:** MIT

---

## Özellikler

| Alan | Neler var |
|---|---|
| **Özet** | Harcanabilir bakiye, kredi ve kart borcu, gecikmiş ödemeler, bütçe uyarıları, 8 haftalık nakit akışı |
| **Haftalık takvim** | 4–26 hafta ileriye dönük vadeler, her haftanın sonunda tahmini bakiye |
| **Hesaplar** | Vadesiz, kasa, KMH (limit ve faiz tahmini), vadeli mevduat (vade sonu tutarı), dövizli ve altın hesaplar, virman, hesap hareketleri, banka ekstresi (CSV/Excel) içe aktarma |
| **Gelir / gider** | Tek seferlik, haftalık ve aylık kayıtlar; tekrarlayan kaydın tek bir ayını değiştirme veya atlama |
| **Ödendi işaretleme** | Hangi hesaptan ve hangi tutarla ödendiği sorulur, bakiye kendiliğinden güncellenir. İşaret kaldırılınca bakiye geri gelir |
| **Kredi kartları** | Kesim gününe göre ekstre dönemleri, taksitli alışveriş, bankadan gelen gerçek ekstre tutarını girme, geçmiş ödenmemiş ekstreler |
| **Krediler** | Taksit planı, anapara/faiz ayrımı, kalan anapara (erken kapama tutarı), değişken taksit, erken kapama |
| **Cari hesaplar** | Açılış bakiyesi, tekrarlayan kayıtlar dahil alacak/borç, cari ekstresi (PDF/Excel) |
| **Çek / senet** | Alınan/verilen çek ve senet, ciro, karşılıksız, portföy hareket geçmişi |
| **Bütçe** | Aylık veya yıllık limit, devreden bütçe, geçmiş aylar, yıllık tablo, gerçekleşen/planlanan ayrımı |
| **Raporlar** | Aylık/yıllık; gerçekleşen ve planlanan ayrı; kategori dağılımı; PDF ve Excel çıktısı |
| **Çoklu şirket** | Holding görünümü (konsolide) veya tek şirket |
| **Güvenlik** | PIN kilidi (hareketsiz kalınca kilitlenme), isteğe bağlı veri dosyası şifreleme (Windows DPAPI) |
| **Yedekleme** | Her gün otomatik yedek (son 30 gün), ikinci yedek konumu (ör. OneDrive), JSON ve Excel yedek, içe aktarma öncesi otomatik yedek |
| **Kullanım kolaylığı** | Koyu tema, klavye kısayolları, her değişiklikte "Geri al", vade hatırlatma bildirimleri, sistem tepsisi |

Türkçe tutar yazımını anlar: `8.750`, `1.250.000` ve `1.250,50` doğru okunur. Okunamayan
bir tutar sessizce 0 olarak kaydedilmez, form hata gösterir. Tutarlar kuruş cinsinden
tamsayı tutulduğu için yuvarlama hatası birikmez. Kredi, kart ve çek vadeleri hafta sonuna
veya resmi tatile denk gelirse sonraki iş gününe kaydırılır.

---

## İndirme ve kurulum

Hazır kurulum dosyaları **[Releases](../../releases)** sayfasındadır:

| Platform | Dosya |
|---|---|
| Windows | `Finans Takip Setup x.y.z.exe` |
| macOS | `Finans Takip-x.y.z.dmg` |
| Linux | `Finans Takip-x.y.z.AppImage` |

Kurulu uygulama yeni sürümleri kendiliğinden indirir ve kapatırken kurar.

> Kurulum dosyaları kod imzası olmadan dağıtıldığında Windows SmartScreen uyarı verir:
> **Ek bilgi → Yine de çalıştır**. İmzalama için aşağıdaki "Kod imzalama" bölümüne bakın.

### 1.x sürümünden geçiş

2.0 ilk açılışta 1.x verisini **kendiliğinden** yeni biçime taşır:

- Ham 1.x verisi yedek klasörüne `ilk-surum-verisi-*.json` adıyla kaydedilir. Eski kopya
  silinmez.
- Tutarlar, ödendi işaretleri, kartlar ve kategoriler kayıpsız aktarılır.
- 1.x'te ayın 29-31'inde kayan aylık kayıtların "ödendi" işaretleri doğru vadeye taşınır.
- Geçişin özeti ilk açılışta ekranın üstünde gösterilir.

---

## Verileriniz nerede?

| | Windows |
|---|---|
| Veri dosyası | `%APPDATA%\finans-takip\data\finans-takip.json` |
| Otomatik yedekler | `%APPDATA%\finans-takip\backups\` |
| Bu bilgisayara özel ayarlar | `%APPDATA%\finans-takip\config.json` |

- Dosyaya **atomik** yazılır. Elektrik kesilse bile yarım dosya kalmaz.
- Veri dosyası okunamazsa üzerine **asla yazılmaz**. Dosya `bozuk-*.json` adıyla yedek
  klasörüne taşınır ve uygulama yedekten geri dönmeyi önerir.
- Uygulama aynı anda yalnızca bir kez açılabilir. İkinci açılış mevcut pencereyi öne getirir.
- Kaldırma işlemi verileri silmez.

---

## Geliştirme

Gereksinim: [Node.js](https://nodejs.org) 20 veya üzeri.

```bash
npm ci
npm run dev:electron   # Vite + Electron (veriler geçici bir klasörde tutulur)
npm run dev            # yalnızca tarayıcıda (veri localStorage'da)
npm test               # birim testleri (Vitest)
npm run typecheck      # TypeScript denetimi
```

### Kurulum dosyası üretme

```bash
npm run dist:win       # Windows (macOS: dist:mac, Linux: dist:linux)
```

Çıktılar `release/` klasörüne yazılır. Her platformun kurulum dosyası kendi işletim
sisteminde üretilmelidir. Üç platform birden için GitHub Actions'ı kullanın.

**Windows'ta "Cannot create symbolic link" hatası:** electron-builder imzalama araçlarını
açarken sembolik bağlantı oluşturur. Bunun için Windows'ta **Geliştirici Modu** gerekir
(Ayarlar → Gizlilik ve güvenlik → Geliştiriciler için). Diğer seçenek terminali yönetici
olarak çalıştırmaktır. Ardından şunu çalıştırın:
`rm -rf "$LOCALAPPDATA/electron-builder/Cache/winCodeSign"`. GitHub Actions'ta bu sorun
yaşanmaz.

### Sürüm yayınlama ve otomatik güncelleme

```bash
npm version patch          # package.json sürümünü artırır ve etiketler
git push --follow-tags
```

[`release.yml`](.github/workflows/release.yml) testleri çalıştırır, üç platformda paketler
ve kurulum dosyalarını GitHub Releases'te **yayınlanmış** bir sürüm olarak yükler. Kurulu
uygulamalar güncellemeyi kendiliğinden alır. Dosyalar ayrıca iş akışı sayfasında
"artifact" olarak da indirilebilir. GitHub deposu git remote'tan otomatik bulunur, ayrıca
ayar gerekmez.

### Kod imzalama (isteğe bağlı)

Bir kod imzalama sertifikanız (.pfx) varsa depo ayarlarında **Secrets** altına ekleyin:

- `WIN_CSC_LINK`: sertifikanın base64 içeriği
- `WIN_CSC_KEY_PASSWORD`: sertifika parolası

Release iş akışı bu sırları kendiliğinden kullanır.

---

## Proje yapısı

```
electron/
  main.cjs          Ana süreç: pencere, menü, tepsi, bildirim, güncelleme, IPC, güvenlik
  storage.cjs       Veri dosyası, atomik yazma, otomatik yedekler, şifreleme
  preload.cjs       Arayüze açılan dar API
src/
  domain/           İş mantığı (arayüzden bağımsız, testli)
    money.ts        Tutar ayrıştırma (Türkçe), kuruş aritmetiği, döviz
    dates.ts        Tarih hesapları, iş günü; holidays.ts resmi tatiller
    occurrences.ts  Takvimdeki bütün vadelerin üretimi
    cards.ts        Ekstre dönemleri, taksitler
    loans.ts        Taksit planı, anapara/faiz, erken kapama
    contacts.ts     Cari ekstre ve bakiye
    analytics.ts    Bütçe, rapor, nakit akışı
    migrate.ts      Şema sürümleri ve 1.x → 2.0 geçişi
    backup.ts       JSON ve Excel yedek biçimleri
    bankImport.ts   Banka ekstresi ayrıştırma
  store/            Durum yönetimi, işlemler (actions.ts), platform köprüsü
  ui/               Ortak bileşenler (modal, tablo, form alanları…)
  pages/            Ekranlar
tests/              Vitest testleri
```

---

## Üçüncü taraf lisansları

- Electron, React: MIT
- SheetJS (xlsx 0.20.3, cdn.sheetjs.com): Apache-2.0
- electron-updater, electron-builder: MIT
