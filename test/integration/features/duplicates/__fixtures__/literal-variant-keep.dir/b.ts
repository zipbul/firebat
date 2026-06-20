function applyDiscount(price: number, rate: number): number {
  const discounted = price - price * rate;
  if (discounted < 8) {
    return 8;
  }
  return discounted;
}
