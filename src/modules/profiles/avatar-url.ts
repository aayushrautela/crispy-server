const DICEBEAR_HOST = 'api.dicebear.com';
const DICEBEAR_VERSION = 'v9';
const DICEBEAR_FORMATS = ['svg', 'png', 'webp', 'avif'] as const;

export const SUPPORTED_DICEBEAR_STYLES = [
  'adventurer',
  'adventurer-neutral',
  'avataaars',
  'avataaars-neutral',
  'big-ears',
  'big-ears-neutral',
  'big-smile',
  'bottts',
  'bottts-neutral',
  'croodles',
  'croodles-neutral',
  'dylan',
  'fun-emoji',
  'glass',
  'icons',
  'identicon',
  'initials',
  'lorelei',
  'lorelei-neutral',
  'micah',
  'miniavs',
  'notionists',
  'notionists-neutral',
  'open-peeps',
  'personas',
  'pixel-art',
  'pixel-art-neutral',
  'rings',
  'shapes',
  'thumbs',
] as const;

export type DicebearStyle = (typeof SUPPORTED_DICEBEAR_STYLES)[number];

const DICEBEAR_STYLE_SET: ReadonlySet<string> = new Set(SUPPORTED_DICEBEAR_STYLES);

export type AvatarUrlValidation =
  | { ok: true; url: string }
  | { ok: false; reason: string };

export function isSupportedDicebearStyle(value: unknown): value is DicebearStyle {
  return typeof value === 'string' && DICEBEAR_STYLE_SET.has(value);
}

export function validateAvatarUrl(value: unknown): AvatarUrlValidation {
  if (value === null || value === undefined) {
    return { ok: true, url: '' };
  }
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: true, url: '' };
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return { ok: false, reason: 'Avatar URL must be a valid absolute URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Avatar URL must use https.' };
  }
  if (parsed.hostname !== DICEBEAR_HOST) {
    return { ok: false, reason: `Avatar URL must use the ${DICEBEAR_HOST} host.` };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 3) {
    return { ok: false, reason: 'Avatar URL path must be /<version>/<style>/<format>.' };
  }

  const [version, style, format] = segments;
  if (version !== DICEBEAR_VERSION) {
    return { ok: false, reason: `Avatar URL version must be ${DICEBEAR_VERSION}.` };
  }
  if (!isSupportedDicebearStyle(style)) {
    return { ok: false, reason: `Avatar URL style '${style}' is not supported.` };
  }
  if (!DICEBEAR_FORMATS.includes(format as (typeof DICEBEAR_FORMATS)[number])) {
    return { ok: false, reason: `Avatar URL format '${format}' is not supported.` };
  }

  return { ok: true, url: parsed.toString() };
}
