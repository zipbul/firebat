import { Guards, seed } from './guards';

const boot = (): boolean => seed && Guards.isString('y');

boot();
