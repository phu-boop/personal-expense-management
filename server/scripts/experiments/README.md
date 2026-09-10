Experiment A — Cursor-only memory test

Run this script to iterate the real MongoDB cursor without PDF generation. It logs memory usage at thresholds.

Usage:

1. Ensure environment points to the same DB the worker uses (or a copy):

```bash
export MONGO_URL='mongodb://localhost:27017'
export MONGO_DB='personal_expense'
```

2. Run with Node/tsx. For best results enable forced GC and inspector if you want heap snapshots:

```bash
# use --expose-gc to allow manual gc() calls
node --expose-gc -r tsx/register server/scripts/experiments/experimentA-cursor-only.ts

# or with tsx directly
tsx --node-arg=--expose-gc server/scripts/experiments/experimentA-cursor-only.ts
```

3. Capture heap snapshots with `node --inspect` and Chrome DevTools, or use `heapdump` (install separately) to write .heapsnapshot files at thresholds.
