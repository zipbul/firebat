import { FORMAT_VERSION, MAX_RETRIES } from './shared';

export const getConfig = () => ({ version: FORMAT_VERSION, retries: MAX_RETRIES });
