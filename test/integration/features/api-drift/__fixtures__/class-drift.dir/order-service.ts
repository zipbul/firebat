// class-drift: class methods with different shapes across files

export class OrderService {
  async create(name: string, quantity: number): Promise<void> {
    console.log(name, quantity);
  }

  process(id: string): boolean {
    return id.length > 0;
  }
}
