import type { FirebatReport } from './types';

import { toJsonReport, toScanResult } from './types';

const formatReport = (report: FirebatReport): string => {
  return JSON.stringify(toScanResult(report, report.findings));
};

/** @deprecated Use formatReport (new flat format). Kept for backward compat during migration. */
const formatLegacyReport = (report: FirebatReport): string => {
  return JSON.stringify(toJsonReport(report));
};

export { formatReport, formatLegacyReport };
