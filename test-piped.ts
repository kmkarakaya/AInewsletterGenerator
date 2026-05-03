fetch('https://pipedapi.kavin.rocks/streams/FMSu4PcAyGM')
  .then(res => res.json())
  .then(data => {
    console.log(data.subtitles?.map(s => s.name));
    if (data.subtitles && data.subtitles.length > 0) {
      console.log('Fetching first subtitle:', data.subtitles[0].url);
      return fetch(data.subtitles[0].url).then(r => r.text());
    }
  })
  .then(text => console.log(text?.substring(0, 200)))
  .catch(console.error);
