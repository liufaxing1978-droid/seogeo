export function sanitizeGeoError(error: string | null | undefined): string | null {
  if (!error) return null;
  return error.replace(/[\r\n\t]+/g, ' ').slice(0, 1000);
}

export function logGeoEvent(event: string, data: Record<string, unknown>): void {
  console.log({ event, ...data });
}
