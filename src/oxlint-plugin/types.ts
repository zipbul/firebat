export type Range = [number, number];

interface SourcePosition {
  line: number;
  column: number;
}

interface SourceLocation {
  start: SourcePosition;
  end: SourcePosition;
}

type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface TemplateElementValue {
  cooked?: string | null;
  raw?: string;
}

export interface SourceToken {
  value?: string;
  range?: Range;
}

interface CommentNode {
  value?: string;
  range?: Range;
  type?: string;
}

export interface AstRoot {
  comments?: CommentNode[];
}

export interface Scope {}

export interface Fix {
  range: Range;
  text?: string;
}

export type AstNodeValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Range
  | SourceLocation
  | TemplateElementValue
  | AstNode
  | AstNode[]
  | AstNodeValue[];

export interface AstNode {
  [key: string]: AstNodeValue;
  type: string;
  range?: Range;
  loc?: SourceLocation;
  parent?: AstNode;
  name?: string;
  kind?: string;
  operator?: string;
  computed?: boolean;
  object?: AstNode;
  property?: AstNode;
  argument?: AstNode;
  expression?: AstNode;
  left?: AstNode;
  right?: AstNode;
  test?: AstNode;
  body?: AstNode | AstNode[];
  update?: AstNode;
  callee?: AstNode;
  arguments?: AstNode[];
  declarations?: AstNode[];
  specifiers?: AstNode[];
  local?: AstNode;
  imported?: AstNode;
  references?: AstNode[];
  identifiers?: AstNode[];
  init?: AstNode;
  value?: string | number | boolean | TemplateElementValue | null;
  members?: AstNode[];
  accessibility?: string;
  decorators?: AstNode[];
  static?: boolean;
  abstract?: boolean;
  id?: AstNode;
  typeAnnotation?: AstNode;
  typeName?: AstNode;
  quasis?: AstNode[];
  expressions?: AstNode[];
  source?: AstNode;
}

export type NodeOrNull = AstNode | null | undefined;

export interface Variable {
  identifiers?: AstNode[];
  references?: AstNode[];
}

export interface SourceCode {
  text: string;
  ast?: AstRoot | null;
  scope?: Scope | null;
  tokens?: SourceToken[];
  getText?: () => string;
  getLines?: () => string[];
  getTokenBefore(node: AstNode): SourceToken | null | undefined;
  getTokenAfter(node: AstNode): SourceToken | null | undefined;
  getAllComments?: () => CommentNode[];
}

export interface Fixer {
  replaceTextRange(range: Range, text: string): Fix;
  removeRange(range: Range): Fix;
  remove(node: AstNode): Fix;
}

export interface ReportDescriptor {
  messageId: string;
  node: AstNode | CommentNode;
  data?: Record<string, string>;
  fix?: (fixer: Fixer) => Fix | null;
}

export interface RuleContext {
  options: JsonValue[];
  getSourceCode(): SourceCode;
  report(descriptor: ReportDescriptor): void;
  getDeclaredVariables?: (node: AstNode) => Variable[];
  /**
   * When provided by the host, this is the absolute/relative path of the file being linted.
   * Kept optional to avoid coupling tests to a specific runtime.
   */
  filename?: string;
  /** ESLint-compatible filename accessor (optional). */
  getFilename?: () => string;
  /** Optional hooks to keep rule unit tests hermetic (no real FS I/O). */
  fileExists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string | null;
}

export interface PaddingRule {
  blankLine: string;
  prev: string | string[];
  next: string | string[];
}
