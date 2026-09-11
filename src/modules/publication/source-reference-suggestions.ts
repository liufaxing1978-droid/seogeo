export interface PendingSourceReferenceSuggestion {
  title: string;
  sourceType: 'PENDING_VERIFICATION';
  sourceUrl: null;
  author: null;
  publisher: null;
}

interface SourceSuggestionInput {
  title: string;
  body: string;
}

const pending = (title: string): PendingSourceReferenceSuggestion => ({
  title,
  sourceType: 'PENDING_VERIFICATION',
  sourceUrl: null,
  author: null,
  publisher: null
});

export function suggestPendingSourceReferences(input: SourceSuggestionInput): PendingSourceReferenceSuggestion[] {
  const content = `${input.title}\n${input.body}`;
  const suggestions: PendingSourceReferenceSuggestion[] = [];

  if (/伏英馆|伏英舘/.test(content)) {
    suggestions.push(pending('六壬伏英馆的门内传承与坛馆资料'));
  }
  if (/广东|香港|澳门|台湾|马来西亚|新加坡|南洋/.test(content)) {
    suggestions.push(pending('六壬伏英馆在广东、香港与南洋的传播资料'));
  }
  if (/六壬神功|民间法教|民间信仰|符籙|符箓/.test(content)) {
    suggestions.push(pending('六壬神功、民间法教与地方信仰研究资料'));
  }

  return suggestions.length > 0
    ? suggestions
    : [pending(`${input.title.trim() || '本文'}相关资料整理`)];
}
