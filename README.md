# Sistemin Teknik Mimarisi ve İşleyiş Rehberi: Otonom AI Bülten Üreticisi

Bu doküman, uygulamanın teknik altyapısını, data katmanlarını, sınırlamaları (limits/specs) ve execution flow (çalışma akışı) detaylarını mühendisler için açıklar.

## 1. Teknoloji Yığını (Tech Stack)

*   **Frontend Katmanı**: React 19, Vite, Tailwind CSS v4, Framer Motion. İstemci (Client) tarafı sadece UI State'ini yönetir. LLM çağrıları `@google/genai` TypeScript SDK'sı aracılığıyla frontend üzerinden yürütülür.
*   **Backend Katmanı (Proxy)**: Node.js, Express (`server.ts`). İstemcinin CORS ve Determinism sorunlarını aşması için video ve RSS keşif aşamaları backend proxy'sine devredilmiştir.
*   **Yapay Zeka (LLM)**:
    *   `gemini-2.5-flash`: Metin oluşturma, Search aracı kullanımı ve JSON yapılı veri analiz için.
    *   `gemini-2.5-flash-image`: İnfografik görseli sentezlemek için.

---

## 2. Sistem İşleyiş Dizisi (Execution Flow)

Uygulama çalıştırıldığında (Bülten Oluştur butonuna basıldığında) aşağıdaki adımlar ardışık (sequential) veya asenkron olarak gerçekleşir:

### Adım 1: Bağlantı ve Edge-Case Doğrulaması (`checkSourceConnection`)
*   **İşlem**: Frontend, Gemini API anahtarının doğruluğunu ve hizmetin erişilebilirliğini test eder.
*   **Spec**: `gemini-2.5-flash` modeline basit bir dummy string ("CURRENT_TIME_AND_DATE_IN_UTC") gönderilir. Özel bir yetki sorunu (403), kota limiti aşımları (429) veya network hatası olup olmadığı test edilir ve süreci bloke eder.

### Adım 2: Deterministik Video Keşfi (`/api/channels/videos`)
YouTube limitleri ve browser önbellek sorunlarından kaçınmak için bu aşama **Backend Express sunucusu** üzerinde gerçekleşir.
*   **İşlem**: Kullanıcının girdiği kanal adları `@username` formatında backend'e iletilir.
*   **Akış & Limitler**:
    1.  `node-fetch` kullanılarak kanalın ana YouTube HTML sayfası çekilir.
    2.  RegEx ile sayfa içindeki RSS Feed URL'i (`<link rel="alternate" type="application/rss+xml" ...>`) çıkartılır.
    3.  Bulunan RSS XML feed'i indirilir ve `xml2js` ile parse edilir.
    4.  **Tarih Limiti (Spec)**: Son **10 gün** içerisindeki gönderilen videolar filtrelenir.
    5.  **Miktar Limiti (Spec)**: Her kanal için alınabilecek maksimum video sayısı **5** ile sınırlandırılmıştır.
*   **Fallback (B Planı)**: Eğer RSS URL bulunamazsa, `yt-search` paketi (Puppeteer tabanlı olmayan, hafif bir HTML scraper API) ile kanal adı aranır ve manuel eşleşen ilk 3 son video çekilir.

### Adım 3: Transkript Çekimi ve "Fallback Cascade" (`fetchTranscriptData`)
Bulunan tüm YouTube videoları için asenkron (paralel) bir data toplama süreci başlatılır. Bu adım, sistem sağlamlığını artıran katmanlı bir *Fallback Cascade* (başarısızlıkta diğer yönteme geçiş) modeline sahiptir.

*   **Evre 3.1: LLM-Based Search Tool Sentezi (Frontend)**
    *   Video URL'si, `Google Search` tool'u etkinleştirilmiş olarak `gemini-2.5-flash` modeline Prompt içine gömülerek gönderilir.
    *   Maksat: Transkripte erişemese dahi, modelin Google Search kullanarak bu videonun lansman haberlerini, blog postlarını ve internetteki tartışmalarını bularak videonun detaylı bir özetini çıkarmasıdır (Min. 300 kelime limitiyle). Başarılı olursa direkt bu LLM sentezi "transkript kaynağı" olarak kabul edilir.
