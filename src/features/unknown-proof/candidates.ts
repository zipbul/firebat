import * as path from 'node:path';

import type { Node } from 'oxc-parser';

import type { ParsedFile } from '../../engine/types';
import type { SourceSpan, UnknownProofFinding } from '../../types';

import { getLineColumn } from '../../engine/source-position';
import { isNodeRecord, walkOxcTree } from '../../engine/oxc-ast-utils';

export const DEFAULT_UNKNOWN_PROOF_BOUNDARY_GLOBS: ReadonlyArray<string> = ['src/adapters/**', 'src/infrastructure/**'];

type BindingCandidate = {
	readonly name: string;
	readonly offset: number;
	readonly span: SourceSpan;
};

type BoundaryUsageKind = 'call' | 'assign' | 'store' | 'return' | 'throw';

type BoundaryUsageCandidate = {
	readonly name: string;
	readonly offset: number;
	readonly span: SourceSpan;
	readonly usageKind: BoundaryUsageKind;
};

export type UnknownProofCandidates = {
	readonly typeAssertionFindings: ReadonlyArray<UnknownProofFinding>;
	readonly nonBoundaryBindings: ReadonlyArray<BindingCandidate>;
	readonly boundaryUnknownUsages: ReadonlyArray<BoundaryUsageCandidate>;
};

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

const toRelPath = (rootAbs: string, fileAbs: string): string => {
	const rel = path.relative(rootAbs, fileAbs);

	return normalizePath(rel);
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const globToRegExp = (pattern: string): RegExp => {
	// Supports: **, *, ?, and path separators '/'.
	// - ** matches any characters including '/'
	// - * matches any characters except '/'
	let out = '^';
	let i = 0;

	while (i < pattern.length) {
		const ch = pattern[i] ?? '';

		if (ch === '*') {
			const next = pattern[i + 1];

			if (next === '*') {
				out += '.*';
				i += 2;

				continue;
			}

			out += '[^/]*';
			i += 1;

			continue;
		}

		if (ch === '?') {
			out += '[^/]';
			i += 1;

			continue;
		}

		out += escapeRegex(ch);
		i += 1;
	}

	out += '$';

	return new RegExp(out);
};

const compileGlobs = (patterns: ReadonlyArray<string>): ReadonlyArray<RegExp> => {
	return patterns
		.map(p => p.trim())
		.filter(p => p.length > 0)
		.map(p => globToRegExp(normalizePath(p)));
};

const isBoundaryFile = (rootAbs: string, fileAbs: string, boundaryGlobs: ReadonlyArray<RegExp>): boolean => {
	const rel = toRelPath(rootAbs, fileAbs);

	if (rel.startsWith('..')) {
		return false;
	}

	return boundaryGlobs.some(re => re.test(rel));
};

const toSpanFromOffsets = (sourceText: string, startOffset: number, endOffset: number): SourceSpan => {
	const start = getLineColumn(sourceText, Math.max(0, startOffset));
	const end = getLineColumn(sourceText, Math.max(0, endOffset));

	return { start, end };
};

const collectStringsFromNode = (node: unknown): string[] => {
	const out: string[] = [];

	const visit = (value: any): void => {
		if (value === null || value === undefined) {
			return;
		}

		if (typeof value === 'string') {
			out.push(value);

			return;
		}

		if (Array.isArray(value)) {
			for (const entry of value) {
				visit(entry);
			}

			return;
		}

		if (typeof value === 'object') {
			for (const v of Object.values(value)) {
				visit(v);
			}
		}
	};

	visit(node);

	return out;
};

const containsTsKeyword = (node: unknown, keywordType: 'TSUnknownKeyword' | 'TSAnyKeyword'): boolean => {
	let found = false;

	walkOxcTree(node as any, (n: Node) => {
		if (n.type === keywordType) {
			found = true;

			return false;
		}

		return true;
	});

	return found;
};

const extractBindingIdentifiers = (pattern: any): ReadonlyArray<any> => {
	if (!pattern || typeof pattern !== 'object') {
		return [];
	}

	if (pattern.type === 'Identifier') {
		return [pattern];
	}

	if (pattern.type === 'AssignmentPattern') {
		return extractBindingIdentifiers((pattern as any).left);
	}

	if (pattern.type === 'RestElement') {
		return extractBindingIdentifiers((pattern as any).argument);
	}

	return [];
};

const collectUnknownAnnotatedBindings = (program: any, sourceText: string): ReadonlyArray<BindingCandidate> => {
	const out: BindingCandidate[] = [];

	const addIfUnknown = (id: any): void => {
		if (!id || typeof id !== 'object' || id.type !== 'Identifier' || typeof id.name !== 'string') {
			return;
		}

		const typeAnn = (id as any).typeAnnotation;

		if (!typeAnn || !containsTsKeyword(typeAnn, 'TSUnknownKeyword')) {
			return;
		}

		const startOffset = typeof id.start === 'number' ? id.start : 0;
		const endOffset = typeof id.end === 'number' ? id.end : startOffset;

		out.push({ name: id.name, offset: startOffset, span: toSpanFromOffsets(sourceText, startOffset, endOffset) });
	};

	walkOxcTree(program as any, (node: Node) => {
		if (!isNodeRecord(node)) {
			return true;
		}

		if (node.type === 'VariableDeclarator') {
			const ids = extractBindingIdentifiers((node as any).id);

			for (const id of ids) {
				addIfUnknown(id);
			}
		}

		if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
			const params = (node as any).params;

			if (Array.isArray(params)) {
				for (const p of params) {
					const ids = extractBindingIdentifiers(p);

					for (const id of ids) {
						addIfUnknown(id);
					}
				}
			}
		}

		return true;
	});

	return out;
};

