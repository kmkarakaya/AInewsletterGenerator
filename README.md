# Sistemin Teknik Mimarisi ve İşleyiş Rehberi: Otonom AI Bülten Üreticisi

Bu doküman, uygulamanın teknik altyapısını, data katmanlarını, sınırlamaları (limits/specs) ve execution flow (çalışma akışı) detaylarını mühendisler için açıklar.

## 1. Teknoloji Yığını (Tech Stack)

*   **Frontend Katmanı**: React 19, Vite, Tailwind CSS v4, Framer Motion. İstemci (Client) tarafı sadece UI State'ini yönetir. LLM çağrıları `@google/genai` TypeScript SDK'sı aracılığıyla frontend üzerinden yürütülür.
*   **Backend Katmanı (Proxy)**: Node.js, Express (`server.ts`). İstemcinin CORS ve Determinism sorunlarını aşması için video çekimi ve transkript indirme aşamaları backend proxy'sine devredilmiştir.
*   **Yapay Zeka (LLM)**:
    *   `gemini-3.1-flash-lite-preview`: Metin oluşturma alanında, transkript özetleme ve JSON yapılı ana bülten analiz/sentezi için kullanılır.
    *   `gemini-2.5-flash-image`: Üretilen içeriği temsil eden infografik görseli sentezlemek için kullanılır.

---

## 2. Sistem İşleyiş Dizisi (Execution Flow)

Uygulama çalıştırıldığında (Bülten Oluştur butonuna basıldığında) aşağıdaki adımlar ardışık (sequential) veya asenkron olarak gerçekleşir:

### Adım 1: Bağlantı ve Edge-Case Doğrulaması (`checkSourceConnection`)
*   **İşlem**: Frontend, Gemini API anahtarının doğruluğunu ve hizmetin erişilebilirliğini test eder.
*   **Spec**: Metin modeline basit bir dummy string ("CURRENT_TIME_AND_DATE_IN_UTC") gönderilerek Search Tool yeteneği test edilir. Özel bir yetki sorunu (403), kota limiti aşımları (429) veya network hatası olup olmadığı test edilir ve süreci bloke eder.

### Adım 2: Deterministik Video Keşfi (`/api/channels/videos`)
YouTube limitleri ve browser önbellek sorunlarından kaçınmak için bu aşama **Backend Express sunucusu** üzerinde gerçekleşir.
*   **İşlem**: Kullanıcının girdiği kanal adları `@username` formatında backend'e iletilir.
*   **Akış & Limitler**:
    1.  `node-fetch` kullanılarak kanalın ana YouTube HTML sayfası çekilir.
    2.  RegEx ile sayfa içindeki RSS Feed URL'i çıkartılır.
    3.  Bulunan RSS XML feed'i indirilir ve `xml2js` ile parse edilir.
    4.  **Tarih Limiti (Spec)**: Son **10 gün** içerisindeki gönderilen videolar filtrelenir.
    5.  **Miktar Limiti (Spec)**: Her kanal için alınabilecek maksimum video sayısı **5** ile sınırlandırılmıştır.
*   **Fallback (B Planı)**: Eğer RSS URL bulunamazsa, `yt-search` paketi (Puppeteer tabanlı olmayan scraper) devrededir ve manuel eşleşen ilk 3 son video çekilir.

### Adım 3: Transkript Çekimi ve Analizi (`fetchTranscriptData`)
Bulunan tüm YouTube videolarının transkriptleri tamamen **gerçek veri** kullanılarak backend üzerinden toplanır ve frontend tarafındaki LLM ile anlamlı özetlere dönüştürülür. İşlem 2 evreden oluşur:

*   **Evre 3.1: Native Transkript API'si (Backend - `/api/transcript`)**
    İstemci, video ID'sini proxy backend'ine gönderir. Sunucu, transkripte ulaşmak için dört aşamalı bir *Fallback Cascade* çalıştırır:
    *   **Attempt 1**: `youtube-transcript` çalıştırılır. Saf YouTube API katmanıdır.
    *   **Attempt 2**: Başarısız olursa `youtube-captions-scraper` ('en' dili için) devreye girer.
    *   **Attempt 3**: O da başarısız olursa diğer yaygın diller ('tr', 'auto') içinscraper denenir.
    *   **Attempt 4**: Tüm altyazı yöntemleri patlarsa, uygulamanın çalışmaya devam etmesi için `@distube/ytdl-core` ile videonun açıklamasına (description text) metadata üzerinden erişilir.

