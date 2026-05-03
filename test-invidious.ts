const instances = [
  'https://invidious.flokinet.to',
  'https://invidious.nerdvpn.de',
  'https://inv.tux.pizza',
  'https://invidious.privacydev.net'
];

async function test() {
  for (const inst of instances) {
    try {
      const res = await fetch(`${inst}/api/v1/videos/FMSu4PcAyGM`);
      if (res.ok) {
        const data = await res.json();
        console.log("Success on", inst);
        console.log("Captions:", data.captions?.map(c => c.label));
        return;
      }
      console.log("Failed", inst, res.status);
    } catch (e) {
      console.log("Error", inst, e.message);
    }
  }
}
test();
