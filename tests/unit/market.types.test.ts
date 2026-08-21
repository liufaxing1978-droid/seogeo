import { describe, expect, it } from 'vitest';
import {
  mapLegacyCountryToMarket,
  marketIdentity,
  normalizeLocale,
  resolveLegacyMarket
} from '../../src/modules/market/market.types.js';

describe('P9-0A market identity', () => {
  it('normalizes common locale casing deterministically', () => {
    expect(normalizeLocale(' zh-cn ')).toBe('zh-CN');
    expect(normalizeLocale('ZH-hant')).toBe('zh-Hant');
    expect(normalizeLocale('en-us')).toBe('en-US');
  });

  it('rejects empty and invalid BCP-47 locales', () => {
    expect(() => normalizeLocale('')).toThrow(/locale/i);
    expect(() => normalizeLocale('not_a_locale')).toThrow(/locale/i);
  });

  it('maps known legacy countries and sends unknown countries to GLOBAL', () => {
    expect(mapLegacyCountryToMarket('cn')).toBe('CN');
    expect(mapLegacyCountryToMarket('HK')).toBe('HK');
    expect(mapLegacyCountryToMarket('TW')).toBe('TW');
    expect(mapLegacyCountryToMarket('SG')).toBe('SG');
    expect(mapLegacyCountryToMarket('MY')).toBe('MY');
    expect(mapLegacyCountryToMarket('US')).toBe('GLOBAL');
  });

  it('builds a read-only legacy fallback market', () => {
    expect(resolveLegacyMarket({ targetCountry: 'TW', defaultLanguage: 'zh-hant' })).toEqual({
      marketCode: 'TW',
      locale: 'zh-Hant',
      enabled: true,
      source: 'LEGACY_FALLBACK'
    });
  });

  it('uses a stable identity key', () => {
    expect(marketIdentity({ marketCode: 'GLOBAL', locale: 'zh-Hant' })).toBe('GLOBAL:zh-Hant');
  });
});
