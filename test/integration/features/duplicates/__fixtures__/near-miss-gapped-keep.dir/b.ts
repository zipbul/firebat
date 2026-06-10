function summarizeOrders(values: number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  console.log(total);
  const tax = total * 0.1;
  const fee = total > 100 ? 5 : 10;
  const grand = total + tax + fee;
  console.log(grand);
  const rounded = Math.round(grand);
  return rounded;
}
