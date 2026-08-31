0. Kiến trúc cuối cùng
                    ┌──────────────────┐
                    │      users       │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │     wallets      │
                    │                  │
                    │ initialBalance   │
                    │ currentBalance   │
                    │ version          │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   transactions   │
                    │                  │
                    │ SOURCE OF TRUTH  │
                    └────────┬─────────┘
                             │
              ┌──────────────┴─────────────┐
              ▼                            ▼
    ┌──────────────────┐          ┌──────────────────┐
    │ balance_snapshots│          │   report_jobs    │
    │ optimization     │          │ async export     │
    └──────────────────┘          └────────┬─────────┘
                                           │
                                           ▼
                                    ┌──────────────┐
                                    │ ExportWorker │
                                    └──────┬───────┘
                                           │
                                           ▼
                                      CSV/XLSX/PDF

Điểm quan trọng:

transactions
     ↓
SOURCE OF TRUTH

wallet.currentBalance
     ↓
CURRENT STATE

balance_snapshots
     ↓
PERFORMANCE CHECKPOINT

report_jobs
     ↓
JOB METADATA
Phase 1 — Dọn schema trước

Bạn đã có 6 collection:

tenants
users
wallets
transactions
balance_snapshots
report_jobs

Giữ nguyên.

wallet
{
  _id: ObjectId,
  tenantId: ObjectId,
  userId: ObjectId,

  name: string,
  accountNumber?: string,

  initialBalance: Decimal128,
  initialBalanceDate: Date,

  currentBalance: Decimal128,

  version: number,

  createdAt: Date,
  updatedAt: Date
}
transaction

Xóa hoàn toàn:

balanceBefore
balanceAfter

Model:

{
  _id: ObjectId,
  tenantId: ObjectId,
  userId: ObjectId,
  walletId: ObjectId,

  amount: Decimal128,
  type: 'INCOME' | 'EXPENSE',

  category?: ObjectId,

  date: Date,
  note?: string,

  createdAt: Date,
  updatedAt: Date
}
Phase 2 — Tạo index

Đây là index cực kỳ quan trọng:

transactionSchema.index({
  tenantId: 1,
  walletId: 1,
  date: 1,
  createdAt: 1,
  _id: 1,
});

Nó phục vụ:

tenant isolation
       +
wallet filtering
       +
canonical ordering

Canonical ordering:

date ASC
createdAt ASC
_id ASC

Ngoài ra nên có:

walletSchema.index({
  tenantId: 1,
  userId: 1,
});

transactionSchema.index({
  tenantId: 1,
  walletId: 1,
});

snapshotSchema.index({
  tenantId: 1,
  walletId: 1,
  status: 1,
  lastTransactionDate: 1,
  lastTransactionCreatedAt: 1,
  lastTransactionId: 1,
});

reportJobSchema.index({
  tenantId: 1,
  userId: 1,
  createdAt: -1,
});
Phase 3 — Decimal utility

Tuyệt đối không:

Number(amount)

để tính tiền.

Tạo:

server/src/utils/money.ts

Ví dụ:

import mongoose from 'mongoose';

export type Decimal128 = mongoose.Types.Decimal128;

export function decimal(value: string | number | Decimal128) {
  if (mongoose.Types.Decimal128.isDecimal128(value)) {
    return value;
  }

  return mongoose.Types.Decimal128.fromString(String(value));
}

export function addDecimal(
  a: Decimal128,
  b: Decimal128,
): Decimal128 {
  return decimal(
    (parseFloat(a.toString()) + parseFloat(b.toString())).toFixed(2),
  );
}

Nhưng lưu ý: đoạn trên chỉ minh họa. Với financial calculation thật, không dùng parseFloat.

Tốt hơn là dùng thư viện decimal chính xác như decimal.js.

npm install decimal.js

Sau đó:

import Decimal from 'decimal.js';

