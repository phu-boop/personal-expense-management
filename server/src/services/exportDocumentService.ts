import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';

export interface StatementRow {
  date: string;
  category: string;
  note?: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  balanceAfter: number;
}

export interface StatementSummary {
  openingBalance: number;
  totalIncome: number;
  totalExpense: number;
  closingBalance: number;
}

export interface StatementReportDateRange {
  startDate: string;
  endDate: string;
}

const findFontPath = (candidates: string[]) => candidates.find((candidate) => fs.existsSync(candidate));

export function resolvePdfFonts() {
  const regular = findFontPath([
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansVietnamese-Regular.ttf',
  ]);
  const bold = findFontPath([
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansVietnamese-Bold.ttf',
  ]);

  return { regular, bold };
}

export async function createStatementPdfBuffer(
  rows: StatementRow[],
  summary?: StatementSummary,
  reportRange?: StatementReportDateRange,
): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 36,
      size: 'A4',
      bufferPages: true,
    });
    const chunks: Buffer[] = [];

    const { regular: regularFont, bold: boldFont } = resolvePdfFonts();

    if (regularFont) {
      doc.registerFont('Regular', regularFont);
    }
    if (boldFont) {
      doc.registerFont('Bold', boldFont);
    }

    doc.on('data', (chunk: Buffer | string | Uint8Array) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const regularFace = regularFont ? 'Regular' : 'Helvetica';
    const boldFace = boldFont ? 'Bold' : 'Helvetica-Bold';

    const startX = doc.page.margins.left;
    const columnWidths = [58, 82, 128, 70, 88, 96];
    const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);
    const yStart = 120;

    const truncateText = (value: string, maxLength: number) => {
      if (value.length <= maxLength) return value;
      return `${value.slice(0, maxLength - 1)}…`;
    };

    const drawTableBorder = (topY: number, height: number) => {
      doc
        .strokeColor('#E5E7EB')
        .lineWidth(0.5)
        .moveTo(startX, topY)
        .lineTo(startX + tableWidth, topY)
        .moveTo(startX, topY + height)
        .lineTo(startX + tableWidth, topY + height)
        .stroke();

      let x = startX;
      for (let i = 0; i < columnWidths.length; i += 1) {
        x += columnWidths[i];
        doc.moveTo(x, topY).lineTo(x, topY + height).stroke();
      }
    };

    const drawCellText = (value: string, x: number, y: number, width: number, color: string) => {
      doc.fillColor(color).text(value, x + 4, y + 3, {
        width: width - 8,
        height: 12,
        align: 'left',
        ellipsis: true,
        lineGap: 0,
      });
    };

    doc.info.Title = 'Báo cáo giao dịch';
    doc.fillColor('#1f8a4c').font(boldFace).fontSize(20).text('Báo cáo giao dịch', { align: 'center' });

    if (reportRange) {
      const reportText = `Từ ${reportRange.startDate} đến ${reportRange.endDate}`;
      doc.fillColor('#475569').font(regularFace).fontSize(9).text(reportText, { align: 'center' });
    }

    doc.fillColor('#475569').font(regularFace).fontSize(9).text(`Tổng số giao dịch: ${rows.length}`, { align: 'center' });

    let summaryTopY = doc.y + 8;
    let summaryBottomY = summaryTopY;

    if (summary) {
      const summaryRows = [
        ['Opening Balance', `${summary.openingBalance.toLocaleString('vi-VN')} ₫`],
        ['Total Income', `${summary.totalIncome.toLocaleString('vi-VN')} ₫`],
        ['Total Expense', `${summary.totalExpense.toLocaleString('vi-VN')} ₫`],
        ['Closing Balance', `${summary.closingBalance.toLocaleString('vi-VN')} ₫`],
      ];

      const summaryWidth = 220;
      let summaryX = 40;
      let summaryY = summaryTopY;

      summaryRows.forEach(([label, value], index) => {
        doc.fillColor(index % 2 === 0 ? '#F8FAFC' : '#F3F4F6').rect(summaryX, summaryY, summaryWidth, 18).fill();
        doc.fillColor('#111827').font(boldFace).fontSize(8).text(label, summaryX + 8, summaryY + 5, { width: 110, align: 'left' });
        doc.fillColor('#111827').font(regularFace).fontSize(8).text(value, summaryX + 122, summaryY + 5, { width: 90, align: 'right' });
        summaryY += 18;
      });

      summaryBottomY = summaryY;
    }

    const currentY = Math.max(yStart, summaryBottomY + 18);
    const headerRow = ['Ngày', 'Danh mục', 'Ghi chú', 'Loại', 'Số tiền', 'Số dư'];

    doc.fillColor('#F3F4F6').font(boldFace).fontSize(8.5);
    let x = startX;
    headerRow.forEach((label, index) => {
      const cellWidth = columnWidths[index];
      doc.rect(x, currentY, cellWidth, 20).fill();
      doc.fillColor('#111827').text(label, x + 6, currentY + 6, { width: cellWidth - 12, height: 12, align: 'left' });
      doc.fillColor('#F3F4F6');
      x += cellWidth;
    });

    doc.fillColor('#111827');
    drawTableBorder(currentY, 20);
    let tableY = currentY + 20;

    rows.forEach((row) => {
      if (tableY > 730) {
        doc.addPage();
        tableY = 60;
      }

      const amountLabel = `${row.amount.toLocaleString('vi-VN')} ₫`;
      const balanceLabel = `${row.balanceAfter.toLocaleString('vi-VN')} ₫`;
      const typeLabel = row.type === 'INCOME' ? 'Thu nhập' : 'Chi tiêu';
      const noteText = row.note && row.note.trim() ? row.note : '—';
      const values = [
        row.date,
        truncateText(row.category, 18),
        truncateText(noteText, 24),
        typeLabel,
        amountLabel,
        balanceLabel,
      ];

      x = startX;
      doc.font(regularFace).fontSize(7.8);
      values.forEach((value, index) => {
        const cellWidth = columnWidths[index];
        const textColor = index === 4 && row.type === 'INCOME' ? '#166534' : index === 4 && row.type === 'EXPENSE' ? '#B91C1C' : '#111827';
        drawCellText(value, x, tableY, cellWidth, textColor);
        x += cellWidth;
      });

      drawTableBorder(tableY, 16);
      tableY += 16;
    });

    doc.end();
  });
}

