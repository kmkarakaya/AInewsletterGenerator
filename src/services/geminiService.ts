export interface VideoSource {
  channel: string;
  date: string;
  title: string;
  views?: string;
  videoId?: string;
  url?: string;
  transcript?: string;
  transcriptStatus?: 'success' | 'failed';
}

export interface ApiConnectionStatus {
  status: 'connected' | 'error';
  service: string;
  message: string;
}

export interface NewsletterResult {
  content: string;
  contentHistory?: string[];
  imagePrompt: string;
  error?: string;
  sourcesFound: boolean;
  sources?: VideoSource[];
  imageUrl?: string;
  imageUrls?: string[];
  commonTopics?: string[];
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (!response.ok) {
    const normalizedMessage = typeof result.error === 'string'
      ? result.error
      : result.error?.message || result.message || `Request failed: ${response.status}`;
    throw new Error(normalizedMessage);
  }

  return result as T;
}

export const checkSourceConnection = async (): Promise<ApiConnectionStatus> => {
  try {
    return await postJson<ApiConnectionStatus>('/api/llm/check-connection', {});
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      status: 'error',
      service: 'YouTube Search Service',
      message: `Bağlantı Katmanı Hatası: ${errorMsg}. Lütfen 5-10 dakika sonra tekrar deneyin.`,
    };
  }
};

export const searchSources = async (channels: string[]): Promise<VideoSource[]> => {
  try {
    const timestamp = new Date().getTime();
    // Calling our local Express backend for deterministic YouTube search (bypassing any browser cache)
    const response = await fetch(`/api/channels/videos?t=${timestamp}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channels })
    });
    
    if (!response.ok) throw new Error("Backend video araması başarısız oldu.");
    
    const result = await response.json();
    return result.videos || [];
  } catch (error) {
    console.error("Search Error:", error);
    throw new Error(`Kanal tarama işlemi sırasında bir sorun oluştu: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const fetchTranscriptData = async (videoId: string, url?: string, onStatus?: (msg: string) => void): Promise<string> => {
  try {
    // AŞAMA 1: Backend proxy üzerinden asıl transkripti çek (youtube-transcript vb.)
    onStatus?.(`[AŞAMA 1] Proxy üzerinden ${videoId} videosunun ham transkripti çekiliyor...`);
    const rawTranscript = await fallbackFetchTranscript(videoId);
    
    if (rawTranscript && rawTranscript.length > 50) {
      if (rawTranscript.includes("TRANSCRIPT NOT FOUND")) {
         onStatus?.(`[BİLGİ] Asıl transkript bulunamadı, video açıklaması (description) yönlendiriliyor.`);
         return rawTranscript;
      }

      onStatus?.(`[AŞAMA 2] Ham transkript proxyden çekildi (${rawTranscript.length} karakter). Bültende kullanılmak üzere LLM ile özetleniyor...`);

      const result = await postJson<{ summary: string }>('/api/llm/transcript-summary', {
        transcript: rawTranscript,
      });

      if (result.summary && result.summary.length > 50) {
        onStatus?.(`[BAŞARILI] Transkript LLM tarafından başarıyla özetlendi ve analiz edildi.`);
        return result.summary;
      }
      
      onStatus?.(`[UYARI] LLM özetlemesi boş döndü, mecbur ham veriyi aktarıyoruz.`);
      return rawTranscript;
    }

    onStatus?.(`[HATA] Proxy (arka plan) üzerinden transkripte ulaşılamadı.`);
    return "";
  } catch (err) {
    console.error("Transcript fetch & summarize error:", err);
    onStatus?.(`[HATA] İşlem sırasında hata oluştu: ${err instanceof Error ? err.message : String(err)}`);
    return "";
  }
};

const fallbackFetchTranscript = async (videoId: string): Promise<string> => {
  try {
    const response = await fetch('/api/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId })
    });
    if (!response.ok) return "";
    const data = await response.json();
    return data.text || "";
  } catch (err) {
    console.error("Transcript API error:", err);
    return "";
  }
};

export const generateNewsletter = async (sources: VideoSource[], revisionPrompt?: string, lastContent?: string): Promise<NewsletterResult> => {
  try {
    return await postJson<NewsletterResult>('/api/llm/newsletter', {
      sources,
      revisionPrompt,
      lastContent,
    });
  } catch (error) {
    console.error("Gemini Error:", error);
    return {
      content: "Bülten oluşturulurken bir hata oluştu.",
      imagePrompt: "",
      sourcesFound: false,
      sources: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

export const generateImage = async (prompt: string): Promise<string | null> => {
  try {
    const response = await postJson<{ imageUrl: string | null }>('/api/llm/image', {
      prompt,
    });
    return response.imageUrl;
  } catch (error) {
    console.error("Image generation error:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes("403") || errorMsg.includes("permission")) {
      throw new Error("IMAGE_GEN_PERMISSION: Görsel oluşturma modeli için yetki hatası.");
    }
    if (errorMsg.includes("quota") || errorMsg.includes("429")) {
      throw new Error("IMAGE_GEN_QUOTA: Görsel oluşturma limiti aşıldı.");
    }
    return null;
  }
};
