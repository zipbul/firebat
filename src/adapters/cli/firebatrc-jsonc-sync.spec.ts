import { describe, it, expect } from 'bun:test';

import { syncJsoncTextToTemplateKeys, syncFirebatRcJsoncTextToTemplateKeys } from './firebatrc-jsonc-sync';

describe('syncFirebatRcJsoncTextToTemplateKeys', () => {
  it('should be an alias for syncJsoncTextToTemplateKeys', () => {
    expect(syncFirebatRcJsoncTextToTemplateKeys).toBe(syncJsoncTextToTemplateKeys);
  });
});

describe('syncJsoncTextToTemplateKeys', () => {
  it('should return ok:true with unchanged text when templateJson is not a plain object', () => {
    const result = syncJsoncTextToTemplateKeys({
      userText: '{"key": "value"}',
      templateJson: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(false);
      expect(result.text).toBe('{"key": "value"}');
    }
  });

  it('should return ok:true with unchanged text when already in sync', () => {
    const template = { name: 'test', version: '1.0.0' };
    const userText = JSON.stringify(template, null, 2);

    const result = syncJsoncTextToTemplateKeys({ userText, templateJson: template });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(false);
    }
  });

  it('should insert missing keys from template', () => {
    const userText = '{\n  "name": "test"\n}';
    const templateJson = { name: 'test', version: '1.0.0' };

    const result = syncJsoncTextToTemplateKeys({ userText, templateJson });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(true);
      expect(result.text).toContain('"version"');
    }
  });

  it('should remove keys not present in template', () => {
    const userText = '{\n  "name": "test",\n  "extra": "should-be-removed"\n}';
    const templateJson = { name: 'test' };

    const result = syncJsoncTextToTemplateKeys({ userText, templateJson });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(true);
      expect(result.text).not.toContain('"extra"');
    }
  });

  it('should return ok:false when userText is invalid JSON', () => {
    const result = syncJsoncTextToTemplateKeys({
      userText: 'not valid json {{{',
      templateJson: { key: 'value' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe('string');
    }
  });

  it('should return ok:false when userText root is not an object (array)', () => {
    const result = syncJsoncTextToTemplateKeys({
      userText: '[1, 2, 3]',
      templateJson: { key: 'value' },
    });

    expect(result.ok).toBe(false);
  });

  it('should preserve JSONC comments in unchanged sections', () => {
    const userText = '{\n  // a comment\n  "name": "test"\n}';
    const templateJson = { name: 'test' };

    const result = syncJsoncTextToTemplateKeys({ userText, templateJson });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Comments preserved — no change needed
      expect(result.changed).toBe(false);
    }
  });

  it('should handle empty user object with non-empty template', () => {
    const result = syncJsoncTextToTemplateKeys({
      userText: '{}',
      templateJson: { key: 'value', num: 42 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(true);
      expect(result.text).toContain('"key"');
      expect(result.text).toContain('"num"');
    }
  });

  it('should handle nested objects from template', () => {
    const userText = '{\n  "top": {}\n}';
    const templateJson = { top: { nested: 'value' } };

    const result = syncJsoncTextToTemplateKeys({ userText, templateJson });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain('"nested"');
    }
  });

  it('should preserve existing values even if template has different values', () => {
    const userText = '{\n  "name": "my-custom-name"\n}';
    const templateJson = { name: 'template-name' };

    const result = syncJsoncTextToTemplateKeys({ userText, templateJson });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Key exists in both — no structural change needed
      expect(result.text).toContain('"my-custom-name"');
    }
  });
});