type WalkStackEntry = { readonly node: any; readonly keyInParent: string | null };

const walkOxcTreeWithStack = (root: unknown, visit: (node: any, stack: ReadonlyArray<WalkStackEntry>) => void): void => {
	const seen = new Set<object>();

	const rec = (value: any, keyInParent: string | null, stack: ReadonlyArray<WalkStackEntry>): void => {
		if (value === null || value === undefined) {
			return;
		}

		if (Array.isArray(value)) {
			for (const entry of value) {
				rec(entry, keyInParent, stack);
			}

			return;
		}

		if (typeof value !== 'object') {
			return;
		}

		if (!isNodeRecord(value)) {
			for (const [k, v] of Object.entries(value)) {
				rec(v, k, stack);
			}

			return;
		}

		if (seen.has(value)) {
			return;
		}

		seen.add(value);

		const nextStack = [...stack, { node: value, keyInParent }];

		visit(value, nextStack);

		for (const [k, v] of Object.entries(value)) {
			rec(v, k, nextStack);
		}
	};

	rec(root as any, null, []);
};

const isInMemberPropertyPosition = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
	const self = stack[stack.length - 1]?.node;
	const parent = stack[stack.length - 2]?.node;

	if (!self || !parent || !isNodeRecord(parent)) {
		return false;
	}

	return parent.type === 'MemberExpression' && (parent as any).property === self;
};

const isInTestPosition = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
	for (let i = 0; i < stack.length - 1; i++) {
		const n = stack[i]?.node;
		const childKey = stack[i + 1]?.keyInParent;

		if (!n || !isNodeRecord(n) || typeof childKey !== 'string') {
			continue;
		}

		if (
			(n.type === 'IfStatement' && childKey === 'test') ||
			(n.type === 'WhileStatement' && childKey === 'test') ||
			(n.type === 'DoWhileStatement' && childKey === 'test') ||
			(n.type === 'ForStatement' && childKey === 'test') ||
			(n.type === 'ConditionalExpression' && childKey === 'test')
		) {
			return true;
		}
	}

	return false;
};

const isInCallArguments = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
	for (let i = stack.length - 2; i >= 0; i--) {
		const n = stack[i]?.node;
		const childKey = stack[i + 1]?.keyInParent;

		if (!n || !isNodeRecord(n) || typeof childKey !== 'string') {
			continue;
		}

		if (n.type === 'CallExpression' && childKey === 'arguments') {
			return true;
		}
	}

	return false;
};

