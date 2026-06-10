function summarizeOrders(values: number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  const tax = total * 0.1;
  const fee = total > 100 ? 5 : 10;
  const grand = total + tax + fee;
  const rounded = Math.round(grand);
  return rounded;
}
