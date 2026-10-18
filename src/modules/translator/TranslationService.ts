import { sha256 } from '../../utils/sha256';
import { storageService } from '../../storage/StorageService';
import { TranslationProviderId } from '../../types';
import { isCoherentEnglishText } from '../../utils/textCoherence';

export interface TranslationProgressEvent {
  current: number;
  total: number;
  paragraphId: string;
  originalText: string;
  translatedText: string;
  fromCache: boolean;
}

/**
 * Translates a single text segment using the free Google Translate API endpoint.
 * Requires zero API keys or authentication.
 */
async function translateViaGoogleFree(text: string): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(
    text
  )}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Google Translate error HTTP ${response.status}`);
  }
  const data = await response.json();
  if (Array.isArray(data) && Array.isArray(data[0])) {
    return data[0].map((item: any) => item[0]).join('');
  }
  throw new Error('Respuesta inesperada de Google Translate');
}

/**
 * Fallback translation using MyMemory public API.
 */
async function translateViaMyMemory(text: string): Promise<string> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|es`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MyMemory error HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data?.responseData?.translatedText) {
    return data.responseData.translatedText;
  }
  throw new Error('Respuesta vacía de MyMemory');
}

/**
 * Translates text via OpenAI Chat Completions (if key provided).
 */
async function translateViaOpenAI(text: string, apiKey: string, model = 'gpt-4o-mini'): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert translator specializing in scientific and technical literature. Translate the following English text to Spanish accurately, preserving tone, formatting, and technical terms. Only return the translated text.'
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI error HTTP ${response.status}`);
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * Translates text via DeepL API (if key provided).
 */
async function translateViaDeepL(text: string, apiKey: string): Promise<string> {
  const isFreeKey = apiKey.endsWith(':fx');
  const baseUrl = isFreeKey ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `text=${encodeURIComponent(text)}&source_lang=EN&target_lang=ES`
  });

  if (!response.ok) {
    throw new Error(`DeepL error HTTP ${response.status}`);
  }
  const data = await response.json();
  return data?.translations?.[0]?.text || '';
}

/**
 * Central Translation Service orchestrating real-time translation with caching.
 */
class TranslationService {
  /**
   * Translates a single paragraph with caching and fallback.
   */
  async translateSegment(
    text: string,
    provider: TranslationProviderId = 'google',
    apiKeys?: { openai?: string; deepl?: string }
  ): Promise<{ text: string; fromCache: boolean }> {
    const trimmed = text.trim();
    // Only translate coherent English words - skip visual noise/artifacts
    if (!trimmed || !isCoherentEnglishText(trimmed)) {
      return { text: '', fromCache: true };
    }

    // 1. Check local cache
    const hash = sha256(trimmed + '_es_' + provider);
    const cached = await storageService.getCachedTranslation(hash);
    if (cached) {
      return { text: cached, fromCache: true };
    }

    // 2. Perform translation according to provider
    let translated = '';

    if (provider === 'openai' && apiKeys?.openai) {
      translated = await translateViaOpenAI(trimmed, apiKeys.openai);
    } else if (provider === 'deepl' && apiKeys?.deepl) {
      translated = await translateViaDeepL(trimmed, apiKeys.deepl);
    } else {
      // Default / Free Google with MyMemory fallback
      try {
        translated = await translateViaGoogleFree(trimmed);
      } catch (err) {
        console.warn('[TranslationService] Google Free failed, trying MyMemory fallback...', err);
        translated = await translateViaMyMemory(trimmed);
      }
    }

    // 3. Save to local cache
    if (translated) {
      await storageService.setCachedTranslation({
        hashSha256: hash,
        originalText: trimmed,
        translatedText: translated,
        sourceLang: 'en',
        targetLang: 'es',
        provider,
        createdAt: Date.now()
      });
    }

    return { text: translated, fromCache: false };
  }

  /**
   * Translates a list of paragraphs in real-time, emitting progress for each one.
   */
  async translateParagraphs(
    paragraphs: { id: string; text: string }[],
    options: {
      provider?: TranslationProviderId;
      apiKeys?: { openai?: string; deepl?: string };
      concurrency?: number;
      onProgress?: (event: TranslationProgressEvent) => void;
      signal?: { cancelled: boolean };
    }
  ): Promise<Record<string, string>> {
    const { provider = 'google', apiKeys, concurrency = 2, onProgress, signal } = options;
    const results: Record<string, string> = {};

    // Filter out drawing noise / OCR hallucinations so we only translate coherent English text
    const validParagraphs = paragraphs.filter(p => isCoherentEnglishText(p.text));
    for (const p of paragraphs) {
      if (!isCoherentEnglishText(p.text)) {
        results[p.id] = '';
      }
    }

    const total = validParagraphs.length;
    let completed = 0;

    // Process in batches
    for (let i = 0; i < total; i += concurrency) {
      if (signal?.cancelled) {
        break;
      }

      const batch = validParagraphs.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async item => {
          if (signal?.cancelled) return;
          try {
            const { text: translated, fromCache } = await this.translateSegment(item.text, provider, apiKeys);
            results[item.id] = translated;
            completed++;

            if (onProgress) {
              onProgress({
                current: completed,
                total,
                paragraphId: item.id,
                originalText: item.text,
                translatedText: translated,
                fromCache
              });
            }
          } catch (e: any) {
            console.error(`[TranslationService] Error translating paragraph ${item.id}:`, e);
            results[item.id] = `[Error al traducir: ${e.message || 'Sin conexión'}]`;
            completed++;
          }
        })
      );

      // Short delay between batches to respect free rate-limits
      if (i + concurrency < total && !signal?.cancelled) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    return results;
  }
}

export const translationService = new TranslationService();
export default translationService;