export function toDecimal(value: mongoose.Types.Decimal128 | string) {
  return new Decimal(value.toString());
}
Phase 4 — Effect utility

Tạo:

server/src/utils/transactionEffect.ts
import Decimal from 'decimal.js';

export function getTransactionEffect(
  amount: Decimal,
  type: 'INCOME' | 'EXPENSE',
): Decimal {
  return type === 'INCOME'
    ? amount
    : amount.negated();
}

Ví dụ:

INCOME  5000000
       ↓
+5000000

EXPENSE 2000000
       ↓
-2000000
Phase 5 — MongoDB Replica Set

Vì bạn dùng MongoDB transaction nên local phải chạy replica set.

Docker Compose:

mongo:
  image: mongo:6
  command: ["mongod", "--replSet", "rs0", "--bind_ip_all"]
  ports:
    - "27017:27017"

Sau đó:

docker compose up -d mongo

Init:

docker exec -it mongo mongosh
rs.initiate()

Check:

rs.status()

Phải thấy:

PRIMARY
Phase 6 — Implement createTransaction

File:

server/src/services/transactionService.ts

Flow:

request
   ↓
validate
   ↓
load wallet
   ↓
calculate effect
   ↓
Mongo transaction
   ↓
check currentBalance + effect
   ↓
insert transaction
   ↓
update wallet.currentBalance
   ↓
commit

Pseudo code:

const session = await mongoose.startSession();

try {
  await session.withTransaction(async () => {

    const wallet = await Wallet.findOne({
      _id: walletId,
      tenantId,
      userId,
    }).session(session);

    if (!wallet) {
      throw new NotFoundError();
    }

    const effect = getTransactionEffect(
      amount,
      type,
    );

    const newBalance =
      toDecimal(wallet.currentBalance)
        .plus(effect);

    if (newBalance.isNegative()) {
      throw new InsufficientBalanceError();
    }

    const [transaction] = await Transaction.create(
      [{
        tenantId,
        userId,
        walletId,
        amount,
        type,
        date,
        category,
        note,
      }],
      { session },
    );

    wallet.currentBalance =
      mongoose.Types.Decimal128.fromString(
        newBalance.toFixed(2),
      );

    wallet.version += 1;

    await wallet.save({ session });

    result = transaction;
  });

} finally {
  await session.endSession();
}
Phase 7 — Implement editTransaction

Đây là phần quan trọng nhất.

Transaction cũ:

EXPENSE 1,000,000

New:

EXPENSE 2,500,000

Tính:

oldEffect = -1,000,000

newEffect = -2,500,000

delta = -1,500,000

Sau đó:

currentBalance + delta

Nếu:

< 0

→ reject.

Nếu:

>= 0

→ update.

Flow
PATCH
  ↓
load transaction
  ↓
calculate oldEffect
  ↓
calculate newEffect
  ↓
delta
  ↓
Mongo transaction
  ↓
load wallet
  ↓
check currentBalance + delta
  ↓
update transaction
  ↓
update wallet
  ↓
commit
Date-only edit
oldEffect = -1,000,000
newEffect = -1,000,000

delta = 0

Không update balance.

Nhưng:

date changed

=> snapshot phía sau transaction có thể phải INVALID.

Phase 8 — Snapshot

Model:

{
  tenantId,
  walletId,

  snapshotAt,

  balance,

  lastTransactionDate,
  lastTransactionCreatedAt,
  lastTransactionId,

  status: 'VALID' | 'INVALID',

  createdAt,
  updatedAt,
}

Snapshot:

transaction #500,000
       ↓
balance = 20,000,000

Nó có nghĩa:

Balance ngay sau transaction #500,000.

Phase 9 — Snapshot invalidation

Đây là chỗ nhiều implementation dễ sai.

Nếu transaction:

#300,000

bị sửa:

amount
type
date

thì snapshot:

#500,000
#600,000
#700,000

có thể bị ảnh hưởng.

