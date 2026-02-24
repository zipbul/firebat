// invertible-if-else: short branch ends with return, long branch is 2x+ longer
// Also: loop continue guard

export function invertibleIfElse(value: string | null): string {
  if (value === null) {
    return 'default';
  } else {
    const trimmed = value.trim();
    const upper = trimmed.toUpperCase();
    const result = upper.replace(/\s+/g, '-');
    console.log(result);
    return result;
  }
}

export function loopContinueGuard(items: Array<{ active: boolean; name: string }>): string[] {
  const result: string[] = [];

  for (const item of items) {
    if (!item.active) {
      continue;
    }

    const processed = item.name.trim().toUpperCase();
    result.push(processed);
  }

  return result;
}
