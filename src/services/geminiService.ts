import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

export const fetchTranscriptData = async (videoId: string, url?: string): Promise<string> => {
  try {
    // We bypass the flaky third-party youtube-transcript library which is blocked by YT Anti-Bot.
    // Instead we use the Gemini's native capabilities to read the video directly.
    const videoUrl = url || `https://www.youtube.com/watch?v=${videoId}`;
    const prompt = `Please act as a transcriber and summarize the content. Give me a highly detailed step-by-step technical extraction of what is discussed in this video: ${videoUrl}\n\nDo not invent things, rely on the tools to view the video content. Provide a long, detailed transcript summary.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        toolConfig: { includeServerSideToolInvocations: true }
      }
    });

    if (response.text && response.text.length > 50) {
      return response.text;
    }
    
    // Fallback if Gemini fails
    return await fallbackFetchTranscript(videoId);
  } catch (err) {
    console.error("Gemini Transcript fetch error:", err);
    return await fallbackFetchTranscript(videoId);
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
    const today = new Date();
    const lastWeek = new Date(today);
    lastWeek.setDate(today.getDate() - 7);
    
    // Format dates for Turkish format
    const dateFormatter = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
    const todayStr = dateFormatter.format(today);
    const lastWeekStr = dateFormatter.format(lastWeek);
    const dateRangeStr = `${lastWeek.getDate()} - ${todayStr}`;
    const currentDateEN = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const lastWeekEN = lastWeek.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const sourcesContext = sources.map(s => `- ${s.title} (${s.channel}, ${s.date})\n  Transcript/Summary: ${s.transcript?.substring(0, 800) || "No transcript"}`).join("\n\n");
    
    let revisionContext = "";
    if (revisionPrompt && lastContent) {
      revisionContext = `
      USER REVISION REQUEST:
      The user wants to rewrite the previous newsletter with the following instructions:
      "${revisionPrompt}"

      PREVIOUS NEWSLETTER CONTENT:
      ${lastContent}

      You MUST apply the user's revision request to create the newly generated newsletter. Keep the overall structure but apply their requests carefully.
      `;
    }

    const prompt = `
      Current Date: ${currentDateEN}.
      Target Period: ${lastWeekEN} - ${currentDateEN}.
      
      ANALYZING TOP ${sources.length} TRENDING VIDEOS:
      ${sourcesContext}
      ${revisionContext}

      TASK:
      1. Deeply analyze the transcripts or detailed technical summaries of ONLY these top ${sources.length} videos.
      2. CROSS-ANALYSIS: Identify if there are common news, overlapping technical concepts, or shared announcements discussed across these transcripts. List these common topics clearly.
      3. Focus on "The Most Impactful Shared Trends" of the week found in these sources.
      4. Generate a LinkedIn newsletter for "Murat Karakaya Akademi" in TURKISH.
      5. PRIORITY: If common topics exist, lead with them as the core highlight of the week. Summarize the technical essence.
      
      6. RULES:
         - Professional news agency style.
         - NO bold text formatting (**text**) should be used anywhere in the generated text.
         - NO mention of YouTube, channel names, or "video" in the text.
         - DO NOT write the section labels like "Ana Başlık:", "Giriş:", "Kapanış:", "Soru:", "Hashtagler:". Instead, just use the relevant emojis and write the section content directly.
         - Format Example:
           🚀 Haftanın Yapay Zeka Gündemi (${dateRangeStr})
           🌐 [Haftanın en çok dikkat çeken ortak konusunu özetleyen vurucu cümle]
           
           Haber Maddeleri (Öncelikle ortak konular, sonra videolardaki tekil devrim niteliğindeki gelişmeler):
           📰 [Haber Başlığı]
           ⚙️ Gelişme: Transkriptlerden gelen teknik özet (Maks. 3 cümle).
           🎯 Neden Önemli?: Stratejik avantaj ve sektörel etki.
           
           🔮 [Murat Karakaya Akademi'den bir öngörü]
           💬 [Takipçilere teknik bir tartışma sorusu]
           🏷️ #MuratKarakayaAkademi [relevant tech tags]

      OUTPUT SCHEMA:
      {
        "content": "Full Turkish newsletter text",
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
          required: ["content", "sourcesFound", "sources", "commonTopics"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    
    // Step 2: Now that we have the newsletter content, dynamically generate the image prompt
    if (result.content && result.content.length > 10) {
      result.imagePrompt = await generateImagePromptForNewsletter(result.content);
    } else {
      result.imagePrompt = "Detailed tech infographic, mind map style, flat vector art, modern corporate tech style.";
    }
    
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

export const generateImagePromptForNewsletter = async (newsletterContent: string): Promise<string> => {
  try {
    const prompt = `
      I have just generated a technical newsletter in Turkish.
      Read the newsletter below and write a highly detailed, extremely specific English image generation prompt to create an infographic that perfectly represents the precise topics discussed.

      NEWSLETTER CONTENT:
      ${newsletterContent}

      INSTRUCTIONS:
      - The image MUST be a professional, high-quality, modern "INFOGRAPHIC" or "mind map" suitable for a LinkedIn post.
      - Visually represent the core AI/tech tools, models, and concepts mentioned in the text (e.g. if the text mentions specific LLMs like GPT-5, Claude, or specific technologies, include these concepts visually).
      - Do NOT just write one large word. Instead, ask the image AI to render multiple key technical terms and concepts as a well-structured infographic, interconnected diagram, or mind map.
      - Request a solid dark blue background, bright legible white, cyan, and orange typography, connecting lines and glowing nodes representing data.
      - Output ONLY the English prompt string, without any other conversational text or markdown formatting.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt
    });

    return response.text ? response.text.trim() : "Detailed tech infographic, mind map style, flat vector art, modern corporate tech style.";
  } catch (error) {
    console.error("Gemini Image Prompt Error:", error);
    return "Detailed tech infographic, mind map style, flat vector art, modern corporate tech style.";
  }
};

export const generateImage = async (prompt: string): Promise<string | null> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          { text: prompt }
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
