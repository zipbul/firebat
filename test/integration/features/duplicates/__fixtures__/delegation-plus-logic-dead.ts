class UserGateway {
  svc: UserStore;

  find(id: string) {
    const key = id.trim();
    return this.svc.find(key);
  }

  mark(): string {
    return 'user';
  }
}

class OrderGateway {
  svc: OrderStore;

  find(id: string) {
    const key = id.trim();
    return this.svc.find(key);
  }
}
