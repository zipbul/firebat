function normalizePrice(price: number, rate: number): number {
  const discounted = price - price * rate;
  const rounded = Math.round(discounted);
  return rounded;
}
