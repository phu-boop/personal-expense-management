# Implementation Plan — Transaction Rework

## Goal

Implement the transaction architecture so that:

- `transactions` is the source of truth.
- `wallet.currentBalance` is the current aggregate state.
- historical edits do not cascade to other transactions.
- running balances are derived at read/export time using canonical ordering.
- snapshoting is an optimization only and must be invalidated when historical edits affect ordering/effect.

---

## Phase 1 — Repository inspection and baseline validation

- [ ] Inspect all current transaction and wallet model files
  - [ ] `server/src/models/Transaction.ts`
  - [ ] `server/src/models/Wallet.ts`
  - [ ] `server/src/services/transactionService.ts`
  - [ ] `server/src/routes/transaction.ts`
  - [ ] `server/src/validators/transactionValidator.ts`
  - [ ] `server/src/services/balanceService.ts`
- [ ] Check whether existing code persists `balanceBefore` / `balanceAfter`
- [ ] Confirm current indexes and query patterns
- [ ] Confirm test/build commands in `server/package.json`
- [ ] Document current root cause before code changes

Definition of done:
- We know the exact repository structure and the current anti-patterns we must remove.

---

## Phase 2 — Schema alignment to the target architecture

- [ ] Update `Transaction` schema to remove persisted running-balance fields
- [ ] Add canonical ordering indexes:
  - `{ tenantId: 1, walletId: 1, date: 1, createdAt: 1, _id: 1 }`
  - keep required tenant/user scoping indexes
- [ ] Update `Wallet` schema with:
  - `initialBalanceDate?: Date`
  - `version?: number`
- [ ] Decide and document `initialBalanceDate` business rule
  - preferred: reject transactions before `initialBalanceDate`
  - if not possible, document semantics explicitly
- [ ] Ensure `amount` and `currentBalance` are stored with an exact numeric type strategy
  - prefer Mongo `Decimal128` or equivalent exact decimal handling

Definition of done:
- Models match the architecture and no longer encode persisted running balances.

---

## Phase 3 — Transaction write logic

### 3.1 `createTransaction()`

- [ ] Validate input and wallet ownership
- [ ] Start MongoDB session / transaction
- [ ] Read wallet by `{ _id, tenantId, userId }`
- [ ] Compute effect from `type`
  - `INCOME` => `+amount`
  - `EXPENSE` => `-amount`
- [ ] Validate `wallet.currentBalance + effect >= 0`
- [ ] Insert new transaction document
- [ ] Update `wallet.currentBalance += effect`
- [ ] Increment `wallet.version`
- [ ] Commit transaction
- [ ] Retry on transient transaction/write-conflict errors
- [ ] Return created transaction

### 3.2 `editTransaction()`

- [ ] Load existing transaction by `{ _id, tenantId, userId }`
- [ ] Calculate:
  - `oldEffect`
  - `newEffect`
  - `delta = newEffect - oldEffect`
- [ ] Start MongoDB session / transaction
- [ ] Read wallet for update by wallet id
- [ ] Validate `wallet.currentBalance + delta >= 0`
- [ ] Apply transaction changes only for the edited transaction
  - `amount`, `type`, `date`, `note`
- [ ] Update `wallet.currentBalance += delta`
- [ ] Increment `wallet.version`
- [ ] Commit transaction
- [ ] Retry on transient write conflicts
- [ ] Return updated transaction

### 3.3 Special cases

- [ ] Allow note-only edits with `delta == 0`
- [ ] Treat date-change as an ordering mutation even when delta == 0
- [ ] Reject insufficient balance with explicit `409`/business error semantics
- [ ] Ensure no other transactions are rewritten or recomputed

Definition of done:
- `createTransaction` and `editTransaction` both satisfy the invariant without cascade updates.

---

## Phase 4 — MongoDB concurrency and write-conflict handling

- [ ] Explicitly ban `SELECT ... FOR UPDATE`-style assumptions
- [ ] Use MongoDB transaction semantics when available
- [ ] Add retry loop for transient transaction errors and write conflicts
- [ ] Serialize wallet balance updates through the wallet document
- [ ] Ensure only one concurrent update wins; the loser retries and rechecks balance
- [ ] Document expected behavior for concurrent A/B edits to the same wallet

