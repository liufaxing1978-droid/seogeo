import { describe, expect, it } from 'vitest';
import { buildKeywordWhere } from '../../src/modules/keywords/keyword-filter.js';

describe('buildKeywordWhere', () => {
  it('combines project isolation, normalized search, fields, and Cluster membership', () => {
    expect(buildKeywordWhere('project-1', {
      q: '  ＦＯＯ   符紙 ',
      type: 'CORE',
      intent: 'INFORMATIONAL',
      priority: 'HIGH',
      status: 'ACTIVE',
      lifecycleStatus: 'APPROVED',
      groupId: 'group-1',
      language: 'zh-Hant',
      region: 'HK',
    })).toEqual({
      projectId: 'project-1',
      normalizedText: { contains: 'foo 符紙' },
      type: 'CORE',
      intent: 'INFORMATIONAL',
      priority: 'HIGH',
      status: 'ACTIVE',
      lifecycleStatus: 'APPROVED',
      groupMemberships: { some: { groupId: 'group-1' } },
      language: 'zh-Hant',
      targetCountry: 'HK',
    });
  });

  it('uses only project isolation when no filters are supplied', () => {
    expect(buildKeywordWhere('project-1', {})).toEqual({ projectId: 'project-1' });
  });
});
