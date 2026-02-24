export class UserService {
  create(name: string): void {
    console.log(name);
  }

  async process(id: string, force?: boolean): Promise<string> {
    return force ? id : '';
  }
}
