# Export pipeline

## 1. Overview

The export pipeline generates wallet statements as downloadable report files in PDF or XLSX format. The export is intentionally asynchronous because large statements may take longer than a normal HTTP request and should not block the API thread.

The pipeline is designed to keep the worker bounded in memory while still producing a single final file per export job.

---

## 2. Goals

The export flow must satisfy these requirements:

- generate only one final PDF or XLSX file
- keep memory usage bounded for large data sets
- calculate correct totals for the selected wallet and date range
- ensure page accounting matches the actual output
- ensure preflight row counts match exported rows
- produce a consistent financial summary at the top of the output

---

## 3. Job lifecycle

### 3.1 Job creation

When a user requests an export, the API validates:

- the wallet belongs to the authenticated user and tenant
- the date range is valid
- the requested format is supported

Then it creates an `ExportJob` record and enqueues it for async processing.

Typical job fields:

```json
{
  "walletId": "wallet-id",
  "tenantId": "tenant-id",
  "userId": "user-id",
  "fromDate": "2026-08-01T00:00:00Z",
  "toDate": "2026-08-31T00:00:00Z",
  "format": "XLSX",
  "status": "PENDING"
}
```

### 3.2 Worker processing

The worker picks up the queued job and moves it to `IN_PROGRESS` before performing export generation.

During processing, it:

- computes opening balance for the range
- computes total income / total expense
- streams the matching transactions
- renders a PDF or XLSX file
- writes the file to persistent storage
- updates the job status to `COMPLETED`

### 3.3 Failure handling

If export generation fails, the job is set to `FAILED` and the error message is saved to the job record.

This makes future debugging and support easier.

---

## 4. Export design requirements

### 4.1 Correctness first

The export must reflect the same business logic as the statement API:

- canonical ordering: date ASC, createdAt ASC, _id ASC
- half-open range semantics: [fromDate, toDate)
- opening balance computed before the range begins
- total income and total expense computed only for the export range

### 4.2 Bounded-memory execution

Large exports cannot retain all rows in memory. The job must instead use a bounded-memory strategy:

- stream transactions using MongoDB cursor
- use chunk files for PDF generation
- use stream-based XLSX writing
- avoid large arrays of rows/pages in the heap

### 4.3 Single final artifact

The final user-facing export must still be a single PDF or XLSX file. The system may create temporary chunk files internally, but the final deliverable remains one coherent document.

---

## 5. PDF export flow

### 5.1 Why PDF is sensitive

PDF generation is particularly sensitive to memory pressure because many page objects and buffers can remain alive until the final merge.

### 5.2 Correct PDF approach

The correct pattern is:

1. create a temporary chunk directory
2. generate one PDF chunk at a time
3. write each chunk to disk
4. track page counts per chunk
5. merge chunk PDFs into a final PDF file
6. upload the final PDF to storage
7. remove temporary chunk files

This ensures the export remains bounded in memory while still producing one final PDF document.

### 5.3 PDF summary content

The first chunk should include the header summary so the user sees immediately:

- wallet name
- date range
- opening balance
- total income
- total expense
- ending balance

The summary should be based on the same range and data used for export, not an approximated count.

---

## 6. XLSX export flow

### 6.1 Requirements

XLSX exports must remain readable even when the statement contains a very large number of rows.

The export should:

- stream rows directly to the workbook
- write numeric values instead of formatting-only cells
- freeze the top summary/header area if supported
- include summary rows near the top of the sheet
- ensure totals remain visible without needing to scroll to the end

### 6.2 Correct total behavior

For the sheet summary, the system should include values for:

- opening balance
- total income
- total expense
- ending balance

In Excel, either formulas or explicit numeric values can be used, but the values should be present immediately at the top of the sheet to avoid a misleading or empty summary for large files.

---

## 7. Preflight and summary checks

Before a large export is considered safe to proceed, the system should complete a preflight validation.

### Required preflight values

- walletId
- fromDate
- toDate
- format
- rowCount
- totalIncome
- totalExpense
- openingBalance
- endingBalance

The most important rule is:

- preflightRowCount must match the number of rows actually exported

If row counts differ, the export must be treated as invalid.

---

## 8. Page accounting

Page accounting must be tracked from the real generated output.

For PDF exports:

- each chunk stores page count
- total page count = sum(chunk page counts)
- final job metadata uses the total from the actual merged output

This avoids a mismatch where the job claims one page count but the final merged document has another.

---

## 9. Export summary contract

At the end of a successful export, the system should emit a summary in the following spirit:

```json
{
  "jobId": "...",
  "walletId": "...",
  "format": "XLSX",
  "preflightRowCount": 125000,
  "exportedRowCount": 125000,
  "totalIncome": 25480.00,
  "totalExpense": 19810.50,
  "openingBalance": 12000.00,
  "endingBalance": 18689.50,
  "chunkCount": 7,
  "pageCount": 33,
  "status": "COMPLETED"
}
```

This summary is essential both for debugging and for validating correctness after export generation.

---

## 10. Failure conditions to avoid

The export should not be considered valid if any of the following occur:

- heap grows without bound during processing
- final PDF or XLSX is empty
- preflight row count differs from real row count
- total income/expense mismatch the range data
- page count metadata is inconsistent with the actual document
- rows fall outside the intended date range

---

## 11. Operational recommendations

- keep the worker isolated from normal API traffic
- log chunk counts, row counts, and memory usage during large exports
- keep temporary files in a temporary directory and clean them up on success or failure
- make dead-letter and retry behavior explicit for worker failures
- store status and metadata in `ExportJob` to support monitoring and troubleshooting

---

## 12. Conclusion

The export pipeline is not only a file-generation feature; it is part of the financial correctness layer of the application. Large exports must preserve the same business semantics as statement queries and must be bound in memory to remain stable under heavier workloads.

The correct implementation strategy is: stream, chunk, validate, summarize, and merge — never accumulate the whole report in heap and assume the output is correct.
