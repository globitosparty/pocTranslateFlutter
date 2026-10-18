import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { File as ExpoFile } from 'expo-file-system';
import { getNativeBridge } from './PdfWebViewExtractor';
import { isCoherentEnglishText, filterCoherentParagraphs } from '../../utils/textCoherence';

export interface BoundingBox {
  x: number;      // 0..1 (fraction of page width)
  y: number;      // 0..1 (fraction of page height)
  width: number;  // 0..1 (fraction of page width)
  height: number; // 0..1 (fraction of page height)
}

export interface ExtractedParagraph {
  id: string;              // e.g. "p_1_0"
  pageNumber: number;      // 1-indexed
  index: number;           // 0-indexed within page
  text: string;
  box?: BoundingBox;
}

export interface ExtractedPage {
  pageNumber: number;
  paragraphs: ExtractedParagraph[];
  fullText: string;
  imageUrl?: string;
  pageWidth?: number;
  pageHeight?: number;
}

export interface RawLineItem {
  text: string;
  box?: BoundingBox;
}

export function unionBoxes(b1?: BoundingBox, b2?: BoundingBox): BoundingBox | undefined {
  if (!b1) return b2;
  if (!b2) return b1;
  const x0 = Math.min(b1.x, b2.x);
  const y0 = Math.min(b1.y, b2.y);
  const x1 = Math.max(b1.x + b1.width, b2.x + b2.width);
  const y1 = Math.max(b1.y + b1.height, b2.y + b2.height);
  return {
    x: x0,
    y: y0,
    width: Math.max(0.01, x1 - x0),
    height: Math.max(0.01, y1 - y0)
  };
}

export interface ExtractionResult {
  title: string;
  pageCount: number;
  pages: ExtractedPage[];
  totalParagraphs: number;
}

export interface PdfDocumentSession {
  title: string;
  pageCount: number;
  getPage: (pageNumber: number, onOcr?: () => void) => Promise<ExtractedPage>;
}

/**
 * Loads pdf.js library dynamically for Web.
 */
async function getPdfJsLib(): Promise<any> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const win = window as any;
    if (win.pdfjsLib) {
      return win.pdfjsLib;
    }

    // Load from CDN
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        if (win.pdfjsLib) {
          win.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          resolve();
        } else {
          reject(new Error('pdf.js loaded but pdfjsLib not found on window'));
        }
      };
      script.onerror = () => reject(new Error('Failed to load pdf.js from CDN'));
      document.head.appendChild(script);
    });

    return win.pdfjsLib;
  }

  // Fallback
  try {
    const pdfjs = require('pdfjs-dist/legacy/build/pdf');
    return pdfjs;
  } catch (e) {
    console.warn('[PdfExtractor] Could not require pdfjs-dist:', e);
    return null;
  }
}

/**
 * Detects if a line extracted from OCR is random sketch noise (pencil lines, shadows)
 * rather than actual readable text.
 */
export function isOcrNoise(text: string): boolean {
  const clean = (text || '').trim();
  if (clean.length < 2) return true;
  return !isCoherentEnglishText(clean);
}

/**
 * Normalizes text lines into clean, readable paragraphs with optional bounding boxes.
 * Preserves spatial separation between titles, drawings, and separate columns.
 */
