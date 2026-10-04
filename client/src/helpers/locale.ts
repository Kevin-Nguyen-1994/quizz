/** Human-readable name for an open-ended locale code (e.g. "fr" → "French"). */
export function localeName(code: string): string {
  try {
    return (
      new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

/** New quizzes default to Vietnamese unless the maker picks something else. */
export const DEFAULT_LOCALE = 'vi';

/** A handful of common locale codes to suggest — pickers also accept any free-text code. */
export const COMMON_LOCALES = [
  'vi',
  'fr',
  'en',
  'es',
  'de',
  'it',
  'pt',
  'pt-BR',
  'nl',
  'pl',
  'ru',
  'uk',
  'tr',
  'ar',
  'he',
  'hi',
  'ja',
  'ko',
  'zh',
  'zh-TW',
  'id',
  'sv',
  'da',
  'no',
  'fi',
  'el',
  'cs',
  'ro',
  'th',
];
