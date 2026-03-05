// Fixture: explicit `as any` cast — should produce any-cast finding
export const data = { name: 'test' };
export const unsafe = data as any;
