const clean = value => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';

// Host-selected translations take priority; romanization is a different role.
export function getLineTranslation(line, language = 'zh-CN') {
  if (!line || typeof line !== 'object') return '';
  const original = clean(line.fullText);
  const distinct = value => { const text = clean(value); return text && text !== original ? text : ''; };
  const selected = distinct(line.translation);
  if (selected) return selected;
  const alternatives = Array.isArray(line.alternateTexts)
    ? line.alternateTexts.filter(item => item?.role === 'translation' && distinct(item.text)) : [];
  const preferred = String(language).toLowerCase();
  const primary = preferred.split('-')[0];
  const match = alternatives.find(item => String(item.language || '').toLowerCase() === preferred)
    || alternatives.find(item => String(item.language || '').toLowerCase().split('-')[0] === primary)
    || alternatives[0];
  return match ? distinct(match.text) : '';
}
