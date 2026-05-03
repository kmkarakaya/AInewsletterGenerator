import ytdl from '@distube/ytdl-core';

ytdl.getInfo('FMSu4PcAyGM').then(info => {
  const tracks = info.player_response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (tracks && tracks.length > 0) {
    console.log("Captions available:", tracks.map(t => t.name.simpleText));
  } else {
    console.log("No captions found in player_response");
  }
}).catch(console.error);
