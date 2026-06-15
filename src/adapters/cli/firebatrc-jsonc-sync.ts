import { isPlainObject } from '../../shared/json-guards';

interface JsonObject {
  readonly [key: string]: JsonValue;
}

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface NodeBase {
  readonly start: number;
  readonly end: number;
}

interface ObjectNode extends NodeBase {
  readonly kind: 'object';
  readonly openBrace: number;
  readonly closeBrace: number;
  readonly props: readonly PropNode[];
}

interface ArrayNode extends NodeBase {
  readonly kind: 'array';
}

interface StringNode extends NodeBase {
  readonly kind: 'string';
}

interface NumberNode extends NodeBase {
  readonly kind: 'number';
}

interface LiteralNode extends NodeBase {
  readonly kind: 'literal';
}

type ValueNode = ObjectNode | ArrayNode | StringNode | NumberNode | LiteralNode;

interface PropNode {
  readonly key: string;
  readonly keyStart: number;
  readonly keyEnd: number;
  readonly value: ValueNode;
  readonly start: number; // keyStart
  readonly end: number; // value.end
}

interface TokenRange {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

interface RenderInsertedPropertyInput {
  readonly key: string;
  readonly value: JsonValue;
  readonly indent: string;
  readonly newline: string;
}

interface CollectEditsInput {
  readonly userText: string;
  readonly userNode: Extract<ValueNode, ObjectKindSelector>;
  readonly templateValue: JsonValue;
}

interface SyncInput {
  readonly userText: string;
  readonly templateJson: JsonValue;
}

interface SyncSuccess {
  readonly ok: true;
  readonly text: string;
  readonly changed: boolean;
}

interface SyncFailure {
  readonly ok: false;
  readonly error: string;
}

type SyncResult = SyncSuccess | SyncFailure;

interface ObjectKindSelector {
  readonly kind: 'object';
}

const detectNewline = (text: string): string => {
  return text.includes('\r\n') ? '\r\n' : '\n';
};

const isIdentStart = (ch: string): boolean => {
  return /[A-Za-z_$]/.test(ch);
};

const isIdentPart = (ch: string): boolean => {
  return /[A-Za-z0-9_$]/.test(ch);
};

interface ScannerApi {
  readonly pos: () => number;
  readonly advance: (n?: number) => void;
  readonly slice: (start: number, end: number) => string;
  readonly eof: () => boolean;
  readonly peek: (offset?: number) => string;
  readonly next: () => string;
  readonly error: (message: string) => Error;
  readonly skipWhitespaceAndComments: () => void;
  readonly parseString: () => TokenRange;
  readonly parseIdentifier: () => TokenRange;
  readonly parseNumberLike: () => ValueNode;
  readonly parseLiteral: () => ValueNode;
  readonly parseArray: () => ValueNode;
  readonly parseObject: () => ValueNode;
  readonly parseValue: () => ValueNode;
}

const createScanner = (text: string): ScannerApi => {
  let i = 0;

  const pos = (): number => i;

  const advance = (n: number = 1): void => {
    i += n;
  };

  const slice = (start: number, end: number): string => text.slice(start, end);

  const eof = (): boolean => i >= text.length;

  const peek = (offset: number = 0): string => text[i + offset] ?? '';

  const next = (): string => {
    const ch = peek();

    advance();

    return ch;
  };

  const error = (message: string): Error => new Error(message);

  const fail = (message: string): never => {
    throw error(message);
  };

  const skipWhitespace = (): boolean => {
    const ch = peek();

    if (ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') {
      return false;
    }

    advance();

    return true;
  };

  const skipLineComment = (): boolean => {
    if (peek() !== '/' || peek(1) !== '/') {
      return false;
    }

    advance(2);

    while (!eof()) {
      const c = peek();

      if (c === '\n' || c === '\r') {
        break;
      }

      advance();
    }

    return true;
  };

  const skipBlockComment = (): boolean => {
    if (peek() !== '/' || peek(1) !== '*') {
      return false;
    }

    advance(2);

    while (!eof() && !(peek() === '*' && peek(1) === '/')) {
      advance();
    }

    if (!eof()) {
      advance(2);
    }

    return true;
  };

  const skipWhitespaceAndComments = (): void => {
    while (!eof()) {
      if (skipWhitespace()) {
        continue;
      }

      if (skipLineComment()) {
        continue;
      }

      if (skipBlockComment()) {
        continue;
      }

      break;
    }
  };

  const parseString = (): TokenRange => {
    const start = pos();
    const quote = next();

    if (quote !== '"' && quote !== "'") {
      return fail('Expected string');
    }

    let out = '';
    let escaping = false;

    while (!eof()) {
      const ch = next();

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

      if (ch !== quote) {
        out += ch;

        continue;
      }

      // Keep raw escapes as part of value; key extraction uses raw content anyway.
      return { value: out, start, end: pos() };
    }

    throw error('Unterminated string');
  };

  const parseIdentifier = (): TokenRange => {
    const start = pos();
    const first = peek();

    if (!isIdentStart(first)) {
      return fail('Expected identifier');
    }

    let out = '';

    out += next();

    while (!eof()) {
      const ch = peek();

      if (!isIdentPart(ch)) {
        break;
      }

      out += next();
    }

    return { value: out, start, end: pos() };
  };

  const parseNumberLike = (): ValueNode => {
    const start = pos();

    if (eof()) {
      return fail('Expected number');
    }

    while (!eof()) {
      const ch = peek();

      if (!/[-+0-9.eE]/.test(ch)) {
        break;
      }

      advance();
    }

    return { kind: 'number', start, end: pos() };
  };

  const parseLiteral = (): ValueNode => {
    const start = pos();
    const ch = peek();
    let matched = false;

    if (ch === 't' && slice(pos(), pos() + 4) === 'true') {
      advance(4);

      matched = true;
    } else if (ch === 'f' && slice(pos(), pos() + 5) === 'false') {
      advance(5);

      matched = true;
    } else if (ch === 'n' && slice(pos(), pos() + 4) === 'null') {
      advance(4);

      matched = true;
    }

    if (!matched) {
      return fail('Expected literal');
    }

    return { kind: 'literal', start, end: pos() };
  };

  const parseObjectProp = (props: PropNode[]): void => {
    const keyTok = parseObjectKey();

    skipWhitespaceAndComments();

    if (peek() !== ':') {
      fail('Expected :');
    }

    advance();
    skipWhitespaceAndComments();

    const value = parseValue();

    props.push({
      key: keyTok.value,
      keyStart: keyTok.start,
      keyEnd: keyTok.end,
      value,
      start: keyTok.start,
      end: value.end,
    });

    skipWhitespaceAndComments();

    if (peek() === ',') {
      advance();
    }
  };

  const parseObjectKey = (): TokenRange => {
    const ch = peek();

    if (ch === '"' || ch === "'") {
      return parseString();
    }

    if (isIdentStart(ch)) {
      return parseIdentifier();
    }

    return fail('Expected object key');
  };

  // Forward declaration for mutual recursion.
  let parseValue: () => ValueNode;

  const parseArray = (): ValueNode => {
    const start = pos();
    const open = next();

    if (open !== '[') {
      return fail('Expected [');
    }

    while (!eof()) {
      skipWhitespaceAndComments();

      const ch = peek();

      if (ch === ']') {
        advance();

        return { kind: 'array', start, end: pos() };
      }

      // Parse value but discard structure (we don't sync inside arrays).
      parseValue();

      skipWhitespaceAndComments();

      const after = peek();

      if (after === ',') {
        advance();

        continue;
      }

      if (after === ']') {
        continue;
      }

      // Allow trailing commas + comments; keep going.
    }

    return fail('Unterminated array');
  };

  const parseObject = (): ValueNode => {
    const start = pos();
    const openBrace = pos();
    const open = next();

    if (open !== '{') {
      return fail('Expected {');
    }

    const props: PropNode[] = [];

    while (!eof()) {
      skipWhitespaceAndComments();

      const ch = peek();

      if (ch === '}') {
        const closeBrace = pos();

        advance();

        return { kind: 'object', start, end: pos(), openBrace, closeBrace, props };
      } else {
        parseObjectProp(props);
      }
    }

    return fail('Unterminated object');
  };

  parseValue = (): ValueNode => {
    skipWhitespaceAndComments();

    const start = pos();
    const ch = peek();
    let value: ValueNode | null = null;

    if (ch === '{') {
      value = parseObject();
    }

    if (ch === '[') {
      value = parseArray();
    }

    if (ch === '"' || ch === "'") {
      const s = parseString();

      value = { kind: 'string', start: s.start, end: s.end };
    }

    if (ch === '-' || ch === '+' || /[0-9]/.test(ch)) {
      value = parseNumberLike();
    }

    if (ch === 't' || ch === 'f' || ch === 'n') {
      value = parseLiteral();
    }

    if (!value) {
      return fail(`Unexpected token at ${start}`);
    }

    return value;
  };

  return {
    pos,
    advance,
    slice,
    eof,
    peek,
    next,
    error,
    skipWhitespaceAndComments,
    parseString,
    parseIdentifier,
    parseNumberLike,
    parseLiteral,
    parseArray,
    parseObject,
    parseValue,
  };
};

const parseRootObjectOrThrow = (text: string): Extract<ValueNode, ObjectKindSelector> => {
  const s = createScanner(text);
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

const renderInsertedProperty = (input: RenderInsertedPropertyInput): string => {
  // Render via a wrapper object to get stable formatting, then strip braces.
  const wrapper = JSON.stringify({ [input.key]: input.value }, null, 2);
  const lines = wrapper.split('\n');
  const inner = lines.slice(1, -1); // drop { and }
  const adjusted = inner.map(l => input.indent + (l.startsWith('  ') ? l.slice(2) : l));

  return adjusted.join(input.newline);
};

interface InsertionContext {
  readonly userText: string;
  readonly userNode: Extract<ValueNode, ObjectKindSelector>;
  readonly templateObject: JsonObject;
  readonly missingKeys: readonly string[];
  readonly keptProps: readonly PropNode[];
  readonly newline: string;
}

const renderMissingKeyLines = (ctx: InsertionContext, indent: string): string[] => {
  return ctx.missingKeys.map(k => {
    const v = ctx.templateObject[k] as JsonValue;

    return renderInsertedProperty({ key: k, value: v, indent, newline: ctx.newline }) + ',';
  });
};

const buildInsertionsBeforeFirstProp = (ctx: InsertionContext): Edit[] => {
  const first = ctx.keptProps[0];

  if (!first) {
    return [];
  }

  const firstLineStart = lineStartAt(ctx.userText, first.keyStart);
  const indent = ctx.userText.slice(firstLineStart, first.keyStart);
  const blockLines = renderMissingKeyLines(ctx, indent);
  const block = blockLines.join(ctx.newline) + ctx.newline;

  return [{ start: firstLineStart, end: firstLineStart, text: block }];
};

const buildInsertionsIntoEmptyObject = (ctx: InsertionContext): Edit[] => {
  const closeBrace = ctx.userNode.closeBrace;
  const closeLineStart = lineStartAt(ctx.userText, closeBrace);
  const baseIndent = ctx.userText.slice(closeLineStart, closeBrace);
  const indent = baseIndent + '  ';
  const blockLines = renderMissingKeyLines(ctx, indent);
  const block = ctx.newline + blockLines.join(ctx.newline) + ctx.newline + baseIndent;

  return [{ start: closeBrace, end: closeBrace, text: block }];
};

const buildInsertions = (ctx: InsertionContext): Edit[] => {
  if (ctx.missingKeys.length === 0) {
    return [];
  }

  if (ctx.keptProps.length > 0) {
    return buildInsertionsBeforeFirstProp(ctx);
  }

  return buildInsertionsIntoEmptyObject(ctx);
};

const collectEditsForObjectSync = (input: CollectEditsInput): Edit[] => {
  const { userText, userNode, templateValue } = input;

  if (!isPlainObject(templateValue)) {
    return [];
  }

  const templateObject = templateValue as JsonObject;
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
  const keptProps = userProps.filter(p => templateKeySet.has(p.key)).sort((a, b) => a.keyStart - b.keyStart);
  const missingKeys = templateKeys.filter(k => !userPropsByKey.has(k));
  const insertions = buildInsertions({ userText, userNode, templateObject, missingKeys, keptProps, newline });
  const nestedEdits: Edit[] = [];

  for (const k of templateKeys) {
    const p = userPropsByKey.get(k);

    if (!p) {
      continue;
    }

    const tplChild = templateObject[k] as JsonValue;

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

export const syncJsoncTextToTemplateKeys = (input: SyncInput): SyncResult => {
  if (!isPlainObject(input.templateJson)) {
    return { ok: true, text: input.userText, changed: false };
  }

  let result: SyncResult = { ok: true, text: input.userText, changed: false };

  try {
    const root = parseRootObjectOrThrow(input.userText);
    const edits = collectEditsForObjectSync({
      userText: input.userText,
      userNode: root,
      templateValue: input.templateJson,
    });

    if (edits.length > 0) {
      const next = applyEditsDescending(input.userText, edits);

      result = { ok: true, text: next, changed: next !== input.userText };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    result = { ok: false, error: msg };
  }

  return result;
};

// Backward-compatible alias (historical name).
export const syncFirebatRcJsoncTextToTemplateKeys = syncJsoncTextToTemplateKeys;