const isInNewArguments = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
	for (let i = stack.length - 2; i >= 0; i--) {
		const n = stack[i]?.node;
		const childKey = stack[i + 1]?.keyInParent;

		if (!n || !isNodeRecord(n) || typeof childKey !== 'string') {
			continue;
		}

		if (n.type === 'NewExpression' && childKey === 'arguments') {
			return true;
		}
	}

	return false;
};

const isInReturnArgument = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
	for (let i = stack.length - 2; i >= 0; i--) {
		const n = stack[i]?.node;
		const childKey = stack[i + 1]?.keyInParent;

		if (!n || !isNodeRecord(n) || typeof childKey !== 'string') {
			continue;
		}

		if (n.type === 'ReturnStatement' && childKey === 'argument') {
			return true;
		}
	}

	return false;
};

const isInThrowArgument = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
	for (let i = stack.length - 2; i >= 0; i--) {
		const n = stack[i]?.node;
		const childKey = stack[i + 1]?.keyInParent;

		if (!n || !isNodeRecord(n) || typeof childKey !== 'string') {
			continue;
		}

		if (n.type === 'ThrowStatement' && childKey === 'argument') {
			return true;
		}
	}

	return false;
};

const isInForwardingAssignment = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
	for (let i = stack.length - 2; i >= 0; i--) {
		const n = stack[i]?.node;
		const childKey = stack[i + 1]?.keyInParent;

		if (!n || !isNodeRecord(n) || typeof childKey !== 'string') {
			continue;
		}

		if (n.type === 'VariableDeclarator' && childKey === 'init') {
			return true;
		}

		if (n.type === 'AssignmentExpression' && childKey === 'right') {
			return true;
		}
	}

	return false;
};

const isInPropertyValue = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
	for (let i = stack.length - 2; i >= 0; i--) {
		const n = stack[i]?.node;
		const childKey = stack[i + 1]?.keyInParent;

		if (!n || !isNodeRecord(n) || typeof childKey !== 'string') {
			continue;
		}

		if (n.type === 'Property' && childKey === 'value') {
			return true;
		}
	}

	return false;
};

const isInArrayElement = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
	for (let i = stack.length - 2; i >= 0; i--) {
		const n = stack[i]?.node;
		const childKey = stack[i + 1]?.keyInParent;

		if (!n || !isNodeRecord(n) || typeof childKey !== 'string') {
			continue;
		}

		if (n.type === 'ArrayExpression' && childKey === 'elements') {
			return true;
		}
	}

	return false;
};

const isAllowedNarrowingContext = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
	const self = stack[stack.length - 1]?.node;
	const parent = stack[stack.length - 2]?.node;

	if (!self || !parent || !isNodeRecord(parent)) {
		return false;
	}

	if (parent.type === 'UnaryExpression' && (parent as any).operator === 'typeof') {
		return true;
	}

	if (parent.type === 'BinaryExpression') {
		const op = (parent as any).operator;

		if (op === 'instanceof' && (parent as any).left === self) {
			return true;
		}

		if (op === 'in' && (parent as any).right === self) {
			return true;
		}

		if (op === '===' || op === '!==' || op === '==' || op === '!=') {
			const left = (parent as any).left;
			const right = (parent as any).right;
			const other = left === self ? right : right === self ? left : null;

			if (
				other &&
				isNodeRecord(other) &&
				((other.type === 'Literal' && (other as any).value === null) ||
					(other.type === 'Identifier' && (other as any).name === 'undefined'))
			) {
				return true;
			}
		}
	}

	// Allow calling guard functions in conditional test positions (e.g., Array.isArray(x), isFoo(x)).
		if (isInTestPosition(stack) && (isInCallArguments(stack) || isInNewArguments(stack))) {
		return true;
	}

	return false;
};

