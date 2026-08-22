export const MARKET_CODES = ['CN', 'GLOBAL', 'HK', 'TW', 'SG', 'MY'] as const;

export type MarketCode = (typeof MARKET_CODES)[number];

export type MarketErrorCode =
  | 'INVALID_LOCALE'
  | 'INVALID_MARKET'
  | 'DUPLICATE_MARKET'
  | 'MARKET_LIMIT_EXCEEDED'
  | 'PROJECT_NOT_FOUND';

export interface MarketWriteInput {
  marketCode: MarketCode;
  locale: string;
  enabled: boolean;
}

export interface MarketSelection extends MarketWriteInput {
  source: 'EXPLICIT' | 'LEGACY_FALLBACK';
}

export interface LegacyProjectMarketInput {
  targetCountry: string;
  defaultLanguage: string;
}

export class MarketValidationError extends Error {
  constructor(
    message: string,
    public readonly code: MarketErrorCode
  ) {
    super(message);
    this.name = 'MarketValidationError';
  }
}

const LEGACY_COUNTRY_MARKET: Readonly<Record<string, MarketCode>> = {
  CN: 'CN',
  HK: 'HK',
  TW: 'TW',
  SG: 'SG',
  MY: 'MY'
};

export function normalizeLocale(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) {
    throw new MarketValidationError(
      'Locale must be between 1 and 64 characters',
      'INVALID_LOCALE'
    );
  }

  try {
    const normalized = Intl.getCanonicalLocales(trimmed)[0];
    if (!normalized) {
      throw new Error('empty canonical locale');
    }
    return normalized;
  } catch {
    throw new MarketValidationError(
      'Locale is not a valid BCP-47 language tag',
      'INVALID_LOCALE'
    );
  }
}

export function mapLegacyCountryToMarket(value: string): MarketCode {
  const country = value.trim().toUpperCase();
  return LEGACY_COUNTRY_MARKET[country] ?? 'GLOBAL';
}

export function resolveLegacyMarket(input: LegacyProjectMarketInput): MarketSelection {
  return {
    marketCode: mapLegacyCountryToMarket(input.targetCountry),
    locale: normalizeLocale(input.defaultLanguage),
    enabled: true,
    source: 'LEGACY_FALLBACK'
  };
}

export function marketIdentity(
  input: Pick<MarketSelection, 'marketCode' | 'locale'>
): string {
  return `${input.marketCode}:${normalizeLocale(input.locale)}`;
}
