import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseControlledAutopilotGlobalKillSwitch } from '../../src/modules/optimization-autopilot/autopilot.config.js';

describe('P9-C controlled autopilot safe runtime default', () => {
  it('documents the global kill switch as ON by default', () => {
    const envExample = readFileSync('.env.example', 'utf8');
    expect(envExample).toContain('CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH=true');
  });

  it('fails closed unless the value explicitly means OFF', () => {
    expect(parseControlledAutopilotGlobalKillSwitch(undefined)).toBe(true);
    expect(parseControlledAutopilotGlobalKillSwitch('')).toBe(true);
    expect(parseControlledAutopilotGlobalKillSwitch('garbage')).toBe(true);
    expect(parseControlledAutopilotGlobalKillSwitch('true')).toBe(true);
    expect(parseControlledAutopilotGlobalKillSwitch('1')).toBe(true);
    expect(parseControlledAutopilotGlobalKillSwitch('on')).toBe(true);

    expect(parseControlledAutopilotGlobalKillSwitch('false')).toBe(false);
    expect(parseControlledAutopilotGlobalKillSwitch('0')).toBe(false);
    expect(parseControlledAutopilotGlobalKillSwitch('off')).toBe(false);
    expect(parseControlledAutopilotGlobalKillSwitch(' OFF ')).toBe(false);
  });
});
