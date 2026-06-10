const toPositiveDoubles = (xs: number[]): number[] => xs.filter(x => x > 0).map(x => x * 2);
