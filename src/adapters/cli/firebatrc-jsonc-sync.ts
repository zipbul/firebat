type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

type Edit = { readonly start: number; readonly end: number; readonly text: string };

type NodeBase = { readonly start: number; readonly end: number };

type ValueNode =
  | (NodeBase & { readonly kind: 'object'; readonly openBrace: number; readonly closeBrace: number; readonly props: readonly PropNode[] })
  | (NodeBase & { readonly kind: 'array' })
  | (NodeBase & { readonly kind: 'string' })
  | (NodeBase & { readonly kind: 'number' })
  | (NodeBase & { readonly kind: 'literal' });

type PropNode = {
  readonly key: string;
  readonly keyStart: number;
  readonly keyEnd: number;
  readonly value: ValueNode;
  readonly start: number; // keyStart
  readonly end: number; // value.end
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const detectNewline = (text: string): string => {
  return text.includes('\r\n') ? '\r\n' : '\n';
};

const isIdentStart = (ch: string): boolean => {
  return /[A-Za-z_$]/.test(ch);
};

const isIdentPart = (ch: string): boolean => {
  return /[A-Za-z0-9_$]/.test(ch);
};

class Scanner {
  public i = 0;

  public constructor(public readonly text: string) {}

  public eof(): boolean {
    return this.i >= this.text.length;
  }

  public peek(offset: number = 0): string {
    return this.text[this.i + offset] ?? '';
  }

  public next(): string {
    const ch = this.peek();

    this.i += 1;

    return ch;
  }

  public error(message: string): Error {
    return new Error(message);
  }

  public skipWhitespaceAndComments(): void {
    while (!this.eof()) {
      const ch = this.peek();
      const next = this.peek(1);

      // whitespace
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.i += 1;

        continue;
      }

      // line comment
      if (ch === '/' && next === '/') {
        this.i += 2;

        while (!this.eof()) {
          const c = this.peek();

          if (c === '\n' || c === '\r') {
            break;
          }

          this.i += 1;
        }
        continue;
      }

      // block comment
      if (ch === '/' && next === '*') {
        this.i += 2;

        while (!this.eof()) {
          const c = this.peek();
          const n = this.peek(1);

          if (c === '*' && n === '/') {
            this.i += 2;

            break;
          }

          this.i += 1;
        }
        continue;
      }

      break;
    }
  }

  public parseString(): { value: string; start: number; end: number } {
    const start = this.i;
    const quote = this.next();

    if (quote !== '"' && quote !== "'") {
      throw this.error('Expected string');
    }

    let out = '';
    let escaping = false;

    while (!this.eof()) {
      const ch = this.next();

      if (escaping) {
        out += ch;

        escaping = false;

        continue;
      }

      if (ch === '\\') {
        escaping = true;

        out += ch;

        continue;
      }

      if (ch === quote) {
        const end = this.i;

        // Keep raw escapes as part of value; key extraction uses raw content anyway.
        return { value: out, start, end };
      }

      out += ch;
    }

    throw this.error('Unterminated string');
  }

  public parseIdentifier(): { value: string; start: number; end: number } {
    const start = this.i;
    const first = this.peek();

    if (!isIdentStart(first)) {
      throw this.error('Expected identifier');
    }

    let out = '';

    out += this.next();

    while (!this.eof()) {
      const ch = this.peek();

      if (!isIdentPart(ch)) {
        break;
      }

      out += this.next();
    }

    return { value: out, start, end: this.i };
  }

  public parseNumberLike(): ValueNode {
    const start = this.i;

    while (!this.eof()) {
      const ch = this.peek();

      if (/[-+0-9.eE]/.test(ch)) {
        this.i += 1;

        continue;
      }
      break;
    }

    return { kind: 'number', start, end: this.i };
  }

  public parseLiteral(): ValueNode {
    const start = this.i;
    const ch = this.peek();

    if (ch === 't' && this.text.slice(this.i, this.i + 4) === 'true') {
      this.i += 4;

      return { kind: 'literal', start, end: this.i };
    }

    if (ch === 'f' && this.text.slice(this.i, this.i + 5) === 'false') {
      this.i += 5;

      return { kind: 'literal', start, end: this.i };
    }

    if (ch === 'n' && this.text.slice(this.i, this.i + 4) === 'null') {
      this.i += 4;

      return { kind: 'literal', start, end: this.i };
    }

    throw this.error('Expected literal');
  }

  public parseArray(): ValueNode {
    const start = this.i;
    const open = this.next();

    if (open !== '[') {
      throw this.error('Expected [');
    }

    while (!this.eof()) {
      this.skipWhitespaceAndComments();

      const ch = this.peek();

      if (ch === ']') {
        this.i += 1;

        return { kind: 'array', start, end: this.i };
      }

      // Parse value but discard structure (we don't sync inside arrays).
      this.parseValue();

      this.skipWhitespaceAndComments();

      const after = this.peek();

      if (after === ',') {
        this.i += 1;

        continue;
      }

      if (after === ']') {
        continue;
      }

      // Allow trailing commas + comments; keep going.
    }

    throw this.error('Unterminated array');
  }

  public parseObject(): ValueNode {
    const start = this.i;
    const openBrace = this.i;
    const open = this.next();

    if (open !== '{') {
      throw this.error('Expected {');
    }

    const props: PropNode[] = [];

    while (!this.eof()) {
      this.skipWhitespaceAndComments();

      const ch = this.peek();

      if (ch === '}') {
        const closeBrace = this.i;

        this.i += 1;

        return { kind: 'object', start, end: this.i, openBrace, closeBrace, props };
      }

      let keyTok: { value: string; start: number; end: number };

      if (ch === '"' || ch === "'") {
        keyTok = this.parseString();
      } else if (isIdentStart(ch)) {
        keyTok = this.parseIdentifier();
      } else {
        throw this.error('Expected object key');
      }

      this.skipWhitespaceAndComments();

      if (this.peek() !== ':') {
        throw this.error('Expected :');
      }

      this.i += 1;

      this.skipWhitespaceAndComments();

      const value = this.parseValue();

      props.push({
        key: keyTok.value,
        keyStart: keyTok.start,
        keyEnd: keyTok.end,
        value,
        start: keyTok.start,
        end: value.end,
      });

      this.skipWhitespaceAndComments();

      const after = this.peek();

      if (after === ',') {
        this.i += 1;

        continue;
      }

      // Allow trailing commas/comments; object end handled at top.
    }

    throw this.error('Unterminated object');
  }

  public parseValue(): ValueNode {
    this.skipWhitespaceAndComments();

    const start = this.i;
    const ch = this.peek();

    if (ch === '{') {
      return this.parseObject();
    }

    if (ch === '[') {
      return this.parseArray();
    }

    if (ch === '"' || ch === "'") {
      const s = this.parseString();

      return { kind: 'string', start: s.start, end: s.end };
    }

    if (ch === '-' || ch === '+' || /[0-9]/.test(ch)) {
      return this.parseNumberLike();
    }

    if (ch === 't' || ch === 'f' || ch === 'n') {
      return this.parseLiteral();
    }

    throw this.error(`Unexpected token at ${start}`);
  }
}

