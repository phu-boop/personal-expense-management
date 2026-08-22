import ExportJob, { ExportJobStatus } from '../models/ExportJob';

export function buildPendingExportJobQuery() {
  return {
    status: ExportJobStatus.PENDING,
  };
}

export async function getPendingExportJobs(limit = 10) {
  return ExportJob.find(buildPendingExportJobQuery())
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();
}
