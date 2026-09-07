import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SECTION_LIMITS } from './default-templates.js';

test('DEFAULT_SECTION_LIMITS caps hero below rails', () => {
  const hero = DEFAULT_SECTION_LIMITS.heroCarousel ?? 0;
  const rail = DEFAULT_SECTION_LIMITS.contentRail ?? 0;
  assert.ok(hero > 0 && hero < rail);
});
