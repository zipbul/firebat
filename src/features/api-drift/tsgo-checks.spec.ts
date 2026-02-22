import { describe, expect, it } from 'bun:test';

// tsgo-checks.ts exports interfaces (ApiDriftInterfaceToken, ApiDriftInterfaceMethodCandidate)
// and runTsgoApiDriftChecks (requires live tsgo binary — tested as smoke test only).

import type { ApiDriftInterfaceMethodCandidate, ApiDriftInterfaceToken } from './tsgo-checks';

describe('features/api-drift/tsgo-checks — ApiDriftInterfaceToken shape', () => {
  it('satisfies interface with name and span', () => {
    const token: ApiDriftInterfaceToken = {
      name: 'IService',
      span: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
    };
    expect(token.name).toBe('IService');
    expect(token.span.start.line).toBe(1);
    expect(token.span.end.column).toBe(10);
  });
});

describe('features/api-drift/tsgo-checks — ApiDriftInterfaceMethodCandidate shape', () => {
  it('satisfies interface with all required fields', () => {
    const candidate: ApiDriftInterfaceMethodCandidate = {
      interfaceToken: {
        name: 'IRepo',
        span: { start: { line: 3, column: 0 }, end: { line: 3, column: 5 } },
      },
      methodName: 'findAll',
      shape: {
        paramsCount: 2,
        optionalCount: 0,
        returnKind: 'value',
        async: false,
      },
      filePath: '/src/repo.ts',
      span: { start: { line: 5, column: 2 }, end: { line: 5, column: 20 } },
    };
    expect(candidate.methodName).toBe('findAll');
    expect(candidate.shape.paramsCount).toBe(2);
    expect(candidate.filePath).toBe('/src/repo.ts');
    expect(candidate.interfaceToken.name).toBe('IRepo');
  });

  it('different instances are distinct', () => {
    const makeCandidate = (method: string): ApiDriftInterfaceMethodCandidate => ({
      interfaceToken: { name: 'IFoo', span: { start: { line: 1, column: 0 }, end: { line: 1, column: 4 } } },
      methodName: method,
      shape: { paramsCount: 0, optionalCount: 0, returnKind: 'void', async: false },
      filePath: '/foo.ts',
      span: { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } },
    });
    const c1 = makeCandidate('doA');
    const c2 = makeCandidate('doB');
    expect(c1.methodName).not.toBe(c2.methodName);
  });
});
