// accidental-quadratic: same-target nested iteration + high cognitive complexity

export function findDuplicates(items: string[]): string[] {
  const result: string[] = [];

  for (const a of items) {
    for (const b of items) {
      if (a === b) {
        if (!result.includes(a)) {
          if (a.length > 0) {
            if (a !== 'skip') {
              result.push(a);
            }
          }
        }
      }
    }
  }

  return result;
}

export function nestedFilterSameTarget(data: number[]): number[] {
  return data.filter((x) => {
    return data.some((y) => y > x);
  });
}
