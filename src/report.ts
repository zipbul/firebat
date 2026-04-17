import type { FirebatReport } from './types';

import { toScanResult } from './types';

const formatReport = (report: FirebatReport): string => {
  return JSON.stringify(toScanResult(report));
};

export { formatReport };