export function cleanAndGroupParagraphs(
  rawLines: (string | RawLineItem)[],
  pageNumber: number
): ExtractedParagraph[] {
  const paragraphs: ExtractedParagraph[] = [];
  let currentBuffer: string[] = [];
  let currentBox: BoundingBox | undefined = undefined;
  let lastBox: BoundingBox | undefined = undefined;

  const flushBuffer = () => {
    if (currentBuffer.length === 0) return;
    const joined = currentBuffer
      .join(' ')
      .replace(/(\w+)-\s+(\w+)/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();

    if (joined.length >= 2 && isCoherentEnglishText(joined)) {
      paragraphs.push({
        id: `p_${pageNumber}_${paragraphs.length}`,
        pageNumber,
        index: paragraphs.length,
        text: joined,
        box: currentBox
      });
    }
    currentBuffer = [];
    currentBox = undefined;
    lastBox = undefined;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const item = rawLines[i];
    const text = typeof item === 'string' ? item : item.text;
    const box = typeof item === 'string' ? undefined : item.box;
    const trimmed = (text || '').trim();
    if (!trimmed) {
      flushBuffer();
      continue;
    }

    if (currentBuffer.length > 0 && lastBox && box) {
      const prevText = currentBuffer[currentBuffer.length - 1];
      const verticalGap = box.y - (lastBox.y + lastBox.height);
      const isAllUpperPrev = prevText.length > 2 && prevText === prevText.toUpperCase() && /[A-Z]/.test(prevText);
      const isAllUpperCurr = trimmed.length > 2 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
      const heightRatio = lastBox.height > 0 ? box.height / lastBox.height : 1;
      const isHeightDifferent = heightRatio > 1.45 || heightRatio < 0.68;
      const isLineBreakSentence = /[.:!?]$/.test(prevText) && !/\b(e\.g|i\.e|mr|mrs|ms|dr|prof|vs|vol|no|p|pp|etc)\.$/i.test(prevText);
      const isShortHeading = currentBuffer.length === 1 && prevText.length < 45 && !/[.:,]$/.test(prevText);
      const isLargeGap = verticalGap > Math.min(Math.max((lastBox.height || 0.015) * 0.6, 0.016), 0.026);
      const isHorizontalIndentJump = Math.abs(box.x - lastBox.x) > 0.08;

      if (
        isLineBreakSentence ||
        isAllUpperPrev ||
        isAllUpperCurr ||
        isHeightDifferent ||
        (isShortHeading && (isLargeGap || isHorizontalIndentJump || isHeightDifferent)) ||
        isLargeGap ||
        verticalGap < -0.04 ||
        isHorizontalIndentJump
      ) {
        flushBuffer();
      }
    }

    currentBuffer.push(trimmed);
    currentBox = unionBoxes(currentBox, box);
    lastBox = box;

    // Check if current line itself ends a sentence or is a standalone title
    const isAbbrev = /\b(e\.g|i\.e|mr|mrs|ms|dr|prof|vs|vol|no|p|pp|etc)\.$/i.test(trimmed);
    const isAllUpper = trimmed.length > 2 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
    if ((/[.:!?]$/.test(trimmed) && !isAbbrev) || isAllUpper) {
      flushBuffer();
    }
  }

  flushBuffer();
  return paragraphs;
}

let webOcrWorker: any = null;

/**
 * Detects whether a candidate bounding box sits on top of a charcoal/pencil sketch,
 * dark shadow, or face portrait rather than a clean, high-contrast text paper background.
 */
export function isBoxOverShadedArtwork(canvas: HTMLCanvasElement, box: BoundingBox): boolean {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const cw = canvas.width;
    const ch = canvas.height;
    const x = Math.max(0, Math.floor(box.x * cw));
    const y = Math.max(0, Math.floor(box.y * ch));
    const w = Math.min(cw - x, Math.floor(box.width * cw));
    const h = Math.min(ch - y, Math.floor(box.height * ch));

    if (w < 8 || h < 8) return false;

    // Sample pixels across the candidate bounding box
    const imgData = ctx.getImageData(x, y, w, h);
    const data = imgData.data;
    let lightPixels = 0;
    let midGrayPixels = 0;
    let sampleCount = 0;

    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      if (brightness > 215) {
        lightPixels++;
      } else if (brightness >= 70 && brightness <= 200) {
        midGrayPixels++;
      }
      sampleCount++;
    }

    if (sampleCount === 0) return false;

    const lightRatio = lightPixels / sampleCount;
    const midGrayRatio = midGrayPixels / sampleCount;

    // Real text on paper has predominantly clean white/cream background (>= 50%).
    // Charcoal drawings, face portraits, and sketches have high mid-gray graphite density (> 42%) and low clean paper (< 38%).
    if (midGrayRatio > 0.42 && lightRatio < 0.38) {
      return true; // Over shaded artwork / drawing!
    }
  } catch {
    // If canvas cannot be sampled, fail safe
  }
  return false;
}

/**
 * Detects faces on the page canvas using Chromium's native Shape Detection API if available.
 */
