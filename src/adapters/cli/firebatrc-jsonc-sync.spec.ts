import { describe, it, expect } from 'bun:test';

import { syncJsoncTextToTemplateKeys, syncFirebatRcJsoncTextToTemplateKeys } from './firebatrc-jsonc-sync';

type SyncTemplateJson = Parameters<typeof syncJsoncTextToTemplateKeys>[0]['templateJson'];

const syncOk = (userText: string, templateJson: SyncTemplateJson) => {
  const result = syncJsoncTextToTemplateKeys({ userText, templateJson });

  expect(result.ok).toBe(true);

  if (!result.ok) {
    throw new Error('unreachable: expected ok:true');
  }

  return result;
};

const syncErr = (userText: string, templateJson: SyncTemplateJson) => {
  const result = syncJsoncTextToTemplateKeys({ userText, templateJson });

  expect(result.ok).toBe(false);

  if (result.ok) {
    throw new Error('unreachable: expected ok:false');
  }

  return result;
};

describe('syncFirebatRcJsoncTextToTemplateKeys', () => {
  it('should be an alias for syncJsoncTextToTemplateKeys', () => {
    expect(syncFirebatRcJsoncTextToTemplateKeys).toBe(syncJsoncTextToTemplateKeys);
  });
});

describe('syncJsoncTextToTemplateKeys', () => {
  it('should return ok:true with unchanged text when templateJson is not a plain object', () => {
    const result = syncOk('{"key": "value"}', null);

    expect(result.changed).toBe(false);
    expect(result.text).toBe('{"key": "value"}');
  });

  it('should return ok:true with unchanged text when already in sync', () => {
    const template = { name: 'test', version: '1.0.0' };
    const result = syncOk(JSON.stringify(template, null, 2), template);

    expect(result.changed).toBe(false);
  });

  it('should insert missing keys from template', () => {
    const result = syncOk('{\n  "name": "test"\n}', { name: 'test', version: '1.0.0' });

    expect(result.changed).toBe(true);
    expect(result.text).toContain('"version"');
  });

  it('should remove keys not present in template', () => {
    const result = syncOk('{\n  "name": "test",\n  "extra": "should-be-removed"\n}', { name: 'test' });

    expect(result.changed).toBe(true);
    expect(result.text).not.toContain('"extra"');
  });

  it('should return ok:false when userText is invalid JSON', () => {
    const result = syncErr('not valid json {{{', { key: 'value' });

    expect(typeof result.error).toBe('string');
  });

  it('should return ok:false when userText root is not an object (array)', () => {
    const result = syncErr('[1, 2, 3]', { key: 'value' });

    expect(result.ok).toBe(false);
  });

  it('should preserve JSONC comments in unchanged sections', () => {
    const result = syncOk('{\n  // a comment\n  "name": "test"\n}', { name: 'test' });

    // Comments preserved — no change needed
    expect(result.changed).toBe(false);
  });

  it('should handle empty user object with non-empty template', () => {
    const result = syncOk('{}', { key: 'value', num: 42 });

    expect(result.changed).toBe(true);
    expect(result.text).toContain('"key"');
    expect(result.text).toContain('"num"');
  });

  it('should handle nested objects from template', () => {
    const result = syncOk('{\n  "top": {}\n}', { top: { nested: 'value' } });

    expect(result.text).toContain('"nested"');
  });

  it('should preserve existing values even if template has different values', () => {
    const result = syncOk('{\n  "name": "my-custom-name"\n}', { name: 'template-name' });

    // Key exists in both — no structural change needed
    expect(result.text).toContain('"my-custom-name"');
  });
});
