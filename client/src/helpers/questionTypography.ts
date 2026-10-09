export function liveQuestionSizeClass(text: string): string {
  const length = text.trim().length;
  if (length <= 80) return 'live-question-short';
  if (length <= 160) return 'live-question-medium';
  if (length <= 260) return 'live-question-long';
  return 'live-question-xlong';
}
