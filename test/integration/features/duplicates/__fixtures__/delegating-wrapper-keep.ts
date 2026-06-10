class UserRepoFacade {
  svc: UserStore;

  find(id: string) {
    return this.svc.find(id);
  }

  label(): string {
    return 'user';
  }
}

class OrderRepoFacade {
  svc: OrderStore;

  find(id: string) {
    return this.svc.find(id);
  }
}