async function detectFacesOnCanvas(canvas: HTMLCanvasElement): Promise<BoundingBox[]> {
  if (typeof window !== 'undefined' && typeof (window as any).FaceDetector === 'function') {
    try {
      const FaceDetectorClass = (window as any).FaceDetector;
      const detector = new FaceDetectorClass({ fastMode: true, maxDetectedFaces: 10 });
      const faces = await detector.detect(canvas);
      const cw = canvas.width;
      const ch = canvas.height;
      return (faces || []).map((f: any) => ({
        x: Math.max(0, f.boundingBox.x / cw),
        y: Math.max(0, f.boundingBox.y / ch),
        width: Math.min(1, f.boundingBox.width / cw),
        height: Math.min(1, f.boundingBox.height / ch)
      }));
    } catch {
      // Shape detection not supported or failed
    }
  }
  return [];
}

function isBoxInsideFace(box: BoundingBox, faces: BoundingBox[]): boolean {
  for (const f of faces) {
    const xOverlap = Math.max(0, Math.min(box.x + box.width, f.x + f.width) - Math.max(box.x, f.x));
    const yOverlap = Math.max(0, Math.min(box.y + box.height, f.y + f.height) - Math.max(box.y, f.y));
    const overlapArea = xOverlap * yOverlap;
    const boxArea = box.width * box.height;
    if (boxArea > 0 && (overlapArea / boxArea) > 0.35) {
      return true;
    }
  }
  return false;
}

/**
 * Attempts to call Google Lens OCR via local backend/Metro endpoint.
 * Returns high-accuracy line items with normalized bounding boxes.
 */
async function callLensOcr(dataUrl: string): Promise<RawLineItem[] | null> {
  const cleanB64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const endpoints = [
    'http://localhost:5055/ocr',
    'http://127.0.0.1:5055/ocr',
    '/api/lens-ocr'
  ];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: cleanB64 }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        // If Google Lens successfully analyzed the image
        if (data && data.success && Array.isArray(data.items)) {
          const validItems: RawLineItem[] = [];
          for (const it of data.items) {
            const txt = (it.text || '').replace(/\s+/g, ' ').trim();
            if (txt.length >= 2 && !isOcrNoise(txt)) {
              validItems.push({
                text: txt,
                box: it.box
              });
            }
          }
          console.log(`[Google Lens OCR] Respuesta recibida (${validItems.length} líneas detectadas).`);
          // Return validItems (even if empty, meaning Google Lens verified there is no text)
          return validItems;
        }
      }
    } catch {
      // try next endpoint
    }
  }
  return null;
}

async function ocrWebPage(page: any): Promise<RawLineItem[]> {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

  // 1. Try Google Lens OCR first (authoritative: if it returns 0 items, it's a pure drawing/face!)
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    const lensItems = await callLensOcr(dataUrl);
    if (lensItems !== null) {
      // If Google Lens responded, its verdict is authoritative.
      // If lensItems is empty, the page is an illustration/face portrait. Do NOT fall back to Tesseract!
      return lensItems;
    }
  } catch (err) {
    console.warn('[ocrWebPage] Lens OCR no respondió, recurriendo a Tesseract fallback:', err);
  }

  // 2. Detect faces on canvas to suppress hallucinations
  const detectedFaces = await detectFacesOnCanvas(canvas);

  // 3. Fallback to Tesseract.js ONLY if Lens OCR endpoint is completely unreachable
  const win = window as any;
  if (!win.Tesseract) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('No se pudo cargar el motor OCR'));
      document.head.appendChild(s);
    });
  }
  if (!webOcrWorker) {
    webOcrWorker = await win.Tesseract.createWorker('eng');
  }
  const result = await webOcrWorker.recognize(canvas);
  
  const cw = canvas.width;
  const ch = canvas.height;
  const items: RawLineItem[] = [];

  // Use lines to preserve spatial separation across drawings, titles, and labels
  if (result.data?.lines && result.data.lines.length > 0) {
    for (const line of result.data.lines) {
      const clean = (line.text || '').replace(/\s+/g, ' ').trim();
      // Skip OCR sketch and drawing noise
      if (isOcrNoise(clean)) continue;

      if (clean.length >= 2 && line.bbox && line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0) {
        const box: BoundingBox = {
          x: Math.max(0, Math.min(1, line.bbox.x0 / cw)),
          y: Math.max(0, Math.min(1, line.bbox.y0 / ch)),
          width: Math.max(0.01, Math.min(1, (line.bbox.x1 - line.bbox.x0) / cw)),
          height: Math.max(0.01, Math.min(1, (line.bbox.y1 - line.bbox.y0) / ch))
        };

        // Suppress if inside a detected face or over shaded drawing artwork
        if (detectedFaces.length > 0 && isBoxInsideFace(box, detectedFaces)) continue;
        if (isBoxOverShadedArtwork(canvas, box)) continue;

        items.push({ text: clean, box });
      }
    }
  }

  // Fallback to text split if no lines found
  if (items.length === 0 && result.data?.text) {
    const raw = String(result.data.text).split('\n');
    for (const l of raw) {
      const t = l.trim();
      if (t && !isOcrNoise(t)) items.push({ text: t });
    }
  }

  return items;
}

