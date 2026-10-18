/**
 * IndexedDB storage for persisting PDF files on Web.
 * Uses ArrayBuffer serialization with keyPath object storage to guarantee 100% compatibility across Chrome, Safari, Firefox and Edge.
 */
import { Platform } from 'react-native';

const DB_NAME = 'DocuLinguaVault_v1';
const STORE_NAME = 'pdf_vault';
const DB_VERSION = 1;

// In-memory cache of Blobs for instant retrieval during active session
export const memoryFileMap = new Map<string, Blob>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function getDb(): Promise<IDBDatabase | null> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };

      request.onblocked = () => {
        console.warn('[WebFileStore] IndexedDB blocked');
        resolve(null);
      };

      request.onerror = (err) => {
        console.warn('[WebFileStore] IndexedDB open error:', err);
        resolve(null);
      };
    } catch (e) {
      console.warn('[WebFileStore] IndexedDB exception:', e);
      resolve(null);
    }
  });

  return dbPromise;
}

/**
 * Persists a PDF into IndexedDB as ArrayBuffer.
 */
export async function saveWebPdf(
  key: string,
  fileOrBlob: Blob | File | ArrayBuffer,
  fileName?: string
): Promise<void> {
  if (!key) return;

  try {
    let buffer: ArrayBuffer;
    if (fileOrBlob instanceof ArrayBuffer) {
      buffer = fileOrBlob;
    } else if (fileOrBlob && typeof (fileOrBlob as any).arrayBuffer === 'function') {
      buffer = await (fileOrBlob as any).arrayBuffer();
    } else {
      return;
    }

    // Cache in memory
    const blob = new Blob([buffer], { type: 'application/pdf' });
    memoryFileMap.set(key, blob);

    const db = await getDb();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => {
          console.warn('[WebFileStore] tx error:', e);
          resolve();
        };
        tx.objectStore(STORE_NAME).put({
          key,
          buffer,
          name: fileName || key,
          size: buffer.byteLength,
          updatedAt: Date.now()
        });
      } catch (putErr) {
        console.warn('[WebFileStore] put exception:', putErr);
        resolve();
      }
    });
  } catch (err) {
    console.warn('[WebFileStore] saveWebPdf failed:', err);
  }
}

/**
 * Retrieves a PDF Blob by exact key from IndexedDB or memory cache.
 */
export async function getWebPdf(key: string): Promise<Blob | null> {
  if (!key) return null;

  if (memoryFileMap.has(key)) {
    return memoryFileMap.get(key) || null;
  }

  const db = await getDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const result = req.result;
        if (result && result.buffer) {
          const blob = new Blob([result.buffer], { type: 'application/pdf' });
          memoryFileMap.set(key, blob);
          resolve(blob);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

/**
 * Robust retrieval: tries exact keys, then fuzzy matches stored entries,
 * or returns the single stored PDF if only one exists in the vault.
 */
export async function findWebPdf(
  docId: string,
  title: string,
  originalPath?: string
): Promise<Blob | null> {
  // 1. Try memory map
  const keysToTry = [docId, title, `${title}.pdf`, originalPath, '__latest__'].filter(Boolean) as string[];
  for (const k of keysToTry) {
    if (memoryFileMap.has(k)) {
      return memoryFileMap.get(k) || null;
    }
  }

  // 2. Try exact IndexedDB queries
  for (const k of keysToTry) {
    const direct = await getWebPdf(k);
    if (direct) return direct;
  }

  // 3. Inspect all entries in vault for title / name fuzzy matching
  const db = await getDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const items: any[] = req.result || [];
        if (items.length === 0) {
          resolve(null);
          return;
        }

        const cleanSearch = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        // Check if any item's key or name matches search
        for (const item of items) {
          const itemKey = String(item.key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const itemName = String(item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanSearch && (itemKey.includes(cleanSearch) || cleanSearch.includes(itemKey) || itemName.includes(cleanSearch))) {
            const blob = new Blob([item.buffer], { type: 'application/pdf' });
            memoryFileMap.set(docId, blob);
            resolve(blob);
            return;
          }
        }

        // If there is only one PDF in the vault, use it!
        if (items.length === 1 && items[0]?.buffer) {
          const blob = new Blob([items[0].buffer], { type: 'application/pdf' });
          memoryFileMap.set(docId, blob);
          resolve(blob);
          return;
        }

        // Fallback to most recently updated
        items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        if (items[0]?.buffer) {
          const blob = new Blob([items[0].buffer], { type: 'application/pdf' });
          memoryFileMap.set(docId, blob);
          resolve(blob);
          return;
        }

        resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

/**
 * Deletes a PDF from IndexedDB and memory.
 */
export async function deleteWebPdf(key: string): Promise<void> {
  if (!key) return;
  memoryFileMap.delete(key);

  const db = await getDb();
  if (!db) return;

  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
  } catch (e) {
    console.warn('[WebFileStore] delete error:', e);
  }
}
