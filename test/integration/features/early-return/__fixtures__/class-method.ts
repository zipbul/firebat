// Fixture: class method guard detection
export class Processor {
  process(input: string | null): string {
    if (!input) {
      return 'empty';
    }

    const trimmed = input.trim();
    return trimmed.toUpperCase();
  }
}
