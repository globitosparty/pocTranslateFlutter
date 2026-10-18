import { Platform } from 'react-native';

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    // Try dynamic require of expo-clipboard if available
    try {
      const ExpoClipboard = require('expo-clipboard');
      if (ExpoClipboard?.setStringAsync) {
        await ExpoClipboard.setStringAsync(text);
        return true;
      }
    } catch {
      // Ignore if not loaded
    }

    return true;
  } catch (err) {
    console.warn('[Clipboard] Could not copy text:', err);
    return false;
  }
}
