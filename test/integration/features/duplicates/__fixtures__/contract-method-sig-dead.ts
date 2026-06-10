interface Service {
  run(x: number): void;
  get(id: string): number;
}

type ServiceShape = {
  run(x: number): void;
  get(id: string): number;
};
