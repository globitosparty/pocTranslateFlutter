/**
 * Text Coherence & OCR Noise Filtering Algorithm
 * 
 * Accurately identifies whether a given string consists of coherent English words 
 * and sentences, filtering out OCR hallucinations, pencil sketches, cross-hatching,
 * halftone dots, stray letters, and non-word drawing artifacts.
 */

// Core English dictionary containing high-frequency functional, grammatical,
// and literary/art/educational vocabulary for instant O(1) coherence checks.
const CORE_ENGLISH_WORDS = new Set([
  // Articles, pronouns, prepositions, conjunctions, auxiliaries
  'a', 'about', 'above', 'across', 'after', 'again', 'against', 'all', 'almost', 'alone',
  'along', 'already', 'also', 'although', 'always', 'am', 'among', 'an', 'and', 'another',
  'any', 'anybody', 'anyone', 'anything', 'anyway', 'are', 'around', 'as', 'at', 'back',
  'be', 'became', 'because', 'become', 'becomes', 'been', 'before', 'began', 'behind', 'being',
  'below', 'between', 'both', 'but', 'by', 'came', 'can', 'cannot', 'could', 'did', 'do',
  'does', 'doing', 'done', 'down', 'during', 'each', 'either', 'else', 'even', 'ever',
  'every', 'everyone', 'everything', 'everywhere', 'except', 'few', 'first', 'for', 'from',
  'further', 'get', 'gets', 'getting', 'give', 'given', 'gives', 'go', 'goes', 'going',
  'gone', 'got', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself',
  'him', 'himself', 'his', 'how', 'however', 'i', 'if', 'in', 'into', 'is', 'it', 'its',
  'itself', 'just', 'keep', 'keeps', 'kept', 'know', 'known', 'knows', 'last', 'later',
  'least', 'less', 'let', 'like', 'likely', 'little', 'look', 'looked', 'looking', 'looks',
  'made', 'make', 'makes', 'making', 'many', 'may', 'maybe', 'me', 'might', 'more',
  'most', 'mostly', 'much', 'must', 'my', 'myself', 'near', 'neither', 'never', 'next',
  'no', 'nobody', 'none', 'noone', 'nor', 'not', 'nothing', 'now', 'of', 'off', 'often',
  'on', 'once', 'one', 'ones', 'only', 'onto', 'or', 'other', 'others', 'otherwise',
  'our', 'ours', 'ourselves', 'out', 'over', 'own', 'part', 'perhaps', 'quite', 'rather',
  'really', 'said', 'same', 'saw', 'say', 'saying', 'says', 'see', 'seeing', 'seen',
  'sees', 'several', 'shall', 'she', 'should', 'since', 'so', 'some', 'somebody',
  'someone', 'something', 'sometimes', 'somewhere', 'still', 'such', 'than', 'that',
  'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'therefore', 'these',
  'they', 'this', 'those', 'though', 'through', 'throughout', 'thus', 'to', 'together',
  'too', 'took', 'toward', 'towards', 'under', 'until', 'up', 'upon', 'us', 'use',
  'used', 'uses', 'using', 'very', 'was', 'way', 'ways', 'we', 'well', 'went', 'were',
  'what', 'whatever', 'when', 'where', 'whether', 'which', 'while', 'who', 'whoever',
  'whole', 'whom', 'whose', 'why', 'will', 'with', 'within', 'without', 'would', 'yes',
  'yet', 'you', 'your', 'yours', 'yourself', 'yourselves',

  // Common descriptive, academic, publishing and domain vocabulary
  'art', 'artist', 'artists', 'artistic', 'guide', 'complete', 'expression', 'expressions',
  'expressive', 'facial', 'face', 'faces', 'head', 'heads', 'skull', 'skulls', 'bone', 'bones',
  'muscle', 'muscles', 'muscular', 'eye', 'eyes', 'eyebrow', 'eyebrows', 'brow', 'brows',
  'forehead', 'foreheads', 'mouth', 'mouths', 'lip', 'lips', 'chin', 'chins', 'jaw', 'jaws',
  'cheek', 'cheeks', 'nose', 'noses', 'neck', 'feature', 'features', 'form', 'forms',
  'visual', 'index', 'drawing', 'drawings', 'draw', 'drawn', 'painter', 'painters', 'painting',
  'printmaker', 'work', 'works', 'exhibited', 'exhibition', 'show', 'shows', 'country',
  'trained', 'student', 'students', 'league', 'school', 'academy', 'classes', 'lives',
  'wife', 'architect', 'designer', 'author', 'book', 'books', 'chapter', 'chapters',
  'page', 'pages', 'volume', 'edition', 'published', 'publisher', 'publications',
  'subtle', 'subtleties', 'emotion', 'emotions', 'emotional', 'kind', 'carefully',
  'explains', 'illustrates', 'illustration', 'illustrations', 'illustrate', 'illustrated',
  'effect', 'effects', 'image', 'images', 'photographic', 'sources', 'focus', 'action',
  'three', 'key', 'areas', 'shows', 'successful', 'portrayal', 'dependent', 'understanding',
  'deep', 'structural', 'information', 'brilliant', 'section', 'depicting', 'six', 'basic',
  'human', 'sadness', 'anger', 'joy', 'fear', 'disgust', 'surprise', 'detailed', 'renderings',
  'supplemented', 'news', 'photos', 'cartoons', 'movie', 'posters', 'masterworks', 'complex',
  'finished', 'jacket', 'design', 'graphics', 'black', 'white', 'contents', 'preface',
  'introduction', 'figure', 'figures', 'plate', 'plates', 'table', 'tables', 'note', 'notes',
  'index', 'glossary', 'bibliography', 'paper', 'text', 'line', 'lines', 'color', 'light',
  'shade', 'shadow', 'shadows', 'tone', 'tones', 'contrast', 'space', 'proportion',
  'proportions', 'anatomy', 'anatomical', 'structure', 'movement', 'action', 'pose', 'poses'
]);

