import type { Product } from './product-types';

export function validateProduct(product: Product): boolean {
  return product.price > 0;
}
