import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Dimensions,
  TextInput,
  Modal,
  Image,
  KeyboardAvoidingView,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { theme } from '../../theme';
import { copyToClipboard } from '../../utils/clipboard';
import { ExtractedPage, ExtractedParagraph } from '../../modules/pdf/PdfExtractor';
import { translationService, TranslationProgressEvent } from '../../modules/translator/TranslationService';
import { AppSettings } from '../../types';
import { isCoherentEnglishText } from '../../utils/textCoherence';

interface DualViewerProps {
  documentTitle: string;
  pageCount: number;
  getPage: (pageNumber: number, onOcr?: () => void) => Promise<ExtractedPage>;
  initialPages?: ExtractedPage[];
  initialSettings: AppSettings;
  onBack: () => void;
}

export default function DualViewerScreen({
  documentTitle,
  pageCount,
  getPage,
  initialPages,
  initialSettings,
  onBack
}: DualViewerProps) {
  // 1-indexed page number
  const [currentPageNum, setCurrentPageNum] = useState(1);
  const [pagesCache, setPagesCache] = useState<Record<number, ExtractedPage>>(() => {
    const init: Record<number, ExtractedPage> = {};
    if (initialPages) {
      initialPages.forEach(p => {
        init[p.pageNumber] = p;
      });
    }
    return init;
  });

  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [activeParagraphId, setActiveParagraphId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'split' | 'en' | 'es'>('split');
  const [originalDisplayMode, setOriginalDisplayMode] = useState<'image' | 'text'>('image');
  const [translatedDisplayMode, setTranslatedDisplayMode] = useState<'overlay' | 'text'>('overlay');
  const [copiedToast, setCopiedToast] = useState(false);

  // Smart font size calculation for translated text overlaid on bounding boxes
  const getAdaptiveFontSize = (box?: { x: number; y: number; width: number; height: number }, textLength: number = 20): number => {
    if (!box) return 12;
    const approxHeightPx = 700 * (box.height || 0.03);
    const approxWidthPx = 520 * (box.width || 0.3);

    // Test from large title size down to body text size
    for (let size = 32; size >= 8; size--) {
      const charsPerLine = Math.max(1, Math.floor(approxWidthPx / (size * 0.52)));
      const lines = Math.ceil(textLength / charsPerLine);
      const neededH = lines * (size * 1.25);

      // Single line text: scale directly with the box height
      if (lines === 1 && size <= Math.max(approxHeightPx * 0.92, 10)) {
        return size;
      }
      // Multi-line text: ensure total block fits comfortably
      if (lines > 1 && neededH <= Math.max(approxHeightPx * 1.25, lines * 10)) {
        return size;
      }
    }
    return 8;
  };

  // Jump to page modal
  const [showJumpModal, setShowJumpModal] = useState(false);
  const [jumpInput, setJumpInput] = useState('');

  const windowWidth = Dimensions.get('window').width;
  const isLargeScreen = windowWidth >= 768;
  const activeTheme = theme.colors.dark;
  const cancelSignalRef = useRef({ cancelled: false });
  const leftScrollRef = useRef<ScrollView>(null);
  const rightScrollRef = useRef<ScrollView>(null);

  const currentPage = pagesCache[currentPageNum];

  // Load and translate page whenever currentPageNum changes
  useEffect(() => {
    leftScrollRef.current?.scrollTo({ y: 0, animated: false });
    rightScrollRef.current?.scrollTo({ y: 0, animated: false });
    loadAndTranslatePage(currentPageNum);
    return () => {
      cancelSignalRef.current.cancelled = true;
    };
  }, [currentPageNum]);

  const loadAndTranslatePage = async (targetPageNum: number) => {
    cancelSignalRef.current.cancelled = true;
    cancelSignalRef.current = { cancelled: false };

    let pageData = pagesCache[targetPageNum];

    // Step 1: Extract page if not in cache
    if (!pageData) {
      setIsLoadingPage(true);
      setLoadingStatus(`Cargando página ${targetPageNum}...`);
      try {
        pageData = await getPage(targetPageNum, () => {
          setLoadingStatus(`Página ${targetPageNum}: reconociendo imagen (OCR)...`);
        });
        setPagesCache(prev => ({ ...prev, [targetPageNum]: pageData }));
      } catch (err: any) {
        console.error('Error cargando página:', err);
        setLoadingStatus(`Error: ${err.message || 'No se pudo leer la página'}`);
        setIsLoadingPage(false);
        return;
      } finally {
        setIsLoadingPage(false);
      }
    }

    if (!pageData || !pageData.paragraphs || pageData.paragraphs.length === 0) {
      return;
    }

    // Step 2: Translate paragraphs that aren't translated yet and are coherent English
    const needed = pageData.paragraphs.filter((p: ExtractedParagraph) => !translations[p.id] && isCoherentEnglishText(p.text));
    if (needed.length === 0) {
      return;
    }

    setIsTranslating(true);
    setProgress({ current: pageData.paragraphs.length - needed.length, total: pageData.paragraphs.length });

    try {
      await translationService.translateParagraphs(needed, {
        provider: initialSettings.defaultProvider === 'mock' ? 'google' : initialSettings.defaultProvider,
        apiKeys: {
          openai: initialSettings.openaiApiKey,
          deepl: initialSettings.deeplApiKey
        },
        concurrency: 2,
        signal: cancelSignalRef.current,
        onProgress: (evt: TranslationProgressEvent) => {
          setTranslations(prev => ({
            ...prev,
            [evt.paragraphId]: evt.translatedText
          }));
          setProgress({ current: evt.current, total: evt.total });
        }
      });
    } catch (e: any) {
      console.error('Error traduciendo página:', e);
    } finally {
      setIsTranslating(false);
      setProgress(null);
    }
  };

  const handleReloadCurrentPage = async () => {
    cancelSignalRef.current.cancelled = true;
    cancelSignalRef.current = { cancelled: false };

    if (currentPage?.paragraphs) {
      setTranslations(prev => {
        const next = { ...prev };
        currentPage.paragraphs.forEach(p => {
          delete next[p.id];
        });
        return next;
      });
    }

    setIsLoadingPage(true);
    setLoadingStatus(`Re-analizando página ${currentPageNum}...`);
    try {
      const pageData = await getPage(currentPageNum, () => {
        setLoadingStatus(`Página ${currentPageNum}: reconociendo imagen (OCR)...`);
      });
      setPagesCache(prev => ({ ...prev, [currentPageNum]: pageData }));

      if (pageData && pageData.paragraphs && pageData.paragraphs.length > 0) {
        setIsTranslating(true);
        setProgress({ current: 0, total: pageData.paragraphs.length });
        await translationService.translateParagraphs(pageData.paragraphs, {
          provider: initialSettings.defaultProvider === 'mock' ? 'google' : initialSettings.defaultProvider,
          apiKeys: {
            openai: initialSettings.openaiApiKey,
            deepl: initialSettings.deeplApiKey
          },
          concurrency: 2,
          signal: cancelSignalRef.current,
          onProgress: (evt: TranslationProgressEvent) => {
            setTranslations(prev => ({
              ...prev,
              [evt.paragraphId]: evt.translatedText
            }));
            setProgress({ current: evt.current, total: evt.total });
          }
        });
      }
    } catch (err: any) {
      console.error('Error re-analizando página:', err);
    } finally {
      setIsLoadingPage(false);
      setIsTranslating(false);
      setProgress(null);
    }
  };

  const handleCopyTranslatedPage = async () => {
    if (!currentPage) return;
    const textToCopy = currentPage.paragraphs
      .map((p: ExtractedParagraph) => translations[p.id] || p.text)
      .join('\n\n');

    await copyToClipboard(textToCopy);
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2500);
  };

  const handleJumpSubmit = () => {
    const cleanStr = (jumpInput || '').trim();
    const num = parseInt(cleanStr, 10);
    if (!isNaN(num) && num >= 1 && num <= pageCount) {
      setCurrentPageNum(num);
      setShowJumpModal(false);
      setJumpInput('');
    } else {
      Alert.alert(
        'Página no válida',
        `Por favor ingresa un número de página válido entre 1 y ${pageCount}.`
      );
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: activeTheme.background }]}>
      {/* Top Header */}
      <View style={[styles.header, { borderBottomColor: activeTheme.borderLight }]}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={activeTheme.textPrimary} />
        </TouchableOpacity>

        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: activeTheme.textPrimary }]} numberOfLines={1}>
            {documentTitle}
          </Text>
          <View style={styles.headerPageRow}>
            <TouchableOpacity
              disabled={currentPageNum <= 1}
              onPress={() => setCurrentPageNum(prev => Math.max(1, prev - 1))}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.headerNavArrow, currentPageNum <= 1 && { opacity: 0.3 }]}
            >
              <Ionicons name="chevron-back" size={16} color={activeTheme.primary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.pageBadgeTouchable}
              onPress={() => {
                setJumpInput(String(currentPageNum));
                setShowJumpModal(true);
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Text style={[styles.headerSubtitle, { color: activeTheme.primary }]}>
                Pág. {currentPageNum} de {pageCount} ▾
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={currentPageNum >= pageCount}
              onPress={() => setCurrentPageNum(prev => Math.min(pageCount, prev + 1))}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.headerNavArrow, currentPageNum >= pageCount && { opacity: 0.3 }]}
            >
              <Ionicons name="chevron-forward" size={16} color={activeTheme.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* View mode toggle (Split / EN / ES) */}
        <View style={[styles.modeSelector, { backgroundColor: activeTheme.surfaceElevated }]}>
          <TouchableOpacity
            style={[styles.modeButton, viewMode === 'split' && { backgroundColor: activeTheme.primary }]}
            onPress={() => setViewMode('split')}
          >
            <Text style={[styles.modeButtonText, { color: '#FFFFFF' }]}>Dual</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, viewMode === 'en' && { backgroundColor: activeTheme.primary }]}
            onPress={() => setViewMode('en')}
          >
            <Text style={[styles.modeButtonText, { color: '#FFFFFF' }]}>EN</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, viewMode === 'es' && { backgroundColor: activeTheme.primary }]}
            onPress={() => setViewMode('es')}
          >
            <Text style={[styles.modeButtonText, { color: '#FFFFFF' }]}>ES</Text>
          </TouchableOpacity>
        </View>

        {/* Action: Reload / Re-analizar */}
        <TouchableOpacity
          style={[styles.iconAction, { backgroundColor: activeTheme.surfaceElevated }]}
          onPress={handleReloadCurrentPage}
        >
          <Ionicons name="refresh-outline" size={18} color={activeTheme.primary} />
        </TouchableOpacity>

        {/* Action: Copy */}
        <TouchableOpacity
          style={[styles.iconAction, { backgroundColor: activeTheme.surfaceElevated }]}
          onPress={handleCopyTranslatedPage}
        >
          <Ionicons name="copy-outline" size={18} color={activeTheme.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* Real-time Loading or Translating Progress Bar */}
      {isLoadingPage && (
        <View style={[styles.progressBarContainer, { backgroundColor: activeTheme.surface }]}>
          <View style={styles.progressInfo}>
            <ActivityIndicator size="small" color={activeTheme.primary} style={{ marginRight: 8 }} />
            <Text style={[styles.progressText, { color: activeTheme.textPrimary }]}>
              {loadingStatus || `Leyendo página ${currentPageNum}...`}
            </Text>
          </View>
        </View>
      )}

      {isTranslating && progress && !isLoadingPage && (
        <View style={[styles.progressBarContainer, { backgroundColor: activeTheme.surface }]}>
          <View style={styles.progressInfo}>
            <ActivityIndicator size="small" color={activeTheme.accent} style={{ marginRight: 8 }} />
            <Text style={[styles.progressText, { color: activeTheme.textSecondary }]}>
              Traduciendo página {currentPageNum} en tiempo real... ({progress.current}/{progress.total} párrafos)
            </Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: activeTheme.borderLight }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: activeTheme.accent,
                  width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%`
                }
              ]}
            />
          </View>
        </View>
      )}

      {/* Toast Notification */}
      {copiedToast && (
        <View style={[styles.toast, { backgroundColor: activeTheme.accent }]}>
          <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
          <Text style={styles.toastText}>¡Página en español copiada al portapapeles!</Text>
        </View>
      )}

      {/* Main Dual Reader Workspace */}
      <View style={styles.readerWorkspace}>
        {!currentPage && !isLoadingPage ? (
          <View style={styles.emptyPageContainer}>
            <Text style={[styles.emptyPageText, { color: activeTheme.textSecondary }]}>
              Pulsa "Traducir Página {currentPageNum}" o navega a otra página.
            </Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: activeTheme.primary }]}
              onPress={() => loadAndTranslatePage(currentPageNum)}
            >
              <Ionicons name="refresh" size={18} color="#FFFFFF" />
              <Text style={styles.retryBtnText}>Cargar y Traducir Página {currentPageNum}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Left Column: English Original */}
            {(viewMode === 'split' || viewMode === 'en') && (
              <ScrollView
                ref={leftScrollRef}
                style={[styles.column, viewMode === 'split' && styles.columnBorder]}
                contentContainerStyle={styles.columnContent}
              >
                <View style={styles.columnHeader}>
                  <View style={[styles.languageBadge, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                    <Text style={[styles.languageBadgeText, { color: activeTheme.primary }]}>
                      PÁGINA {currentPageNum} • ORIGINAL
                    </Text>
                  </View>

                  {currentPage?.imageUrl ? (
                    <TouchableOpacity
                      style={[styles.viewToggleBtn, { backgroundColor: activeTheme.surfaceElevated }]}
                      onPress={() => setOriginalDisplayMode(prev => prev === 'image' ? 'text' : 'image')}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={originalDisplayMode === 'image' ? 'text-outline' : 'image-outline'}
                        size={14}
                        color={activeTheme.primary}
                        style={{ marginRight: 4 }}
                      />
                      <Text style={[styles.viewToggleBtnText, { color: activeTheme.textPrimary }]}>
                        {originalDisplayMode === 'image' ? 'Ver Texto' : 'Ver Imagen'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {originalDisplayMode === 'image' && currentPage?.imageUrl ? (
                  <View style={styles.imageWrapper}>
                    <View
                      style={[
                        styles.imageAspectContainer,
                        {
                          aspectRatio: (currentPage.pageWidth && currentPage.pageHeight)
                            ? (currentPage.pageWidth / currentPage.pageHeight)
                            : 0.75
                        }
                      ]}
                    >
                      <Image
                        source={{ uri: currentPage.imageUrl }}
                        style={styles.originalImageFill}
                        resizeMode="stretch"
                      />
                      {/* Highlight active paragraph on original image if selected */}
                      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                        {currentPage.paragraphs.map((p: ExtractedParagraph) => {
                          const isSelected = activeParagraphId === p.id;
                          if (!p.box || !isSelected) return null;
                          return (
                            <View
                              key={`orig_box_${p.id}`}
                              style={[
                                styles.originalHighlightBox,
                                {
                                  left: `${p.box.x * 100}%`,
                                  top: `${p.box.y * 100}%`,
                                  width: `${p.box.width * 100}%`,
                                  height: `${p.box.height * 100}%`,
                                  borderColor: activeTheme.primary
                                }
                              ]}
                            />
                          );
                        })}
                      </View>
                    </View>
                  </View>
                ) : currentPage?.paragraphs.length === 0 ? (
                  <Text style={[styles.noParagraphsText, { color: activeTheme.textMuted }]}>
                    No se detectó texto en esta página.
                  </Text>
                ) : (
                  currentPage?.paragraphs
                    .filter((p: ExtractedParagraph) => isCoherentEnglishText(p.text))
                    .map((p: ExtractedParagraph) => {
                      const isSelected = activeParagraphId === p.id;
                      return (
                        <TouchableOpacity
                          key={p.id}
                          activeOpacity={0.8}
                          onPress={() => setActiveParagraphId(p.id)}
                          style={[
                            styles.paragraphBox,
                            { borderColor: isSelected ? activeTheme.primary : 'transparent' },
                            isSelected && { backgroundColor: activeTheme.highlightOriginal }
                          ]}
                        >
                          <Text style={[styles.paragraphText, { color: activeTheme.textPrimary }]}>{p.text}</Text>
                        </TouchableOpacity>
                      );
                    })
                )}
              </ScrollView>
            )}

            {/* Right Column: Spanish Translation */}
            {(viewMode === 'split' || viewMode === 'es') && (
              <ScrollView
                ref={rightScrollRef}
                style={styles.column}
                contentContainerStyle={styles.columnContent}
              >
                <View style={styles.columnHeader}>
                  <View style={[styles.languageBadge, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                    <Text style={[styles.languageBadgeText, { color: activeTheme.accent }]}>
                      PÁGINA {currentPageNum} • TRADUCIDO (ES)
                    </Text>
                  </View>

                  {currentPage?.imageUrl ? (
                    <TouchableOpacity
                      style={[styles.viewToggleBtn, { backgroundColor: activeTheme.surfaceElevated }]}
                      onPress={() => setTranslatedDisplayMode(prev => prev === 'overlay' ? 'text' : 'overlay')}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={translatedDisplayMode === 'overlay' ? 'text-outline' : 'image-outline'}
                        size={14}
                        color={activeTheme.accent}
                        style={{ marginRight: 4 }}
                      />
                      <Text style={[styles.viewToggleBtnText, { color: activeTheme.textPrimary }]}>
                        {translatedDisplayMode === 'overlay' ? 'Ver Texto' : 'Ver en Imagen'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {translatedDisplayMode === 'overlay' && currentPage?.imageUrl ? (
                  <View style={styles.imageWrapper}>
                    <View
                      style={[
                        styles.imageAspectContainer,
                        {
                          aspectRatio: (currentPage.pageWidth && currentPage.pageHeight)
                            ? (currentPage.pageWidth / currentPage.pageHeight)
                            : 0.75
                        }
                      ]}
                    >
                      <Image
                        source={{ uri: currentPage.imageUrl }}
                        style={styles.originalImageFill}
                        resizeMode="stretch"
                      />
                      {/* Overlaid translated text boxes positioned where original English text was */}
                      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                        {currentPage.paragraphs.map((p: ExtractedParagraph) => {
                          const isSelected = activeParagraphId === p.id;
                          const translated = translations[p.id];
                          if (!p.box || !isCoherentEnglishText(p.text)) return null;

                          const boxW = (p.box.width || 0.1) * 100;
                          const boxH = (p.box.height || 0.02) * 100;
                          const maxW = Math.min(98 - (p.box.x * 100), Math.max(boxW * 1.25, 4));

                          return (
                            <TouchableOpacity
                              key={`trans_box_${p.id}`}
                              activeOpacity={0.88}
                              onPress={() => setActiveParagraphId(p.id)}
                              style={[
                                styles.overlayBox,
                                {
                                  left: `${p.box.x * 100}%`,
                                  top: `${p.box.y * 100}%`,
                                  minWidth: `${boxW}%`,
                                  minHeight: `${boxH}%`,
                                  maxWidth: `${maxW}%`,
                                  alignSelf: 'flex-start',
                                  zIndex: isSelected ? 20 : 5,
                                  borderColor: isSelected ? activeTheme.accent : 'rgba(0, 0, 0, 0.12)'
                                },
                                isSelected && styles.overlayBoxSelected
                              ]}
                            >
                              {translated ? (() => {
                                const fSize = getAdaptiveFontSize(p.box, translated.length);
                                return (
                                  <Text
                                    style={[
                                      styles.overlayText,
                                      {
                                        fontSize: fSize,
                                        lineHeight: Math.max(11, Math.round(fSize * 1.25))
                                      }
                                    ]}
                                  >
                                    {translated}
                                  </Text>
                                );
                              })() : isTranslating ? (
                                <View style={styles.overlayLoading}>
                                  <ActivityIndicator size="small" color={activeTheme.accent} />
                                </View>
                              ) : (() => {
                                const fSize = getAdaptiveFontSize(p.box, p.text.length);
                                return (
                                  <Text
                                    style={[
                                      styles.overlayText,
                                      styles.overlayTextPending,
                                      {
                                        fontSize: fSize,
                                        lineHeight: Math.max(11, Math.round(fSize * 1.25))
                                      }
                                    ]}
                                  >
                                    {p.text}
                                  </Text>
                                );
                              })()}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                ) : (
                  currentPage?.paragraphs
                    .filter((p: ExtractedParagraph) => isCoherentEnglishText(p.text))
                    .map((p: ExtractedParagraph) => {
                      const isSelected = activeParagraphId === p.id;
                      const translated = translations[p.id];
                      const isPending = !translated && isTranslating;

                    return (
                      <TouchableOpacity
                        key={p.id}
                        activeOpacity={0.8}
                        onPress={() => setActiveParagraphId(p.id)}
                        style={[
                          styles.paragraphBox,
                          { borderColor: isSelected ? activeTheme.accent : 'transparent' },
                          isSelected && { backgroundColor: activeTheme.highlightTranslated }
                        ]}
                      >
                        {translated ? (
                          <Text style={[styles.paragraphText, { color: activeTheme.textPrimary }]}>{translated}</Text>
                        ) : isPending ? (
                          <View style={styles.loadingParagraph}>
                            <ActivityIndicator size="small" color={activeTheme.accent} />
                            <Text style={[styles.loadingParagraphText, { color: activeTheme.textMuted }]}>
                              Traduciendo párrafo...
                            </Text>
                          </View>
                        ) : (
                          <Text style={[styles.paragraphText, { color: activeTheme.textMuted, fontStyle: 'italic' }]}>
                            {p.text}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            )}
          </>
        )}
      </View>

      {/* Bottom Page Selector & Navigation Toolbar */}
      <View style={[styles.bottomBar, { borderTopColor: activeTheme.borderLight, backgroundColor: activeTheme.surface }]}>
        <TouchableOpacity
          style={[styles.navButton, currentPageNum <= 1 && styles.navButtonDisabled]}
          disabled={currentPageNum <= 1}
          onPress={() => setCurrentPageNum(prev => Math.max(1, prev - 1))}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={22} color={currentPageNum <= 1 ? activeTheme.textMuted : activeTheme.primary} />
          <Text style={[styles.navButtonText, { color: currentPageNum <= 1 ? activeTheme.textMuted : activeTheme.textPrimary }]}>
            Anterior
          </Text>
        </TouchableOpacity>

        {/* Page Selector Trigger */}
        <TouchableOpacity
          style={[styles.pageSelectorPill, { backgroundColor: activeTheme.surfaceElevated, borderColor: activeTheme.border }]}
          onPress={() => {
            setJumpInput(String(currentPageNum));
            setShowJumpModal(true);
          }}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="document-text-outline" size={16} color={activeTheme.primary} style={{ marginRight: 6 }} />
          <Text style={[styles.pageIndicator, { color: activeTheme.textPrimary }]}>
            Página {currentPageNum} / {pageCount}
          </Text>
          <Ionicons name="swap-vertical" size={14} color={activeTheme.textMuted} style={{ marginLeft: 6 }} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navButton, currentPageNum >= pageCount && styles.navButtonDisabled]}
          disabled={currentPageNum >= pageCount}
          onPress={() => setCurrentPageNum(prev => Math.min(pageCount, prev + 1))}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          activeOpacity={0.7}
        >
          <Text style={[styles.navButtonText, { color: currentPageNum >= pageCount ? activeTheme.textMuted : activeTheme.textPrimary }]}>
            Siguiente
          </Text>
          <Ionicons name="chevron-forward" size={22} color={currentPageNum >= pageCount ? activeTheme.textMuted : activeTheme.primary} />
        </TouchableOpacity>
      </View>

      {/* Jump To Page Modal */}
      <Modal visible={showJumpModal} transparent animationType="fade" onRequestClose={() => setShowJumpModal(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowJumpModal(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ width: '100%', alignItems: 'center' }}
          >
            <TouchableOpacity
              activeOpacity={1}
              style={[styles.modalBox, { backgroundColor: activeTheme.surface, borderColor: activeTheme.border }]}
              onPress={e => e.stopPropagation?.()}
            >
              <Text style={[styles.modalTitle, { color: activeTheme.textPrimary }]}>Seleccionar Página</Text>
              <Text style={[styles.modalSubtitle, { color: activeTheme.textSecondary }]}>
                Página actual: {currentPageNum} de {pageCount}
              </Text>

              {/* Quick direct page picker chips */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.quickPagesScroll}
                contentContainerStyle={styles.quickPagesContainer}
              >
                {Array.from({ length: Math.min(pageCount, 60) }, (_, i) => i + 1).map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.pageChip,
                      p === currentPageNum && { backgroundColor: activeTheme.primary, borderColor: activeTheme.primary },
                      { borderColor: activeTheme.border }
                    ]}
                    onPress={() => {
                      setCurrentPageNum(p);
                      setShowJumpModal(false);
                    }}
                  >
                    <Text style={[styles.pageChipText, { color: p === currentPageNum ? '#FFFFFF' : activeTheme.textPrimary }]}>
                      {p}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.jumpInputRow}>
                <TextInput
                  style={[styles.jumpInput, { color: activeTheme.textPrimary, borderColor: activeTheme.border }]}
                  keyboardType="number-pad"
                  value={jumpInput}
                  onChangeText={setJumpInput}
                  placeholder={`1 a ${pageCount}`}
                  placeholderTextColor={activeTheme.textMuted}
                  onSubmitEditing={handleJumpSubmit}
                  returnKeyType="go"
                  selectTextOnFocus
                />
                <TouchableOpacity
                  style={[styles.modalConfirmBtn, { backgroundColor: activeTheme.primary }]}
                  onPress={handleJumpSubmit}
                >
                  <Text style={styles.modalConfirmText}>Ir a la Página</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.modalButtonsRow}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setShowJumpModal(false)}
                >
                  <Text style={[styles.modalCancelText, { color: activeTheme.textSecondary }]}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12
  },
  backButton: {
    padding: 6,
    borderRadius: 8
  },
  headerTitleContainer: {
    flex: 1
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700'
  },
  headerPageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2
  },
  headerNavArrow: {
    padding: 3,
    borderRadius: 6
  },
  pageBadgeTouchable: {
    paddingHorizontal: 4,
    paddingVertical: 2
  },
  headerSubtitle: {
    fontSize: 12,
    fontWeight: '600'
  },
  modeSelector: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 2
  },
  modeButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6
  },
  modeButtonText: {
    fontSize: 12,
    fontWeight: '700'
  },
  iconAction: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  progressBarContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)'
  },
  progressInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4
  },
  progressText: {
    fontSize: 12,
    fontWeight: '500'
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 4
  },
  progressFill: {
    height: '100%',
    borderRadius: 2
  },
  toast: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    zIndex: 99,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
    elevation: 5
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600'
  },
  readerWorkspace: {
    flex: 1,
    flexDirection: 'row'
  },
  column: {
    flex: 1
  },
  columnBorder: {
    borderRightWidth: 1,
    borderRightColor: 'rgba(255, 255, 255, 0.08)'
  },
  columnContent: {
    padding: 16,
    paddingBottom: 40
  },
  columnHeader: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  viewToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6
  },
  viewToggleBtnText: {
    fontSize: 11,
    fontWeight: '600'
  },
  imageWrapper: {
    width: '100%',
    alignItems: 'center',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1E293B',
    padding: 2
  },
  imageAspectContainer: {
    width: '100%',
    position: 'relative'
  },
  originalImageFill: {
    width: '100%',
    height: '100%'
  },
  originalImage: {
    width: '100%',
    height: 600
  },
  originalHighlightBox: {
    position: 'absolute',
    borderWidth: 2,
    backgroundColor: 'rgba(59, 130, 246, 0.22)',
    borderRadius: 3,
    zIndex: 10
  },
  overlayBox: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderWidth: 0.5,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1.5,
    elevation: 2
  },
  overlayBoxSelected: {
    borderWidth: 1.5,
    borderColor: '#10B981',
    shadowColor: '#10B981',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 6,
    backgroundColor: '#FFFFFF'
  },
  overlayText: {
    color: '#0F172A',
    fontWeight: '600'
  },
  overlayTextPending: {
    color: '#64748B',
    fontStyle: 'italic'
  },
  overlayLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2
  },
  languageBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6
  },
  languageBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  paragraphBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    marginBottom: 14
  },
  paragraphText: {
    fontSize: 15,
    lineHeight: 24
  },
  loadingParagraph: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8
  },
  loadingParagraphText: {
    fontSize: 13,
    fontStyle: 'italic'
  },
  noParagraphsText: {
    fontSize: 14,
    fontStyle: 'italic',
    paddingVertical: 20
  },
  emptyPageContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  emptyPageText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600'
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8
  },
  navButtonDisabled: {
    opacity: 0.3
  },
  navButtonText: {
    fontSize: 13,
    fontWeight: '600'
  },
  pageSelectorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20
  },
  pageIndicator: {
    fontSize: 14,
    fontWeight: '700'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  modalBox: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6
  },
  modalSubtitle: {
    fontSize: 13,
    marginBottom: 14
  },
  quickPagesScroll: {
    maxHeight: 44,
    marginBottom: 16
  },
  quickPagesContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2
  },
  pageChip: {
    minWidth: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  pageChipText: {
    fontSize: 14,
    fontWeight: '700'
  },
  jumpInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16
  },
  jumpInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16
  },
  modalButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12
  },
  modalCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '600'
  },
  modalConfirmBtn: {
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 10
  },
  modalConfirmText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700'
  }
});
