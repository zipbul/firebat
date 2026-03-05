// Fixture: return guard — function with guard clauses should get 'has-guard' kind
export function greetUser(name: string | null): string {
  if (!name) {
    return 'Hello stranger';
  }

  return `Hello ${name}`;
}
