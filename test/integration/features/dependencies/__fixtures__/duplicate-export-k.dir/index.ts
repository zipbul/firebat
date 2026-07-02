import { helper as ha } from './a';
import { helper as hb } from './b';

const boot = (): string[] => [ha(), hb()];

boot();
