const videoId = 'FMSu4PcAyGM';
fetch(`https://corsproxy.io/?https://www.youtube.com/watch?v=${videoId}`)
  .then(res => res.text())
  .then(text => {
    let match = text.match(/ytInitialPlayerResponse\s*=\s*(.+?});var/);
    if (!match) match = text.match(/var ytInitialPlayerResponse = ({.+?});/);
    if (!match) return console.log("Not found.");
    const body = match[1];
    console.log("length:", body.length);
    console.log("contains captions:", body.includes("captions"));
  });
