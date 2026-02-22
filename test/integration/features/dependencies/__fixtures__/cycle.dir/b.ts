import { getA } from './a';

export const getB = () => `b:${getA()}`;