Không được:

update transactions hàng loạt

Chỉ:

snapshot.status = INVALID
Phase 10 — Tạo snapshot worker

Không cần snapshot sau mỗi transaction.

Ví dụ:

100,000 transactions
       ↓
snapshot

200,000 transactions
       ↓
snapshot

300,000 transactions
       ↓
snapshot

Ví dụ:

snapshot #1
checkpoint = transaction 100,000
balance = 5,000,000

snapshot #2
checkpoint = transaction 200,000
balance = 8,000,000

snapshot #3
checkpoint = transaction 300,000
balance = 12,000,000
Phase 11 — Viết cursor pagination

API:

GET /api/wallets/:walletId/transactions

Sort:

.sort({
  date: 1,
  createdAt: 1,
  _id: 1,
})

Cursor:

{
  "date": "...",
  "createdAt": "...",
  "_id": "..."
}

Encode:

JSON
 ↓
base64
 ↓
opaque cursor
Phase 12 — Query page tiếp theo

Nếu cursor:

(date=C1, createdAt=C2, _id=C3)

query:

{
  $or: [
    {
      date: { $gt: C1 }
    },
    {
      date: C1,
      createdAt: { $gt: C2 }
    },
    {
      date: C1,
      createdAt: C2,
      _id: { $gt: C3 }
    }
  ]
}

Đây là canonical cursor.

Phase 13 — Tính openingBalance

Giả sử page bắt đầu ở transaction:

2026-08-20 10:00

Cần:

openingBalance

ngay trước transaction đầu tiên.

Không được:

wallet.currentBalance

vì đó là current balance, không phải historical balance.

Phase 14 — Không có snapshot

Fallback:

initialBalance
       +
SUM(effect của transaction trước page)

Nhưng không:

const transactions = await find(...)

Mà dùng MongoDB aggregation/cursor.

Phase 15 — Có snapshot

Ví dụ:

initialBalance

       ↓

snapshot
checkpoint = 500,000
balance = 20M

       ↓

transactions
500,001 → page start

       ↓

openingBalance

Đây là lý do snapshot giúp bài toán 1 triệu transaction nhanh hơn.

Phase 16 — Export worker

Tạo:

server/src/workers/exportWorker.ts

Flow:

report_jobs
     │
     ▼
PENDING
     │
     ▼
IN_PROGRESS
     │
     ▼
find valid snapshot
     │
     ▼
calculate startingBalance
     │
     ▼
Mongo cursor
     │
     ▼
transaction
     │
     ├── balanceBefore
     ├── effect
     └── balanceAfter
     │
     ▼
CSV stream
     │
     ▼
COMPLETED
Phase 17 — CSV streaming

Ví dụ dùng:

npm install csv-stringify

Không làm:

const rows = [];

for (...) {
  rows.push(...)
}

writeFile(rows)

Vì:

1M rows
 ↓
RAM
 ↓
💥

Mà:

Mongo Cursor
    ↓
row
    ↓
CSV stream
    ↓
disk
Phase 18 — Mongo cursor

Đây là đoạn cực kỳ quan trọng cho bài test:

const cursor = Transaction
  .find({
    tenantId,
    walletId,
    date: {
      $gte: fromDate,
      $lt: toDate,
    },
  })
  .sort({
    date: 1,
    createdAt: 1,
    _id: 1,
  })
  .lean()
  .cursor();

for await (const tx of cursor) {

  const balanceBefore = runningBalance;

  const effect =
    tx.type === 'INCOME'
      ? toDecimal(tx.amount)
      : toDecimal(tx.amount).negated();

  runningBalance =
    runningBalance.plus(effect);

  const balanceAfter = runningBalance;

  csvStream.write({
    date: tx.date,
    type: tx.type,
    amount: tx.amount.toString(),
    balanceBefore: balanceBefore.toFixed(2),
    balanceAfter: balanceAfter.toFixed(2),
  });
}

