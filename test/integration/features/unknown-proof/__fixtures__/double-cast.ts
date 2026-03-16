// Fixture: double assertion (as unknown as T) — should produce double-cast finding
interface User {
  name: string;
}

export const raw = '{"name":"test"}';
export const user = raw as unknown as User;
