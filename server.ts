import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
import { getSubtitles } from 'youtube-captions-scraper';
import ytdl from '@distube/ytdl-core';
import yts from 'yt-search';
import path from 'path';
import { fileURLToPath } from 'url';
import { AI_MODELS } from './src/config.ts';
import type { NextFunction, Request, Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 3005;
const DEFAULT_HOST = '0.0.0.0';
const LLM_RATE_LIMIT_WINDOW_MS = 60_000;
const LLM_RATE_LIMIT_MAX_REQUESTS = 12;

type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'LLM_PERMISSION'
  | 'LLM_QUOTA'
  | 'INTERNAL_ERROR';

type ErrorPayload = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: string;
  };
};

const llmRequestLog = new Map<string, number[]>();

interface VideoSource {
  channel: string;
  date: string;
  title: string;
  views?: string;
  videoId?: string;
  url?: string;
  transcript?: string;
  transcriptStatus?: 'success' | 'failed';
}

interface NewsletterResult {
  content: string;
  imagePrompt: string;
  error?: string;
  sourcesFound: boolean;
  sources?: Array<{
    channel: string;
    date: string;
    title: string;
    views: string;
  }>;
  commonTopics?: string[];
}

function getClientKey(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.ip || 'unknown-client';
}

function sendApiError(res: Response, status: number, code: ApiErrorCode, message: string, details?: string) {
  const payload: ErrorPayload = {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };

  return res.status(status).json(payload);
}

function createLlmRateLimiter(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientKey = getClientKey(req);
    const now = Date.now();
    const recentRequests = (llmRequestLog.get(clientKey) || []).filter((timestamp) => now - timestamp < windowMs);

    if (recentRequests.length >= maxRequests) {
      const retryAfterSeconds = Math.ceil(windowMs / 1000);
      res.setHeader('Retry-After', retryAfterSeconds.toString());
      return sendApiError(
        res,
        429,
        'RATE_LIMITED',
        'LLM istek limiti aşıldı. Lütfen kısa bir süre sonra tekrar deneyin.',
        `Allowed ${maxRequests} requests per ${Math.floor(windowMs / 1000)} seconds.`,
      );
    }

    recentRequests.push(now);
    llmRequestLog.set(clientKey, recentRequests);
    next();
  };
}

function normalizeLlmError(error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerCaseMessage = errorMessage.toLowerCase();

  if (errorMessage.includes('403') || lowerCaseMessage.includes('permission')) {
    return {
      status: 403,
      code: 'LLM_PERMISSION' as const,
      message: 'LLM servisi için yetki hatası oluştu.',
      details: errorMessage,
    };
  }

  if (errorMessage.includes('429') || lowerCaseMessage.includes('quota') || lowerCaseMessage.includes('limit')) {
    return {
      status: 429,
      code: 'LLM_QUOTA' as const,
      message: 'LLM kullanım kotası veya hız limiti aşıldı.',
      details: errorMessage,
    };
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR' as const,
    message: 'LLM isteği işlenirken beklenmeyen bir hata oluştu.',
    details: errorMessage,
  };
}

function getAiClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

