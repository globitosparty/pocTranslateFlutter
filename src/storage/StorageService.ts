import AsyncStorage from '@react-native-async-storage/async-storage';
import { DocumentItem, PageChunk, AppSettings, TranslationCacheEntry } from '../types';

const STORAGE_KEYS = {
  DOCUMENTS: '@doculingua:documents',
  CHUNKS_PREFIX: '@doculingua:chunks:',
  CACHE: '@doculingua:cache',
  SETTINGS: '@doculingua:settings'
};

export const defaultSettings: AppSettings = {
  defaultProvider: 'mock',
  openAiModel: 'gpt-4o-mini',
  cacheEnabled: true,
  maxConcurrentRequests: 3,
  readerFontSize: 16,
  readerTheme: 'dark',
  keepOriginalLayout: true
};

/**
 * Lightweight, high-performance offline storage engine for DocuLingua.
 */
class StorageService {
  // --- DOCUMENTS ---
  async getDocuments(): Promise<DocumentItem[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.DOCUMENTS);
      if (!data) return [];
      return JSON.parse(data) as DocumentItem[];
    } catch (e) {
      console.error('[StorageService] Error getting documents:', e);
      return [];
    }
  }

  async saveDocument(doc: DocumentItem): Promise<void> {
    const docs = await this.getDocuments();
    const index = docs.findIndex(d => d.id === doc.id);
    if (index >= 0) {
      docs[index] = { ...docs[index], ...doc, updatedAt: Date.now() };
    } else {
      docs.unshift(doc);
    }
    await AsyncStorage.setItem(STORAGE_KEYS.DOCUMENTS, JSON.stringify(docs));
  }

  async getDocumentById(id: string): Promise<DocumentItem | null> {
    const docs = await this.getDocuments();
    return docs.find(d => d.id === id) || null;
  }

  async deleteDocument(id: string): Promise<void> {
    const docs = await this.getDocuments();
    const filtered = docs.filter(d => d.id !== id);
    await AsyncStorage.setItem(STORAGE_KEYS.DOCUMENTS, JSON.stringify(filtered));
    await AsyncStorage.removeItem(`${STORAGE_KEYS.CHUNKS_PREFIX}${id}`);
  }

  // --- CHUNKS ---
  async getChunksForDocument(documentId: string): Promise<PageChunk[]> {
    try {
      const data = await AsyncStorage.getItem(`${STORAGE_KEYS.CHUNKS_PREFIX}${documentId}`);
      if (!data) return [];
      return JSON.parse(data) as PageChunk[];
    } catch (e) {
      console.error('[StorageService] Error getting chunks:', e);
      return [];
    }
  }

  async saveChunks(documentId: string, chunks: PageChunk[]): Promise<void> {
    await AsyncStorage.setItem(`${STORAGE_KEYS.CHUNKS_PREFIX}${documentId}`, JSON.stringify(chunks));
  }

  async updateChunk(documentId: string, updatedChunk: PageChunk): Promise<void> {
    const chunks = await this.getChunksForDocument(documentId);
    const idx = chunks.findIndex(c => c.id === updatedChunk.id);
    if (idx >= 0) {
      chunks[idx] = updatedChunk;
      await this.saveChunks(documentId, chunks);
    }
  }

  // --- TRANSLATION CACHE (Deduplication) ---
  async getCachedTranslation(hash: string): Promise<string | null> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.CACHE);
      if (!data) return null;
      const cache: Record<string, TranslationCacheEntry> = JSON.parse(data);
      return cache[hash]?.translatedText || null;
    } catch {
      return null;
    }
  }

  async setCachedTranslation(entry: TranslationCacheEntry): Promise<void> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.CACHE);
      const cache: Record<string, TranslationCacheEntry> = data ? JSON.parse(data) : {};
      cache[entry.hashSha256] = entry;
      await AsyncStorage.setItem(STORAGE_KEYS.CACHE, JSON.stringify(cache));
    } catch (e) {
      console.error('[StorageService] Cache error:', e);
    }
  }

  // --- SETTINGS ---
  async getSettings(): Promise<AppSettings> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (!data) return defaultSettings;
      return { ...defaultSettings, ...JSON.parse(data) };
    } catch {
      return defaultSettings;
    }
  }

  async saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
    return updated;
  }
}

export const storageService = new StorageService();
export default storageService;