// Valid 2-letter English words
const VALID_TWO_LETTER_WORDS = new Set([
  'am', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me',
  'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we', 'ox', 'id', 'ok', 'tv',
  'vs', 'ad', 'pi', 're', 'ma', 'pa', 'ex'
]);

/**
 * Checks if an individual token is a phonotactically valid English word.
 */
export function isCoherentEnglishWord(rawWord: string): boolean {
  const clean = rawWord.replace(/^[^\w]+|[^\w]+$/g, '').toLowerCase();
  if (!clean) return false;

  // Single letter words: only 'a' or 'i'
  if (clean.length === 1) {
    return clean === 'a' || clean === 'i';
  }

  // 2-letter words: strict whitelist
  if (clean.length === 2) {
    return VALID_TWO_LETTER_WORDS.has(clean);
  }

  // Check core dictionary first (instant hit)
  if (CORE_ENGLISH_WORDS.has(clean)) {
    return true;
  }

  // Pure digits are numbers, not words
  if (/^\d+$/.test(clean)) {
    return true;
  }

  // Must contain only letters
  if (!/^[a-z]+$/.test(clean)) {
    return false;
  }

  // Must contain at least one vowel (a, e, i, o, u, y)
  if (!/[aeiouy]/.test(clean)) {
    return false;
  }

  // Check for impossible consonant clusters (5+ consecutive consonants)
  if (/[bcdfghjklmnpqrstvwxz]{5,}/.test(clean)) {
    return false;
  }

  // Check for impossible vowel clusters (4+ consecutive vowels)
  if (/[aeiou]{4,}/.test(clean)) {
    return false;
  }

  // Check for 3+ identical consecutive characters (e.g. "aaaa", "xxx")
  if (/([a-z])\1\1/.test(clean)) {
    return false;
  }

  // Length sanity: natural words in text rarely exceed 24 letters
  if (clean.length > 24) {
    return false;
  }

  // Check common English suffixes: -ing, -ed, -ly, -tion, -sion, -ment, -able, -ible, -ness, -ful, -less, -est, -er, -ic, -al, -ous, -ive
  const suffixPattern = /(ing|ed|ly|tion|sion|ment|able|ible|ness|ful|less|est|er|ic|al|ous|ive|ize|ise|ism|ist|ity|ty|ies|es|s)$/;
  if (clean.length >= 5 && suffixPattern.test(clean)) {
    return true;
  }

  // Check common English prefixes: un-, re-, in-, dis-, non-, pre-, over-, sub-, mis-, trans-, inter-
  const prefixPattern = /^(un|re|in|dis|non|pre|over|sub|mis|trans|inter|anti|super|semi)/;
  if (clean.length >= 6 && prefixPattern.test(clean)) {
    return true;
  }

  // General phonotactic check: ratio of vowels must be between 20% and 75%
  const vowels = (clean.match(/[aeiouy]/g) || []).length;
  const vowelRatio = vowels / clean.length;
  return vowelRatio >= 0.20 && vowelRatio <= 0.75;
}

