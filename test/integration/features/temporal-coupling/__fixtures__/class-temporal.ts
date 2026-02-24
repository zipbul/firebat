// class-temporal: class state property with writer/reader method split

export class SessionManager {
  private currentUser: string | null = null;
  private lastAccess: number = 0;

  login(user: string): void {
    this.currentUser = user;
    this.lastAccess = Date.now();
  }

  getUser(): string | null {
    return this.currentUser;
  }

  isActive(): boolean {
    return this.lastAccess > 0;
  }
}
