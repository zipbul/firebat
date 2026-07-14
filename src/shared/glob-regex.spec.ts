import { describe, expect, it } from 'bun:test';

import { globToRegExp } from './glob-regex';

// F5 (adversarial review): standard globstar semantics match `**/` as ZERO OR
// MORE path segments — `**/*.spec.*` must match a root-level `app.spec.ts`,
// not just a nested one. Bun.Glob (used by target-discovery) agrees with this
// semantics. Pre-fix, this shared helper compiled `**/` as ONE OR MORE
// segments (`.*` requires at least the trailing `/` to be consumed by
// something), producing a false-W: a root-level file matching a documented
// ignore glob was still reported as not-ignored.
describe('globToRegExp — F5: leading/inner ** matches zero segments', () => {
  it('matches a root-level file against a leading **/ pattern', () => {
    expect(globToRegExp('**/*.spec.*').test('app.spec.ts')).toBe(true);
  });

  it('still matches a nested file against the same leading **/ pattern', () => {
    expect(globToRegExp('**/*.spec.*').test('src/app.spec.ts')).toBe(true);
  });

  it('matches a root-level directory against an inner **/ pattern', () => {
    expect(globToRegExp('**/ui/**').test('ui/x.ts')).toBe(true);
  });

  it('still matches a nested directory against the same inner **/ pattern', () => {
    expect(globToRegExp('**/ui/**').test('a/ui/x.ts')).toBe(true);
  });

  it('does not match a file outside a non-globstar-prefixed directory pattern', () => {
    expect(globToRegExp('test/**').test('test/x.ts')).toBe(true);
    expect(globToRegExp('test/**').test('other/test/x.ts')).toBe(false);
    expect(globToRegExp('test/**').test('x.ts')).toBe(false);
  });

  it('does not match an unrelated file against **/*.spec.*', () => {
    expect(globToRegExp('**/*.spec.*').test('app.ts')).toBe(false);
  });
});
