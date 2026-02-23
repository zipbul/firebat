import type { SourceToken } from '../../../../src/test-api';

const PUNCTUATION_CHARS = new Set([',', ';', '(', ')', '{', '}', '[', ']']);

const buildCommaTokens = (text: string): SourceToken[] => {
  const tokens: SourceToken[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch !== undefined && PUNCTUATION_CHARS.has(ch)) {
      tokens.push({ value: ch, range: [i, i + 1] });
    }
  }

  return tokens;
};

export { buildCommaTokens };
