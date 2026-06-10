function secondsToDays(total: number): number {
  return total / 86400;
}

function clampWindow(size: number): number {
  if (size > 86400) {
    return 86400;
  }
  return size;
}