export function createStatementXlsxBuffer(
  rows: StatementRow[],
  summary?: StatementSummary,
  reportRange?: StatementReportDateRange,
): Buffer {
  const summaryRows = summary ? [
    ['Opening Balance', summary.openingBalance],
    ['Total Income', summary.totalIncome],
    ['Total Expense', summary.totalExpense],
    ['Closing Balance', summary.closingBalance],
  ] : [];

  const outputRows: (string | number)[][] = [];

  if (reportRange) {
    outputRows.push(['Report Date', `${reportRange.startDate} to ${reportRange.endDate}`]);
    outputRows.push([]);
  }

  if (summaryRows.length > 0) {
    outputRows.push(['Metric', 'Value'], ...summaryRows, []);
  }

  outputRows.push(['Date', 'Category', 'Description', 'Type', 'Amount', 'Balance']);
  rows.forEach((row) => {
    outputRows.push([
      row.date,
      row.category,
      row.note || '',
      row.type,
      row.amount,
      row.balanceAfter,
    ]);
  });

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(outputRows);
  worksheet['!cols'] = [
    { wch: 14 },
    { wch: 18 },
    { wch: 24 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Statement');

  const workbookBuffer = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array',
    Props: {
      Title: 'Statement Export',
      Company: 'Personal Expense Management',
    },
  });

  return Buffer.from(workbookBuffer);
}
