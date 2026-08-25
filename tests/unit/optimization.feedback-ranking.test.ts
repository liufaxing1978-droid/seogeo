import { describe, expect, it } from 'vitest'
import * as rankingModule from '../../src/modules/optimization/optimization.ranking.js'

function seed(rank: number, key?: string) {
  return {
    candidateId: `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`,
    candidateKey: (key ?? String.fromCharCode(96 + Math.min(rank, 26))).repeat(64),
    deterministicRank: rank,
  }
}

function applyFeedbackAware(
  ranked: readonly ReturnType<typeof seed>[],
  ai: readonly { candidateId: string; adjustment: number }[],
  historical: readonly { candidateId: string; adjustment: number }[],
) {
  const fn = (rankingModule as unknown as Record<string, unknown>).applyFeedbackAwareRankAdjustments
  if (typeof fn !== 'function') throw new Error('applyFeedbackAwareRankAdjustments is missing')
  return (fn as (
    ranked: readonly ReturnType<typeof seed>[],
    ai: readonly { candidateId: string; adjustment: number }[],
    historical: readonly { candidateId: string; adjustment: number }[],
  ) => Array<{
    candidateId: string
    deterministicRank: number
    aiRankAdjustment: number
    historicalRankAdjustment: number
    finalRank: number
    historicalFallback: boolean
  }>)(ranked, ai, historical)
}

describe('P9-A V2 feedback-aware ranking', () => {
  it('composes deterministic, valid AI, and historical signals while keeping V1 AI bounds', () => {
    const ranked = [seed(1, 'a'), seed(2, 'b'), seed(3, 'c'), seed(4, 'd')]
    const result = applyFeedbackAware(
      ranked,
      [
        { candidateId: ranked[0]!.candidateId, adjustment: 1 },
        { candidateId: ranked[1]!.candidateId, adjustment: -1 },
      ],
      [
        { candidateId: ranked[2]!.candidateId, adjustment: -1 },
        { candidateId: ranked[3]!.candidateId, adjustment: 2 },
      ],
    )

    expect(result).toEqual([
      {
        candidateId: ranked[0]!.candidateId,
        deterministicRank: 1,
        aiRankAdjustment: 1,
        historicalRankAdjustment: 0,
        finalRank: 2,
        historicalFallback: false,
      },
      {
        candidateId: ranked[1]!.candidateId,
        deterministicRank: 2,
        aiRankAdjustment: -1,
        historicalRankAdjustment: 0,
        finalRank: 1,
        historicalFallback: false,
      },
      {
        candidateId: ranked[2]!.candidateId,
        deterministicRank: 3,
        aiRankAdjustment: 0,
        historicalRankAdjustment: -1,
        finalRank: 3,
        historicalFallback: false,
      },
      {
        candidateId: ranked[3]!.candidateId,
        deterministicRank: 4,
        aiRankAdjustment: 0,
        historicalRankAdjustment: 2,
        finalRank: 4,
        historicalFallback: false,
      },
    ])
  })

  it('breaks combined-signal ties by deterministic rank then candidate key', () => {
    const ranked = [seed(1, 'b'), seed(2, 'a'), seed(3, 'c')]
    const result = applyFeedbackAware(
      ranked,
      [],
      [
        { candidateId: ranked[0]!.candidateId, adjustment: 1 },
        { candidateId: ranked[1]!.candidateId, adjustment: 0 },
      ],
    )

    expect(result.find((item) => item.candidateId === ranked[0]!.candidateId)?.finalRank).toBe(1)
    expect(result.find((item) => item.candidateId === ranked[1]!.candidateId)?.finalRank).toBe(2)
  })

  it('accepts only integer historical adjustments in the inclusive [-10,+10] range', () => {
    const ranked = [seed(1, 'a')]

    expect(() => applyFeedbackAware(ranked, [], [
      { candidateId: ranked[0]!.candidateId, adjustment: -10 },
    ])).not.toThrow()
    expect(() => applyFeedbackAware(ranked, [], [
      { candidateId: ranked[0]!.candidateId, adjustment: 10 },
    ])).not.toThrow()
    expect(() => applyFeedbackAware(ranked, [], [
      { candidateId: ranked[0]!.candidateId, adjustment: 11 },
    ])).toThrow('Historical optimization ranking adjustment must be an integer from -10 through 10')
    expect(() => applyFeedbackAware(ranked, [], [
      { candidateId: ranked[0]!.candidateId, adjustment: 0.5 },
    ])).toThrow('Historical optimization ranking adjustment must be an integer from -10 through 10')
  })

  it('zeros historical adjustments for the whole materialization when combined displacement exceeds ten, preserving valid AI', () => {
    const ranked = Array.from({ length: 13 }, (_, index) => seed(index + 1))
    const last = ranked[12]!
    const result = applyFeedbackAware(
      ranked,
      [{ candidateId: last.candidateId, adjustment: -2 }],
      [{ candidateId: last.candidateId, adjustment: -10 }],
    )

    expect(result.every((item) => item.historicalFallback)).toBe(true)
    expect(result.every((item) => item.historicalRankAdjustment === 0)).toBe(true)
    expect(result.find((item) => item.candidateId === last.candidateId)).toMatchObject({
      deterministicRank: 13,
      aiRankAdjustment: -2,
      historicalRankAdjustment: 0,
      finalRank: 12,
      historicalFallback: true,
    })
  })

  it('uses the old AI whole-set fallback before historical composition', () => {
    const ranked = Array.from({ length: 7 }, (_, index) => seed(index + 1))
    const ai = [
      { candidateId: ranked[0]!.candidateId, adjustment: 2 },
      { candidateId: ranked[1]!.candidateId, adjustment: 2 },
      { candidateId: ranked[2]!.candidateId, adjustment: 2 },
      { candidateId: ranked[3]!.candidateId, adjustment: -2 },
      { candidateId: ranked[4]!.candidateId, adjustment: -2 },
      { candidateId: ranked[5]!.candidateId, adjustment: -2 },
      { candidateId: ranked[6]!.candidateId, adjustment: -2 },
    ]
    const result = applyFeedbackAware(
      ranked,
      ai,
      [{ candidateId: ranked[6]!.candidateId, adjustment: -1 }],
    )

    expect(result.every((item) => item.aiRankAdjustment === 0)).toBe(true)
    expect(result.find((item) => item.candidateId === ranked[6]!.candidateId)?.historicalRankAdjustment).toBe(-1)
  })

  it('fails closed for unknown or duplicate historical candidate ids', () => {
    const ranked = [seed(1, 'a'), seed(2, 'b')]
    expect(() => applyFeedbackAware(ranked, [], [
      { candidateId: '00000000-0000-4000-8000-999999999999', adjustment: 1 },
    ])).toThrow('Unknown historical optimization ranking candidate')
    expect(() => applyFeedbackAware(ranked, [], [
      { candidateId: ranked[0]!.candidateId, adjustment: 1 },
      { candidateId: ranked[0]!.candidateId, adjustment: 1 },
    ])).toThrow('Duplicate historical optimization ranking adjustment')
  })
})