const collectBoundaryUnknownUsages = (input: {
	program: any;
	sourceText: string;
	unknownBindings: ReadonlyArray<BindingCandidate>;
}): ReadonlyArray<BoundaryUsageCandidate> => {
	const declaredOffsets = new Set<number>(input.unknownBindings.map(b => b.offset));
	const unknownNames = new Set<string>(input.unknownBindings.map(b => b.name));
	const out: BoundaryUsageCandidate[] = [];

	if (unknownNames.size === 0) {
		return out;
	}

	walkOxcTreeWithStack(input.program, (node, stack) => {
		if (!isNodeRecord(node) || node.type !== 'Identifier') {
			return;
		}

		const name = typeof (node as any).name === 'string' ? (node as any).name : '';

		if (name.length === 0 || !unknownNames.has(name)) {
			return;
		}

		const startOffset = typeof (node as any).start === 'number' ? (node as any).start : 0;
		const endOffset = typeof (node as any).end === 'number' ? (node as any).end : startOffset;

		// Skip the declaration identifier itself.
		if (declaredOffsets.has(startOffset)) {
			return;
		}

		// Skip property name in member access: obj.prop (the `prop` identifier).
		if (isInMemberPropertyPosition(stack)) {
			return;
		}

		// Allow explicit narrowing contexts.
		if (isAllowedNarrowingContext(stack)) {
			return;
		}

		let usageKind: BoundaryUsageKind | null = null;

		if (isInReturnArgument(stack)) {
			usageKind = 'return';
		} else if (isInThrowArgument(stack)) {
			usageKind = 'throw';
		} else if (isInCallArguments(stack) || isInNewArguments(stack)) {
			usageKind = 'call';
		} else if (isInForwardingAssignment(stack)) {
			usageKind = 'assign';
		} else if (isInPropertyValue(stack) || isInArrayElement(stack)) {
			usageKind = 'store';
		}

		if (usageKind === null) {
			return;
		}

		out.push({
			name,
			offset: startOffset,
			span: toSpanFromOffsets(input.sourceText, startOffset, endOffset),
			usageKind,
		});
	});

	return out;
};

