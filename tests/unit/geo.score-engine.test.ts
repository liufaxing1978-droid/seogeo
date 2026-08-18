import { describe, expect, it } from 'vitest';
import { calculateGeoReadinessScore } from '../../src/modules/geo/score-engine.js';

describe('calculateGeoReadinessScore', () => {
  it('normalizes across only available deterministic dimensions', () => {
    const result = calculateGeoReadinessScore({
      citability: 80,
      entity: 60,
      aiCrawler: null,
      brand: 100,
      contentGeo: 70
    });

    expect(result.scoreType).toBe('GEO_READINESS_V1');
    expect(result.formulaVersion).toBe('GEO_READINESS_V1_NORMALIZED_AVAILABLE');
    expect(result.score).toBe(76.25);
    expect(result.availableWeight).toBe(80);
    const componentCodes: string[] = result.components.map((component) => component.componentCode);
    expect(componentCodes).toEqual([
      'CITABILITY',
      'ENTITY',
      'BRAND',
      'CONTENT_GEO'
    ]);
    expect(componentCodes).not.toContain('AI_VISIBILITY');
  });

  it('returns unavailable rather than fabricating a score when no deterministic dimension is available', () => {
    const result = calculateGeoReadinessScore({
      citability: null,
      entity: null,
      aiCrawler: null,
      brand: null,
      contentGeo: null
    });

    expect(result.score).toBeNull();
    expect(result.availableWeight).toBe(0);
    expect(result.components).toEqual([]);
  });
});
