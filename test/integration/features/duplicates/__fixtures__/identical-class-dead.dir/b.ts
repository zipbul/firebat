class PriceEngine {
  base: number = 100;

  compute(x: number): number {
    const doubled = x * 2;
    const tripled = doubled + x;
    return tripled;
  }

  describe(): string {
    return 'engine';
  }
}
