import { HttpError } from '../../lib/errors.js';

const DASHED_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_ITEM_ID_RE = /^[0-9a-f]{32}$/;

export function encodePublicItemId(uuid: string): string {
  const normalized = uuid.trim().toLowerCase();
  if (!DASHED_UUID_RE.test(normalized)) {
    throw new HttpError(400, 'Invalid item id.');
  }

  return normalized.replaceAll('-', '');
}

export function decodePublicItemId(itemId: string): string {
  const normalized = itemId.trim();
  if (!PUBLIC_ITEM_ID_RE.test(normalized)) {
    throw new HttpError(400, 'Invalid item id.');
  }

  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20),
  ].join('-');
}

export function assertPublicItemId(value: string): string {
  return decodePublicItemId(value);
}
