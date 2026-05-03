const videoId = 'FMSu4PcAyGM';
fetch(`https://www.youtube.com/watch?v=${videoId}`, {
  headers: {
    'Accept-Language': 'en-US,en;q=0.5',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36'
  }
})
  .then(res => res.text())
  .then(text => {
    let match = text.match(/ytInitialPlayerResponse\s*=\s*(.+?});var/);
    if (!match) match = text.match(/var ytInitialPlayerResponse = ({.+?});/);
    if (!match) return console.log("Not found.");
    const body = match[1];
    console.log(body);
  });
