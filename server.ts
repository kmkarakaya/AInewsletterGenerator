import express from 'express';
import { createServer as createViteServer } from 'vite';
import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
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

    // API Route: Deterministically fetch latest videos via YouTube Search
    app.post('/api/channels/videos', async (req, res) => {
      try {
        const { channels } = req.body;
        const videos: any[] = [];

        for (const channel of channels) {
          try {
            const cleanName = channel.replace('@', '');
            // sp: 'CAI=' is YouTube's sort by upload date. This ensures we get the newest videos first.
            const searchResult = await yts({ query: cleanName, sp: 'CAI=' });
            
            // Filter strictly by the author name containing the channel name (case-insensitive) to avoid unrelated videos
            let channelVideos = searchResult.videos.filter(v => 
               v.author?.name?.toLowerCase().includes(cleanName.toLowerCase()) || 
               v.author?.url?.toLowerCase().includes(cleanName.toLowerCase())
            );
            
            // Further filter by date: only keep videos uploaded in the last week
            channelVideos = channelVideos.filter(v => {
               if (!v.ago) return false;
               const lowerResult = v.ago.toLowerCase();
               if (lowerResult.includes('month') || lowerResult.includes('year')) return false;
               if (lowerResult.includes('second') || lowerResult.includes('minute') || lowerResult.includes('hour') || lowerResult.includes('day') || lowerResult.includes('week')) {
                  if (lowerResult.includes('week')) {
                     const match = lowerResult.match(/(\d+)\s+week/);
                     if (match && parseInt(match[1]) > 1) return false;
                  }
                  if (lowerResult.includes('day')) {
                     const match = lowerResult.match(/(\d+)\s+day/);
                     if (match && parseInt(match[1]) > 7) return false;
                  }
                  return true;
               }
               return false;
            });
            
            channelVideos = channelVideos.slice(0, 5);

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

          const transcriptParts = await YoutubeTranscript.fetchTranscript(videoId);
          const fullText = transcriptParts.map(t => t.text).join(' ');
          res.json({ text: fullText });
      } catch (err) {
          const errStr = String(err);
          // Omit noisy console.errors for common transcript disabled scenarios
          if (!errStr.includes("Transcript is disabled")) {
            console.error("Transcript fetch error:", err);
          }
          res.json({ text: "", error: "Transcript extraction failed", details: errStr });
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
