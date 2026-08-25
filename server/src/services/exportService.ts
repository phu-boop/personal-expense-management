import fs from 'fs/promises';
import path from 'path';
import PDFDocument from 'pdfkit';
import { ExportJobModel } from '../models/ExportJob.js';
import { walletRepository } from '../repositories/walletRepository.js';
import { transactionRepository } from '../repositories/transactionRepository.js';
import { formatDateLabel, parseDateInput } from '../utils/date.js';

const EXPORT_BASE_DIR = path.resolve(process.cwd(), 'storage', 'exports');
const PDF_FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const PDF_FONT_BOLD_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const formatCurrency = (value: number, withSign = false) => {
  const safeValue = Number.isFinite(value) ? value : 0;
  const formatted = Math.abs(safeValue).toLocaleString('vi-VN');
  if (withSign) {
    return `${safeValue >= 0 ? '+' : '-'}${formatted} VND`;
  }
  return `${formatted} VND`;
};

const buildPdfDocument = (title: string, dateRange: string, summary: any, transactions: any[]) => {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 20, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('DejaVuSans', PDF_FONT_PATH);
    doc.registerFont('DejaVuSans-Bold', PDF_FONT_BOLD_PATH);

    doc.font('DejaVuSans-Bold').fontSize(18).text(title, 50, 30, { align: 'center', width: 500 });
    doc.font('DejaVuSans').fontSize(11).fillColor('#333').text(`Ngày: ${dateRange}`, 50, 70, { align: 'left' });

    let y = 110;
    const summaryRows = [
      ['Opening Balance', formatCurrency(summary.openingBalance)],
      ['Total Income', formatCurrency(summary.totalIncome, true)],
      ['Total Expense', formatCurrency(-summary.totalExpense, true)],
      ['Closing Balance', formatCurrency(summary.closingBalance)],
    ];

    summaryRows.forEach(([label, value]) => {
      doc.font('DejaVuSans-Bold').fontSize(11).text(label, 50, y, { width: 180, align: 'left' });
      doc.font('DejaVuSans').fontSize(11).text(value, 250, y, { width: 280, align: 'left' });
      y += 22;
    });

    if (transactions.length > 0) {
      y += 12;
      doc.font('DejaVuSans-Bold').fontSize(12).text('Transactions', 50, y, { align: 'left' });
      y += 18;

      transactions.forEach((tx) => {
        const date = new Date(tx.date).toLocaleDateString('vi-VN');
        const type = tx.type === 'INCOME' ? 'Thu' : 'Chi';
        const amount = tx.type === 'INCOME' ? `+${formatCurrency(tx.amount)}` : `-${formatCurrency(tx.amount)}`;
        const line = `${date} | ${type} | ${tx.category} | ${amount} | ${tx.note || 'Không có ghi chú'}`;
        doc.font('DejaVuSans').fontSize(9).text(line, 50, y, { width: 500, align: 'left' });
        y += 16;

        if (y > 760) {
          doc.addPage();
          y = 50;
        }
      });
    }

    doc.end();
  });
};

export const exportService = {
  async createJob(userId: string, input: { walletId?: string; fromDate?: string; toDate?: string; format?: 'PDF' | 'EXCEL' }) {
    const format = input.format === 'PDF' ? 'PDF' : 'EXCEL';

    const job = await ExportJobModel.create({
      userId,
      walletId: input.walletId || undefined,
      fromDate: input.fromDate ? new Date(input.fromDate) : undefined,
      toDate: input.toDate ? new Date(input.toDate) : undefined,
      type: format,
      status: 'PENDING',
      fileUrl: '',
    });

    setTimeout(() => {
      exportService.processJob(String(job._id)).catch((error) => {
        console.error('Export job failed:', error);
      });
    }, 300);

    return job;
  },

  async processJob(jobId: string) {
    const job = await ExportJobModel.findById(jobId);
    if (!job) {
      return null;
    }

    job.status = 'RUNNING';
    await job.save();

    try {
      const filePath = await this.generateFile(job);
      job.status = 'DONE';
      job.fileUrl = filePath;
      await job.save();
      return job;
    } catch (error: any) {
      job.status = 'FAILED';
      job.fileUrl = '';
      await job.save();
      throw error;
    }
  },

  async generateFile(job: any) {
    const walletId = job.walletId ? String(job.walletId) : undefined;
    const fromDate = job.fromDate ? parseDateInput(String(job.fromDate), false) : undefined;
    const toDate = job.toDate ? parseDateInput(String(job.toDate), true) : undefined;

    const wallet = walletId ? await walletRepository.findByIdForUser(String(job.userId), walletId) : null;
    const allWallets = await walletRepository.listByUser(String(job.userId));
    const transactions = await transactionRepository.listByUser(String(job.userId), {
      walletId,
      from: fromDate,
      to: toDate,
    });

    const sorted = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const selectedWallets = walletId ? (wallet ? [wallet] : []) : allWallets;

    const openingBalance = selectedWallets.reduce((sum, item) => sum + Number(item.openingBalance || 0), 0);
    const totalIncome = sorted
      .filter((tx) => tx.type === 'INCOME')
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const totalExpense = sorted
      .filter((tx) => tx.type === 'EXPENSE')
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const closingBalance = openingBalance + totalIncome - totalExpense;

    await fs.mkdir(EXPORT_BASE_DIR, { recursive: true });

    const extension = job.type === 'PDF' ? 'pdf' : 'csv';
    const fileName = `${String(job._id)}.${extension}`;
    const filePath = path.join(EXPORT_BASE_DIR, fileName);

    if (job.type === 'EXCEL') {
      const dateRangeText = `${formatDateLabel(fromDate) || 'Tất cả'} - ${formatDateLabel(toDate) || 'Hiện tại'}`;
      const summaryRows = [
        ['Date', `"${dateRangeText}"`],
        ['Opening Balance', `${formatCurrency(openingBalance)}`],
        ['Total Income', `${formatCurrency(totalIncome, true)}`],
        ['Total Expense', `${formatCurrency(-totalExpense, true)}`],
        ['Closing Balance', `${formatCurrency(closingBalance)}`],
        [],
        ['walletName', 'walletId', 'type', 'category', 'amount', 'date', 'note', 'balanceAfter'],
      ];

      const rows = [
        ...summaryRows,
        ...sorted.map((tx) => [
          wallet?.name || '',
          String(tx.walletId),
          tx.type,
          tx.category,
          String(tx.amount),
          new Date(tx.date).toISOString(),
          tx.note || '',
          String(tx.balanceAfter || 0),
        ]),
      ];

      const csv = rows
        .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');

      await fs.writeFile(filePath, csv, 'utf8');
      return filePath;
    }

    const summary = {
      openingBalance,
      totalIncome,
      totalExpense,
      closingBalance,
    };

    const dateRange = `${formatDateLabel(fromDate) || 'Tất cả'} - ${formatDateLabel(toDate) || 'Hiện tại'}`;
    const pdfBuffer = await buildPdfDocument('Báo cáo thu chi', dateRange, summary, sorted);
    await fs.writeFile(filePath, pdfBuffer);
    return filePath;
  },
};
