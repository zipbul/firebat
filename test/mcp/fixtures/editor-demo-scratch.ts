// Demo function below

// verified insert_before
function demo(x: number): number {
  return x + 10;
}

const LABEL = 'verified';

class Helper {
  run(): string {
    return 'ok';
  }
}

const _Helper = Helper;

export { LABEL, demo };
