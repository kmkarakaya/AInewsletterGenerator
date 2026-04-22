import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface VideoSource {
  channel: string;
  date: string;
  title: string;
  views?: string;
  videoId?: string;
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
  imagePrompt: string;
  error?: string;
  sourcesFound: boolean;
  sources?: VideoSource[];
  imageUrl?: string;
  commonTopics?: string[];
}

export const checkSourceConnection = async (): Promise<ApiConnectionStatus> => {
  try {
    // Phase 1: Basic API Connectivity
    // We send a very simple prompt to verify the API key is valid.
    const basicCheck = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "API_REACHABILITY_PULSE_CHECK",
    });

    if (!basicCheck) throw new Error("API base layers unreachable.");

    // Phase 2: Search Tool Permission Check
    // This is where most 403 errors happen. We use a real query to trigger the tool properly.
    const searchCheck = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "CURRENT_TIME_AND_DATE_IN_UTC",
      config: { 
        tools: [{ googleSearch: {} }],
        toolConfig: { includeServerSideToolInvocations: true }
      }
    });
    
    if (searchCheck) {
      return { 
        status: 'connected', 
        service: 'YouTube Search Service', 
        message: 'YouTube/Google veri kanalları açık. Sistem operasyona hazır.' 
      };
    }
    throw new Error("No response from AI service components");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    let userSuggestion = "Lütfen 5-10 dakika sonra tekrar deneyin.";
    
    if (errorMsg.includes("403") || errorMsg.includes("PERMISSION_DENIED")) {
      userSuggestion = "API KEY YETKİ HATASI: Gemini API anahtarınızın 'Google Search' (Arama) yetkisi kapalı. Lütfen Google AI Studio -> API Key -> Search Tool ayarlarını kontrol edin.";
    } else if (errorMsg.includes("quota") || errorMsg.includes("429") || errorMsg.includes("limit")) {
      userSuggestion = "KOTA SINIRI: Kullanım limitine takıldınız. Lütfen 30 dakika bekleyiniz.";
    } else if (errorMsg.includes("network") || errorMsg.includes("connection")) {
      userSuggestion = "AĞ HATASI: İnternet veya backend servislerine ulaşılamıyor. Lokasyonunuzdaki filtreleri kontrol edin.";
    }

    return { 
      status: 'error', 
      service: 'YouTube Search Service', 
      message: `Bağlantı Katmanı Hatası: ${errorMsg}. ${userSuggestion}` 
    };
  }
};

export const searchSources = async (channels: string[]): Promise<VideoSource[]> => {
  try {
    // Calling our local Express backend for deterministic RSS search
    const response = await fetch('/api/videos', {
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

export const fetchTranscriptData = async (videoId: string): Promise<string> => {
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

export const generateNewsletter = async (sources: VideoSource[]): Promise<NewsletterResult> => {
  try {
    const sourcesContext = sources.map(s => `- ${s.title} (${s.channel}, ${s.date})`).join("\n");
    const prompt = `
      Current Date: April 18, 2026.
      Target Period: April 11 - April 18, 2026.
      
      ANALYZING TOP 3 TRENDING VIDEOS:
      ${sourcesContext}

      TASK:
      1. Deeply analyze the transcripts or detailed technical summaries of ONLY these top 3 videos.
      2. CROSS-ANALYSIS: Identify if there are common news, overlapping technical concepts, or shared announcements discussed across these transcripts. List these common topics clearly.
      3. Focus on "The Most Impactful Shared Trends" of the week found in these sources.
      4. Generate a LinkedIn newsletter for "Murat Karakaya Akademi" in TURKISH.
      5. PRIORITY: If common topics exist, lead with them as the core highlight of the week. Summarize the technical essence.
      
      6. RULES:
         - Professional news agency style.
         - NO mention of YouTube, channel names, or "video" in the text.
         - Format:
           🚀 Ana Başlık: Haftanın Ortak AI Gündemi (11 - 18 Nisan 2026)
           🌐 Giriş: Haftanın en çok dikkat çeken ortak konusunu özetleyen vurucu cümle.
           Haber Maddeleri (Öncelikle ortak konular, sonra videolardaki tekil devrim niteliğindeki gelişmeler):
           📰 [Haber Başlığı]
           ⚙️ Gelişme: Transkriptlerden gelen teknik özet (Maks. 3 cümle).
           🎯 Neden Önemli?: Stratejik avantaj ve sektörel etki.
           🔮 Kapanış: Murat Karakaya Akademi'den bir öngörü.
           💬 Soru: Takipçilere teknik bir tartışma sorusu.
           🏷️ Hashtagler: #MuratKarakayaAkademi and relevant tech tags.
      7. Provide a detailed English prompt for an IMAGE GENERATION AI. 
         - The prompt MUST describe a high-tech technical "INFOGRAPHIC".
         - It MUST explicitly list at least 5-7 technical keywords/concepts found in the analysis (e.g., 'Local LLM', 'Llama 3.1', 'RAG', 'Agentic Workflow', etc.) to be rendered as large, legible, neon-green technical typography.
         - Describe these terms as being part of a data-viz web, connected by neon lines on a deep black background.
         - The vibe must be: "Engineering Blueprint meet Cyberpunk Infographic".
         - Ensure the prompt demands correct spelling and clear visibility of these technical terms.

      OUTPUT SCHEMA:
      {
        "content": "Full Turkish newsletter text",
        "imagePrompt": "Detailed English image prompt",
        "sourcesFound": true,
        "sources": [
          { "channel": "@example", "date": "2026-04-15", "title": "Top Trend Video", "views": "150K" }
        ],
        "commonTopics": ["Topic 1", "Topic 2"]
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        toolConfig: { includeServerSideToolInvocations: true },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            content: { type: Type.STRING },
            imagePrompt: { type: Type.STRING },
            sourcesFound: { type: Type.BOOLEAN },
            sources: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  channel: { type: Type.STRING },
                  date: { type: Type.STRING },
                  title: { type: Type.STRING },
                  views: { type: Type.STRING }
                },
                required: ["channel", "date", "title", "views"]
              }
            },
            commonTopics: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["content", "imagePrompt", "sourcesFound", "sources", "commonTopics"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    return result;
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
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          { text: `CREATE A TECHNICAL DATA INFOGRAPHIC. 
          STRICT INSTRUCTIONS: 
          - Visual theme: ${prompt}
          - Mandatory technical keywords to include as text: ${prompt}
          - Style: Engineering blueprint, data-viz, cyberpunk, high-tech, black background, neon green text.
          - Quality: Professional infographic design.` }
        ]
      },
      config: {
        imageConfig: {
          aspectRatio: "16:9"
        }
      }
    });

    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
    }
    
    // If no inline data, check for errors in the response text
    if (response.text) {
      console.warn("AI returned text instead of image:", response.text);
    }
    
    return null;
  } catch (error) {
    console.error("Image generation error:", error);
    // Categorize error for better logging
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
