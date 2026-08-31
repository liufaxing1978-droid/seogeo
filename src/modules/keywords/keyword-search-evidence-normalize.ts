export function normalizeSearchEvidenceQuery(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('und');
}