Đây là điểm ăn tiền của bài test.

Phase 19 — 1 triệu transaction generator

Tạo:

server/src/scripts/generateTransactions.ts

Không:

for 1M:
  await Transaction.create(...)

Cực kỳ chậm.

Dùng:

bulkWrite()

theo batch.

Ví dụ:

1,000 transactions
      ↓
bulkWrite

1,000
      ↓
bulkWrite

...

Không tạo array 1 triệu phần tử cùng lúc.

Phase 20 — Generator

Pseudo:

const BATCH_SIZE = 5_000;

for (let i = 0; i < 1_000_000; i += BATCH_SIZE) {

  const operations = [];

  for (
    let j = 0;
    j < BATCH_SIZE && i + j < 1_000_000;
    j++
  ) {
    operations.push({
      insertOne: {
        document: {
          tenantId,
          userId,
          walletId,

          amount: Decimal128.fromString(
            randomAmount()
          ),

          type: randomType(),

          date: randomDate(),

          note: `Generated ${i + j}`,

          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    });
  }

  await Transaction.bulkWrite(
    operations,
    { ordered: false }
  );
}
Phase 21 — Cẩn thận currentBalance

Nếu generate 1 triệu transaction bằng:

bulkWrite transactions

thì đừng quên wallet.currentBalance.

Có 2 lựa chọn cho benchmark:

Cách 1

Generator đồng thời tính:

SUM(effect)

rồi update:

wallet.currentBalance
Cách 2

Sau khi generate:

aggregate SUM(effect)

và set:

currentBalance =
initialBalance + SUM(effect)

Để verify invariant.

Phase 22 — Verify invariant

Đây là test cực kỳ quan trọng.

Query:

SUM(INCOME)
-
SUM(EXPENSE)
+
initialBalance

So sánh:

wallet.currentBalance

Phải:

EXPECTED == ACTUAL

Ví dụ:

initialBalance = 10M

SUM income  = 500M
SUM expense = 200M

expected = 310M

wallet.currentBalance = 310M

PASS
Phase 23 — Benchmark export

Chạy:

node dist/scripts/generateTransactions.js 1000000

Sau đó:

node dist/workers/exportWorker.js

Đo:

Transactions:
1,000,000

Export:
CSV

Execution:
xx seconds

Peak RAM:
xxx MB

File:
xxx MB
Phase 24 — Test memory

Bạn có thể log:

const start = process.memoryUsage().rss;

...

const end = process.memoryUsage().rss;

console.log({
  startMB: start / 1024 / 1024,
  endMB: end / 1024 / 1024,
});

Tốt hơn là monitor định kỳ:

setInterval(() => {
  const memory = process.memoryUsage();

  console.log({
    rss: Math.round(memory.rss / 1024 / 1024),
    heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
  });
}, 1000);

Bạn muốn chứng minh:

1K transaction
   ↓
RAM X

100K transaction
   ↓
RAM ~X + small overhead

1M transaction
   ↓
RAM ~X + small overhead

chứ không phải:

1M transaction
   ↓
RAM tăng khủng khiếp
Phase 25 — Test concurrent edit

Test:

Wallet balance = 1,000,000

Transaction:

expense 500,000

Hai request đồng thời:

Request A
edit → expense 900,000
delta = -400,000

Request B
edit → expense 900,000
delta = -400,000

Không được xảy ra:

1,000,000
   ↓
-400K
   ↓
600K

-400K
   ↓
200K

mà transaction logic phải serialize/conflict retry đúng cách.

MongoDB transaction:

A ────────────────┐
                  │
                  ▼
               COMMIT

B ── conflict ──► retry
                  │
                  ▼
              re-evaluate

Retry phải tính lại balance, không dùng kết quả cũ.

Phase 26 — Test historical edit

Đây là test rất quan trọng.

Tạo:

T1: +1M
T2: -500K
T3: +2M
T4: -300K

Current:

initial = 10M

10M + 1M - 500K + 2M - 300K
= 12.2M

Edit:

T2 -500K
→ -800K

delta:

-300K

Expected:

currentBalance = 11.9M

Không được update:

T3.balanceBefore
T3.balanceAfter
T4.balanceBefore
T4.balanceAfter

vì những field đó không tồn tại.

Khi đọc report:

T1
T2
T3
T4

running balance được tính lại.

Phase 27 — Test date edit

Ví dụ:

T2 = 2026-01-10

đổi:

T2 = 2026-02-10

Effect không đổi:

delta = 0

Current balance:

KHÔNG ĐỔI

Nhưng snapshot:

checkpoint >= vị trí bị ảnh hưởng

phải:

INVALID
Phase 28 — Test snapshot correctness

Test:

1M transactions

Tạo:

snapshot @ 500K

Sau đó export.

So sánh:

export using snapshot

với:

full scan from initialBalance

Kết quả phải:

openingBalance: SAME
closingBalance: SAME

Đây là benchmark cực kỳ đẹp để trình bày.

Phase 29 — Test snapshot invalidation

Scenario:

snapshot
checkpoint = T500K

Edit:

T300K

Expected:

snapshot.status = INVALID

Worker:

INVALID snapshot
       ↓
không sử dụng
       ↓
fallback

Sau đó verify:

snapshot result
==
full recomputation
Phase 30 — Test 1M

Cuối cùng benchmark:

┌───────────────────────────────┐
│       LARGE DATA TEST         │
├───────────────────────────────┤
│ Transactions: 1,000,000      │
│ Wallets: 1                   │
│ Database: MongoDB             │
│ Export: CSV                   │
│ Batch: 5,000                  │
│ Cursor: YES                   │
│ Snapshot: YES                 │
└───────────────────────────────┘

Đo:

Generation time
Export time
Peak RSS
Peak heap
CPU
Output file size
Thứ tự bạn nên code thật

Đừng code worker trước.

Làm đúng thứ tự:

PHASE 1
Schema
  ↓
PHASE 2
Indexes
  ↓
PHASE 3
Decimal utility
  ↓
PHASE 4
createTransaction
  ↓
PHASE 5
editTransaction
  ↓
PHASE 6
Unit tests
  ↓
PHASE 7
Snapshot
  ↓
PHASE 8
Cursor pagination
  ↓
PHASE 9
openingBalance
  ↓
PHASE 10
Export CSV
  ↓
PHASE 11
1M generator
  ↓
PHASE 12
1M benchmark
  ↓
PHASE 13
Concurrency tests
  ↓
PHASE 14
Snapshot invalidation tests
  ↓
PHASE 15
XLSX/PDF
Quan trọng nhất

Đừng bắt đầu bằng XLSX/PDF.

Bài test anh reviewer đưa cho bạn thực chất muốn xem:

                1,000,000 transactions
                         │
                         ▼
                  MongoDB Cursor
                         │
                    batch/stream
                         │
                         ▼
              calculate running balance
                         │
                         ▼
                  write CSV stream
                         │
                         ▼
                    output file

Nếu bạn làm được phần này đúng + memory ổn định + invariant luôn đúng, thì đã giải quyết được phần khó nhất của bài test.

Sau đó mới gắn:

Redis/Bull
   ↓
report_jobs
   ↓
exportWorker
   ↓
XLSX/PDF

Và một lưu ý rất quan trọng: balance_snapshots không làm cho việc tính 1 triệu dòng report biến thành O(1). Nó chủ yếu giúp giảm phần tính startingBalance trước khi bắt đầu stream. Phần 1 triệu dòng trong report vẫn phải đi qua 1 triệu transaction nếu file thực sự chứa 1 triệu dòng — nhưng nhờ cursor/streaming, chi phí RAM không tăng theo toàn bộ dataset.