Definition of done:
- Two concurrent wallet writes cannot violate the invariant.

---

## Phase 5 — History / statement / pagination logic

- [ ] Query transactions using canonical ordering
  - `(date ASC, createdAt ASC, _id ASC)`
- [ ] Use cursor-based pagination with opaque cursor
  - cursor payload: `{ date, createdAt, _id }`
- [ ] Compute `openingBalance` as the balance immediately before the first row in the page
- [ ] Derive per-row `balanceBefore` / `balanceAfter` at read time
- [ ] Do not trust `wallet.currentBalance` to reconstruct historical pages
- [ ] Use half-open date range filtering: `[fromDate, toDate)`
- [ ] Convert report boundaries from user timezone to UTC before query

Definition of done:
- The API returns correct page-level opening balance and row-level derived balances without recomputing millions of historical rows for each page.

---

## Phase 6 — Snapshot strategy

- [ ] Add `balance_snapshots` collection design
- [ ] Define snapshot checkpoint as ordering tuple:
  - `(date, createdAt, _id)`
- [ ] Include `status: VALID | INVALID`
- [ ] Add logic to invalidate snapshot when a historical transaction changes:
  - amount
  - type
  - date
- [ ] Snapshot is used only as optimization, never as source of truth
- [ ] If snapshot is stale or invalid, fallback to a valid checkpoint or initial-balance scan
- [ ] Do not rewrite transaction documents during invalidation

Definition of done:
- Snapshot validity is tied to the actual ordering boundary and historical mutations, not creation time alone.

---

## Phase 7 — Reporting/export worker

- [ ] Create `report_jobs` doc lifecycle
- [ ] Enqueue export job in async worker system
- [ ] Worker determines valid starting balance
  - prefer valid snapshot
  - fallback to aggregate/scan near boundary
- [ ] Stream transactions in canonical order
- [ ] Write CSV/XLSX/PDF incrementally without loading full dataset into memory
- [ ] Mark job as `COMPLETED` with file metadata
- [ ] Document eventual consistency vs strict point-in-time snapshot behavior

Definition of done:
- Large exports can run without OOM and without recomputing all history per page.

---

## Phase 8 — Validation and tests

### Unit tests

- [ ] `createTransaction` success for income
- [ ] `createTransaction` success for expense
- [ ] `createTransaction` rejects negative resulting balance
- [ ] `editTransaction` updates amount correctly
- [ ] `editTransaction` updates type correctly
- [ ] `editTransaction` date-only change does not affect wallet balance
- [ ] `editTransaction` note-only change does not affect wallet balance
- [ ] `editTransaction` rejects negative wallet resulting balance

### Integration tests

- [ ] Concurrent edit test on same wallet with conflicting deltas
- [ ] Snapshot invalidation on date change
- [ ] Page opening balance correctness across pages

### Performance tests

- [ ] 100k-row bulk insert generator
- [ ] 1M-row bulk insert generator for wallet history
- [ ] export benchmark and memory profile

Definition of done:
- The implementation is validated both for correctness and for large-data behavior.

---

## Phase 9 — Final verification before merge

- [ ] Run TypeScript build
- [ ] Run relevant tests
- [ ] Review diff against architecture rules
- [ ] Check no code persists running balances
- [ ] Confirm no historical transaction rewrite is required for edits
- [ ] Confirm index and query semantics align with canonical ordering
- [ ] Confirm concurrency rules are documented and implemented

Definition of done:
- The branch is consistent with the spec and safe for the next implementation iteration.

---

## Suggested implementation order for this repo

1. Models and schema cleanup
2. `createTransaction()` and `editTransaction()`
3. MongoDB transaction retry / write conflict handling
4. History and pagination logic
5. Snapshot invalidation design
6. Report/export worker
7. Tests and performance harness

This sequence keeps the work correct and avoids building export logic on top of a broken balance model.
