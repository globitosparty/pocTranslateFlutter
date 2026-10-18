const { getDefaultConfig } = require('expo/metro-config');
const Lens = require('chrome-lens-ocr').default || require('chrome-lens-ocr');

const config = getDefaultConfig(__dirname);

let lensInstance = null;
function getLens() {
  if (!lensInstance) {
    lensInstance = new Lens();
  }
  return lensInstance;
}

const previousEnhanceMiddleware = config.server?.enhanceMiddleware;
config.server = config.server || {};
config.server.enhanceMiddleware = (metroMiddleware, server) => {
  const customMiddleware = (req, res, next) => {
    if (req.url && req.url.startsWith('/api/lens-ocr')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'POST') {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf-8');
            const parsed = JSON.parse(raw);
            const cleanB64 = (parsed.imageBase64 || parsed.image || '').replace(/^data:image\/\w+;base64,/, '');
            
            if (!cleanB64) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'No image provided' }));
              return;
            }

            const buffer = Buffer.from(cleanB64, 'base64');
            const lens = getLens();
            const result = await lens.scanByBuffer(buffer);

            const items = (result.segments || []).map(seg => {
              const b = seg.boundingBox || {};
              const width = typeof b.perWidth === 'number' ? b.perWidth : 0.1;
              const height = typeof b.perHeight === 'number' ? b.perHeight : 0.03;
              const centerX = typeof b.centerPerX === 'number' ? b.centerPerX : 0;
              const centerY = typeof b.centerPerY === 'number' ? b.centerPerY : 0;
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
            res.end(JSON.stringify({ success: true, items }));
          } catch (err) {
            console.error('[Metro Lens OCR] Error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: String(err && err.message ? err.message : err) }));
          }
        });
        return;
      }
    }
    return next();
  };

  const app = previousEnhanceMiddleware ? previousEnhanceMiddleware(metroMiddleware, server) : metroMiddleware;
  return (req, res, next) => {
    customMiddleware(req, res, () => {
      app(req, res, next);
    });
  };
};

module.exports = config;
