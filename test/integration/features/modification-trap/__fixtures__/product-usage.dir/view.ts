import type { Product } from './product-types';

export function renderProduct(product: Product): string {
  return `${product.name} - $${product.price}`;
}
