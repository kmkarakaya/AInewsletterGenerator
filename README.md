# YouTube Kaynaklı YZ Haber Yazıcısı (Murat Karakaya Akademi)

Bu proje, belirlenen teknik YouTube kanallarındaki en son ve popüler yapay zeka/teknoloji videolarını analiz ederek, LinkedIn için profesyonel bültenler ve infografikler oluşturan otonom bir asistan uygulamasıdır.

## 🚀 Özellikler

- **Otonom Kaynak Taraması:** Seçilen YouTube kanallarındaki son bir haftalık trend videoları otomatik olarak tarar.
- **Transkript Analizi:** Videoların teknik transkriptlerini Gemini 3.1 Pro modeli ile analiz eder ve sentezler.
- **Çapraz Analiz:** Farklı kanallardaki ortak konuları ve teknik trendleri saptayarak "Haftanın Ortak Gündemi"ni oluşturur.
- **Dinamik Haber Bülteni:** Murat Karakaya Akademi stiliyle uyumlu, profesyonel ve hemen paylaşıma hazır Türkçe bülten hazırlar.
- **Yapay Zeka Destekli İnfografik:** Haber içeriğini en iyi yansıtacak detaylı bir görsel üretim promptu hazırlar ve Gemini 2.5 Flash Image modeli ile infografik üretir.
- **Revizyon Sistemi:** Kullanıcı, üretilen metni özel komutlarla (örn: "daha teknik yaz", "kısalt") saniye içerisinde yeniden düzenletebilir.
- **Sürüm Geçmişi:** Yapılan tüm düzenlemeleri tarihçeli olarak saklar ve sürümler arası geçiş yapmanıza olanak tanır.
- **Karanlık ve Modern Arayüz:** Yüksek kontrastlı, teknik odaklı ve duyarlı (responsive) tasarım.

## 🛠️ Teknolojiler

- **Frontend:** React 19, Vite, Tailwind CSS, Lucide Icons, Framer Motion (Motion).
- **Backend:** Node.js, Express (YouTube Proxy & Scraper Proxy).
- **Yapay Zeka (LLM):** 
    - `gemini-3.1-pro-preview` (Transkript analizi)
    - `gemini-3-flash-preview` (Bülten sentezi ve Search entegrasyonu)
    - `gemini-2.5-flash-image` (İnfografik üretimi)
- **Veri Kaynakları:** YouTube Data Scraper API, Google Search Grounding.

## 📦 Kurulum

1. Depoyu klonlayın:
   ```bash
   git clone https://github.com/kullaniciadi/youtube-yz-haber-yazicisi.git
   cd youtube-yz-haber-yazicisi
   ```

2. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```

3. Çevre değişkenlerini ayarlayın (`.env` dosyası oluşturun):
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

4. Uygulamayı geliştirme modunda başlatın:
   ```bash
   npm run dev
   ```

## 📖 Kullanım

1. Uygulama ana sayfasında takip edilecek kanalları kontrol edin (varsayılan: @matthew_berman, @WesRoth vb.).
2. **BÜLTENİ OLUŞTUR** butonuna basın.
3. Arka planda kanalların taranması, transkriptlerin çıkarılması ve bültenin yazılmasını bekleyin.
4. Çıkan sonucu kopyalayabilir veya "Düzeltme Promptu" alanını kullanarak bülteni kişiselleştirebilirsiniz.

## 📄 Lisans

Bu proje MIT lisansı ile lisanslanmıştır.
