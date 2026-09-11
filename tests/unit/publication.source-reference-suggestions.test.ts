import { describe, expect, it } from 'vitest';
import { suggestPendingSourceReferences } from '../../src/modules/publication/source-reference-suggestions.js';

describe('suggestPendingSourceReferences', () => {
  it('creates review-only source suggestions from the cultural claims in a 六壬伏英馆 article', () => {
    const suggestions = suggestPendingSourceReferences({
      title: '伏英馆｜六壬伏英馆文化与民俗文献整理｜兴善堂',
      body: '六壬伏英馆有师徒传承与坛馆制度，并在广东、香港及马来西亚等地传播，与民间信仰和符籙文化相关。'
    });

    expect(suggestions).toEqual([
      expect.objectContaining({
        title: '六壬伏英馆的门内传承与坛馆资料',
        sourceType: 'PENDING_VERIFICATION',
        sourceUrl: null
      }),
      expect.objectContaining({
        title: '六壬伏英馆在广东、香港与南洋的传播资料',
        sourceType: 'PENDING_VERIFICATION',
        sourceUrl: null
      }),
      expect.objectContaining({
        title: '六壬神功、民间法教与地方信仰研究资料',
        sourceType: 'PENDING_VERIFICATION',
        sourceUrl: null
      })
    ]);
  });

  it('creates one neutral pending suggestion when no known topic pattern is present', () => {
    expect(suggestPendingSourceReferences({ title: '传统文化导读', body: '介绍一项传统文化资料。' }))
      .toEqual([expect.objectContaining({
        title: '传统文化导读相关资料整理',
        sourceType: 'PENDING_VERIFICATION',
        sourceUrl: null
      })]);
  });
});
