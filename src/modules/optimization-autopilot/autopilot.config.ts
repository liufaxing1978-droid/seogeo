export function parseControlledAutopilotGlobalKillSwitch(
  value: string | undefined
): boolean {
  if (value === undefined) return true;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'false' || normalized === '0' || normalized === 'off') return false;
  return true;
}
