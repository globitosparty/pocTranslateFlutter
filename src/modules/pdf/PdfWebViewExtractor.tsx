import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

export interface NativePageData {
  lines: string[];
  rawItems?: { text: string; box?: { x: number; y: number; width: number; height: number } }[];
  imageUrl?: string;
  pageWidth?: number;
  pageHeight?: number;
}

export interface NativePdfBridge {
  open(base64: string): Promise<number>;
  getPageData(page: number, onOcr?: () => void): Promise<NativePageData>;
}

let activeBridge: NativePdfBridge | null = null;

export function getNativeBridge(): NativePdfBridge | null {
  return activeBridge;
}

const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head>
<body style="margin:0;padding:0;">
<script>
function post(obj) {
  try {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  } catch(e) {}
}

var pdfDoc = null;
var ocrWorker = null;

async function getOcrWorker() {
  if (!ocrWorker) {
    if (!window.Tesseract) {
      await new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = resolve;
        s.onerror = function() { reject(new Error('No se pudo cargar el script de OCR')); };
        document.head.appendChild(s);
      });
    }
    ocrWorker = await Tesseract.createWorker('eng');
  }
  return ocrWorker;
}

async function renderPageToImage(page) {
  try {
    var vp = page.getViewport({ scale: 1.5 });
    var c = document.createElement('canvas');
    c.width = vp.width;
    c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return { dataUrl: c.toDataURL('image/jpeg', 0.82), canvas: c, width: vp.width, height: vp.height };
  } catch(err) {
    return { dataUrl: null, canvas: null, width: 0, height: 0 };
  }
}

async function ocrCanvas(canvas) {
  try {
    // 1. Try Google Lens OCR local microserver first
    try {
      var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      var cleanB64 = (dataUrl || '').replace(/^data:image\/\w+;base64,/, '');
      var endpoints = [
        'http://10.0.2.2:5055/ocr',
        'http://localhost:5055/ocr',
        'http://127.0.0.1:5055/ocr'
      ];
      for (var e = 0; e < endpoints.length; e++) {
        try {
          var response = await fetch(endpoints[e], {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: cleanB64 })
          });
          if (response.ok) {
            var json = await response.json();
            if (json && json.success && Array.isArray(json.items) && json.items.length > 0) {
              return json.items;
            }
          }
        } catch(netErr) {}
      }
    } catch(lensErr) {}

    var w = await getOcrWorker();
    var r = await w.recognize(canvas);
    var cw = canvas.width || 1;
    var ch = canvas.height || 1;
    var items = [];
    if (r && r.data && r.data.paragraphs && r.data.paragraphs.length > 0) {
      for (var i = 0; i < r.data.paragraphs.length; i++) {
        var p = r.data.paragraphs[i];
        var text = (p.text || '').replace(/\\s+/g, ' ').trim();
        if (text.length > 1 && p.bbox && p.bbox.x1 > p.bbox.x0 && p.bbox.y1 > p.bbox.y0) {
          items.push({
            text: text,
            box: {
              x: Math.max(0, Math.min(1, p.bbox.x0 / cw)),
              y: Math.max(0, Math.min(1, p.bbox.y0 / ch)),
              width: Math.max(0.01, Math.min(1, (p.bbox.x1 - p.bbox.x0) / cw)),
              height: Math.max(0.01, Math.min(1, (p.bbox.y1 - p.bbox.y0) / ch))
            }
          });
        }
      }
    }
    if (items.length === 0 && r && r.data && r.data.lines && r.data.lines.length > 0) {
      for (var j = 0; j < r.data.lines.length; j++) {
        var line = r.data.lines[j];
        var text = (line.text || '').replace(/\\s+/g, ' ').trim();
        if (text.length > 1 && line.bbox && line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0) {
          items.push({
            text: text,
            box: {
              x: Math.max(0, Math.min(1, line.bbox.x0 / cw)),
              y: Math.max(0, Math.min(1, line.bbox.y0 / ch)),
              width: Math.max(0.01, Math.min(1, (line.bbox.x1 - line.bbox.x0) / cw)),
              height: Math.max(0.01, Math.min(1, (line.bbox.y1 - line.bbox.y0) / ch))
            }
          });
        }
      }
    }
    if (items.length === 0 && r && r.data && r.data.text) {
      var raw = (r.data.text || '').split('\\n');
      for (var k = 0; k < raw.length; k++) {
        var t = raw[k].trim();
        if (t.length > 1) items.push({ text: t });
      }
    }
    return items;
  } catch(err) {
    return [{ text: '[OCR Error: ' + (err.message || 'Fallo OCR') + ']' }];
  }
}

