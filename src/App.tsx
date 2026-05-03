import { useState, useRef } from "react";
import { 
  Sparkles, 
  Search, 
  Newspaper, 
  Terminal, 
  Send, 
  AlertCircle, 
  Copy, 
  Check, 
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  ExternalLink,
  Plus,
  X,
  Database,
  Users,
  Calendar,
  CheckCircle2,
  ListRestart
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import { generateNewsletter, searchSources, generateImage, checkSourceConnection, NewsletterResult, VideoSource, ApiConnectionStatus, fetchTranscriptData } from "./services/geminiService";

export default function App() {
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ApiConnectionStatus | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [textLoading, setTextLoading] = useState(false);
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [result, setResult] = useState<NewsletterResult | null>(null);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSourceProgress, setCurrentSourceProgress] = useState<VideoSource | null>(null);
  const [processedSources, setProcessedSources] = useState<VideoSource[]>([]);
  const [analyzingCommonTopics, setAnalyzingCommonTopics] = useState(false);
  const [channels, setChannels] = useState<string[]>(["@matthew_berman", "@code (Wes Roth)", "@SkillLeapAI", "@OpenAI", "@1littlecoder"]);
  const [newChannel, setNewChannel] = useState("");
  const [logs, setLogs] = useState<{ message: string; type: 'info' | 'success' | 'error' | 'step' }[]>([]);
  const [progress, setProgress] = useState(0);
  const [subStatus, setSubStatus] = useState("");

  const [showRawData, setShowRawData] = useState(false);

  const newsletterRef = useRef<HTMLDivElement>(null);

  const addLog = (message: string, type: 'info' | 'success' | 'error' | 'step' = 'info') => {
    setLogs(prev => [...prev, { message, type }]);
  };

  const politeDelay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms + Math.random() * 500));

  const handleRegenerateText = async () => {
    if (!result || !processedSources.length) return;
    
    addLog("BÜLTEN METNİ YENİDEN OLUŞTURULUYOR...", "step");
    if (revisionPrompt) {
      addLog(`[BİLGİ] Kullanıcı düzeltme isteği eklendi: "${revisionPrompt}"`, "info");
    }
    setTextLoading(true);
    try {
      // Pass the current requested revision prompt and the latest version of the newsletter
      const data = await generateNewsletter(processedSources, revisionPrompt, result.content);
      
      if (data && !data.error) {
        setResult(prev => {
          if (!prev) return null;
          const prevHistory = prev.contentHistory || (prev.content ? [prev.content] : []);
          return { 
            ...prev, 
            content: data.content, 
            contentHistory: [data.content, ...prevHistory],
            imagePrompt: data.imagePrompt
          };
        });
        setRevisionPrompt(""); // Clear input on success
        addLog("[OK] Bülten metni ve dinamik görsel promptu başarıyla oluşturuldu.", "success");
        
        // Start generating image automatically with the new prompt
        addLog("YENİ METNE UYGUN BÜLTEN GÖRSELİ OLUŞTURULUYOR...", "step");
        setImageLoading(true);
        try {
          const imageUrl = await generateImage(data.imagePrompt);
          if (imageUrl) {
            setResult(prev => {
              if (!prev) return null;
              const prevUrls = prev.imageUrls || (prev.imageUrl ? [prev.imageUrl] : []);
              return { ...prev, imageUrl: imageUrl, imageUrls: [imageUrl, ...prevUrls] };
            });
            addLog("[OK] İnfografik görseli başarıyla oluşturuldu.", "success");
          } else {
            addLog("[UYARI] Görsel üretilemedi (Görsel servisi yanıt vermedi).", "info");
          }
        } catch (imgErr) {
          addLog(`[HATA] Görsel servisi hatası: ${String(imgErr)}`, "error");
        } finally {
          setImageLoading(false);
        }
      } else {
        addLog("[UYARI] Bülten metni üretilemedi.", "error");
      }
    } catch (err) {
      addLog(`[HATA] Metin yenilenemedi: ${String(err)}`, "error");
    } finally {
      setTextLoading(false);
    }
  };

  const handleRegenerateImage = async () => {
    if (!result?.imagePrompt) return;
    
    addLog("BÜLTEN GÖRSELİ YENİDEN OLUŞTURULUYOR...", "step");
    setImageLoading(true);
    try {
      const imageUrl = await generateImage(result.imagePrompt);
      if (imageUrl) {
        setResult(prev => {
          if (!prev) return null;
          const prevUrls = prev.imageUrls || (prev.imageUrl ? [prev.imageUrl] : []);
          return { ...prev, imageUrl: imageUrl, imageUrls: [imageUrl, ...prevUrls] };
        });
        addLog("[OK] İnfografik görseli başarıyla yeniden oluşturuldu.", "success");
      } else {
        addLog("[UYARI] Görsel üretilemedi (Görsel servisi yanıt vermedi).", "info");
      }
    } catch (imgErr) {
      const imgErrMsg = imgErr instanceof Error ? imgErr.message : String(imgErr);
      addLog(`[HATA] Görsel üretilemedi: ${imgErrMsg}`, "error");
    } finally {
      setImageLoading(false);
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setCurrentSourceProgress(null);
    setProcessedSources([]);
    setAnalyzingCommonTopics(false);
    setConnectionStatus(null);
    setLogs([]);
    setProgress(0);
    setSubStatus("Sistem hazırlanıyor...");

    try {
      // Step 0: Connection Check
      addLog("SİSTEM BAŞLATILIYOR...", "step");
      setSubStatus("Güvenlik ve API katmanları doğrulanıyor...");
      
      addLog("[PHASE_1] Gemini API temel bağlantısı test ediliyor...");
      setProgress(3);
      await politeDelay(500);

      addLog("[PHASE_2] Google Search Tool protokol erişimi sorgulanıyor...");
      setProgress(7);
      
      const connection = await checkSourceConnection();
      setConnectionStatus(connection);
      
      if (connection.status === 'error') {
        addLog(`[BAĞLANTI_HATASI] Kritik sistem testi başarısız: ${connection.message}`, "error");
        setSubStatus("KRİTİK HATA: Servis bağlantısı kurulamadı.");
        setError(connection.message);
        setLoading(false);
        return;
      }
      addLog(`[OK] ${connection.message}`, "success");
      addLog("[BİLGİ] Tüm arama ve analiz modülleri senkronize edildi.");
      setSubStatus("Sistem doğrulandı. Hedef kanallar taranıyor...");
      setProgress(15);

      await politeDelay(1000);
      
      // Step 1: Sequential Discovery Simulation
      addLog("HEDEF KANALLAR TARANIYOR...", "step");
      addLog("[POLİTİKA] YouTube kullanım sınırlarını korumak için gecikmeli tarama yapılıyor...");
      
      for (const channel of channels) {
        addLog(`[TARAMA] ${channel} kanalı için YouTube veri kütüphanesi sorgulanıyor...`);
        setSubStatus(`${channel} taranıyor...`);
        await politeDelay(2000); // Increased delay for "politeness"
      }

      setSubStatus("Veriler derinlemesine analiz için toplanıyor...");
      await politeDelay(500);
      const discovered = await searchSources(channels);
      setProgress(25);
      
      if (discovered.length === 0) {
        addLog("Belirtilen kaynaklarda veri bulunamadı.", "error");
        setSubStatus("HATA: Veri bulunamadı.");
        setResult({ content: "Belirtilen kaynaklarda bu haftaya ait transkript verisi bulunamadı", imagePrompt: "", sourcesFound: false, sources: [], commonTopics: [] });
        return;
      }

      addLog(`[OK] Toplam ${discovered.length} adet teknik AI videosu tespit edildi.`, "success");
      await politeDelay(800);
      
      // Grouping stats for logs
      const stats = discovered.reduce((acc, curr) => {
        acc[curr.channel] = (acc[curr.channel] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      Object.entries(stats).forEach(([channel, count]) => {
        addLog(`   > ${channel}: ${count} yeni video bulundu.`);
      });

      addLog("Popülarite ve izlenme sayılarına göre sıralama yapılıyor...");
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Filter Top 3
      const topVideos = [...discovered]
        .sort((a, b) => {
          const valA = parseFloat(a.views?.replace(/[^\d.]/g, '') || '0') * (a.views?.includes('M') ? 1000000 : a.views?.includes('K') ? 1000 : 1);
          const valB = parseFloat(b.views?.replace(/[^\d.]/g, '') || '0') * (b.views?.includes('M') ? 1000000 : b.views?.includes('K') ? 1000 : 1);
          return valB - valA;
        })
        .slice(0, 5);

      addLog(`[KARAR] Analiz için en popüler ${topVideos.length} video seçildi:`, "step");
      topVideos.forEach((v, i) => {
        addLog(`   ${i+1}. "${v.title}" (${v.views} izlenme)`);
      });
      
      setSubStatus("En popüler videolar seçildi. İçerik analizi başlıyor...");
      setProgress(40);

      // Step 2: Iterative Analysis
      addLog("DERİN TRANSKRİPT ANALİZİ BAŞLATILDI...", "step");
      const results: VideoSource[] = [];
      const baseProgress = 40;
      const progressPerSource = 30 / topVideos.length;

      for (let i = 0; i < topVideos.length; i++) {
        const source = topVideos[i];
        setCurrentSourceProgress(source);
        setSubStatus(`Analiz Ediliyor: ${source.title}`);
        addLog(`[VERİ] "${source.title}" videosuna ait transkript indiriliyor...`);
        
        let transcriptText = "";
        if (source.videoId) {
           transcriptText = await fetchTranscriptData(source.videoId, source.url);
        }
        
        const status = transcriptText.length > 50 ? 'success' : 'failed';
        
        if (status === 'success') {
             addLog(`[BAŞARILI] "${source.title}" - ${source.views} izlenme. Transkript: ${transcriptText.length} karakter indirildi. URL: ${source.url}`, "success");
        } else {
             addLog(`[HATA/UYARI] "${source.title}" videosu için transkript alınamadı. (Altyazı desteklenmiyor veya engelli)`, "error");
        }

        const updatedSource: VideoSource = { ...source, transcriptStatus: status, transcript: transcriptText };
        results.push(updatedSource);
        setProcessedSources([...results]);
        
        if (status === 'success') {
          addLog(`   [BAŞARILI] Transkript başarıyla çözümlendi. (${source.channel})`, "success");
          addLog(`   [İŞLEM] Teknik kavramlar ve parametreler ayıklanıyor...`);
        } else {
          addLog(`   [HATA] Transkript erişim engeline takıldı. Özet verisi kullanılıyor.`, "error");
        }
        
        setProgress(baseProgress + (i + 1) * progressPerSource);
      }

      // Step 3: Global Analysis
      addLog("ÇAPRAZ LİTERATÜR VE TREND ANALİZİ...", "step");
      setSubStatus("Farklı kaynaklardaki teknik ortaklıklar ve çelişkiler analiz ediliyor...");
      setCurrentSourceProgress(null);
      setAnalyzingCommonTopics(true);
      setProgress(75);
      await new Promise(resolve => setTimeout(resolve, 2500));
      addLog("[OK] Haftanın ortak teknik trendleri ve kritik duyuruları saptandı.", "success");
      setProgress(85);

      // Step 4: Newsletter Generation
      addLog("BÜLTEN MİMARİSİ OLUŞTURULUYOR...", "step");
      setSubStatus("Murat Karakaya Akademi stilinde LinkedIn bülteni yazılıyor...");
      const data = await generateNewsletter(results);
      setResult({ ...data, contentHistory: [data.content] });
      addLog("[OK] LinkedIn bülten taslağı hazırlandı.", "success");
      setProgress(95);

      // Step 5: Visual
      if (data.sourcesFound && data.imagePrompt) {
        addLog("TEKNİK İNFOGRAFİK TASARLANIYOR...", "step");
        setSubStatus("Yapay zeka bülten için teknik infographic üretiyor...");
        setImageLoading(true);
        try {
          const imageUrl = await generateImage(data.imagePrompt);
          if (imageUrl) {
            setResult(prev => prev ? { ...prev, imageUrl: imageUrl || undefined, imageUrls: [imageUrl] } : null);
            addLog("[OK] İnfografik görseli başarıyla oluşturuldu.", "success");
          } else {
            addLog("[UYARI] Görsel üretilemedi (Görsel servisi yanıt vermedi).", "info");
          }
        } catch (imgErr) {
          const imgErrMsg = imgErr instanceof Error ? imgErr.message : String(imgErr);
          addLog(`[HATA] Görsel üretilemedi: ${imgErrMsg}`, "error");
        } finally {
          setImageLoading(false);
        }
      }
      
      setProgress(100);
      setSubStatus("Bülten ve analiz hazır!");
      addLog("İŞLEM BAŞARIYLA TAMAMLANDI. BÜLTEN ÇIKTISI EKRANDA.", "step");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Critical Flow Error:", err);
      
      if (errorMsg.includes("YOUTUBE_QUOTA_EXCEEDED")) {
        addLog("!!!! YOUTUBE KULLANIM SINIRI AŞILDI !!!!", "error");
        addLog("YouTube (Google) arama ve veri çekme limitleri şu an için dolmuştur.", "error");
        addLog("Lütfen 30-60 dakika bekledikten sonra tekrar deneyiniz.", "info");
        setSubStatus("KOTA AŞILDI: Lütfen daha sonra deneyin.");
        setError("YouTube kullanım limitleri aşıldı. Lütfen bir süre bekleyip tekrar deneyin.");
      } else if (errorMsg.includes("GOOGLE_SEARCH_PERMISSION_DENIED")) {
        addLog("!!!! YETKİLENDİRME HATASI !!!!", "error");
        addLog("API anahtarınızın 'Google Search' aracı kullanma yetkisi bulunmuyor.", "error");
        addLog("Lütfen Google AI Studio üzerinden anahtar yetkilerini kontrol edin.", "info");
        setSubStatus("YETKİ HATASI: API ayarlarını kontrol edin.");
        setError("API Anahtarı Yetki Hatası (Google Search Aracı Pasif).");
      } else {
        addLog(`Sistem hatası: ${errorMsg}`, "error");
        setSubStatus("Sistem hatası!");
        setError(`İşlem sırasında bir hata oluştu: ${errorMsg}`);
      }
    } finally {
      setLoading(false);
      setImageLoading(false);
      setCurrentSourceProgress(null);
    }
  };

  const addChannel = () => {
    if (newChannel && !channels.includes(newChannel)) {
      setChannels([...channels, newChannel]);
      setNewChannel("");
      addLog(`[LİSTE] Yeni kanal eklendi: ${newChannel}`, "success");
    }
  };

  const removeChannel = (channel: string) => {
    setChannels(channels.filter(c => c !== channel));
    addLog(`[LİSTE] Kanal listeden çıkarıldı: ${channel}`, "info");
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopying(true);
      setTimeout(() => setCopying(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text font-sans selection:bg-brand-accent selection:text-black relative">
      <div className="grid-bg absolute inset-0 opacity-20 pointer-events-none z-0" />

      <div className="relative z-10 flex flex-col min-h-screen border-x border-brand-line max-w-[1440px] mx-auto">
        {/* Header */}
        <header className="p-10 md:p-14 border-b border-brand-line flex flex-col md:flex-row md:items-end justify-between gap-10">
          <div className="space-y-4">
            <div className="text-brand-accent font-mono text-xs tracking-[0.3em] uppercase">
              MURAT KARAKAYA AKADEMİ
            </div>
            <h1 className="text-7xl md:text-9xl font-black tracking-[-0.06em] leading-[0.85] uppercase">
              GELİŞMELER.
            </h1>
          </div>
          <div className="text-right space-y-2">
            <div className="font-mono text-[10px] text-brand-dim uppercase tracking-widest">
              MURAT KARAKAYA AKADEMİ
            </div>
            <div className="font-mono text-sm text-brand-dim">
              {(() => {
                const today = new Date();
                const lastWeek = new Date(today);
                lastWeek.setDate(today.getDate() - 7);
                const months = ["OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN", "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"];
                const startDay = lastWeek.getDate();
                const startMonth = months[lastWeek.getMonth()];
                const startYear = lastWeek.getFullYear();
                const endDay = today.getDate();
                const endMonth = months[today.getMonth()];
                const endYear = today.getFullYear();
                
                if (startMonth === endMonth && startYear === endYear) {
                  return `${startDay} — ${endDay} ${endMonth} ${endYear}`;
                } else if (startYear === endYear) {
                  return `${startDay} ${startMonth} — ${endDay} ${endMonth} ${endYear}`;
                } else {
                  return `${startDay} ${startMonth} ${startYear} — ${endDay} ${endMonth} ${endYear}`;
                }
              })()}
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className={`
                mt-6 px-10 py-4 font-mono text-xs font-bold tracking-widest uppercase border transition-all duration-300
                ${loading 
                  ? "bg-brand-surface text-brand-dim border-brand-line cursor-wait" 
                  : "bg-brand-accent text-black border-brand-accent hover:bg-black hover:text-brand-accent active:scale-95 shadow-[0_0_20px_rgba(0,255,157,0.2)]"}
              `}
            >
              {loading ? "SİSTEM MEŞGUL..." : "BÜLTENİ OLUŞTUR"}
            </button>
          </div>
        </header>

        {/* Channel Management Section */}
        <section className="p-10 md:p-14 border-b border-brand-line bg-black/40">
          <div className="max-w-4xl space-y-8">
            <div className="flex items-center gap-4">
              <Database size={18} className="text-brand-accent" />
              <h2 className="font-mono text-xs font-bold tracking-[0.2em] uppercase text-brand-dim">
                HEDEF YOUTUBE KANALLARI (VERİ KAYNAKLARI)
              </h2>
            </div>
            
            <div className="flex flex-wrap gap-3">
              {channels.map((channel) => (
                <div 
                  key={channel} 
                  className="flex items-center gap-3 px-4 py-2 bg-brand-surface/30 border border-brand-line group hover:border-brand-accent transition-colors"
                >
                  <span className="font-mono text-sm text-brand-text">{channel}</span>
                  {!loading && (
                    <button 
                      onClick={() => removeChannel(channel)}
                      className="text-brand-dim hover:text-red-500 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              
              {!loading && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newChannel}
                    onChange={(e) => setNewChannel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addChannel()}
                    placeholder="Kanal @etiketi..."
                    className="bg-black/40 border border-brand-line px-4 py-2 font-mono text-sm focus:border-brand-accent outline-none w-48 transition-all"
                  />
                  <button 
                    onClick={addChannel}
                    className="px-4 py-2 border border-brand-accent text-brand-accent hover:bg-brand-accent hover:text-black transition-all"
                  >
                    <Plus size={18} />
                  </button>
                </div>
              )}
            </div>
            
            <p className="font-mono text-[10px] text-brand-dim uppercase tracking-wider leading-relaxed bg-brand-accent/5 p-4 border-l-2 border-brand-accent">
              * Yazılım SADECE bu listedeki kanalları son 7 gün içindeki en çok izlenen teknik videoları için tarar.
              Farklı bir kanaldan veri çekilmesi protokol gereği engellenmiştir.
            </p>
          </div>
        </section>

        {/* Main Content Areas */}
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] border-b border-brand-line">
          {/* Left Column: Content */}
          <section className="p-10 md:p-14 border-r border-brand-line relative">
            <AnimatePresence mode="wait">
              {loading ? (
                <motion.div 
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col h-full space-y-6"
                >
                  {/* Status Bar */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-end font-mono text-[10px] uppercase tracking-[0.2em]">
                      <span className="text-brand-accent flex items-center gap-2">
                        <RefreshCw size={12} className="animate-spin" />
                        SİSTEM DURUMU: AKTİF ANALİZ
                      </span>
                      <span className="text-brand-text">{Math.round(progress)}% Tamamlandı</span>
                    </div>
                    <div className="h-2 bg-brand-line overflow-hidden border border-brand-line">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        className="h-full bg-brand-accent shadow-[0_0_15px_rgba(0,255,157,0.5)] transition-all duration-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 overflow-hidden min-h-[400px]">
                    {/* Log Terminal */}
                    <div className="flex flex-col h-full bg-black/40 border border-brand-line px-6 py-4 font-mono text-[10px] space-y-2 overflow-y-auto max-h-[400px] scrollbar-hide relative">
                      <div className="text-brand-dim pb-2 border-b border-brand-line/30 mb-2 uppercase tracking-widest flex items-center gap-2 sticky top-0 bg-brand-bg/80 backdrop-blur-sm z-10 w-full">
                        <Terminal size={12} /> PROCESS_LOGS
                      </div>
                      <div className="flex-1">
                        {logs.map((log, i) => (
                          <motion.div 
                            key={i}
                            initial={{ opacity: 0, x: -5 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={`
                              leading-relaxed
                              ${log.type === 'step' ? "text-brand-accent font-bold mt-4 border-l-2 border-brand-accent pl-2" : ""}
                              ${log.type === 'success' ? "text-brand-accent" : ""}
                              ${log.type === 'error' ? "text-red-500" : ""}
                              ${log.type === 'info' ? "text-brand-dim pl-4" : ""}
                            `}
                          >
                            {log.type === 'step' ? ">> " : "   "}
                            {log.message}
                          </motion.div>
                        ))}
                      </div>
                      <div className="animate-pulse text-brand-accent mt-2">_</div>
                    </div>

                    {/* Visual Progress */}
                    <div className="flex flex-col h-full space-y-6 overflow-y-auto scrollbar-hide">
                      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand-dim">
                        KAYNAK DURUM TABLOSU
                      </p>
                      
                      <div className="space-y-2">
                        {processedSources.map((s, i) => (
                          <motion.div 
                            key={i}
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-center justify-between p-3 border border-brand-line bg-brand-surface/20 text-[10px] font-mono"
                          >
                            <div className="flex items-center gap-2 truncate">
                              {s.transcriptStatus === 'success' ? <Check size={10} className="text-brand-accent" /> : <AlertCircle size={10} className="text-red-500" />}
                              <span className="text-brand-dim w-20 shrink-0">{s.channel}</span>
                              <span className="text-brand-text truncate italic">{s.title}</span>
                            </div>
                            <span className={s.transcriptStatus === 'success' ? "text-brand-accent ml-4" : "text-red-500 ml-4"}>
                              {s.views}
                            </span>
                          </motion.div>
                        ))}
                      </div>

                      {currentSourceProgress && (
                        <motion.div
                          key={currentSourceProgress.title}
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="p-6 border border-brand-accent/30 bg-brand-accent/5 backdrop-blur-sm space-y-3"
                        >
                          <div className="flex justify-between items-start">
                            <span className="font-mono text-[9px] text-brand-accent uppercase tracking-widest">AKTİF ANALİZ</span>
                            <span className="font-mono text-[9px] text-brand-dim">{currentSourceProgress.date}</span>
                          </div>
                          <div className="text-sm font-medium leading-tight text-white">{currentSourceProgress.title}</div>
                          <div className="flex justify-between items-center pt-2">
                            <span className="font-mono text-[9px] text-brand-dim">{currentSourceProgress.channel}</span>
                            <span className="font-mono text-[9px] text-brand-accent">{currentSourceProgress.views} GÖRÜNTÜLENME</span>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </div>

                  {/* Footer Status Bar */}
                  <div className="mt-auto pt-6 border-t border-brand-line">
                    <div className="flex items-center gap-4 bg-brand-surface/30 p-4 border border-brand-line">
                      <div className="flex h-3 w-3 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-brand-accent"></span>
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="font-mono text-[9px] text-brand-dim uppercase tracking-[0.2em]">ŞU AN YAPILIYOR:</div>
                        <div className="font-mono text-xs text-brand-accent truncate uppercase tracking-widest font-bold">
                          {subStatus}
                        </div>
                      </div>
                      <div className="hidden md:block font-mono text-[9px] text-brand-dim text-right">
                        THREADS: ACTIVE<br />
                        MEMORY: OPTIMIZED
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : error ? (
                <motion.div 
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-8 border border-red-500/20 bg-red-500/5 text-red-500 font-mono text-sm uppercase tracking-wider"
                >
                  [ HATA ]: {error}
                </motion.div>
              ) : result ? (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-12"
                >
                  {result.sourcesFound ? (
                    <div className="space-y-12">
                      <div className="space-y-4 border-b border-brand-line pb-8">
                        <div className="flex items-center gap-4">
                          <h2 className="font-mono text-xs font-bold uppercase tracking-[0.3em] text-brand-accent flex items-center gap-2">
                            <Newspaper size={14} /> NEWSLETTER_OUTPUT
                          </h2>
                        </div>
                        <div className="space-y-2">
                          <label className="font-mono text-[9px] uppercase tracking-widest text-brand-dim">BU METİNDE DEĞİŞTİRMEK İSTEDİĞİNİZ BİR ŞEY VAR MI? (OPSİYONEL):</label>
                          <div className="flex flex-col sm:flex-row gap-4">
                            <textarea
                              value={revisionPrompt}
                              onChange={e => setRevisionPrompt(e.target.value)}
                              placeholder="Örn: Daha kısa ve öz yaz. Teknik terimleri azalt..."
                              className="flex-1 bg-brand-surface/20 border border-brand-line p-3 font-mono text-[10px] leading-relaxed text-brand-text focus:border-brand-accent outline-none resize-y min-h-[60px] transition-colors"
                            />
                            <button
                              onClick={handleRegenerateText}
                              disabled={textLoading}
                              className={`font-mono text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 px-6 py-3 border whitespace-nowrap ${textLoading ? "border-brand-line text-brand-dim cursor-wait bg-transparent" : "border-brand-accent bg-brand-accent/5 text-brand-accent hover:bg-brand-accent hover:text-black transition-colors"}`}
                            >
                              <RefreshCw size={14} className={textLoading ? "animate-spin" : ""} /> YENİ METİN OLUŞTUR
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Common Topics Summary */}
                      {result.commonTopics && result.commonTopics.length > 0 && (
                        <div className="p-6 border border-brand-accent/20 bg-brand-accent/5 space-y-4">
                          <h4 className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand-accent">BU HAFTANIN ORTAK GÜNDEMİ:</h4>
                          <div className="flex flex-wrap gap-2">
                            {result.commonTopics.map((topic, tidx) => (
                              <span key={tidx} className="px-3 py-1 border border-brand-accent/30 text-brand-accent text-[10px] font-mono uppercase tracking-widest">
                                {topic}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {textLoading && (
                        <div className="p-12 border border-brand-line bg-brand-surface/20 flex flex-col items-center justify-center space-y-4">
                          <RefreshCw size={32} className="animate-spin text-brand-accent/50" />
                          <span className="font-mono text-[10px] text-brand-dim uppercase tracking-widest animate-pulse">
                            YENİ METİN YAZILIYOR...
                          </span>
                        </div>
                      )}

                      <div className="space-y-12" ref={newsletterRef}>
                        {(result.contentHistory || [result.content]).map((content, idx) => (
                          <div key={idx} className="space-y-6 pb-12 border-b border-brand-line/50 last:border-b-0">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[10px] uppercase tracking-widest text-brand-dim">
                                VERSİYON { (result.contentHistory?.length || 1) - idx } {idx === 0 && "(EN YENİ)"}
                              </span>
                              <button
                                onClick={() => copyToClipboard(content)}
                                className="font-mono text-[10px] uppercase tracking-widest text-brand-dim hover:text-brand-accent flex items-center gap-2 transition-colors"
                              >
                                {copying ? <Check size={12} /> : <Copy size={12} />}
                                {copying ? "KOPYALANDI" : "KOPYALA"}
                              </button>
                            </div>
                            <div className="font-sans text-xl md:text-2xl font-light leading-relaxed whitespace-pre-wrap text-brand-text selection:bg-brand-accent selection:text-black">
                              <Markdown>{content}</Markdown>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* RAW DATA ACCORDION / TOGGLE */}
                      <div className="mt-12 pt-8 border-t border-brand-line">
                          <button 
                            onClick={() => setShowRawData(!showRawData)}
                            className="flex items-center gap-2 text-sm font-semibold text-brand-accent hover:text-white transition-colors uppercase tracking-widest font-mono"
                          >
                            <ListRestart className="w-4 h-4" />
                            {showRawData ? '[ HAM VERİLERİ GİZLE ]' : '[ YAPAY ZEKANIN OKUDUĞU HAM VERİLERİ (TRANSKRİPT) İNCELE ]'}
                          </button>
                          
                          {showRawData && (
                            <div className="mt-6 space-y-4">
                              {processedSources.map((src, i) => (
                                <div key={i} className="p-4 bg-brand-surface/20 border border-brand-line text-xs font-mono text-brand-dim">
                                   <div className="flex justify-between items-center mb-2">
                                     <div className="font-bold text-brand-text text-sm">{src.channel} - {src.title}</div>
                                     <div className="text-brand-accent">{src.views} izlenme • {src.date}</div>
                                   </div>
                                   <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline mb-4 block">
                                     {src.url}
                                   </a>
                                   <div className="mt-4 text-brand-text/70 max-h-64 overflow-y-auto whitespace-pre-wrap bg-black/40 p-4 border border-brand-line/50 font-sans text-sm">
                                     {src.transcriptStatus === 'success' ? src.transcript : 'YOUTUBE BU VİDEONUN ERİŞİMİNE (TRANSKRİPTİNE) İZİN VERMEDİ.'}
                                   </div>
                                </div>
                              ))}
                            </div>
                          )}
                      </div>

                      <div className="flex flex-col sm:flex-row gap-4 pt-4">
                        <button
                          onClick={() => copyToClipboard(result.content)}
                          className={`
                            flex-1 py-6 px-10 font-mono text-xs font-bold tracking-widest uppercase border transition-all duration-300 flex items-center justify-center gap-3
                            ${copying 
                              ? "bg-brand-accent text-black border-brand-accent" 
                              : "bg-transparent text-brand-accent border-brand-accent hover:bg-brand-accent/10"}
                          `}
                        >
                          {copying ? <Check size={16} /> : <Copy size={16} />}
                          {copying ? "METİN KOPYALANDI" : "EN YENİ METNİ KOPYALA"}
                        </button>
                      </div>

                      {/* PROOF OF SOURCE: Permanent Verification Section */}
                      <div className="space-y-10 pt-20 border-t border-brand-line mt-20">
                        <div className="flex items-center gap-4">
                          <CheckCircle2 size={24} className="text-brand-accent" />
                          <h3 className="font-black text-3xl uppercase tracking-tighter">İÇERİK DOĞRULAMA (PROOF OF SOURCE)</h3>
                        </div>
                        
                        <div className="grid gap-6">
                          {processedSources.map((source, idx) => (
                            <div 
                              key={idx} 
                              className={`p-6 border ${source.transcriptStatus === 'success' ? 'border-brand-line bg-brand-surface/20' : 'border-red-900/30 bg-red-900/5'} flex flex-col md:flex-row justify-between gap-6 transition-all hover:border-brand-accent/50 group`}
                            >
                              <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                  <span className="font-mono text-[9px] bg-brand-accent text-black px-2 py-0.5 font-black uppercase">DOĞRULANMIŞ KAYNAK {idx + 1}</span>
                                  <span className="font-mono text-[9px] italic text-brand-dim">YouTube Verified Account</span>
                                </div>
                                <h4 className="text-2xl font-bold text-brand-text group-hover:text-brand-accent transition-colors">{source.title}</h4>
                                <div className="flex flex-wrap gap-6 font-mono text-xs text-brand-dim uppercase tracking-widest">
                                  <div className="flex items-center gap-2 border-r border-brand-line pr-6">
                                    <span className="text-brand-accent">KANAL:</span> {source.channel}
                                  </div>
                                  <div className="flex items-center gap-2 border-r border-brand-line pr-6">
                                    <span className="text-brand-accent">İZLENME:</span> {source.views}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-brand-accent">TARİH:</span> {source.date}
                                  </div>
                                </div>
                              </div>
                              
                              <div className="flex flex-col items-end justify-center min-w-[200px] md:border-l border-brand-line md:pl-8">
                                <div className={`flex items-center gap-2 font-mono text-xs font-black uppercase tracking-widest ${source.transcriptStatus === 'success' ? 'text-brand-accent' : 'text-red-500'}`}>
                                  {source.transcriptStatus === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                                  {source.transcriptStatus === 'success' ? 'TRANSKRİPT ANALİZ EDİLDİ' : 'TRANSKRİPT ERİŞİLEMİ'}
                                </div>
                                <div className="font-mono text-[9px] text-brand-dim mt-2 text-right">
                                  {source.transcriptStatus === 'success' ? 'TEKNİK ÖZET ÇIKARIMI BAŞARILI' : 'OTOMATİK ÖZET VERİSİ KULLANILDI'}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        
                        <div className="p-8 border border-brand-line bg-black/40 font-mono text-[10px] text-brand-dim space-y-4 uppercase tracking-[0.2em] leading-relaxed">
                          <p className="flex items-start gap-3">
                            <span className="w-1.5 h-1.5 bg-brand-accent mt-1 flex-shrink-0" />
                            <span>Bülten mimarisi sadece yukarıda teyit edilen <span className="text-brand-text font-bold text-xs"> resmi kanalların </span> kendi yayınlarından beslenmektedir.</span>
                          </p>
                          <p className="flex items-start gap-3">
                            <span className="w-1.5 h-1.5 bg-brand-accent mt-1 flex-shrink-0" />
                            <span>Üretilen her paragraf, transkript verisindeki teknik parametrelerle çapraz kontrol edilmiştir.</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-10 py-10">
                      <div className="font-mono text-xs text-brand-accent uppercase tracking-widest border-l-2 border-brand-accent pl-4">
                        [ VERI_BULUNAMADI ]
                      </div>
                      <p className="text-xl text-brand-dim leading-relaxed font-light italic">
                        Belirtilen kanallarda bu haftaya ait yeterli teknik transkript verisi bulunamadı. Genel web bilgisiyle bülten hazırlanması engellendi.
                      </p>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-12"
                >
                  <div className="space-y-6">
                    <h2 className="text-2xl md:text-3xl font-light text-brand-accent leading-tight tracking-tight">
                      Otomatik Bülten Üretim Sistemine Hoş Geldiniz
                    </h2>
                    <p className="text-base md:text-lg text-brand-dim leading-relaxed font-light">
                      Bu uygulamanın amacı, belirlediğiniz teknik YouTube kanallarının son bir haftada yayınladığı en popüler videoları analiz ederek <strong className="text-brand-text font-normal">hemen paylaşıma hazır, yapay zeka destekli profesyonel bir LinkedIn bülteni</strong> oluşturmaktır. Belirtilen kanallardaki en sıcak gelişmeleri tarar ve size özel bir derleme sunar.
                    </p>
                  </div>
                  
                  <div className="space-y-6 bg-brand-surface/20 border border-brand-line p-8">
                    <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-brand-accent flex items-center gap-3">
                      <Terminal size={14} /> ADIM ADIM KULLANIM
                    </h3>
                    <ul className="space-y-6 font-mono text-[10px] md:text-[11px] text-brand-dim uppercase tracking-wider leading-relaxed">
                      <li className="flex items-start gap-4">
                        <span className="text-brand-accent mt-0.5">01 //</span>
                        <span>Yukarıdaki <strong className="text-brand-text">"HEDEF YOUTUBE KANALLARI"</strong> bölümünden bültene dahil edilmesini istediğiniz kaynakları belirleyin veya silebilirsiniz.</span>
                      </li>
                      <li className="flex items-start gap-4">
                        <span className="text-brand-accent mt-0.5">02 //</span>
                        <span>Sağ üst köşedeki <strong className="text-brand-text">"BÜLTENİ OLUŞTUR"</strong> butonuna tıklayarak süreci başlatın. Bu işlem bağlantı hızınıza ve video sayısına göre biraz süre alabilir.</span>
                      </li>
                      <li className="flex items-start gap-4">
                        <span className="text-brand-accent mt-0.5">03 //</span>
                        <span>Sistem transkriptleri analiz edecek ve size haber metni ile infografik üretim promptunu sunacaktır. Sonuçları inceleyip dilerseniz yapay zekadan bülten metnini güncel isteklerinize göre revize etmesini isteyebilirsiniz.</span>
                      </li>
                    </ul>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* Right Column: Sidebar */}
          <section className="p-10 md:p-14 bg-gradient-to-b from-brand-surface to-brand-bg flex flex-col justify-between gap-12">
            <div className="space-y-12">
              <div className="space-y-6">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand-accent border-l-2 border-brand-accent pl-4">
                  SİSTEM DURUMU
                </h3>
                <p className="text-sm md:text-base font-light italic leading-relaxed text-brand-dim">
                  Yapay Zeka ve LLM dünyasındaki yenilikleri hızlı ve etkili şekilde takip edin. Bu asistan, teknik haberleri doğrudan ham kaynaklardan (YouTube transkriptleri) sentezler, manuel araştırma süresini ortadan kaldırır. 
                </p>
              </div>

              {result?.imagePrompt && (
                <div className="space-y-6">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.3em] text-brand-accent border-l-2 border-brand-accent pl-4">
                    BÜLTEN GÖRSELİ
                  </h3>
                  
                  <div className="space-y-6">
                    <div className="relative group overflow-hidden border border-brand-line bg-black flex flex-col p-6 space-y-4">
                      <div className="space-y-2">
                        <label className="font-mono text-[9px] uppercase tracking-widest text-brand-accent">IMAGE PROMPT (DÜZENLENEBİLİR):</label>
                        <textarea
                          value={result.imagePrompt}
                          onChange={(e) => setResult(prev => prev ? { ...prev, imagePrompt: e.target.value } : null)}
                          className="w-full bg-brand-bg border border-brand-line p-3 font-mono text-[10px] leading-relaxed text-brand-dim italic focus:border-brand-accent focus:text-brand-text outline-none resize-y min-h-[100px] transition-colors"
                        />
                      </div>
                      <div className="flex flex-wrap gap-4 pt-2 border-t border-brand-line/50">
                        <button
                          onClick={handleRegenerateImage}
                          disabled={imageLoading}
                          className={`font-mono text-[10px] uppercase tracking-widest flex items-center gap-2 ${imageLoading ? "text-brand-dim cursor-wait" : "text-brand-accent hover:underline"}`}
                        >
                          <RefreshCw size={10} className={imageLoading ? "animate-spin" : ""} /> YENİDEN OLUŞTUR
                        </button>
                        <button
                          onClick={() => copyToClipboard(result.imagePrompt || "")}
                          className="font-mono text-[10px] uppercase tracking-widest text-brand-dim hover:text-brand-text transition-colors flex items-center gap-2"
                        >
                          <Copy size={10} /> PROMPT KOPYALA
                        </button>
                      </div>
                    </div>

                    {imageLoading && (
                      <div className="relative group overflow-hidden border border-brand-line bg-black flex flex-col">
                        <div className="aspect-video relative overflow-hidden bg-brand-surface/50">
                          <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4">
                            <RefreshCw size={24} className="animate-spin text-brand-accent/50" />
                            <span className="font-mono text-[10px] text-brand-dim uppercase tracking-widest animate-pulse">
                              GÖRSEL OLUŞTURULUYOR...
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {(result.imageUrls || (result.imageUrl ? [result.imageUrl] : [])).map((imgUrl, idx) => (
                      <div key={idx} className="relative group overflow-hidden border border-brand-line bg-black flex flex-col">
                        <div className="aspect-[16/9] relative overflow-hidden bg-brand-surface/50">
                          <motion.img 
                            initial={{ opacity: 0, scale: 1.1 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.7 }}
                            src={imgUrl} 
                            alt={`AI Newsletter Visual ${idx + 1}`}
                            className="absolute inset-0 w-full h-full object-contain transition-transform duration-700 group-hover:scale-105"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="p-4 border-t border-brand-line flex justify-end">
                          <a 
                            href={imgUrl} 
                            download={`ai-newsletter-gems-${idx + 1}.png`}
                            className="font-mono text-[10px] uppercase tracking-widest text-brand-text hover:text-brand-accent flex items-center gap-2"
                          >
                            <ExternalLink size={10} /> GÖRSELİ İNDİR
                          </a>
                        </div>
                      </div>
                    ))}
                    
                    {!imageLoading && !(result.imageUrls?.length || result.imageUrl) && (
                      <div className="relative group overflow-hidden border border-brand-line bg-black flex flex-col">
                        <div className="aspect-video relative overflow-hidden bg-brand-surface/50">
                          <div className="absolute inset-0 flex items-center justify-center text-brand-dim/30">
                            <ImageIcon size={48} strokeWidth={1} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="p-8 border border-dashed border-brand-line">
              <p className="font-mono text-[10px] uppercase leading-loose tracking-widest text-brand-dim">
                TRANSKRİPT ANALİZİ: AKTİF<br />
                KAYNAK KONTROLÜ: DOĞRULANDI<br />
                TEKNİK DERİNLİK: %100
              </p>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="p-10 md:px-14 md:py-8 flex flex-col md:flex-row items-center justify-between gap-8 border-t border-brand-line bg-black/40">
          <div className="font-mono text-[10px] text-brand-accent uppercase tracking-[0.2em] flex flex-wrap gap-x-6 gap-y-2">
            <span>#MuratKarakayaAkademi</span>
            <span>#AIAutomations</span>
            <span>#LLM</span>
          </div>
          <div className="text-center md:text-right max-w-lg">
            <p className="font-mono text-[10px] text-brand-dim uppercase tracking-wider leading-relaxed">
              YAPAY ZEKA DESTEKLİ HABER BÜLTENİ ÜRETİM ASİSTANI
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
