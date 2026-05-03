# AInewsletterGenerator

Bu repo, belirli YouTube kanallarındaki son içerikleri tarayıp teknik AI odaklı bir LinkedIn bülteni ve buna eşlik eden infografik görsel oluşturan tam yığın bir uygulamadır.

Uygulama iki ana parçadan oluşur:

- React + Vite tabanlı istemci arayüzü
- Express tabanlı backend proxy ve Gemini orkestrasyonu

Önemli not: Gemini çağrıları artık sadece backend üzerinde çalışır. `GEMINI_API_KEY` istemci bundle'ına gömülmez.

## Ne Yapar?

Uygulama aşağıdaki zinciri çalıştırır:

1. Gemini metin bağlantısını doğrular ve görsel modelin kullanılabilirliğini bloklamadan kontrol eder.
2. Girilen YouTube kanallarının son içeriklerini backend üzerinden toplar.
3. Videoları popülerliğe göre sıralar ve en güçlü adayları seçer.
4. Her video için transcript veya transcript yoksa açıklama verisini almaya çalışır.
5. Ham veriyi Gemini ile Türkçe teknik özete dönüştürür.
6. Bu özetlerden bir Türkçe LinkedIn bülteni üretir.
7. Bültene göre ayrı bir image prompt üretir.
8. Görsel model erişilebilirse bu prompt ile 16:9 bir görsel üretir; erişilemiyorsa promptu korur ve kullanıcıyı uyarır.
9. Kullanıcı isterse aynı kaynak özetleri üzerinde son bülteni revize ettirir.

## Mimari Özeti

### Frontend

Frontend tarafı ağırlıklı olarak [src/App.tsx](src/App.tsx) içinde orkestre edilir.

Başlıca sorumluluklar:

- Kanal listesini yönetmek
- İlerleme durumu ve log ekranını göstermek
- Kaynak videoları ve transcript işleme durumlarını göstermek
- Oluşturulan bülten sürümlerini saklamak
- Kullanıcıdan revizyon talimatı almak
- Image prompt düzenleme ve görseli yeniden üretme akışını yönetmek
- Ham transcript/özet verilerini kullanıcıya açmak
- “Proof of Source” ekranını göstermek

Frontend doğrudan Gemini SDK kullanmaz. Tüm AI ve veri toplama çağrıları backend API uçlarına gider.

### Backend

Backend tarafı [server.ts](server.ts) içinde yer alır.

Başlıca sorumluluklar:

- Ortam değişkenlerini yüklemek
- Geliştirme modunda Vite middleware ile aynı süreçte frontend'i servis etmek
- Production modunda `dist` klasörünü statik olarak servis etmek
- YouTube kanal keşfini yapmak
- Transcript alma fallback zincirini yürütmek
- Gemini metin ve görsel çağrılarını yürütmek
- Revizyon modunda son bülteni düzenlemek

## Teknoloji Yığını

### UI ve İstemci

- React 19
- Vite 6
- Tailwind CSS v4
- Motion
- react-markdown
- lucide-react

### Backend ve Veri Toplama

- Express
- dotenv
- xml2js
- yt-search
- youtube-transcript
- youtube-captions-scraper
- @distube/ytdl-core

### LLM

- `gemini-3.1-flash-lite-preview` metin işleri için
- `gemini-2.5-flash-image` görsel üretimi için

Model sabitleri [src/config.ts](src/config.ts) içinde tutulur.

## Ortam Değişkenleri

Örnek dosya: [.env.example](.env.example)

Desteklenen değişkenler:

- `GEMINI_API_KEY`: Backend Gemini çağrıları için zorunlu.
- `PORT`: Express + Vite sunucusunun dinleyeceği port. Varsayılan `3005`.
- `HOST`: Sunucu bind adresi. Varsayılan `0.0.0.0`.
- `APP_URL`: Şu an doğrudan uygulama akışında kullanılmıyor; örnek dosyada yer alıyor.
- `HMR_PORT`: İsteğe bağlı. Vite HMR websocket portu. Verilmezse `PORT + 1` kullanılır.
- `DISABLE_HMR`: `true` ise HMR kapatılır.

Production ve Docker notu:

