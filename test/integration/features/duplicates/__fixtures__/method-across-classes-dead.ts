class AlphaService {
  items: number[] = [];

  compute(x: number): number {
    const doubled = x * 2;
    const shifted = doubled + 7;
    return shifted;
  }

  reset(): void {
    this.items = [];
  }
}

class BetaWorker {
  label = 'beta';

  compute(x: number): number {
    const doubled = x * 2;
    const shifted = doubled + 7;
    return shifted;
  }
}