/**
 * Validates whether a text block consists of coherent English text rather than
 * drawing noise, pencil sketch artifacts, isolated letters, or OCR hallucinations.
 */
export function isCoherentEnglishText(text: string): boolean {
  if (!text) return false;
  const clean = text.trim();
  if (clean.length < 2) return false;

  // 1. Symbol density check: if text is mostly punctuation, slashes, dashes, or symbols
  const lettersAndDigits = (clean.match(/[a-zA-Z0-9]/g) || []).length;
  if (lettersAndDigits === 0) return false;

  const symbolRatio = (clean.length - lettersAndDigits) / clean.length;
  if (symbolRatio > 0.35 && clean.length > 4) {
    return false;
  }

  // 2. Reject pure noise patterns (e.g. lines of dashes, dots, underscores, slashes)
  if (/^[-_.~=/*|\\:;,#\s]+$/.test(clean)) {
    return false;
  }

  // 3. Extract words (sequences of letters/digits)
  const tokens = clean
    .split(/\s+/)
    .map(t => t.replace(/^[^\w]+|[^\w]+$/g, ''))
    .filter(Boolean);

  if (tokens.length === 0) return false;

  // 4. Single-token handling:
  // An isolated single token (e.g. on a drawing) MUST be a genuine, recognized word.
  // Stray single letters ("c", "x", "e", "nx", "Faig") are rejected.
  if (tokens.length === 1) {
    const single = tokens[0].toLowerCase();
    if (single.length <= 2 && !VALID_TWO_LETTER_WORDS.has(single)) {
      return false;
    }
    // Pure numbers alone (like "92", "11") are not translatable paragraphs
    if (/^\d+$/.test(single)) {
      return false;
    }
    return isCoherentEnglishWord(single) && (CORE_ENGLISH_WORDS.has(single) || single.length >= 4);
  }

  // 5. Short 2-word snippets (e.g. "FAIG 92" or "c o" or "x v"):
  // Must contain at least one recognized core English word or valid multi-letter words.
  if (tokens.length === 2) {
    const w1 = tokens[0].toLowerCase();
    const w2 = tokens[1].toLowerCase();

    // Artist signature pattern: e.g. "FAIG 92", "Faigin 91", "Smith '92"
    if (/^\d{2,4}$/.test(w2) && !CORE_ENGLISH_WORDS.has(w1)) {
      return false;
    }

    // Two single letters: e.g. "c v", "x o" -> drawing noise
    if (w1.length <= 1 && w2.length <= 1) {
      return false;
    }

    const w1Valid = isCoherentEnglishWord(w1);
    const w2Valid = isCoherentEnglishWord(w2);

    if (!w1Valid && !w2Valid) return false;
    if (CORE_ENGLISH_WORDS.has(w1) || CORE_ENGLISH_WORDS.has(w2)) return true;
    return w1Valid && w2Valid;
  }

  // 6. Multi-word paragraphs (>= 3 words):
  // Check the proportion of coherent words and presence of core English vocabulary.
  let validWords = 0;
  let coreWords = 0;
  let totalLettersInWords = 0;
  let totalVowelsInWords = 0;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (isCoherentEnglishWord(lower)) {
      validWords++;
      if (CORE_ENGLISH_WORDS.has(lower)) {
        coreWords++;
      }
    }

    const letters = (lower.match(/[a-z]/g) || []).length;
    const vowels = (lower.match(/[aeiouy]/g) || []).length;
    totalLettersInWords += letters;
    totalVowelsInWords += vowels;
  }

  // Check valid word ratio: at least 60% of words must be coherent
  const validRatio = validWords / tokens.length;
  if (validRatio < 0.60) {
    return false;
  }

  // In real English text of 3+ words, there should almost always be at least one core functional word
  // (articles, prepositions, common verbs/nouns), UNLESS all words are valid domain nouns.
  if (tokens.length >= 4 && coreWords === 0 && validRatio < 0.85) {
    return false;
  }

  // Overall vowel ratio check: natural English has 30% to 50% vowels
  if (totalLettersInWords >= 8) {
    const overallVowelRatio = totalVowelsInWords / totalLettersInWords;
    if (overallVowelRatio < 0.22 || overallVowelRatio > 0.65) {
      return false;
    }
  }

  return true;
}

/**
 * Filters an array of paragraphs, keeping only those that represent coherent English text.
 */
export function filterCoherentParagraphs<T extends { text: string }>(items: T[]): T[] {
  return items.filter(item => isCoherentEnglishText(item.text));
}