- Production modunda `NODE_ENV=production` olduğunda backend `dist` klasörünü statik olarak servis eder.
- Docker/Hugging Face deploy'larında `GEMINI_API_KEY` secret olarak verilmelidir; image içine gömülmez.

Not: Çalışan ortamda hem `GOOGLE_API_KEY` hem `GEMINI_API_KEY` tanımlıysa, `@google/genai` kütüphanesi `GOOGLE_API_KEY` kullanıldığına dair log üretebilir. Bu davranış kütüphane seviyesindedir.

## Çalıştırma

### Kurulum

```bash
npm install
```

`.env.example` dosyasını `.env` olarak kopyalayın ve en az `GEMINI_API_KEY` değerini doldurun.

### Geliştirme

```bash
npm run dev
```

Bu komut tam yığın akışı çalıştırır:

- Express backend ayağa kalkar
- Geliştirme modunda Vite middleware aynı süreçte bağlanır
- Frontend ve backend aynı origin altında servis edilir

Port çakışıyorsa:

PowerShell:

```powershell
$env:PORT=3010
$env:HMR_PORT=3011
npm run dev
```

### Derleme

```bash
npm run build
```

Bu komut sadece frontend `dist` çıktısını üretir.

### Production Benzeri Çalıştırma

```bash
npm run start
```

Bu komut backend server'ı başlatır. `NODE_ENV=production` ile çalıştırıldığında `dist` klasöründeki frontend çıktısı da servis edilir.

### Tip Denetimi

```bash
npm run lint
```

Bu script `tsc --noEmit` çalıştırır. Lint aracı değil, TypeScript type-check scriptidir.

### Preview

```bash
npm run preview
```

Bu komut yalnızca Vite preview çalıştırır. Backend `/api/*` uçlarını servis etmez. Bu nedenle uygulamanın tam akışını doğrulamak için uygun değildir.

### Clean

```bash
npm run clean
```

Bu script `rm -rf dist` kullanır. Windows PowerShell üzerinde her zaman taşınabilir değildir. Unix benzeri shell yoksa elle `dist` klasörünü silmek gerekebilir.

## Gerçek İş Akışı

Bu bölüm repodaki mevcut davranışı, kodun bugün yaptığı şekliyle anlatır.

### 1. Başlangıç ve Bağlantı Kontrolü

Kullanıcı “Bülteni Oluşturmaya Başla” butonuna bastığında frontend şu sırayı izler:

1. Tüm UI state temizlenir.
2. İlerleme çubuğu ve log terminali başlatılır.
3. `/api/llm/check-connection` çağrılır.

Backend bu uçta iki parçalı ama tek endpoint altında toplanmış bir kontrol yapar:

- Basit bir `API_REACHABILITY_PULSE_CHECK`
- Görsel model için hafif bir availability probe

Amaç:

- Anahtar geçerli mi
- Model erişilebilir mi
- Görsel model erişimi var mı

Başarısız olursa süreç başta kesilir.

Önemli ayrım:

- Metin modeli başarısızsa akış baştan durur
- Görsel modeli başarısızsa akış durmaz; sistem status panelinde belirgin bir warning gösterilir, image prompt yine üretilir ve otomatik görsel render atlanır

### 2. Kanal Taraması

Frontend kullanıcıya gecikmeli tarama hissi vermek için her kanal için log üretir. Ardından `/api/channels/videos` uç noktasına kanal listesini yollar.

Varsayılan kanal listesi UI içinde gömülüdür ve kullanıcı tarafından değiştirilebilir.

Mevcut varsayılanlar:

- `@muratkarakayaakademi`
- `@matthew_berman`
- `@code (Wes Roth)`
- `@SkillLeapAI`
- `@OpenAI`
- `@1littlecoder`

Backend keşif davranışı:

1. Kanal adı `@` ile başlamıyorsa normalize edilir.
2. `https://www.youtube.com/@kanal` sayfası çekilir.
3. HTML içinden RSS linki regex ile aranır.
4. RSS bulunursa XML parse edilir.
5. Son 10 gün içindeki videolar filtrelenir.
6. Kanal başına maksimum 5 video eklenir.
7. RSS bulunamazsa `yt-search` fallback kullanılır.
8. Fallback modunda kanal ismine benzeyen ilk 3 video alınır.