async function checkSourceConnectionWithGemini() {
  const ai = getAiClient();

  try {
    const basicCheck = await ai.models.generateContent({
      model: AI_MODELS.TEXT_GENERATION,
      contents: 'API_REACHABILITY_PULSE_CHECK',
    });

    if (!basicCheck) {
      throw new Error('API base layers unreachable.');
    }

    const searchCheck = await ai.models.generateContent({
      model: AI_MODELS.TEXT_GENERATION,
      contents: 'CURRENT_TIME_AND_DATE_IN_UTC',
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    if (searchCheck) {
      return {
        status: 'connected' as const,
        service: 'YouTube Search Service',
        message: 'YouTube/Google veri kanalları açık. Sistem operasyona hazır.',
      };
    }

    throw new Error('No response from AI service components');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    let userSuggestion = 'Lütfen 5-10 dakika sonra tekrar deneyin.';

    if (errorMsg.includes('403') || errorMsg.includes('PERMISSION_DENIED')) {
      userSuggestion = "API KEY YETKİ HATASI: Gemini API anahtarınızın 'Google Search' (Arama) yetkisi kapalı. Lütfen Google AI Studio -> API Key -> Search Tool ayarlarını kontrol edin.";
    } else if (errorMsg.includes('quota') || errorMsg.includes('429') || errorMsg.includes('limit')) {
      userSuggestion = 'KOTA SINIRI: Kullanım limitine takıldınız. Lütfen 30 dakika bekleyiniz.';
    } else if (errorMsg.includes('network') || errorMsg.includes('connection')) {
      userSuggestion = 'AĞ HATASI: İnternet veya backend servislerine ulaşılamıyor. Lokasyonunuzdaki filtreleri kontrol edin.';
    }

    return {
      status: 'error' as const,
      service: 'YouTube Search Service',
      message: `Bağlantı Katmanı Hatası: ${errorMsg}. ${userSuggestion}`,
    };
  }
}

async function summarizeTranscript(rawTranscript: string): Promise<string> {
  const ai = getAiClient();
  const prompt = `
    Sen uzaman bir teknik analizci ve veri madencisisin.
    Aşağıda bir YouTube videosundan çekilmiş ham transkript (altyazı dökümü) bulunmaktadır.
    
    GÖREV: Bu transkripti okuyup, profesyonel bir haber bülteninde kullanılmak üzere
    videonun özünü, en önemli teknik duyurularını, yeni tanıtılan araç/versiyonları 
    ve çözülen problemleri anlatan kapsamlı, madde madde bir teknik özet çıkarmaktır.
    
    ÇOK KRİTİK KURALLAR:
    1. SADECE aşağidaki ham transkriptte olan bilgileri özetle. DIŞARIDAN, GEÇMİŞTEN VEYA GENEL KÜLTÜRDEN HİÇBİR BİLGİ UYDURMA, EKLEME (HALLUCINATION YAPMA).
    2. Çıktıyı tamamen Türkçe ver.
    3. Yazım tarzın profesyonel, net ve bilgi yoğun olsun.

    HAM TRANSKRİPT:
    ${rawTranscript.substring(0, 40000)}
  `;

  const response = await ai.models.generateContent({
    model: AI_MODELS.TEXT_GENERATION,
    contents: prompt,
  });

  return response.text || '';
}

async function generateImagePromptForNewsletter(newsletterContent: string): Promise<string> {
  const ai = getAiClient();
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
    model: AI_MODELS.TEXT_GENERATION,
    contents: prompt,
  });

  return response.text ? response.text.trim() : 'Detailed tech infographic, mind map style, flat vector art, modern corporate tech style.';
}

