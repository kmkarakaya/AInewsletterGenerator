import express from 'express';
import { createServer as createViteServer } from 'vite';
import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
import { getSubtitles } from 'youtube-captions-scraper';
import yts from 'yt-search';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  try {
    const app = express();
    const PORT = 3000;

    app.use(express.json());

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
            console.warn(`[UYARI] youtube-transcript başarısız (${videoId}):`, String(e));
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
             console.warn(`[UYARI] youtube-captions-scraper (en) başarısız (${videoId}):`, String(e));
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

          res.json({ text: "", error: "Bütün transkript yöntemleri denendi ama sonuç alınamadı." });
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

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Deterministik Full-Stack Backend Server running on http://localhost:${PORT}`);
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