Notlar:

- Tarih filtresi gerçek kodda 10 gündür, 7 gün değil.
- Her kanal için toplanan ham video listesi daha sonra frontend tarafında popülerlik sıralamasına girer.

### 3. En Popüler Videoların Seçilmesi

Frontend keşfedilen videoları `views` alanına göre sıralar ve en fazla 5 videoyu analize alır.

Sıralama mantığı:

- Sayı dışı karakterler temizlenir
- `M` milyon, `K` bin olarak yorumlanır

Bu parsing kaba bir heuristic'tir. Beklenmeyen locale formatlarında hatalı sıralama ihtimali vardır.

### 4. Transcript Alma Zinciri

Her seçili video için frontend `/api/transcript` çağırır.

Backend transcript çözümleme sırası:

1. `youtube-transcript`
2. `youtube-captions-scraper` `en`
3. `youtube-captions-scraper` `tr`
4. `youtube-captions-scraper` `auto`
5. `@distube/ytdl-core` ile video açıklaması fallback

Çıktı davranışı:

- Gerçek transcript bulunduysa tam metin döner
- Transcript yok ama açıklama varsa `TRANSCRIPT NOT FOUND. VIDEO DESCRIPTION INSTEAD:` önekiyle description döner
- Hiçbiri yoksa boş metin ve hata mesajı döner

### 5. Transcript Özetleme

Frontend ham transcript'i aldıktan sonra bunu `/api/llm/transcript-summary` ile backend’e yollar.

Backend burada:

- Transcript'i en fazla 40.000 karaktere kırpar
- Türkçe teknik özet promptu oluşturur
- Hallucination yapmama kuralı uygular
- Sonucu frontend'e döner

Frontend davranışı:

- Eğer summary anlamlıysa transcript yerine bunu kullanır
- Summary boşsa ham transcript fallback olarak tutulur
- Bu sonuç `processedSources` state'ine yazılır

Yani bülten üretimi çoğu zaman tam transcript ile değil, transcript özetiyle yapılır.

### 6. İlk Bülten Üretimi

Frontend `/api/llm/newsletter` çağrısına `sources` dizisini yollar.

Backend ilk üretim modunda şunları yapar:

- `sources_data` bloğu oluşturur
- Her kaynağın başlık, kanal, tarih ve transcript/summary içeriğini prompta gömer
- JSON schema enforced yanıt ister
- `content`, `sourcesFound`, `sources`, `commonTopics` alanlarını üretir

Kurallar:

- Sadece kaynak bloktan üretim
- Geçmiş bilgi eklememe
- Türkçe çıktı
- Kalın markdown kullanmama
- YouTube, kanal adı ve "video" kelimesinden kaçınma

### 7. Image Prompt ve Görsel Üretimi

Backend bülten metni oluştuktan hemen sonra ikinci bir metin çağrısı ile image prompt üretir.

Ardından frontend, başlangıçtaki sağlık kontrolünde görsel model erişimi açık görünüyorsa bu image prompt'u `/api/llm/image` uç noktasına yollar.

Backend burada:

- `gemini-2.5-flash-image` ile 16:9 oranlı görsel üretir
- Inline binary veriyi data URL formatına çevirir
- `imageUrl` alanı ile frontend'e döner

Frontend bu görseli:

- Önizleme olarak gösterir
- History şeklinde saklayabilir
- İndirme linki sunar

Eğer başlangıç kontrolü görsel modelin o anda kullanılamadığını söylemişse frontend:

- Image prompt alanını yine gösterir
- Sistem log panelinde warning blokları gösterir
- Boş görsel placeholder kutusunun içine açıklayıcı uyarı mesajı yazar
- Otomatik görsel render denemesini atlar
- Kullanıcının daha sonra `YENİDEN OLUŞTUR` ile manuel deneme yapmasına izin verir

### 8. Revizyon Akışı

Bu repo artık iki ayrı newsletter modu kullanır:

- İlk üretim modu
- Revizyon modu

Kullanıcı “Yeni Metin Oluştur” butonuna bastığında frontend şu üç veriyi birlikte yollar:

- `processedSources`
- `revisionPrompt`
- `result.content` yani son üretilmiş bülten

Backend revizyon modunda:

- Son bülteni ana taslak kabul eder
- Kullanıcı düzeltmesini doğrudan uygular
- `sources_data` içeriğini doğruluk sınırı olarak kullanır
- Gereksiz sıfırdan üretim yerine gerçek bir düzenleme yapması için yönlendirir
- Ortak konuları yeniden hesaplar

Bu davranışın amacı:

- Son newsletter üzerinde iteratif düzenleme yapmak
- Ama yine de transcript özetlerinden kopmamak

Başarılı revizyonda frontend:

- Yeni içeriği `result.content` içine yazar
- Eski sürümü `contentHistory` içinde tutar
- Yeni image prompt üretir
- Görsel modeli erişilebilir görünüyorsa görseli de otomatik yeniler
- Görsel modeli erişilemez görünüyorsa promptu korur ve otomatik render'ı atlar

### 9. Raw Data ve Proof of Source

UI sonucu ürettikten sonra iki önemli doğrulama yüzeyi gösterir.

#### Ham Veri Görünümü

Kullanıcı “Yapay zekanın okuduğu ham verileri incele” alanını açarsa:

- Her kaynağın başlığı
- URL'si
- İzlenme bilgisi
- Tarihi
- Transcript ya da transcript özetini

görür.

Not: Buradaki alan adı transcript gibi görünse de pratikte transcript özeti de olabilir.

#### Proof of Source

Bu alan kullanıcıya şunları gösterir:

- Kaynak başlığı
- Kanal
- İzlenme
- Tarih
- Transcript erişim durumu

Bu bölüm doğrulama hissi vermek için vardır; resmi API kanıtı anlamına gelmez.

## API Uçları

### `POST /api/llm/check-connection`

Gemini temel erişimini test eder ve görsel model için bloklamayan bir availability bilgisi döner.

Bu uç ve diğer tüm `/api/llm/*` uçları hafif bir in-memory rate limit ile korunur.

Mevcut limit:

- 60 saniyede istemci başına 12 istek

Örnek yanıt:

```json
{
    "status": "connected",
    "service": "Gemini Core Service",
    "message": "Gemini temel bağlantısı açık. Sistem operasyona hazır.",
    "imageGenerationAvailable": false,
    "warnings": [
        "Gorsel uretim modeli kota veya hiz limiti nedeniyle su anda kullanilamiyor. Gorsel promptu yine de uretilecek, ancak otomatik gorsel render atlanacak."
    ]
}
```

Alanlar:

- `status`: Metin modelinin temel erişim sonucu
- `imageGenerationAvailable`: Görsel modelin ilk kontrolde kullanılabilir görünüp görünmediği
- `warnings`: Akışı durdurmayan ama UI'da vurgulu şekilde gösterilen uyarılar

### `POST /api/llm/transcript-summary`

İstek gövdesi:

```json
{
    "transcript": "..."
}
```

Yanıt:

```json
{
    "summary": "..."
}
```

### `POST /api/llm/newsletter`

İstek gövdesi:

```json
{
    "sources": [],
    "revisionPrompt": "İsteğe bağlı",
    "lastContent": "İsteğe bağlı"
}
```

Yanıt şeması:

```json
{
    "content": "...",
    "imagePrompt": "...",
    "sourcesFound": true,
    "sources": [],
    "commonTopics": []
}
```

### `POST /api/llm/image`

İstek gövdesi:

```json
{
    "prompt": "..."
}
```

Yanıt:

```json
{
    "imageUrl": "data:image/png;base64,..."
}
```

### LLM hata formatı

`/api/llm/*` uçları hata durumunda standart bir JSON zarfı döner:

```json
{
    "error": {
        "code": "RATE_LIMITED",
        "message": "LLM istek limiti aşıldı. Lütfen kısa bir süre sonra tekrar deneyin.",
        "details": "Allowed 12 requests per 60 seconds."
    }
}
```

Olası `error.code` değerleri:

- `BAD_REQUEST`
- `RATE_LIMITED`
- `LLM_PERMISSION`
- `LLM_QUOTA`
- `INTERNAL_ERROR`