async function generateNewsletterWithGemini(sources: VideoSource[], revisionPrompt?: string, lastContent?: string): Promise<NewsletterResult> {
  const ai = getAiClient();
  const today = new Date();
  const lastWeek = new Date(today);
  lastWeek.setDate(today.getDate() - 7);

  const dateFormatter = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  const todayStr = dateFormatter.format(today);
  const currentDateEN = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const lastWeekEN = lastWeek.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const dateRangeStr = `${lastWeek.getDate()} - ${todayStr}`;

  const sourcesContext = sources.map((source) => `- ${source.title} (${source.channel}, ${source.date})\n  Transcript/Summary: ${source.transcript?.substring(0, 15000) || 'No transcript'}`).join('\n\n');

  let revisionContext = '';
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

  const isRevisionMode = Boolean(revisionPrompt && lastContent);

  const sharedSourceRules = `
    SOURCE TRUTH RULES:
    - Deeply analyze the <sources_data> block. This block contains transcripts or detailed technical summaries of ONLY these top ${sources.length} videos.
    - EXTREMELY CRITICAL ANTI-HALLUCINATION RULE: You are strictly forbidden from writing about any news, events, or technologies not explicitly detailed in the <sources_data> block.
    - Do not bring in historical context, general knowledge, or previous news.
    - If the text says "No transcript" or has no data, skip that video entirely.
    - If NO video has relevant data, just output "Bu hafta herhangi bir spesifik veri kaynağı bulunamadı."
    - Identify common news, overlapping technical concepts, or shared announcements discussed across these transcripts.
    - Recompute common topics from <sources_data> and return them in the schema.
    - Focus on the most impactful shared trends of the week strictly found in these sources.
    - If common topics exist within the <sources_data>, lead with them as the core highlight and summarize their technical essence based solely on the provided text.
  `;

  const sharedNewsletterContract = `
    BASELINE NEWSLETTER CONTRACT:
    - The final output is still a LinkedIn newsletter for "Murat Karakaya Akademi" in Turkish.
    - Professional news agency style.
    - NO bold text formatting (**text**) should be used anywhere in the generated text.
    - Keep the output in Turkish.
    - Keep the visual newsletter language with emojis for major blocks instead of flattening everything into plain text.
    - Preserve the newsletter-like flow expected by the original generation prompt: headline or opening hook, core developments, why it matters, closing insight, discussion question, and hashtags when still appropriate.
    - The newsletter must never be written as a single continuous paragraph.
    - Use explicit paragraph breaks between major sections.
    - Each main news item must be its own paragraph block.
    - Leave a blank line between the opening, each news item, the closing insight, the discussion question, and the hashtags.
  `;

  const originalGenerationRules = `
    ORIGINAL GENERATION RULES:
    - Generate a LinkedIn newsletter based ONLY on the <sources_data>.
    - NO mention of YouTube, channel names, or "video" in the text.
    - DO NOT write the section labels like "Ana Başlık:", "Giriş:", "Kapanış:", "Soru:", "Hashtagler:". Instead, just use the relevant emojis and write the section content directly.
    - Every distinct news headline/topic must be presented as a separate paragraph block, not merged into one long paragraph.
    - For each news item, keep the headline and its supporting explanation together, but separate that block from the next item with a blank line.
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
  `;

  const revisionModeRules = `
    REVISION MODE RULES:
    - Your PRIMARY job is to EDIT the PREVIOUS NEWSLETTER CONTENT, not to write a brand new newsletter from scratch.
    - Treat the PREVIOUS NEWSLETTER CONTENT as the main draft document.
    - Apply the USER REVISION REQUEST directly and completely to that draft.
    - Use <sources_data> as a factual guardrail and enrichment source. Keep the revised text strictly consistent with those transcript summaries.
    - Preserve the overall structure, strongest insights, and valid factual claims from the previous newsletter unless the user explicitly asks to change, remove, shorten, expand, or reframe them.
    - If the USER REVISION REQUEST conflicts with <sources_data>, obey <sources_data> and adjust the text in the safest possible way.
    - Do not ignore the previous newsletter.
    - Do not regenerate a fresh unrelated variant.
    - Return a true revised version of the latest newsletter.
    - The user's revision request does not cancel the baseline newsletter contract unless the user explicitly asks to override one of those rules.
    - NO mention of YouTube, channel names, or "video" in the text unless the user's revision explicitly requires such wording.
    - DO NOT write helper labels like "Ana Başlık:", "Giriş:", "Kapanış:", "Soru:", "Hashtagler:". Just write the final newsletter.
    - If the current draft is too dense or collapsed, restore clear paragraph separation while revising.
    - Keep each main news topic in its own paragraph block with a blank line before the next one.
    - Preserve or restore the emoji-led structure of the newsletter during revision.
    - Use emoji-led section starts such as 🚀, 🌐, 📰, ⚙️, 🎯, 🔮, 💬, and 🏷️ where appropriate for the existing newsletter structure unless the user explicitly asks for a no-emoji rewrite.
  `;

  const outputSchemaContract = `
    OUTPUT SCHEMA:
    {
      "content": "Turkish newsletter text",
      "sourcesFound": true,
      "sources": [
        { "channel": "@example", "date": "2026-04-15", "title": "Top Trend Video", "views": "150K" }
      ],
      "commonTopics": ["Topic 1", "Topic 2"]
    }
  `;

  const prompt = isRevisionMode
    ? `
    Current Date: ${currentDateEN}.
    Target Period: ${lastWeekEN} - ${currentDateEN}.
    
    FACTUAL SOURCE MATERIAL FOR VALIDATION:
    <sources_data>
    ${sourcesContext}
    </sources_data>
    
    ${revisionContext}

    MODE: REVISION

    ${sharedSourceRules}

    ${sharedNewsletterContract}

    ${originalGenerationRules}

    ${revisionModeRules}

    ${outputSchemaContract}
  `
    : `
    Current Date: ${currentDateEN}.
    Target Period: ${lastWeekEN} - ${currentDateEN}.
    
    ANALYZING TOP ${sources.length} TRENDING VIDEOS:
    <sources_data>
    ${sourcesContext}
    </sources_data>

    MODE: INITIAL GENERATION

    ${sharedSourceRules}

    ${sharedNewsletterContract}

    ${originalGenerationRules}

    ${outputSchemaContract}
  `;

  const response = await ai.models.generateContent({
    model: AI_MODELS.TEXT_GENERATION,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
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
                views: { type: Type.STRING },
              },
              required: ['channel', 'date', 'title', 'views'],
            },
          },
          commonTopics: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['content', 'sourcesFound', 'sources', 'commonTopics'],
      },
    },
  });

  const result = JSON.parse(response.text || '{}') as NewsletterResult;
  if (typeof result.content === 'string') {
    result.content = normalizeNewsletterParagraphs(result.content);
  }
  if (result.content && result.content.length > 10) {
    result.imagePrompt = await generateImagePromptForNewsletter(result.content);
  } else {
    result.imagePrompt = 'Detailed tech infographic, mind map style, flat vector art, modern corporate tech style.';
  }

  return result;
}

