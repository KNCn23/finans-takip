# Değişiklikler

## 2.0.1 — 2026-10-08

- Kurulum dosyası adları boşluksuz sabitlendi (`Finans-Takip-Setup-2.0.1.exe`). 2.0.0
  sürümünde GitHub'a aynı dosyanın iki kopyası yüklenmişti ve otomatik güncelleme
  dosyası (`latest.yml`) eski kopyayı gösteriyordu.
- Yayın iş akışı artık `latest*.yml` dosyalarının gösterdiği her dosyanın yüklendiğini
  yayından önce doğruluyor.
- Uygulama kodunda değişiklik yok.

## 2.0.0 — 2026-10-08

Uygulama, kaynak kodu kaybolan 1.0 sürümünün derlenmiş paketinden okunabilir
TypeScript koduna yeniden yazıldı. 1.x verisi ilk açılışta kendiliğinden taşınır.

### Veri güvenliği
- Veri tarayıcı deposu (localStorage) yerine kullanıcı klasöründeki bir JSON dosyasında
  tutuluyor. Dosyaya atomik olarak yazılıyor.
- Veri bozuk çıkarsa üzerine yazılmıyor. Dosya yedek klasörüne taşınıyor ve kurtarma
  ekranı açılıyor.
- Uygulama aynı anda iki kez açılamıyor (iki pencerenin birbirinin verisini silmesi
  engellendi).
- Her gün otomatik yedek alınıyor (son 30 gün). İkinci yedek konumu seçilebiliyor.
- İçe aktarma ve geri yükleme öncesinde otomatik yedek alınıyor. Her değişiklik
  "Geri al" (Ctrl+Z) ile geri alınabiliyor.
- JSON yedek eklendi. 1.x Excel yedekleri de açılabiliyor.

### Düzeltilen hesap hataları
- `8.750` → 8,75 ₺ ve `1.250.000` → 0 ₺ olarak kaydedilen Türkçe tutar hatası giderildi.
  Okunamayan tutar artık hata gösteriyor.
- Ayın 29-31'inde başlayan aylık kayıtların 28'ine kayması giderildi.
- Geçen ayın ödenmemiş kart borcu artık ay dönünce kaybolmuyor.
- Ödenen kart ekstresi borçtan düşüyor, sonraki aylarda tekrar etmiyor.
- Hesap kesim günü hesaba katılıyor. Kesimden sonraki harcama doğru ekstreye düşüyor.
- "Ödendi" işareti hesap bakiyesini güncelliyor (hesap seçilirse). İşaret kaldırılınca
  bakiye geri geliyor.
- "Kalan kredi borcu" artık "kalan taksitler" olarak adlandırılıyor. Anapara girilirse
  kalan anapara ayrıca gösteriliyor.
- Raporlar gerçekleşen ve planlanan tutarları ayrı gösteriyor.
- Tutarlar kuruş cinsinden tamsayı tutuluyor.
- Vadeler hafta sonu veya resmi tatile denk gelirse sonraki iş gününe kaydırılıyor.
- Gecikmiş kalemlerdeki 12 aylık görünürlük sınırı kaldırıldı.
- "Holding Geneli"nde eklenen kayıt için şirket soruluyor.
- Cari bakiyelerine tekrarlayan kayıtlar ve açılış bakiyesi dahil ediliyor. Cari ekstresi
  eklendi.

### Yeni özellikler
- Kredi kartında taksitli alışveriş ve gerçek ekstre tutarını girme.
- Hesaplar sayfası: virman, hesap hareketleri, KMH, vadeli mevduat, döviz ve altın
  hesaplar, TCMB'den kur alma.
- Çek ciro, senet türü, portföy hareket geçmişi.
- Tekrarlayan kaydın tek bir vadesini değiştirme veya atlama.
- Vade hatırlatma bildirimleri, sistem tepsisi, Windows açılışında başlatma.
- Kredide anapara/faiz tablosu, değişken taksit, erken kapama.
- Tablolarda arama, sıralama ve tarih aralığı.
- Bütçe geçmişi, yıllık bütçe, devreden bütçe, yıllık tablo.
- Rapor ve cari ekstresi için PDF/yazdırma ve Excel çıktısı.
- Banka ekstresi (CSV/Excel) içe aktarma.
- PIN kilidi ve isteğe bağlı veri dosyası şifreleme.

### Arayüz
- Uygulama içi onay pencereleri. Tarayıcı `confirm()`/`alert()` pencereleri kaldırıldı.
- Pencereler Esc ile kapanıyor, odağı içeride tutuyor. Dolu form yanlışlıkla kapanmıyor.
- Tutar alanlarında binlik ayırıcılı önizleme.
- Ortak kategori listesi (büyük/küçük harf ve boşluk farkı birleşiyor). Kategoriler
  yeniden adlandırılabiliyor.
- Koyu tema, odak göstergeleri, ekran okuyucu etiketleri, klavye kısayolları.
- Son açılan sayfa ve pencere boyutu hatırlanıyor. Yakınlaştırma (Ctrl +/−) geri geldi.
- E-posta, telefon ve VKN/TCKN doğrulama.

### Altyapı
- TypeScript kaynak kod, 86 birim testi, GitHub Actions CI.
- xlsx 0.18.5 (bilinen güvenlik açıkları) → 0.20.3.
- Content-Security-Policy, sandbox, gezinme ve izin kısıtları.
- Paket boyutu küçüldü (app.asar 19 MB → 3 MB).
- Otomatik güncelleme (GitHub Releases), uygulama simgesi, kod imzalama desteği.
- Şema sürümleri ve geçiş altyapısı. Bir ekranda hata olursa beyaz sayfa yerine
  kurtarma kartı gösteriliyor.

## 1.0.0 — 2026-07-10

İlk sürüm.
