let sessionToken = '';
let sessionExpiry = 0;

export function startSession(token: string, expiresAt: number): void {
  sessionToken = token;
  sessionExpiry = expiresAt;
}

export function isSessionValid(): boolean {
  return sessionToken !== '' && Date.now() < sessionExpiry;
}
