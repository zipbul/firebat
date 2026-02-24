// bounds-check: bounds-throw pattern + always/never comment keyword

export function validateItems(items: string[]): void {
  // must always provide at least one item
  if (items.length === 0) throw new Error('items must not be empty');

  for (const item of items) {
    console.log(item);
  }
}