*   **Evre 3.2: Native Transkript API'si (Backend - `/api/transcript`)**
    LLM'in sonuç veremediği durumda, istek Backend sunucusuna paslanır.
    *   **Fallback 1**: `youtube-transcript` modülü çalıştırılır. Saf YouTube API katmanı.
    *   **Fallback 2**: Fallback 1 başarısız olursa (örneğin oto-çeviri kısıtı vb) `youtube-captions-scraper` (Dil: `en` - İngilizce) devreye girer.
    *   **Fallback 3**: İngilizce bulunamazsa, Türkçe (`tr`) ve `auto` fallback dener.
    Bulunan altyazılar kelime dizisinden çıkarılarak tek bir blok String (Metin) haline getirilir.

### Adım 4: Prompt Enjeksiyonu ve Bülten Sentezlenmesi (`generateNewsletter`)
Tüm başarılı kaynaklar (Başlık, Kanal ve Transkript özetleri) ana Prompt'a enjekte edilir.

*   **Model**: `gemini-2.5-flash`
*   **Spec (Structured Outputs)**: Bülten çıktısının kırılmamasını sağlamak adına API Schema kısıtlaması uygulanır. API'nin dönmesi gereken format katı bir şekilde tanımlanır (Response Schema): `{"content": string, "commonTopics": string[], ...}`.
*   **İş Mantığı (LLM Yönergesi)**:
    *   Cross-Analysis (Çapraz Analiz): Videolardaki verileri karşılaştır. Ortak konular (trendler) varsa haberin merkezine koy.
    *   Formatlama Kısıtları: Markdown içerisinde "kalın yazı" (**text**) kesinlikle yasaklanır. Haber blokları Emojilerle ayrılır. Videodan bahsedildiği izlenimi verilmeden saf bir "Haber Ajansı" dilinde (LinkedIn formatında) Türkçe içerik üretilir.

### Adım 5: Görüntü (Infografik) Promptlama ve Çizim (`generateImage`)
Sadece metin üretmekle kalmayan sistem, haber içeriğine özel bir grafik oluşturur.
*   **Sub-Prompt Sentzi**: Ana bültenden üretilen şemasız Türkçe haber metni alınır, tekrar LLM'e (Text Model) sokularak, "*Bu haberi temsil edecek spesifik, ince telli, dark-blue zeminli profesyonel bir Infografik / Mind-Map için DALL-E tarzı detaylı İNGİLİZCE bir görsel promptu yaz*" komutu çalıştırılır.
*   **Görsel Sentez (Image Gen)**: Üretilen bu spesifik İngilizce Prompt, `gemini-2.5-flash-image` modeline 16:9 Aspect Ratio (Görsel format) kısıtlaması eşliğinde gönderilir. Gelen resim base64 formatında decodelanarak arayüze basılır.

### Adım 6: Revizyon (Stateful Iteration) Sistemi
Oluşturulan bültenin içeriğine müdahale etmek istenildiğinde (ör: "Bu bülteni daha kısa yap"):
*   Frontend, uygulamanın state'inde tutulan *ESKİ İÇERİĞİ* ve yeni *USER_PROMPT*'unu birleştirerek yeni bir LLM Request'i atar.
*   Versiyon yönetimi: Her dönen sonuç array'e kaydedilir, böylece kullanıcı uygulamanın sol menüsünden revizyonlar arasında saniyeler içinde geçiş yapıp geri dönebilir.

---

## Kurulum ve Bağımlılıklar

*   Projeyi klonladıktan sonra `npm install` komutuyla bağımlıkları yükleyin.
*   `.env` (VEYA `.env.example` kopya) dosyasına `GEMINI_API_KEY` değişkenini girin. Backend için port sabit `3000`'dir. Uygulamayı ayağa kaldırmak için `npm run dev` (`tsx server.ts` çalıştırır) komutu yeterlidir.

