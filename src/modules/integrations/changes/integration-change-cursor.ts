export type IntegrationChangeCursor = {
  lastId: string;
};

export function encodeIntegrationChangeCursor(cursor: IntegrationChangeCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64url');
}

export function decodeIntegrationChangeCursor(encoded: string | null | undefined): IntegrationChangeCursor | null {
  if (!encoded) {
    return null;
  }
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
    const parsed = JSON.parse(decoded) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'lastId' in parsed && typeof parsed.lastId === 'string') {
      return { lastId: parsed.lastId };
    }
    return null;
  } catch {
    return null;
  }
}