*   **Evre 3.2: LLM ile Birebir Sentez ve Özetleme (Frontend)**
    *   Backend tarafından başarıyla çekilen ham veri (mümkünse transkript, minimum açıklama metni) Frontend'e geri döner.
    *   Eğer çekilen veri uzunsa, Frontend direkt olarak metin LLM modeline (`gemini-3.1-flash-lite-preview`) bağlanarak bir ara özetleme işlemi başlatır.
    *   **Anti-Hallucination Kuralı:** Modele kesinlikle ham transkript dışından bilgi eklememesi emredilir. Elde edilen kısa, yoğun ve teknik özet daha sonra bülten aşamasında kullanılmak üzere saklanır.

### Adım 4: Prompt Enjeksiyonu ve Bülten Sentezlenmesi (`generateNewsletter`)
Tüm başarılı kaynak özetleri ana Prompt'a enjekte edilir (`<sources_data>` bloğu) ve nihai haber oluşturulur.

*   **Model**: `gemini-3.1-flash-lite-preview`
*   **Spec (Structured Outputs)**: Bülten çıktısının kırılmamasını sağlamak adına API Schema kısıtlaması uygulanır. API'nin dönmesi gereken format katı bir şekilde tanımlanır (Response Schema): `{"content": string, "commonTopics": string[], ...}`.
*   **İş Mantığı (LLM Yönergesi)**:
    *   **Sıfır Halüsinasyon (Zero-Hallucination)**: Sadece ve sadece `sources_data` içerisindeki metinlere sadık kalınarak haber oluşturulması en katı kuralla emredilir.
    *   Cross-Analysis (Çapraz Analiz): Videolar birbiriyle karşılaştırılarak ortak trendler bulunur.
    *   Tasarım ve Stilleme: Markdown içerisinde "kalın yazı" (**text**) yasaklanmıştır (sade görünüm için). Haberler LinkedIn standartlarında, emoji bullet pointleriyle, profesyonel bir haber ajansı kimliğinde Türkçe olarak üretilir.

### Adım 5: Görüntü (Infografik) Promptlama ve Çizim (`generateImage`)
*   **Sub-Prompt Sentezi**: Ana bültenden üretilen şemasız haber metni alınır ve text LLM modeline gönderilerek "*Bu haberi temsil edecek detaylı bir İngilizce DALL-E/Midjourney tarzı Infografik promptu yaz*" komutu verilir.
*   **Görsel Sentez**: Üretilen bu İngilizce Prompt, görüntü LLM modeline (`gemini-2.5-flash-image`) iletilir. Model, ilgili konuya ait 16:9 oranında bir görsel sentezler ve istemci bu base64 veriyi arayüzde gösterir.

### Adım 6: Revizyon (Stateful Iteration) Sistemi
Oluşturulan bültenin içeriğine müdahale etmek istenildiğinde:
*   Frontend, uygulamanın state'inde tutulan *ESKİ İÇERİĞİ* ve yeni *MERGE PROMPT*'unu birleştirerek yeni bir talep yaratır ve LLM'e gönderir.
*   Tüm geçmiş versiyonlar, history array'i sayesinde sol sidebar'de tutulur; eski üretimlere anında geçiş mümkündür.

---

## 3. Kurulum ve Bağımlılıklar

*   Projeyi klonladıktan sonra `npm install` komutuyla bağımlıkları yükleyin.
*   `.env` (VEYA `.env.example` kopya) dosyasına `GEMINI_API_KEY` değişkenini girin. Backend için port sabit `3000`'dir. Uygulamayı ayağa kaldırmak için `npm run dev` (`tsx server.ts` çalıştırır) komutu yeterlidir.


