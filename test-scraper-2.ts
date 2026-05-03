import { getSubtitles } from 'youtube-captions-scraper';
getSubtitles({ videoID: 'FMSu4PcAyGM', lang: 'en' })
  .then((captions) => console.log('Length:', captions.length))
  .catch(console.error);
