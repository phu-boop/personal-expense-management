import { randomUUID } from 'node:crypto';

export enum ExportJobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

export type ExportFormat = 'xlsx' | 'pdf';

export interface ExportJobFilters {
  walletId?: string;
  startDate: string;
  endDate: string;
  format?: ExportFormat;
}

export interface ExportJobRecord {
  id: string;
  tenantId: string;
  userId: string;
  format: ExportFormat;
  filters: ExportJobFilters;
  status: ExportJobStatus;
  fileKey?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
  expiresAt: Date;
}

export const DEFAULT_EXPORT_TTL_MS = 1000 * 60 * 60 * 24;

export function normalizeExportFormat(format?: string): ExportFormat {
  return format === 'pdf' ? 'pdf' : 'xlsx';
}

export function createExportJob(tenantId: string, userId: string, filters: ExportJobFilters): ExportJobRecord {
  const createdAt = new Date();
  return {
    id: randomUUID(),
    tenantId,
    userId,
    format: normalizeExportFormat(filters.format),
    filters: {
      walletId: filters.walletId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      format: normalizeExportFormat(filters.format),
    },
    status: ExportJobStatus.PENDING,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + DEFAULT_EXPORT_TTL_MS),
  };
}

export function buildExportTransactionFilter(
  tenantId: string,
  userId: string,
  filters: Pick<ExportJobFilters, 'walletId' | 'startDate' | 'endDate'>,
) {
  const filter: Record<string, unknown> = {
    tenantId,
    userId,
    date: {
      $gte: new Date(filters.startDate),
      $lte: new Date(filters.endDate),
    },
  };

  if (filters.walletId) {
    filter.walletId = filters.walletId;
  }

  return filter;
}

export function isExpiredExportJob(job: ExportJobRecord, currentDate = new Date()) {
  return currentDate.getTime() > job.expiresAt.getTime();
}

export function buildExportFilename(job: ExportJobRecord) {
  const baseName = `statement_${job.filters.startDate}_to_${job.filters.endDate}`;
  return `${baseName}.${job.format}`;
}