### `POST /api/channels/videos`

İstek gövdesi:

```json
{
    "channels": ["@OpenAI", "@muratkarakayaakademi"]
}
```

Yanıt:

```json
{
    "videos": [
        {
            "channel": "@OpenAI",
            "date": "2026-05-01",
            "title": "...",
            "views": "150000",
            "videoId": "...",
            "url": "https://..."
        }
    ]
}
```

### `POST /api/transcript`

İstek gövdesi:

```json
{
    "videoId": "..."
}
```

Yanıt:

```json
{
    "text": "..."
}
```

## Önemli Dosyalar

- [server.ts](server.ts): Tüm backend, Gemini entegrasyonu ve API uçları
- [src/App.tsx](src/App.tsx): Uygulama orkestrasyonu ve ana UI
- [src/services/geminiService.ts](src/services/geminiService.ts): Frontend API istemcileri
- [src/config.ts](src/config.ts): Model sabitleri
- [vite.config.ts](vite.config.ts): Vite yapılandırması ve HMR port yönetimi
- [Dockerfile](Dockerfile): Hugging Face Docker Space ve container deploy girişi
- [.dockerignore](.dockerignore): Container build context filtreleri
- [.env.example](.env.example): Ortam değişkeni örneği

## Repo Yapısı

Kısa görünüm:

```text
.
├─ server.ts
├─ package.json
├─ Dockerfile
├─ .dockerignore
├─ tsconfig.json
├─ vite.config.ts
├─ metadata.json
├─ index.html
├─ src/
│  ├─ App.tsx
│  ├─ config.ts
│  ├─ index.css
│  ├─ main.tsx
│  └─ services/
│     └─ geminiService.ts
└─ README.md
```

## Test Durumu

Repoda bir test frameworkü yoktur.

Yani şunlar yok:

- Vitest
- Jest
- Playwright test suite
- entegre `npm test`

Daha önce repoda bazı manuel deneme scriptleri bulunuyordu; bunlar artık kaldırılmıştır. Şu an otomatik CI test altyapısı da, root altında ad-hoc test scriptleri de yoktur.

## Bilinen Kısıtlar ve Davranışlar

### 1. Üretim ve preview farklı şeylerdir

`npm run build` frontend bundle üretir. Tek başına tam uygulamayı ayağa kaldırmaz.

`npm run preview` backend API'leri olmadan çalışır.

### 2. Transcript yoksa description kullanılabilir

Bu durumda sonuç hala analiz edilir, ama transcript kalitesi ile aynı güven seviyesinde değildir.

### 3. Transcript alanı UI'da her zaman literal transcript olmayabilir

Repo bazı akışlarda transcript özeti ya da açıklama fallback'i gösterir.

### 4. Görsel üretimi her zaman garanti değildir

`/api/llm/image` boş `imageUrl` dönebilir veya quota/permission hatasına düşebilir.

Repo artık bu durumu başlangıçta da önden sezebilir:

- Sistem status panelinde belirgin warning gösterilir
- Sağdaki boş görsel kutusunda açıklayıcı uyarı metni görünür
- Buna rağmen image prompt üretimi devam eder

### 5. Port çakışmaları beklenen durumdur

Bu repo artık portu `.env` veya shell üzerinden değiştirilebilir şekilde tasarlanmıştır.

### 6. View parsing heuristiktir

`K` ve `M` parse edilir. Tüm locale formatlarını garanti etmez.

### 7. Frontend logları kısmen simülasyon içerir

Bazı log satırları kullanıcı deneyimi için bilinçli gecikme ve sahnelenmiş ilerleme hissi üretir. Yani tüm loglar birebir gerçek backend event stream değildir.

### 8. API key istemcide değildir

Bu repo güvenlik açısından eski sürüme göre daha doğru yapıdadır. Gemini anahtarı artık istemci bundle içinde bulunmamalıdır.

### 9. Repo Docker Space için hazırlanmıştır

Repo artık minimal bir Docker deploy yüzeyi içerir.

- `Dockerfile` Node 20 tabanlı image kullanır
- Build sırasında frontend `dist` çıktısı üretilir
- Runtime'da backend aynı container içinde frontend'i servis eder
- Hugging Face Spaces için uygun hedef tip `Docker Space`'tir

