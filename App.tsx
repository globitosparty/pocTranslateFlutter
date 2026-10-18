import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  StatusBar,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { File as ExpoFile } from 'expo-file-system';

import { theme } from './src/theme';
import { storageService, defaultSettings } from './src/storage/StorageService';
import { DocumentItem, AppSettings } from './src/types';
import { openPdfDocument, ExtractedPage, ExtractionResult, cleanAndGroupParagraphs } from './src/modules/pdf/PdfExtractor';
import DualViewerScreen from './src/screens/DualViewer/DualViewerScreen';
import SettingsModal from './src/screens/SettingsModal/SettingsModal';
import PdfWebViewExtractor, { getNativeBridge } from './src/modules/pdf/PdfWebViewExtractor';
import { formatDate } from './src/utils/formatters';
import { saveWebPdf, getWebPdf, findWebPdf, memoryFileMap } from './src/storage/WebFileStore';

// Sample document for quick 1-click testing
const SAMPLE_PAPER: ExtractionResult = {
  title: 'Attention Is All You Need (Paper Sample)',
  pageCount: 2,
  totalParagraphs: 5,
  pages: [
    {
      pageNumber: 1,
      paragraphs: [
        {
          id: 'p_1_0',
          pageNumber: 1,
          index: 0,
          text: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. The best performing models also connect the encoder and decoder through an attention mechanism.'
        },
        {
          id: 'p_1_1',
          pageNumber: 1,
          index: 1,
          text: 'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train.'
        },
        {
          id: 'p_1_2',
          pageNumber: 1,
          index: 2,
          text: 'Recurrent models typically factor computation along the symbol positions of the input and output sequences. Aligning the positions to steps in computation time, they generate a sequence of hidden states, as a function of the previous hidden state and the input for position t.'
        }
      ],
      fullText: ''
    },
    {
      pageNumber: 2,
      paragraphs: [
        {
          id: 'p_2_0',
          pageNumber: 2,
          index: 0,
          text: 'The Transformer is the first transduction model relying entirely on self-attention to compute representations of its input and output without using sequence-aligned RNNs or convolution.'
        },
        {
          id: 'p_2_1',
          pageNumber: 2,
          index: 1,
          text: 'In our model, we use multi-head self-attention mechanisms allowing the model to jointly attend to information from different representation subspaces at different positions.'
        }
      ],
      fullText: ''
    }
  ]
};

