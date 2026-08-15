// Local avatar catalog. Avatar files live in assets/avatars/<id>.png and are
// served publicly at GET /v1/avatars/:id. The profile's avatar_url stores one
// of these ids (e.g. "avatar_01") — it is never a remote URL.

export const SUPPORTED_AVATARS = [
  'avatar_01',
  'avatar_02',
  'avatar_03',
  'avatar_04',
  'avatar_05',
  'avatar_06',
  'avatar_07',
  'avatar_08',
  'avatar_09',
  'avatar_10',
  'avatar_11',
  'avatar_12',
  'avatar_13',
  'avatar_14',
  'avatar_15',
  'avatar_16',
  'avatar_17',
  'avatar_18',
  'avatar_19',
  'avatar_20',
] as const;

export type AvatarId = (typeof SUPPORTED_AVATARS)[number];

const AVATAR_SET: ReadonlySet<string> = new Set(SUPPORTED_AVATARS);

export type AvatarIdValidation =
  | { ok: true; id: AvatarId }
  | { ok: false; reason: string };

export function isSupportedAvatar(value: unknown): value is AvatarId {
  return typeof value === 'string' && AVATAR_SET.has(value);
}

export function validateAvatarId(value: unknown): AvatarIdValidation {
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, reason: 'Avatar selection is required.' };
  }
  const id = value.trim();
  if (!isSupportedAvatar(id)) {
    return { ok: false, reason: `Avatar '${id}' is not supported.` };
  }
  return { ok: true, id };
}

export function avatarFileName(id: AvatarId): string {
  return `${id}.png`;
}
