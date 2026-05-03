const videoId = 'FMSu4PcAyGM';
fetch(`https://www.youtube.com/watch?v=${videoId}`)
  .then(res => res.text())
  .then(text => {
    const lines = text.split('\n');
    lines.filter(l => l.includes('caption')).forEach(l => console.log(l.substring(0, 200)));
  });
