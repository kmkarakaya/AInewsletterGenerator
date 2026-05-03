const videoId = 'FMSu4PcAyGM';
fetch(`https://www.youtube.com/watch?v=${videoId}`, {
  headers: {
    'Accept-Language': 'en-US,en;q=0.5',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
  }
})
  .then(res => res.text())
  .then(text => {
    const match = text.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;/);
    if (match) {
      const parsed = JSON.parse(match[1]);
      console.log(Object.keys(parsed.captions || {}));
      console.log(JSON.stringify(parsed.captions || 'NO_CAPTIONS', null, 2).substring(0, 500));
    } else {
      console.log('No ytInitialPlayerResponse found');
    }
  });
