import { reached } from './reached';

export const orphaned = (): number => reached() + 99;