async function generateImageWithGemini(prompt: string): Promise<string | null> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: AI_MODELS.IMAGE_GENERATION,
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
      imageConfig: {
        aspectRatio: '16:9',
      },
    },
  });

  const parts = response.candidates?.[0]?.content?.parts;
  if (parts) {
    for (const part of parts) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
  }

  if (response.text) {
    console.warn('AI returned text instead of image:', response.text);
  }

  return null;
}

function normalizeNewsletterParagraphs(content: string): string {
  if (!content.trim()) {
    return content;
  }

  const normalizedLineEndings = content.replace(/\r\n/g, '\n');
  const lines = normalizedLineEndings.split('\n');
  const blockStarters = ['🚀', '🌐', '📰', '⚙️', '🎯', '🔮', '💬', '🏷️'];
  const normalizedLines: string[] = [];

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();

    if (!trimmedLine) {
      if (normalizedLines[normalizedLines.length - 1] !== '') {
        normalizedLines.push('');
      }
      continue;
    }

    const startsNewBlock = blockStarters.some((starter) => trimmedLine.startsWith(starter));
    if (startsNewBlock && normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1] !== '') {
      normalizedLines.push('');
    }

    normalizedLines.push(trimmedLine);
  }

  return normalizedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resolvePort(rawPort: string | undefined): number {
  if (!rawPort) {
    return DEFAULT_PORT;
  }

  const parsedPort = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(`Invalid PORT value: ${rawPort}. Use a number between 1 and 65535.`);
  }

  return parsedPort;
}

