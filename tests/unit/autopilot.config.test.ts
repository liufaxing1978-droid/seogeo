import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('P9-C controlled autopilot safe runtime default', () => {
  it('documents the global kill switch as ON by default', () => {
    const envExample = readFileSync('.env.example', 'utf8');
    expect(envExample).toContain('CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH=true');
  });
});