export default function App() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [activeDocument, setActiveDocument] = useState<{
    title: string;
    pageCount: number;
    getPage: (pageNumber: number, onOcr?: () => void) => Promise<ExtractedPage>;
    initialPages?: ExtractedPage[];
  } | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    loadLibrary();
  }, []);

  const loadLibrary = async () => {
    const docs = await storageService.getDocuments();
    const st = await storageService.getSettings();
    setDocuments(docs);
    setSettings(st);
  };

  const handlePickDocument = async () => {
    try {
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        // Direct browser file input for 100% web reliability
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/pdf';
        input.onchange = async (e: any) => {
          const file = e.target.files?.[0];
          if (file) {
            processFile(file, file.name);
          }
        };
        input.click();
        return;
      }

      // Native mobile document picker
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        let fileUri = asset.uri;

        // If it came as a content:// URI, copy it to cacheDirectory to ensure a permanent file:// path
        if (fileUri.startsWith('content:')) {
          try {
            const cleanName = (asset.name || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
            const dest = `${FileSystem.cacheDirectory}doc_${Date.now()}_${cleanName}`;
            await FileSystem.copyAsync({ from: asset.uri, to: dest });
            fileUri = dest;
          } catch (copyErr) {
            console.warn('Could not copy content URI, using original:', copyErr);
          }
        }

        await processFile(fileUri, asset.name || 'documento.pdf');
      }
    } catch (e: any) {
      console.error('Error al seleccionar documento:', e);
      Alert.alert('Error', 'No se pudo seleccionar el archivo PDF.');
    }
  };

  const processFile = async (fileOrUri: File | Blob | string, fileName: string, existingDocId?: string) => {
    setIsExtracting(true);
    setExtractStatus('Abriendo documento PDF...');

    try {
      const docId = existingDocId || `doc_${Date.now()}`;

      // Persist in IndexedDB and memory on Web immediately
      if (Platform.OS === 'web' && typeof fileOrUri !== 'string') {
        await saveWebPdf(docId, fileOrUri as Blob, fileName);
        await saveWebPdf(fileName, fileOrUri as Blob, fileName);
        await saveWebPdf('__latest__', fileOrUri as Blob, fileName);
      }

      const session = await openPdfDocument(fileOrUri, fileName);

      if (Platform.OS === 'web' && typeof fileOrUri !== 'string') {
        await saveWebPdf(session.title, fileOrUri as Blob, fileName);
      }

      // Save to local storage history
      const docItem: DocumentItem = {
        id: docId,
        title: session.title,
        originalFilePath: typeof fileOrUri === 'string' ? fileOrUri : fileName,
        originalPageCount: session.pageCount,
        selectedPageRange: Array.from({ length: session.pageCount }, (_, i) => i + 1),
        fileSizeBytes: (fileOrUri as any)?.size || 0,
        status: 'extracting',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastReadPageIndex: 1,
        metadata: {
          originalLanguage: 'en',
          targetLanguage: 'es'
        }
      };

      await storageService.saveDocument(docItem);
      await loadLibrary();

      // Open in dual viewer with on-demand per-page session
      setActiveDocument({
        title: session.title,
        pageCount: session.pageCount,
        getPage: session.getPage
      });
    } catch (err: any) {
      console.error('Error abriendo PDF:', err);
      const isMissing = String(err?.message || '').includes('Missing PDF');
      if (isMissing) {
        Alert.alert(
          'Archivo no disponible',
          'El archivo temporal de este PDF fue limpiado de la memoria por el sistema. Por favor pulsa "Cargar Archivo PDF" para seleccionarlo nuevamente.',
          [
            { text: 'Cargar Archivo PDF', onPress: handlePickDocument },
            { text: 'Entendido', style: 'cancel' }
          ]
        );
      } else {
        Alert.alert('Error', err.message || 'Ocurrió un error al procesar el archivo PDF.');
      }
    } finally {
      setIsExtracting(false);
      setExtractStatus('');
    }
  };

  const handleOpenSamplePaper = () => {
    setActiveDocument({
      title: SAMPLE_PAPER.title,
      pageCount: SAMPLE_PAPER.pageCount,
      initialPages: SAMPLE_PAPER.pages,
      getPage: async (pageNumber: number) => {
        const p = SAMPLE_PAPER.pages.find((x: ExtractedPage) => x.pageNumber === pageNumber);
        return p || { pageNumber, paragraphs: [], fullText: '' };
      }
    });
  };

  const handleOpenDocument = async (doc: DocumentItem) => {
    // 1. On Web: Retrieve from IndexedDB or memory cache first
    if (Platform.OS === 'web') {
      const webFile = await findWebPdf(doc.id, doc.title, doc.originalFilePath);
      if (webFile) {
        await processFile(webFile, (doc.title || 'documento') + '.pdf', doc.id);
        return;
      }

      // If truly not found in vault, politely inform the user before opening picker to re-link:
      Alert.alert(
        'Vincular archivo PDF',
        `Para abrir "${doc.title}" en el navegador, selecciona el archivo PDF de tu equipo una sola vez. Se guardará permanentemente en el navegador.`,
        [
          {
            text: 'Seleccionar Archivo',
            onPress: () => {
              if (typeof document !== 'undefined') {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'application/pdf';
                input.onchange = async (e: any) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    await saveWebPdf(doc.id, file, file.name);
                    await saveWebPdf(doc.title, file, file.name);
                    await saveWebPdf('__latest__', file, file.name);
                    await processFile(file, file.name, doc.id);
                  }
                };
                input.click();
              }
            }
          },
          { text: 'Cancelar', style: 'cancel' }
        ]
      );
      return;
    }

    // 2. On Mobile: Check device file system path
    if (
      doc.originalFilePath &&
      typeof doc.originalFilePath === 'string' &&
      (doc.originalFilePath.startsWith('file:') ||
        doc.originalFilePath.startsWith('content:') ||
        doc.originalFilePath.startsWith('http') ||
        doc.originalFilePath.startsWith('/'))
    ) {
      try {
        await processFile(doc.originalFilePath, doc.title + '.pdf', doc.id);
        return;
      } catch (err) {
        console.warn('Document file no longer accessible:', err);
      }
    }

    Alert.alert(
      'Archivo no disponible',
      `El archivo "${doc.title}" ya no se encuentra en la memoria temporal del dispositivo. ¿Deseas seleccionarlo de nuevo o eliminarlo del historial?`,
      [
        { text: 'Cargar Archivo PDF', onPress: handlePickDocument },
        { text: 'Eliminar del Historial', style: 'destructive', onPress: () => handleDeleteDocument(doc.id, doc.title, false) },
        { text: 'Cancelar', style: 'cancel' }
      ]
    );
  };

  const handleDeleteDocument = (docId: string, title: string, confirm = true) => {
    const doDelete = async () => {
      await storageService.deleteDocument(docId);
      await loadLibrary();
    };

    if (!confirm) {
      doDelete();
      return;
    }

    Alert.alert(
      'Eliminar Documento',
      `¿Deseas eliminar "${title}" del historial?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: doDelete
        }
      ]
    );
  };

  const activeTheme = theme.colors.dark;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.container, { backgroundColor: activeTheme.background }]} edges={['top', 'left', 'right', 'bottom']}>
        <ExpoStatusBar style="light" />
        {Platform.OS !== 'web' && <PdfWebViewExtractor />}

      {activeDocument ? (
        <DualViewerScreen
          documentTitle={activeDocument.title}
          pageCount={activeDocument.pageCount}
          getPage={activeDocument.getPage}
          initialPages={activeDocument.initialPages}
          initialSettings={settings}
          onBack={() => setActiveDocument(null)}
        />
      ) : (
        <>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: activeTheme.borderLight }]}>
            <View style={styles.headerLeft}>
              <View style={[styles.logoBadge, { backgroundColor: activeTheme.primaryLight }]}>
                <MaterialCommunityIcons name="translate" size={24} color={activeTheme.primary} />
              </View>
              <View>
                <Text style={[styles.appTitle, { color: activeTheme.textPrimary }]}>DocuLingua</Text>
                <Text style={[styles.appSubtitle, { color: activeTheme.textSecondary }]}>
                  Traductor Dual de PDFs • En Vivo
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.settingsButton, { backgroundColor: activeTheme.surfaceElevated }]}
              onPress={() => setShowSettings(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="settings-outline" size={20} color={activeTheme.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent}>
            {/* Loading Modal/Banner when extracting */}
            {isExtracting && (
              <View style={[styles.extractingBanner, { backgroundColor: activeTheme.surface, borderColor: activeTheme.primary }]}>
                <ActivityIndicator size="large" color={activeTheme.primary} style={{ marginBottom: 12 }} />
                <Text style={[styles.extractingTitle, { color: activeTheme.textPrimary }]}>
                  Procesando Documento PDF
                </Text>
                <Text style={[styles.extractingText, { color: activeTheme.textSecondary }]}>{extractStatus}</Text>
              </View>
            )}

            {/* Quick Engine Status Card */}
            <View style={[styles.banner, { backgroundColor: activeTheme.surface, borderColor: activeTheme.border }]}>
              <View style={styles.bannerHeader}>
                <Ionicons name="flash" size={20} color={activeTheme.accent} />
                <Text style={[styles.bannerTitle, { color: activeTheme.textPrimary }]}>
                  Motor Activo: {settings.defaultProvider.toUpperCase()}
                </Text>
                <View style={[styles.liveBadge, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                  <Text style={[styles.liveBadgeText, { color: activeTheme.accent }]}>En Vivo</Text>
                </View>
              </View>
              <Text style={[styles.bannerDescription, { color: activeTheme.textSecondary }]}>
                Carga un PDF en inglés y el sistema extraerá las páginas y traducirá párrafo a párrafo al español en tiempo real.
              </Text>

              <View style={styles.quickButtonsRow}>
                <TouchableOpacity
                  style={[styles.primaryActionBtn, { backgroundColor: activeTheme.primary }]}
                  onPress={handlePickDocument}
                  activeOpacity={0.85}
                >
                  <Ionicons name="cloud-upload-outline" size={20} color="#FFFFFF" />
                  <Text style={styles.primaryActionBtnText}>Cargar Archivo PDF</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryActionBtn, { borderColor: activeTheme.border, backgroundColor: activeTheme.surfaceElevated }]}
                  onPress={handleOpenSamplePaper}
                  activeOpacity={0.8}
                >
                  <Ionicons name="flask-outline" size={18} color={activeTheme.textPrimary} />
                  <Text style={[styles.secondaryActionBtnText, { color: activeTheme.textPrimary }]}>
                    Probar Paper Demo
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Library Section */}
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[styles.sectionTitle, { color: activeTheme.textPrimary }]}>Historial de Documentos</Text>
                <Text style={[styles.sectionCount, { color: activeTheme.textMuted }]}>
                  ({documents.length})
                </Text>
              </View>
              {documents.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    Alert.alert(
                      'Limpiar Historial',
                      '¿Deseas borrar todos los documentos del historial?',
                      [
                        { text: 'Cancelar', style: 'cancel' },
                        {
                          text: 'Limpiar Todo',
                          style: 'destructive',
                          onPress: async () => {
                            for (const d of documents) {
                              await storageService.deleteDocument(d.id);
                            }
                            await loadLibrary();
                          }
                        }
                      ]
                    );
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: activeTheme.primary, fontSize: 13, fontWeight: '600' }}>Limpiar Todo</Text>
                </TouchableOpacity>
              )}
            </View>

            {documents.length === 0 ? (
              <View style={[styles.emptyContainer, { backgroundColor: activeTheme.surface, borderColor: activeTheme.border }]}>
                <MaterialCommunityIcons name="file-pdf-box" size={54} color={activeTheme.textMuted} />
                <Text style={[styles.emptyTitle, { color: activeTheme.textPrimary }]}>
                  No hay documentos traducidos aún
                </Text>
                <Text style={[styles.emptySubtitle, { color: activeTheme.textSecondary }]}>
                  Selecciona cualquier PDF o pulsa "Probar Paper Demo" para ver la traducción dual en acción.
                </Text>
              </View>
            ) : (
              documents.map(doc => (
                <View
                  key={doc.id}
                  style={[styles.docCard, { backgroundColor: activeTheme.surface, borderColor: activeTheme.border }]}
                >
                  <TouchableOpacity
                    style={styles.docCardMain}
                    onPress={() => handleOpenDocument(doc)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.docIconContainer, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                      <MaterialCommunityIcons name="file-pdf-box" size={28} color="#EF4444" />
                    </View>
                    <View style={styles.docInfo}>
                      <Text style={[styles.docTitle, { color: activeTheme.textPrimary }]} numberOfLines={1}>
                        {doc.title}
                      </Text>
                      <Text style={[styles.docMeta, { color: activeTheme.textSecondary }]}>
                        {doc.originalPageCount} {doc.originalPageCount === 1 ? 'página' : 'páginas'} • {formatDate(doc.createdAt)}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.docDeleteBtn}
                    onPress={() => handleDeleteDocument(doc.id, doc.title)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="trash-outline" size={18} color={activeTheme.textMuted} />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </ScrollView>

          {/* Floating Action Button */}
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: activeTheme.primary }]}
            onPress={handlePickDocument}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={26} color="#FFFFFF" />
            <Text style={styles.fabText}>Cargar PDF</Text>
          </TouchableOpacity>

          {/* Settings Modal */}
          <SettingsModal
            visible={showSettings}
            settings={settings}
            onSave={async updated => {
              await storageService.saveSettings(updated);
              setSettings(updated);
            }}
            onClose={() => setShowSettings(false)}
          />
        </>
      )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  logoBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  appTitle: {
    fontSize: 20,
    fontWeight: '700'
  },
  appSubtitle: {
    fontSize: 12,
    marginTop: 2
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 90
  },
  extractingBanner: {
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20
  },
  extractingTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4
  },
  extractingText: {
    fontSize: 13
  },
  banner: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    marginBottom: 20
  },
  bannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1
  },
  liveBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  liveBadgeText: {
    fontSize: 11,
    fontWeight: '700'
  },
  bannerDescription: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16
  },
  quickButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  primaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700'
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1
  },
  secondaryActionBtnText: {
    fontSize: 13,
    fontWeight: '600'
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 6
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700'
  },
  sectionCount: {
    fontSize: 13
  },
  emptyContainer: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18
  },
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10
  },
  docIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  docInfo: {
    flex: 1
  },
  docTitle: {
    fontSize: 15,
    fontWeight: '600'
  },
  docCardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center'
  },
  docDeleteBtn: {
    padding: 8,
    borderRadius: 8,
    marginLeft: 8
  },
  docMeta: {
    fontSize: 12,
    marginTop: 3
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    gap: 8
  },
  fabText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700'
  }
});