## Sorun Giderme

### Port doluysa

PowerShell:

```powershell
$env:PORT=3010
$env:HMR_PORT=3011
npm run dev
```

### `GEMINI_API_KEY is not configured on the server` hatası

`.env` dosyasını kontrol edin ve backend'in aynı çalışma dizininden başlatıldığından emin olun.

Docker veya Hugging Face Spaces üzerinde çalışıyorsanız bu değeri `.env` yerine secret/env variable olarak verin.

### `IMAGE_GEN_PERMISSION` hatası

Görsel modeli için yetki yoktur ya da hesap politikasına takılmıştır.

### `IMAGE_GEN_QUOTA` hatası

Görsel üretim kotası aşılmıştır.

### `RATE_LIMITED` hatası

Çok kısa sürede çok fazla `/api/llm/*` isteği gönderilmiştir. `Retry-After` başlığı beklenebilir.

### `npm run preview` çalışıyor ama uygulama iş akışı bozuk

Beklenen davranıştır. Preview backend API sağlamaz.

## Güvenlik Notu

Bu repo artık şu güvenlik iyileştirmesini içerir:

- Gemini çağrıları backend'e taşınmıştır
- `GEMINI_API_KEY` frontend bundle'a inject edilmez

Yine de şu noktalar ayrıca değerlendirilebilir:

- rate limiting
- request validation şemasının güçlendirilmesi
- structured logging
- backend route bazlı auth gereksinimi

## Geliştirme İçin Doğru Mental Model

Bu projeyi geliştirirken doğru model şudur:

- Frontend bir orkestratör ve görselleştirici
- Backend hem veri toplayıcı hem LLM gateway
- Transcript özeti, newsletter üretiminin asıl yakıtı
- Revizyon modu sıfırdan üretim değil, son newsletter üzerinde kontrollü edit akışı

Bu README, mevcut repo davranışını kodun şu an yaptığı haliyle belgelemek için güncellenmiştir.

## Hugging Face Spaces (Docker) Deploy

Bu repo en doğru şekilde `Docker Space` olarak deploy edilir.

Gerekli minimum ayarlar:

1. Hugging Face'te yeni bir Space oluşturun.
2. Space tipini `Docker` seçin.
3. Repo'yu bu Space'e bağlayın veya push edin.
4. Space secrets içine `GEMINI_API_KEY` ekleyin.

Container davranışı:

- `Dockerfile` bağımlılıkları kurar
- `npm run build` ile frontend bundle üretir
- `npm run start` ile server'ı ayağa kaldırır
- `NODE_ENV=production` altında backend `dist` klasörünü servis eder

Yerel Docker testi örneği:

```bash
docker build -t ai-newsletter-generator .
docker run -p 3005:3005 -e GEMINI_API_KEY=YOUR_KEY ai-newsletter-generator
```

Beklenen çalışma modeli:

- Tek container içinde hem backend hem frontend servis edilir
- Frontend `/api/*` çağrılarını aynı origin üzerinden backend'e yapar
- Gemini anahtarı yalnızca server tarafında kullanılır

### Tek Komutla Push

Repo kökünde bir [deploy-hf-space.bat](deploy-hf-space.bat) scripti vardır.

Amaç:

- Önce `npm run build` doğrulaması yapmak
- Sonra Docker image build testi yapmak
- Son olarak mevcut commit'i Hugging Face Space repo'suna push etmek

Normal kullanım:

```bat
deploy-hf-space.bat
```

İlk kullanım öncesi seçenekler:

- Bir kez `hf auth login` çalıştırabilirsiniz
- veya scripti `HF_TOKEN` env var ile çağırabilirsiniz

Örnek:

```bat
set HF_TOKEN=hf_xxx
deploy-hf-space.bat
```

Yardımcı bayraklar:

- `DRY_RUN=1`: Push yapmadan önce tüm yerel kontrolleri çalıştırır
- `SKIP_DOCKER_BUILD=1`: Docker build doğrulamasını atlar

Örnek dry-run:

```bat
set DRY_RUN=1
deploy-hf-space.bat
```