const parseRootObjectOrThrow = (text: string): Extract<ValueNode, { kind: 'object' }> => {
  const s = new Scanner(text);
  const node = s.parseValue();

  s.skipWhitespaceAndComments();

  if (node.kind !== 'object') {
    throw new Error('Expected root object');
  }

  return node;
};

const lineStartAt = (text: string, pos: number): number => {
  const idx = text.lastIndexOf('\n', Math.max(0, pos - 1));

  return idx === -1 ? 0 : idx + 1;
};

const lineEndAfter = (text: string, pos: number): number => {
  const idx = text.indexOf('\n', pos);

  return idx === -1 ? text.length : idx + 1;
};

const applyEditsDescending = (text: string, edits: readonly Edit[]): string => {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;

  for (const e of sorted) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }

  return out;
};

const renderInsertedProperty = (input: {
  readonly key: string;
  readonly value: JsonValue;
  readonly indent: string;
  readonly newline: string;
}): string => {
  // Render via a wrapper object to get stable formatting, then strip braces.
  const wrapper = JSON.stringify({ [input.key]: input.value }, null, 2);
  const lines = wrapper.split('\n');
  const inner = lines.slice(1, -1); // drop { and }

  const strip2 = (line: string): string => (line.startsWith('  ') ? line.slice(2) : line);

  const adjusted = inner.map(l => input.indent + strip2(l));

  return adjusted.join(input.newline);
};

