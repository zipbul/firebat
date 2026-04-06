import type { FirebatReport } from './types';

import { toJsonReport } from './types';

const formatReport = (report: FirebatReport): string => {
  return JSON.stringify(toJsonReport(report));
};

export { formatReport };