async function startServer() {
  try {
    const app = express();
    const port = resolvePort(process.env.PORT);
    const host = process.env.HOST || DEFAULT_HOST;
    const llmRateLimiter = createLlmRateLimiter(LLM_RATE_LIMIT_MAX_REQUESTS, LLM_RATE_LIMIT_WINDOW_MS);

    app.use(express.json());

    app.post('/api/llm/check-connection', llmRateLimiter, async (_req, res) => {
      try {
        const result = await checkSourceConnectionWithGemini();
        res.json(result);
      } catch (error) {
        const normalized = normalizeLlmError(error);
        sendApiError(res, normalized.status, normalized.code, normalized.message, normalized.details);
      }
    });

    app.post('/api/llm/transcript-summary', llmRateLimiter, async (req, res) => {
      try {
        const { transcript } = req.body;
        if (!transcript || typeof transcript !== 'string') {
          return sendApiError(res, 400, 'BAD_REQUEST', 'No transcript provided');
        }

        const summary = await summarizeTranscript(transcript);
        res.json({ summary });
      } catch (error) {
        const normalized = normalizeLlmError(error);
        sendApiError(res, normalized.status, normalized.code, normalized.message, normalized.details);
      }
    });

    app.post('/api/llm/newsletter', llmRateLimiter, async (req, res) => {
      try {
        const { sources, revisionPrompt, lastContent } = req.body as {
          sources: VideoSource[];
          revisionPrompt?: string;
          lastContent?: string;
        };

        if (!Array.isArray(sources)) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'No sources provided');
        }

        const result = await generateNewsletterWithGemini(sources, revisionPrompt, lastContent);
        res.json(result);
      } catch (error) {
        const normalized = normalizeLlmError(error);
        sendApiError(res, normalized.status, normalized.code, normalized.message, normalized.details);
      }
    });

    app.post('/api/llm/image', llmRateLimiter, async (req, res) => {
      try {
        const { prompt } = req.body;
        if (!prompt || typeof prompt !== 'string') {
          return sendApiError(res, 400, 'BAD_REQUEST', 'No prompt provided');
        }

        const imageUrl = await generateImageWithGemini(prompt);
        res.json({ imageUrl });
      } catch (error) {
        const normalized = normalizeLlmError(error);
        sendApiError(res, normalized.status, normalized.code, normalized.message, normalized.details);
      }
    });

    // API Route: Deterministically fetch latest videos via YouTube Search / RSS
    app.post('/api/channels/videos', async (req, res) => {
      try {
        const { channels } = req.body;
        const videos: any[] = [];
        const xml2js = await import('xml2js');
        const fetch = (await import('node-fetch')).default;

        for (const channel of channels) {
          try {
            console.log(`[RSS] ${channel} için RSS bilgisi aranıyor...`);
            const cleanName = channel.startsWith('@') ? channel : `@${channel}`;
            
            // 1. Fetch channel page to find RSS URL
            const channelRes = await fetch(`https://www.youtube.com/${cleanName}`);
            const channelHtml = await channelRes.text();
            
            const rssMatch = channelHtml.match(/<link rel="alternate" type="application\/rss\+xml" title="RSS" href="([^"]+)">/);
            
            if (rssMatch && rssMatch[1]) {
               const rssUrl = rssMatch[1];
               console.log(`[RSS] ${channel} RSS bulundu: ${rssUrl}`);
               
               // 2. Fetch RSS feed
               const rssRes = await fetch(rssUrl);
               const rssXml = await rssRes.text();
               
               // 3. Parse XML
               const parser = new xml2js.Parser();
               const rssObj = await parser.parseStringPromise(rssXml);
               
               const entries = rssObj?.feed?.entry || [];
               
               // 4. Filter for last 7-10 days
               const oneWeekAgo = new Date();
               oneWeekAgo.setDate(oneWeekAgo.getDate() - 10); // Allow 10 days to be safe for "last week"
               
               let addedCount = 0;
               for (const entry of entries) {
                 if (addedCount >= 5) break; // max 5 videos per channel
                 
                 const publishedDate = new Date(entry.published[0]);
                 if (publishedDate >= oneWeekAgo) {
                   const videoIdString = entry['yt:videoId'][0];
                   const titleString = entry.title[0];
                   const linkString = entry.link[0].$.href;
                   const viewsString = entry['media:group']?.[0]?.['media:community']?.[0]?.['media:statistics']?.[0]?.$?.views || "Bilinmiyor";
                   
                   videos.push({
                     channel: channel,
                     date: publishedDate.toISOString().split('T')[0],
                     title: titleString,
                     views: viewsString,
                     videoId: videoIdString,
                     url: linkString
                   });
                   addedCount++;
                 }
               }
            } else {
               console.warn(`[RSS] ${channel} için RSS URL bulunamadı, yts fallback...`);
               // Fallback using yt-search
               const yts = (await import('yt-search')).default;
               const searchResult = await yts({ query: cleanName, sp: 'CAI=' });
               const channelVideos = searchResult.videos?.filter(v => v.author?.name?.toLowerCase().includes(cleanName.replace('@','').toLowerCase())).slice(0,3) || [];
               
               channelVideos.forEach(v => {
                 videos.push({
                   channel: channel,
                   date: v.ago || new Date().toISOString().split('T')[0],
                   title: v.title,
                   views: v.views ? v.views.toString() : "Bilinmiyor",
                   videoId: v.videoId,
                   url: v.url
                 });
               });
            }
          } catch (e) {
            console.error(`Arama API Hatası (${channel}):`, e);
          }
        }
        res.json({ videos });
      } catch (err) {
        console.error("Genel Video Araştırma Hatası:", err);
        res.status(500).json({ error: String(err) });
      }
    });

    // API Route: Deterministically fetch transcript
    app.post('/api/transcript', async (req, res) => {
      try {
          const { videoId } = req.body;
          if (!videoId) return res.status(400).json({error: "No videoId provided"});

          console.log(`[TRANSKRİPT] ${videoId} için veri çekiliyor...`);

          // Attempt 1: youtube-transcript
          try {
            const transcriptParts = await YoutubeTranscript.fetchTranscript(videoId);
            if (transcriptParts && transcriptParts.length > 0) {
              const fullText = transcriptParts.map(t => t.text).join(' ');
              console.log(`[OK] youtube-transcript başarılı (${videoId})`);
              return res.json({ text: fullText });
            }
          } catch (e) {
            console.log(`[BİLGİ] youtube-transcript başarısız (${videoId}): Transkript kapalı veya bulunamadı.`);
          }

          // Attempt 2: youtube-captions-scraper (Fallback 1)
          try {
            const captions = await getSubtitles({ videoID: videoId, lang: 'en' });
            if (captions && captions.length > 0) {
              const fullText = captions.map(c => c.text).join(' ');
              console.log(`[OK] youtube-captions-scraper (en) başarılı (${videoId})`);
              return res.json({ text: fullText });
            }
          } catch (e) {
             console.log(`[BİLGİ] youtube-captions-scraper (en) başarısız (${videoId}): Altyazı bulunamadı.`);
          }

          // Attempt 3: youtube-captions-scraper with common languages (Fallback 2)
          for (const lang of ['tr', 'auto']) {
            try {
              const captions = await getSubtitles({ videoID: videoId, lang });
              if (captions && captions.length > 0) {
                const fullText = captions.map(c => c.text).join(' ');
                console.log(`[OK] youtube-captions-scraper (${lang}) başarılı (${videoId})`);
                return res.json({ text: fullText });
              }
            } catch (e) {
              // Ignore sub-errors in loop
            }
          }

          // Attempt 4: distube/ytdl-core metadata fallback
          try {
             const info = await ytdl.getInfo(videoId);
             const description = info.videoDetails.description;
             if (description && description.length > 50) {
                 console.log(`[OK] ytdl-core video açıklaması kullanıldı (${videoId})`);
                 return res.json({ text: `TRANSCRIPT NOT FOUND. VIDEO DESCRIPTION INSTEAD:\n\n${description}` });
             }
          } catch (e) {
             console.log(`[BİLGİ] ytdl-core description fallback başarısız (${videoId}).`);
          }

          res.json({ text: "", error: "Bütün transkript ve metadata yöntemleri denendi ama sonuç alınamadı." });
      } catch (err) {
          console.error("Transcript fetch error:", err);
          res.json({ text: "", error: "Transcript extraction failed", details: String(err) });
      }
    });

    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    await new Promise<void>((resolve, reject) => {
      const server = app.listen(port, host, () => {
        console.log(`Deterministik Full-Stack Backend Server running on http://localhost:${port}`);
        resolve();
      });

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use. Set PORT in your .env file or shell, for example PORT=3010.`));
          return;
        }

        reject(error);
      });
    });
  } catch (err) {
    console.error("Critical server error during initialization:", err);
    throw err;
  }
}

startServer().catch(err => {
    console.error("FAILED TO START SERVER:", err);
    process.exit(1);
});
