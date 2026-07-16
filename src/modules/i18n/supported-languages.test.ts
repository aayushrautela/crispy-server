import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_LANGUAGES,
  isSupportedLanguageCode,
  normalizeLanguageCode,
  requireSupportedLanguage,
} from './supported-languages.js';

test('SUPPORTED_LANGUAGES includes common BCP-47 short tags', () => {
  const codes = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));
  for (const expected of ['en', 'es', 'fr', 'hi', 'ja', 'pt-BR', 'zh-TW']) {
    assert.ok(codes.has(expected), `expected ${expected} to be supported`);
  }
});

test('isSupportedLanguageCode is case-insensitive', () => {
  assert.equal(isSupportedLanguageCode('en'), true);
  assert.equal(isSupportedLanguageCode('EN'), true);
  assert.equal(isSupportedLanguageCode('Pt-br'), true);
  assert.equal(isSupportedLanguageCode('xx'), false);
});

test('normalizeLanguageCode canonicalizes to the supported code and rejects unknown', () => {
  assert.equal(normalizeLanguageCode('en'), 'en');
  assert.equal(normalizeLanguageCode('  pt-BR  '), 'pt-BR');
  assert.equal(normalizeLanguageCode('PT_BR'), 'pt-BR');
  assert.equal(normalizeLanguageCode('zh-Hans'), null);
  assert.equal(normalizeLanguageCode(''), null);
  assert.equal(normalizeLanguageCode(null), null);
  assert.equal(normalizeLanguageCode(42), null);
});

test('requireSupportedLanguage throws on unknown and returns canonical on supported', () => {
  assert.equal(requireSupportedLanguage('fr'), 'fr');
  assert.equal(requireSupportedLanguage('zh-CN'), 'zh-CN');
  assert.throws(() => requireSupportedLanguage('es-ES'), (err: { statusCode?: number }) => err.statusCode === 400);
  assert.throws(() => requireSupportedLanguage('klingon'), (err: { statusCode?: number }) => err.statusCode === 400);
  assert.throws(() => requireSupportedLanguage(''), (err: { statusCode?: number }) => err.statusCode === 400);
});
