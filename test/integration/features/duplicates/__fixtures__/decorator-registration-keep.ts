class UsersController {
  svc: UsersService;

  @Route(':id')
  findOne(id: string) {
    return this.svc.findOne(id);
  }

  extra(): string {
    return 'users';
  }
}

class OrdersController {
  svc: OrdersService;

  @Route(':id')
  findOne(id: string) {
    return this.svc.findOne(id);
  }
}