/**
 * Safely reads a local URI (file://, content://, or web File) into a clean base64 string.
 * Uses fetch + FileReader as primary method on Android to bypass Scoped Storage sandbox issues,
 * with FileSystem fallback.
 */
export async function readUriAsBase64(fileOrUri: File | Blob | string): Promise<string> {
  if (Platform.OS === 'web') {
    if (typeof fileOrUri !== 'string') {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result as string;
          resolve(res.includes(',') ? res.split(',')[1] : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(fileOrUri as Blob);
      });
    }
  }

  const uri = typeof fileOrUri === 'string' ? fileOrUri : '';

  // Prevent OOM: check file size before attempting full in-memory read
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && typeof info.size === 'number' && info.size > 20 * 1024 * 1024) {
      throw new Error(`El archivo es demasiado grande (${Math.round(info.size / (1024 * 1024))} MB) para leer en memoria Base64.`);
    }
  } catch (sizeErr: any) {
    if (sizeErr.message?.includes('demasiado grande')) throw sizeErr;
  }

  // 1. Direct read if already inside accessible app cache
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64
    });
    if (b64 && b64.length > 0) {
      return b64.replace(/\s+/g, '');
    }
  } catch {
    // continue to safe copy
  }

  // 2. Safe copy from content:// or file:// to root of cacheDirectory
  try {
    const dest = `${FileSystem.cacheDirectory}safe_${Date.now()}.pdf`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    const b64 = await FileSystem.readAsStringAsync(dest, {
      encoding: FileSystem.EncodingType.Base64
    });
    FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
    if (b64 && b64.length > 0) {
      return b64.replace(/\s+/g, '');
    }
  } catch (copyErr) {
    console.warn('[readUriAsBase64] safe copy to cacheDirectory failed:', copyErr);
  }

  // 3. Fallback to ExpoFile.base64()
  try {
    const expoFile = new ExpoFile(uri);
    const b64 = await expoFile.base64();
    if (b64 && b64.length > 0) {
      return b64.replace(/\s+/g, '');
    }
  } catch (expoFileErr) {
    console.warn('[readUriAsBase64] ExpoFile.base64 failed:', expoFileErr);
  }

  throw new Error('No se pudo leer el archivo PDF seleccionado. Intenta seleccionarlo nuevamente.');
}

/**
 * Reads file or URI into an ArrayBuffer.
 */