const collectEditsForObjectSync = (input: {
  readonly userText: string;
  readonly userNode: Extract<ValueNode, { kind: 'object' }>;
  readonly templateValue: JsonValue;
}): Edit[] => {
  const { userText, userNode, templateValue } = input;

  if (!isPlainObject(templateValue)) {
    return [];
  }

  const newline = detectNewline(userText);
  const templateKeys = Object.keys(templateValue);
  const templateKeySet = new Set(templateKeys);
  const userProps = userNode.props;
  const userPropsByKey = new Map<string, PropNode>();

  for (const p of userProps) {
    userPropsByKey.set(p.key, p);
  }

  const deletions: Edit[] = [];

  for (const p of userProps) {
    if (templateKeySet.has(p.key)) {
      continue;
    }

    const delStart = lineStartAt(userText, p.keyStart);
    const delEnd = lineEndAfter(userText, p.end);

    deletions.push({ start: delStart, end: delEnd, text: '' });
  }

  // Determine anchor: first property that survives deletion.
  const keptProps = userProps
    .filter(p => templateKeySet.has(p.key))
    .sort((a, b) => a.keyStart - b.keyStart);
  const missingKeys = templateKeys.filter(k => !userPropsByKey.has(k));
  const insertions: Edit[] = [];

  if (missingKeys.length > 0) {
    if (keptProps.length > 0) {
      const first = keptProps[0]!;
      const firstLineStart = lineStartAt(userText, first.keyStart);
      const indent = userText.slice(firstLineStart, first.keyStart);
      const blockLines: string[] = [];

      for (const k of missingKeys) {
        const v = (templateValue as any)[k] as JsonValue;
        const rendered = renderInsertedProperty({ key: k, value: v, indent, newline });

        blockLines.push(rendered + ',' );
      }

      const block = blockLines.join(newline) + newline;

      insertions.push({ start: firstLineStart, end: firstLineStart, text: block });
    } else {
      // Object will be empty after deletions (or was empty).
      const closeBrace = userNode.closeBrace;
      const closeLineStart = lineStartAt(userText, closeBrace);
      const baseIndent = userText.slice(closeLineStart, closeBrace);
      const indent = baseIndent + '  ';
      const blockLines: string[] = [];

      for (const k of missingKeys) {
        const v = (templateValue as any)[k] as JsonValue;
        const rendered = renderInsertedProperty({ key: k, value: v, indent, newline });

        blockLines.push(rendered + ',' );
      }

      const block = newline + blockLines.join(newline) + newline + baseIndent;

      insertions.push({ start: closeBrace, end: closeBrace, text: block });
    }
  }

  const nestedEdits: Edit[] = [];

  for (const k of templateKeys) {
    const p = userPropsByKey.get(k);

    if (!p) {
      continue;
    }

    const tplChild = (templateValue as any)[k] as JsonValue;

    if (!isPlainObject(tplChild)) {
      continue;
    }

    if (p.value.kind !== 'object') {
      continue;
    }

    nestedEdits.push(
      ...collectEditsForObjectSync({
        userText,
        userNode: p.value,
        templateValue: tplChild,
      }),
    );
  }

  return [...nestedEdits, ...deletions, ...insertions];
};

export const syncJsoncTextToTemplateKeys = (input: {
  readonly userText: string;
  readonly templateJson: JsonValue;
}): { ok: true; text: string; changed: boolean } | { ok: false; error: string } => {
  try {
    const root = parseRootObjectOrThrow(input.userText);
    const edits = collectEditsForObjectSync({
      userText: input.userText,
      userNode: root,
      templateValue: input.templateJson,
    });

    if (edits.length === 0) {
      return { ok: true, text: input.userText, changed: false };
    }

    const next = applyEditsDescending(input.userText, edits);

    return { ok: true, text: next, changed: next !== input.userText };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    return { ok: false, error: msg };
  }
};

// Backward-compatible alias (historical name).
export const syncFirebatRcJsoncTextToTemplateKeys = syncJsoncTextToTemplateKeys;
