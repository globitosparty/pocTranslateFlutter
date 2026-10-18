export type TranslationStatus = 
  | 'idle'
  | 'pending'
  | 'extracting'
  | 'chunking'
  | 'translating'
  | 'assembling'
  | 'completed'
  | 'paused'
  | 'failed';

export type TranslationProviderId = 'deepl' | 'openai' | 'google' | 'mock';

export type TranslationTone = 'academic' | 'technical' | 'general';

export interface DocumentMetadata {
  author?: string;
  creator?: string;
  keywords?: string[];
  originalLanguage: string;
  targetLanguage: string;
}

export interface DocumentItem {
  id: string;                         // UUID v4
  title: string;                      // Nombre del archivo o título del PDF
  originalFilePath: string;           // Ruta local o URI al archivo original
  translatedFilePath?: string;        // Ruta local o URI al PDF generado en español
  originalPageCount: number;          // Total de páginas del PDF original
  selectedPageRange: number[];        // Páginas seleccionadas para traducción [1, 2, 3...]
  fileSizeBytes: number;              // Peso en bytes
  status: TranslationStatus;          // Estado actual del documento
  createdAt: number;                  // Timestamp Unix (ms)
  updatedAt: number;                  // Timestamp Unix (ms)
  lastReadPageIndex: number;          // Última página leída
  metadata: DocumentMetadata;
}

export interface PageChunk {
  id: string;                         // UUID v4
  documentId: string;                 // Llave hacia DocumentItem
  pageNumber: number;                 // Página física (1-indexed)
  paragraphIndex: number;             // Índice del párrafo en la página
  anchorId: string;                   // Identificador de sincronización (ej: "p_1_3")
  originalText: string;               // Texto en inglés sin traducir
  translatedText?: string;            // Texto traducido al español
  hashSha256: string;                 // Hash SHA-256 para deduplicación
  tokenCount: number;                 // Conteo estimado de tokens
  charCount: number;                  // Cantidad de caracteres
  status: 'pending' | 'in_flight' | 'completed' | 'failed';
  errorMessage?: string;
  orderIndex: number;                 // Orden secuencial de lectura
}

export interface TranslationJob {
  id: string;
  documentId: string;
  provider: TranslationProviderId;
  tone: TranslationTone;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  inFlightChunks: number;
  startedAt: number;
  completedAt?: number;
  errorLog?: string[];
}

export interface AppSettings {
  defaultProvider: TranslationProviderId;
  deeplApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  openAiModel: string;
  cacheEnabled: boolean;
  maxConcurrentRequests: number;      // Por defecto: 3
  readerFontSize: number;             // 14 a 22 (por defecto: 16)
  readerTheme: 'dark' | 'light' | 'sepia';
  keepOriginalLayout: boolean;
}

export interface TranslationCacheEntry {
  hashSha256: string;
  originalText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  provider: TranslationProviderId;
  createdAt: number;
}
