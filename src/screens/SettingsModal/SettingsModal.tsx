import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { theme } from '../../theme';
import { AppSettings, TranslationProviderId } from '../../types';

interface SettingsModalProps {
  visible: boolean;
  settings: AppSettings;
  onSave: (updated: AppSettings) => void;
  onClose: () => void;
}

export default function SettingsModal({
  visible,
  settings,
  onSave,
  onClose
}: SettingsModalProps) {
  const [provider, setProvider] = useState<TranslationProviderId>(settings.defaultProvider || 'google');
  const [openaiKey, setOpenaiKey] = useState(settings.openaiApiKey || '');
  const [deeplKey, setDeeplKey] = useState(settings.deeplApiKey || '');

  const activeTheme = theme.colors.dark;

  const handleSave = () => {
    onSave({
      ...settings,
      defaultProvider: provider,
      openaiApiKey: openaiKey.trim() || undefined,
      deeplApiKey: deeplKey.trim() || undefined
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: activeTheme.surface, borderColor: activeTheme.border }]}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderLeft}>
              <Ionicons name="settings-sharp" size={20} color={activeTheme.primary} />
              <Text style={[styles.modalTitle, { color: activeTheme.textPrimary }]}>Configuración de Traducción</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={activeTheme.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            <Text style={[styles.sectionSubtitle, { color: activeTheme.textSecondary }]}>
              Selecciona el motor de traducción para procesar los documentos PDF:
            </Text>

            {/* Provider Options */}
            <TouchableOpacity
              style={[
                styles.providerCard,
                { borderColor: provider === 'google' ? activeTheme.primary : activeTheme.border },
                provider === 'google' && { backgroundColor: 'rgba(59, 130, 246, 0.1)' }
              ]}
              onPress={() => setProvider('google')}
            >
              <View style={styles.providerCardHeader}>
                <Ionicons name="flash" size={18} color={activeTheme.accent} />
                <Text style={[styles.providerName, { color: activeTheme.textPrimary }]}>
                  Google Translate (Gratuito)
                </Text>
                <View style={[styles.badge, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                  <Text style={[styles.badgeText, { color: activeTheme.accent }]}>Recomendado • Sin Key</Text>
                </View>
              </View>
              <Text style={[styles.providerDesc, { color: activeTheme.textSecondary }]}>
                Traducción instantánea directa sin necesidad de registrarte ni pagar API keys.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.providerCard,
                { borderColor: provider === 'openai' ? activeTheme.primary : activeTheme.border },
                provider === 'openai' && { backgroundColor: 'rgba(59, 130, 246, 0.1)' }
              ]}
              onPress={() => setProvider('openai')}
            >
              <View style={styles.providerCardHeader}>
                <MaterialCommunityIcons name="robot" size={18} color={activeTheme.primary} />
                <Text style={[styles.providerName, { color: activeTheme.textPrimary }]}>OpenAI GPT-4o-mini</Text>
              </View>
              <Text style={[styles.providerDesc, { color: activeTheme.textSecondary }]}>
                Traducción contextual especializada para papers científicos y redacción técnica.
              </Text>
              {provider === 'openai' && (
                <TextInput
                  style={[styles.input, { borderColor: activeTheme.border, color: activeTheme.textPrimary }]}
                  placeholder="Ingresa tu API Key (sk-...)"
                  placeholderTextColor={activeTheme.textMuted}
                  value={openaiKey}
                  onChangeText={setOpenaiKey}
                  secureTextEntry
                />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.providerCard,
                { borderColor: provider === 'deepl' ? activeTheme.primary : activeTheme.border },
                provider === 'deepl' && { backgroundColor: 'rgba(59, 130, 246, 0.1)' }
              ]}
              onPress={() => setProvider('deepl')}
            >
              <View style={styles.providerCardHeader}>
                <MaterialCommunityIcons name="translate-variant" size={18} color={activeTheme.primary} />
                <Text style={[styles.providerName, { color: activeTheme.textPrimary }]}>DeepL Translate</Text>
              </View>
              <Text style={[styles.providerDesc, { color: activeTheme.textSecondary }]}>
                Traducción idiomática de alta precisión europea.
              </Text>
              {provider === 'deepl' && (
                <TextInput
                  style={[styles.input, { borderColor: activeTheme.border, color: activeTheme.textPrimary }]}
                  placeholder="Ingresa tu DeepL Auth Key"
                  placeholderTextColor={activeTheme.textMuted}
                  value={deeplKey}
                  onChangeText={setDeeplKey}
                  secureTextEntry
                />
              )}
            </TouchableOpacity>
          </ScrollView>

          <View style={[styles.modalFooter, { borderTopColor: activeTheme.borderLight }]}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={[styles.cancelButtonText, { color: activeTheme.textSecondary }]}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: activeTheme.primary }]}
              onPress={handleSave}
            >
              <Text style={styles.saveButtonText}>Guardar Configuración</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16
  },
  modalContent: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '85%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden'
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)'
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700'
  },
  closeButton: {
    padding: 4
  },
  modalBody: {
    padding: 16
  },
  sectionSubtitle: {
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18
  },
  providerCard: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12
  },
  providerCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6
  },
  providerName: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700'
  },
  providerDesc: {
    fontSize: 12,
    lineHeight: 16
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 10,
    fontSize: 13
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 16,
    borderTopWidth: 1,
    gap: 12
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600'
  },
  saveButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700'
  }
});
