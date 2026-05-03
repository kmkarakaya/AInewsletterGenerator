import { getSubtitles } from 'youtube-captions-scraper';
getSubtitles({ videoID: 'jNQXAC9IVRw', lang: 'en' })
  .then((captions) => console.log('Length:', captions.length))
  .catch(console.error);