window.openPdf = async function(param) {
  try {
    if (!window.pdfjsLib) {
      post({ type: 'error', message: 'pdf.js no terminó de cargar' });
      return;
    }
    // Disable external worker for local files to avoid cross-origin sandbox blocks
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';

    if (typeof param === 'string' && (param.startsWith('file:') || param.startsWith('content:') || param.startsWith('http:') || param.startsWith('https:'))) {
      var bytes = null;
      try {
        bytes = await new Promise(function(resolve, reject) {
          var xhr = new XMLHttpRequest();
          xhr.open('GET', param, true);
          xhr.responseType = 'arraybuffer';
          xhr.onload = function() {
            if (xhr.status === 200 || (xhr.status === 0 && xhr.response && xhr.response.byteLength > 0)) {
              resolve(new Uint8Array(xhr.response));
            } else {
              reject(new Error('XHR status ' + xhr.status));
            }
          };
          xhr.onerror = function() {
            // Try fetch fallback
            fetch(param)
              .then(function(r) { return r.arrayBuffer(); })
              .then(function(ab) { resolve(new Uint8Array(ab)); })
              .catch(function(e) { reject(e); });
          };
          xhr.send();
        });
      } catch (loadErr) {
        console.warn('Buffer load failed, will try direct URL in pdfjs:', loadErr);
      }

      if (bytes && bytes.length > 0) {
        pdfDoc = await pdfjsLib.getDocument({
          data: bytes,
          disableFontFace: true,
          useSystemFonts: true
        }).promise;
      } else {
        pdfDoc = await pdfjsLib.getDocument({
          url: param,
          disableFontFace: true,
          useSystemFonts: true
        }).promise;
      }
    } else {
      var cleanB64 = (param || '').replace(/\s+/g, '');
      var bin = atob(cleanB64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      pdfDoc = await pdfjsLib.getDocument({
        data: bytes,
        disableFontFace: true,
        useSystemFonts: true
      }).promise;
    }

    post({ type: 'opened', total: pdfDoc.numPages });
  } catch(e) {
    post({ type: 'error', message: String(e && e.message ? e.message : e) });
  }
};

window.getPageData = async function(n) {
  try {
    if (!pdfDoc) {
      post({ type: 'error', message: 'Documento no abierto' });
      return;
    }
    var page = await pdfDoc.getPage(n);

    // 1. Render visual image of the page
    var rendered = await renderPageToImage(page);
    var vp = page.getViewport({ scale: 1.5 });

    function unionB(b1, b2) {
      if (!b1) return b2;
      if (!b2) return b1;
      var x0 = Math.min(b1.x, b2.x);
      var y0 = Math.min(b1.y, b2.y);
      var x1 = Math.max(b1.x + b1.width, b2.x + b2.width);
      var y1 = Math.max(b1.y + b1.height, b2.y + b2.height);
      return { x: x0, y: y0, width: Math.max(0.01, x1 - x0), height: Math.max(0.01, y1 - y0) };
    }

    // 2. Extract selectable text
    var tc = await page.getTextContent();
    var items = [];
    var cur = '';
    var curBox = null;
    var prevTx = null;
    var prevTy = null;
    var prevRight = null;
    var prevFs = null;

    for (var j = 0; j < tc.items.length; j++) {
      var it = tc.items[j];
      if (typeof it.str !== 'string' || (!it.str && !it.hasEOL)) continue;

      var ibox = null;
      var tx = 0;
      var ty = 0;
      var fs = 12;
      var w = 0;
      var h = 12;

      if (it.transform && it.transform.length >= 6 && vp.convertToViewportRectangle) {
        try {
          tx = it.transform[4];
          ty = it.transform[5];
          fs = Math.abs(it.transform[3]) || 12;
          w = it.width || (fs * 0.5 * (it.str ? it.str.length : 1));
          h = it.height || fs;
          var rect = vp.convertToViewportRectangle([
            tx,
            ty - (fs * 0.22),
            tx + w,
            ty + (fs * 0.88)
          ]);
          ibox = {
            x: Math.min(rect[0], rect[2]) / vp.width,
            y: Math.min(rect[1], rect[3]) / vp.height,
            width: Math.abs(rect[2] - rect[0]) / vp.width,
            height: Math.abs(rect[3] - rect[1]) / vp.height
          };
        } catch(e) {}
      }

      var isNewLine = false;
      if (prevTy !== null && prevTx !== null && prevRight !== null) {
        var deltaY = Math.abs(ty - prevTy);
        var deltaFs = Math.abs(fs - (prevFs || fs));
        if (it.hasEOL) {
          isNewLine = true;
        } else if (deltaY > fs * 0.35) {
          isNewLine = true;
        } else if (tx < prevTx - (fs * 0.4)) {
          isNewLine = true;
        } else if (tx - prevRight > fs * 2.5) {
          isNewLine = true;
        } else if (deltaFs > 5 && deltaY > 2) {
          isNewLine = true;
        }
      }

      if (isNewLine) {
        if (cur.trim()) items.push({ text: cur.trim(), box: curBox });
        cur = it.str || '';
        curBox = ibox;
      } else {
        if (it.str) {
          var needsSpace = prevRight !== null && (tx - prevRight > fs * 0.16) && !cur.endsWith(' ') && !it.str.startsWith(' ');
          cur += (needsSpace ? ' ' : '') + it.str;
          curBox = unionB(curBox, ibox);
        }
      }

      if (it.str) {
        prevTx = tx;
        prevTy = ty;
        prevRight = tx + w;
        prevFs = fs;
      }

      if (it.hasEOL) {
        if (cur.trim()) items.push({ text: cur.trim(), box: curBox });
        cur = '';
        curBox = null;
        prevTx = null;
        prevTy = null;
        prevRight = null;
        prevFs = null;
      }
    }
    if (cur.trim()) items.push({ text: cur.trim(), box: curBox });

    // 3. Fallback to OCR if page has almost no selectable text
    var chars = items.map(function(i){ return i.text; }).join('').replace(/\\s/g, '').length;
    if (chars < 20 && rendered.canvas) {
      post({ type: 'ocr', page: n });
      items = await ocrCanvas(rendered.canvas);
    }

    post({
      type: 'page',
      page: n,
      rawItems: items,
      lines: items.map(function(i){ return i.text; }),
      imageUrl: rendered.dataUrl,
      pageWidth: rendered.width,
      pageHeight: rendered.height
    });
  } catch(e) {
    post({ type: 'error', message: String(e && e.message ? e.message : e) });
  }
};

var checkTimer = setInterval(function() {
  if (window.pdfjsLib) {
    clearInterval(checkTimer);
    post({ type: 'ready' });
  }
}, 80);
</script>
</body>
</html>`;

export default function PdfWebViewExtractor() {
  const webRef = useRef<WebView>(null);
  const isReadyRef = useRef<boolean>(false);
  const readyPromiseRef = useRef<Promise<void> | null>(null);
  const readyResolveRef = useRef<() => void>(() => {});
  const handlerRef = useRef<((m: any) => void) | null>(null);

  if (!readyPromiseRef.current) {
    readyPromiseRef.current = new Promise<void>(res => {
      readyResolveRef.current = res;
    });
  }

  useEffect(() => {
    activeBridge = {
      async open(base64: string): Promise<number> {
        if (!isReadyRef.current) {
          const timeout = new Promise<void>(resolve => setTimeout(resolve, 6000));
          await Promise.race([readyPromiseRef.current, timeout]);
        }

        return new Promise<number>((resolve, reject) => {
          const timer = setTimeout(() => {
            handlerRef.current = null;
            reject(new Error('Tiempo de espera agotado al abrir el PDF. Si es muy pesado, intenta de nuevo.'));
          }, 60000);

          handlerRef.current = msg => {
            if (msg.type === 'opened') {
              clearTimeout(timer);
              handlerRef.current = null;
              resolve(msg.total);
            } else if (msg.type === 'error') {
              clearTimeout(timer);
              handlerRef.current = null;
              reject(new Error(msg.message || 'Error al procesar el archivo PDF'));
            }
          };

          webRef.current?.injectJavaScript(`window.openPdf(${JSON.stringify(base64)}); true;`);
        });
      },

      async getPageData(page: number, onOcr?: () => void): Promise<NativePageData> {
        return new Promise<NativePageData>((resolve, reject) => {
          const timer = setTimeout(() => {
            handlerRef.current = null;
            reject(new Error(`Tiempo agotado leyendo la página ${page}`));
          }, 45000);

          handlerRef.current = msg => {
            if (msg.type === 'ocr') {
              onOcr?.();
            } else if (msg.type === 'page' && msg.page === page) {
              clearTimeout(timer);
              handlerRef.current = null;
              resolve({
                lines: msg.lines || [],
                rawItems: msg.rawItems,
                imageUrl: msg.imageUrl,
                pageWidth: msg.pageWidth,
                pageHeight: msg.pageHeight
              });
            } else if (msg.type === 'error') {
              clearTimeout(timer);
              handlerRef.current = null;
              reject(new Error(msg.message || 'Error leyendo la página'));
            }
          };

          webRef.current?.injectJavaScript(`window.getPageData(${page}); true;`);
        });
      }
    };

    return () => {
      activeBridge = null;
    };
  }, []);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') {
        isReadyRef.current = true;
        readyResolveRef.current();
      } else {
        handlerRef.current?.(msg);
      }
    } catch {
      // ignore
    }
  };

  return (
    <View
      style={{
        width: 1,
        height: 1,
        opacity: 0.01,
        position: 'absolute',
        top: 0,
        left: 0
      }}
      pointerEvents="none"
    >
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html: HTML, baseUrl: 'file:///' }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowFileAccess={true}
        allowFileAccessFromFileURLs={true}
        allowUniversalAccessFromFileURLs={true}
        mixedContentMode="always"
        onMessage={onMessage}
        onLoadEnd={() => {
          setTimeout(() => {
            isReadyRef.current = true;
            readyResolveRef.current();
          }, 400);
        }}
      />
    </View>
  );
}