export const collectUnknownProofCandidates = (input: {
	program: ReadonlyArray<ParsedFile>;
	rootAbs: string;
	boundaryGlobs?: ReadonlyArray<string>;
}): {
	readonly boundaryGlobs: ReadonlyArray<string>;
	readonly perFile: ReadonlyMap<string, UnknownProofCandidates>;
} => {
	const boundaryGlobs = (input.boundaryGlobs ?? [])
		.map(p => normalizePath(p).trim())
		.filter(p => p.length > 0);
	const boundaryMatchers = compileGlobs(boundaryGlobs);
	const perFile = new Map<string, UnknownProofCandidates>();

	for (const file of input.program) {
		const filePath = file.filePath;
		const boundary = boundaryGlobs.length > 0
			? isBoundaryFile(input.rootAbs, filePath, boundaryMatchers)
			: false;
		const typeAssertionFindings: UnknownProofFinding[] = [];
		const nonBoundaryBindings: BindingCandidate[] = [];
		const boundaryUnknownUsages: BoundaryUsageCandidate[] = [];

		const pushTypeAssertion = (node: any, message: string): void => {
			const startOffset = typeof node.start === 'number' ? node.start : 0;
			const endOffset = typeof node.end === 'number' ? node.end : startOffset;
			const span = toSpanFromOffsets(file.sourceText, startOffset, endOffset);

			typeAssertionFindings.push({
				kind: 'type-assertion',
				message,
				filePath,
				span,
			});
		};

		walkOxcTree(file.program as any, (node: Node) => {
			// Ban type assertions everywhere.
			if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion') {
				pushTypeAssertion(node as any, 'Type assertions are forbidden (no `as T` / `<T>expr`)');

				return true;
			}

			if (!isNodeRecord(node)) {
				return true;
			}

			// Collect binding identifiers for tsgo proof checks.
			if (!boundary) {
				if (node.type === 'VariableDeclarator') {
					const ids = extractBindingIdentifiers((node as any).id);

					for (const id of ids) {
						const name = typeof id?.name === 'string' ? id.name : '';

						if (name.length === 0) {
							continue;
						}

						const startOffset = typeof id.start === 'number' ? id.start : (typeof node.start === 'number' ? node.start : 0);
						const endOffset = typeof id.end === 'number' ? id.end : startOffset;

						nonBoundaryBindings.push({ name, offset: startOffset, span: toSpanFromOffsets(file.sourceText, startOffset, endOffset) });
					}
				}

				if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
					const params = (node as any).params;

					if (Array.isArray(params)) {
						for (const p of params) {
							const ids = extractBindingIdentifiers(p);

							for (const id of ids) {
								const name = typeof id?.name === 'string' ? id.name : '';

								if (name.length === 0) {
									continue;
								}

								const startOffset = typeof id.start === 'number' ? id.start : (typeof node.start === 'number' ? node.start : 0);
								const endOffset = typeof id.end === 'number' ? id.end : startOffset;

								nonBoundaryBindings.push({ name, offset: startOffset, span: toSpanFromOffsets(file.sourceText, startOffset, endOffset) });
							}
						}
					}
				}
			}

			// unknown type annotations
			if (node.type === 'Identifier') {
				const id = node as any;
				const name = typeof id.name === 'string' ? id.name : '';
				const typeAnn = id.typeAnnotation;

				if (!typeAnn || name.length === 0) {
					return true;
				}

				const hasUnknown = containsTsKeyword(typeAnn, 'TSUnknownKeyword');

				if (!hasUnknown) {
					return true;
				}

				const startOffset = typeof id.start === 'number' ? id.start : 0;
				const endOffset = typeof id.end === 'number' ? id.end : startOffset;
				const span = toSpanFromOffsets(file.sourceText, startOffset, endOffset);

				if (!boundary) {
					typeAssertionFindings.push({
						kind: 'unknown-type',
						message: 'Explicit `unknown` type is forbidden outside boundary files',
						filePath,
						span,
						symbol: name,
					});
				}
			}

			return true;
		});

		if (boundary) {
			const unknownBindings = collectUnknownAnnotatedBindings(file.program, file.sourceText);

			boundaryUnknownUsages.push(
				...collectBoundaryUnknownUsages({
					program: file.program,
					sourceText: file.sourceText,
					unknownBindings,
				}),
			);
		}

		// De-dupe bindings by offset.
		const seenOffsets = new Set<number>();

		const dedupBindings = (items: ReadonlyArray<BindingCandidate>): BindingCandidate[] => {
			const out: BindingCandidate[] = [];

			for (const item of items) {
				if (seenOffsets.has(item.offset)) {
					continue;
				}

				seenOffsets.add(item.offset);
				out.push(item);
			}

			return out;
		};

		perFile.set(filePath, {
			typeAssertionFindings,
			nonBoundaryBindings: dedupBindings(nonBoundaryBindings),
			boundaryUnknownUsages,
		});
	}

	return { boundaryGlobs, perFile };
};

export const stringifyHover = (hover: unknown): string => {
	if (!hover || typeof hover !== 'object') {
		return '';
	}

	const contents = (hover as any).contents;
	const raw = contents !== undefined ? contents : hover;

	const extract = (value: any): string[] => {
		if (value === null || value === undefined) {
			return [];
		}

		if (typeof value === 'string') {
			return [value];
		}

		if (Array.isArray(value)) {
			return value.flatMap(v => extract(v));
		}

		if (typeof value === 'object') {
			// MarkupContent: { kind: 'plaintext'|'markdown', value: string }
			if (typeof (value as any).value === 'string') {
				return [(value as any).value];
			}

			// MarkedString: { language: string, value: string }
			if (typeof (value as any).language === 'string' && typeof (value as any).value === 'string') {
				return [(value as any).value];
			}
		}

		return [];
	};

	// LSP Hover.contents can be (string | MarkupContent | MarkedString | (string|MarkedString)[])
	const parts = extract(raw);

	if (parts.length > 0) {
		return parts.join('\n');
	}

	// Fallback for odd server shapes.
	return collectStringsFromNode(raw).join('\n');
};