async function fileToArrayBuffer(fileOrUri: File | Blob | string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') {
    if (typeof fileOrUri !== 'string') {
      return await (fileOrUri as any).arrayBuffer();
    } else {
      const response = await fetch(fileOrUri);
      return await response.arrayBuffer();
    }
  } else {
    const b64 = await readUriAsBase64(fileOrUri as any);
    const binaryString = atob(b64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

/**
 * Opens a PDF document and returns a session that can extract pages individually on demand.
 */
export async function openPdfDocument(
  fileOrUri: File | Blob | string,
  fileName: string
): Promise<PdfDocumentSession> {
  const cleanTitle = fileName.replace(/\.pdf$/i, '');

  if (Platform.OS !== 'web') {
    const bridge = getNativeBridge();
    if (!bridge) {
      throw new Error('El lector de PDF aún no está listo. Intenta de nuevo en un segundo.');
    }

    let paramToSend: string;
    if (
      typeof fileOrUri === 'string' &&
      (fileOrUri.startsWith('file:') ||
        fileOrUri.startsWith('content:') ||
        fileOrUri.startsWith('http:') ||
        fileOrUri.startsWith('https:') ||
        fileOrUri.startsWith('/'))
    ) {
      // Do NOT read 160MB into JavaScript memory! Pass the URI directly to the Chromium WebView
      paramToSend = fileOrUri.startsWith('/') ? `file://${fileOrUri}` : fileOrUri;
    } else if (typeof fileOrUri === 'string' && fileOrUri.startsWith('data:')) {
      paramToSend = fileOrUri;
    } else if (typeof fileOrUri === 'string' && fileOrUri.length > 500) {
      paramToSend = fileOrUri;
    } else {
      paramToSend = await readUriAsBase64(fileOrUri);
    }

    const totalPages = await bridge.open(paramToSend);

    return {
      title: cleanTitle,
      pageCount: totalPages,
      getPage: async (pageNum: number, onOcr?: () => void): Promise<ExtractedPage> => {
        const pageData = await bridge.getPageData(pageNum, onOcr);
        const rawList = pageData.rawItems && pageData.rawItems.length > 0 ? pageData.rawItems : (pageData.lines || []);
        const paragraphs = cleanAndGroupParagraphs(rawList, pageNum);
        return {
          pageNumber: pageNum,
          paragraphs,
          fullText: paragraphs.map(p => p.text).join('\n\n'),
          imageUrl: pageData.imageUrl,
          pageWidth: pageData.pageWidth,
          pageHeight: pageData.pageHeight
        };
      }
    };
  }

  // Web environment
  const arrayBuffer = await fileToArrayBuffer(fileOrUri);
  const pdfjs = await getPdfJsLib();
  if (!pdfjs) {
    throw new Error('No se pudo inicializar el motor de lectura de PDF');
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    disableFontFace: true,
    useSystemFonts: true
  });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  return {
    title: cleanTitle,
    pageCount: numPages,
    getPage: async (pageNum: number, onOcr?: () => void): Promise<ExtractedPage> => {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });
      
      // Render visual page to canvas
      let imageUrl: string | undefined;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        imageUrl = canvas.toDataURL('image/jpeg', 0.82);
      } catch (err) {
        console.warn('Error rendering page image:', err);
      }

      const textContent = await page.getTextContent();
      const rawItems: RawLineItem[] = [];
      let currentLine = '';
      let currentLineBox: BoundingBox | undefined = undefined;
      let prevTx: number | null = null;
      let prevTy: number | null = null;
      let prevRight: number | null = null;
      let prevFontSize: number | null = null;

      for (const item of textContent.items) {
        if ('str' in item) {
          const str = (item as any).str;
          if (!str && !(item as any).hasEOL) continue;

          let itemBox: BoundingBox | undefined = undefined;
          let tx = 0;
          let ty = 0;
          let fontSize = 12;
          let itemW = 0;
          let itemH = 12;

          if (item.transform && item.transform.length >= 6) {
            try {
              tx = item.transform[4];
              ty = item.transform[5];
              fontSize = Math.hypot(item.transform[0], item.transform[1]) || Math.abs(item.transform[3]) || 12;
              itemW = item.width || (fontSize * 0.5 * (str ? str.length : 1));
              itemH = item.height || fontSize;

              if (typeof viewport.convertToViewportRectangle === 'function') {
                // In PDF coordinate space, ty is the text baseline.
                // Glyphs extend upward by ~0.88*fontSize (ascent/capitals) and downward by ~0.22*fontSize (descenders).
                // Calculating true typographic bounds ensures the box sits exactly centered over the letters!
                const rect = viewport.convertToViewportRectangle([
                  tx,
                  ty - (fontSize * 0.22),
                  tx + itemW,
                  ty + (fontSize * 0.88)
                ]);
                const left = Math.min(rect[0], rect[2]);
                const top = Math.min(rect[1], rect[3]);
                const w = Math.abs(rect[2] - rect[0]);
                const h = Math.abs(rect[3] - rect[1]);
                itemBox = {
                  x: Math.max(0, Math.min(1, left / viewport.width)),
                  y: Math.max(0, Math.min(1, top / viewport.height)),
                  width: Math.max(0.005, Math.min(1, w / viewport.width)),
                  height: Math.max(0.005, Math.min(1, h / viewport.height))
                };
              }
            } catch (e) {
              // Ignore box calc error
            }
          }

          let isNewLine = false;
          if (prevTy !== null && prevTx !== null && prevRight !== null) {
            const deltaY = Math.abs(ty - prevTy);
            const deltaFontSize = Math.abs(fontSize - (prevFontSize || fontSize));

            if ((item as any).hasEOL) {
              isNewLine = true;
            } else if (deltaY > fontSize * 0.35) {
              // Baseline moved vertically -> new line
              isNewLine = true;
            } else if (tx < prevTx - (fontSize * 0.4)) {
              // X moved backwards to the left -> new line (carriage return)
              isNewLine = true;
            } else if (tx - prevRight > fontSize * 2.5) {
              // Large gap on same line -> new column or tab
              isNewLine = true;
            } else if (deltaFontSize > 5 && deltaY > 2) {
              // Major font size jump
              isNewLine = true;
            }
          }

          if (isNewLine) {
            if (currentLine.trim()) {
              rawItems.push({ text: currentLine.trim(), box: currentLineBox });
            }
            currentLine = str || '';
            currentLineBox = itemBox;
          } else {
            if (str) {
              const needsSpace =
                prevRight !== null &&
                (tx - prevRight > fontSize * 0.16) &&
                !currentLine.endsWith(' ') &&
                !str.startsWith(' ');
              currentLine += (needsSpace ? ' ' : '') + str;
              currentLineBox = unionBoxes(currentLineBox, itemBox);
            }
          }

          if (str) {
            prevTx = tx;
            prevTy = ty;
            prevRight = tx + itemW;
            prevFontSize = fontSize;
          }

          if ((item as any).hasEOL) {
            if (currentLine.trim()) {
              rawItems.push({ text: currentLine.trim(), box: currentLineBox });
            }
            currentLine = '';
            currentLineBox = undefined;
            prevTx = null;
            prevTy = null;
            prevRight = null;
            prevFontSize = null;
          }
        }
      }
      if (currentLine.trim()) {
        rawItems.push({ text: currentLine, box: currentLineBox });
      }

      const totalChars = rawItems.map(i => i.text).join('').replace(/\s/g, '').length;
      if (totalChars < 20) {
        if (onOcr) onOcr();
        rawItems.length = 0;
        const ocrItems = await ocrWebPage(page);
        rawItems.push(...ocrItems);
      }

      const paragraphs = cleanAndGroupParagraphs(rawItems, pageNum);
      return {
        pageNumber: pageNum,
        paragraphs,
        fullText: paragraphs.map(p => p.text).join('\n\n'),
        imageUrl,
        pageWidth: viewport.width,
        pageHeight: viewport.height
      };
    }
  };
}

/**
 * Convenience helper to extract all pages at once (used by sample paper or tests).
 */
export async function extractTextFromPdf(
  fileOrUri: File | string,
  fileName: string,
  onProgress?: (page: number, total: number, mode?: 'text' | 'ocr') => void
): Promise<ExtractionResult> {
  const session = await openPdfDocument(fileOrUri, fileName);
  const pages: ExtractedPage[] = [];

  for (let i = 1; i <= session.pageCount; i++) {
    if (onProgress) onProgress(i, session.pageCount, 'text');
    const p = await session.getPage(i, () => {
      if (onProgress) onProgress(i, session.pageCount, 'ocr');
    });
    pages.push(p);
  }

  return {
    title: session.title,
    pageCount: session.pageCount,
    pages,
    totalParagraphs: pages.reduce((n, p) => n + p.paragraphs.length, 0)
  };
}
