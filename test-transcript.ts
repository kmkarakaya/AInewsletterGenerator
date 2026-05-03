import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
YoutubeTranscript.fetchTranscript('jNQXAC9IVRw')
  .then((parts) => console.log('Length:', parts.length))
  .catch(console.error);
