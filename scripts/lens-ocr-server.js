const http = require('http');
const Lens = require('chrome-lens-ocr').default || require('chrome-lens-ocr');

const PORT = process.env.LENS_PORT || 5055;
let lensInstance = null;

function getLens() {
  if (!lensInstance) {
    lensInstance = new Lens();
  }
  return lensInstance;
}

const server = http.createServer((req, res) => {
  // Enable CORS for Expo web / browsers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', engine: 'google-lens' }));
    return;
  }

  if ((req.url === '/ocr' || req.url === '/api/lens-ocr') && req.method === 'POST') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const bodyStr = Buffer.concat(chunks).toString('utf-8');
        const parsed = JSON.parse(bodyStr);
        const rawB64 = (parsed.imageBase64 || parsed.image || '').replace(/^data:image\/\w+;base64,/, '');

        if (!rawB64) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'No imageBase64 provided' }));
          return;
        }

        const buffer = Buffer.from(rawB64, 'base64');
        const lens = getLens();
        const result = await lens.scanByBuffer(buffer);

        const items = (result.segments || []).map(seg => {
          const b = seg.boundingBox || {};
          const width = typeof b.perWidth === 'number' ? b.perWidth : 0.1;
          const height = typeof b.perHeight === 'number' ? b.perHeight : 0.03;
          const centerX = typeof b.centerPerX === 'number' ? b.centerPerX : (b.pixelCoords ? b.pixelCoords.x : 0);
          const centerY = typeof b.centerPerY === 'number' ? b.centerPerY : (b.pixelCoords ? b.pixelCoords.y : 0);
          const x = Math.max(0, centerX - width / 2);
          const y = Math.max(0, centerY - height / 2);

          return {
            text: seg.text,
            box: {
              x: Math.max(0, Math.min(1, x)),
              y: Math.max(0, Math.min(1, y)),
              width: Math.max(0.005, Math.min(1, width)),
              height: Math.max(0.005, Math.min(1, height))
            }
          };
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          language: result.language || 'en',
          items
        }));
      } catch (err) {
        console.error('[Lens OCR Server] Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: String(err && err.message ? err.message : err)
        }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Google Lens OCR Server] Listening on http://0.0.0.0:${PORT}`);
});
