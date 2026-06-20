function applyDiscount(price: number, rate: number): number {
  const discounted = price - price * rate;
  if (discounted < 0) {
    return 0;
  }
  return discounted;
}
