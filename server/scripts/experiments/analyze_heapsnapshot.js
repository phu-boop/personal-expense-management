#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function usage() {
  console.error('Usage: node analyze_heapsnapshot.js <snapshot.heapsnapshot>');
  process.exit(1);
}

if (process.argv.length < 3) usage();
const file = process.argv[2];
if (!fs.existsSync(file)) {
  console.error('File not found:', file);
  process.exit(2);
}

console.error('Loading snapshot:', file);
const raw = fs.readFileSync(file, 'utf8');
const snap = JSON.parse(raw);

const meta = snap.snapshot.meta;
const node_fields = meta.node_fields;
const nodes = snap.nodes;
const strings = snap.strings;
const edges = snap.edges;

const idx = {};
for (let i = 0; i < node_fields.length; i++) idx[node_fields[i]] = i;

const edge_fields = meta.edge_fields;
const eidx = {};
for (let i = 0; i < edge_fields.length; i++) eidx[edge_fields[i]] = i;

const nodeFieldCount = node_fields.length;
const edgeFieldCount = edge_fields.length;

function readNodeByOrdinal(ord) {
  const start = ord * nodeFieldCount;
  const type = nodes[start + idx.type];
  const name = nodes[start + idx.name];
  const id = nodes[start + idx.id];
  const self_size = nodes[start + idx.self_size];
  const edge_count = nodes[start + idx.edge_count];
  return { ord, start, type, name, id, self_size, edge_count };
}

const nodeCount = snap.nodes.length / nodeFieldCount;

let edgePtr = 0;
const nodeEdgesIndex = new Array(nodeCount);
for (let i = 0; i < nodeCount; i++) {
  const n = readNodeByOrdinal(i);
  nodeEdgesIndex[i] = edgePtr;
  edgePtr += n.edge_count * edgeFieldCount;
}

function readEdge(nodeOrd, edgeIndex) {
  const base = nodeEdgesIndex[nodeOrd] + edgeIndex * edgeFieldCount;
  const type = edges[base + eidx.type];
  const name_or_index = edges[base + eidx.name_or_index];
  const to_node = edges[base + eidx.to_node];
  const to_node_ord = to_node / nodeFieldCount;
  return { type, name_or_index, to_node, to_node_ord };
}

const targets = [];
for (let i = 0; i < nodeCount; i++) {
  const n = readNodeByOrdinal(i);
  const nm = strings[n.name];
  if (nm === 'transactionsForExport' || (nm && nm.indexOf('transactionsForExport') !== -1)) {
    targets.push(n);
  }
}

if (targets.length === 0) {
  console.error('No node named transactionsForExport found in snapshot.');
  process.exit(0);
}

function traverseFrom(nodeOrd) {
  const seen = new Uint8Array(nodeCount);
  const stack = [nodeOrd];
  let totalSelf = 0;
  let count = 0;
  while (stack.length) {
    const cur = stack.pop();
    if (seen[cur]) continue;
    seen[cur] = 1;
    const n = readNodeByOrdinal(cur);
    totalSelf += n.self_size;
    count++;
    for (let e = 0; e < n.edge_count; e++) {
      const ed = readEdge(cur, e);
      const to = ed.to_node_ord;
      if (!seen[to]) stack.push(to);
    }
  }
  return { totalSelf, count };
}

for (const t of targets) {
  const name = strings[t.name];
  console.error('Found target node ord=', t.ord, 'name=', name, 'self_size=', t.self_size, 'edge_count=', t.edge_count);
  const res = traverseFrom(t.ord);
  console.error('Reachable nodes count:', res.count);
  console.error('Sum of self_size of reachable nodes (bytes):', res.totalSelf);
  console.error('Estimated retained MB:', (res.totalSelf / 1024 / 1024).toFixed(2));

  const immediateTargets = new Set();
  for (let e = 0; e < t.edge_count; e++) {
    const ed = readEdge(t.ord, e);
    immediateTargets.add(ed.to_node_ord);
  }
  let txCandidates = 0;
  for (const ord of immediateTargets) {
    const child = readNodeByOrdinal(ord);
    let looksLikeTx = false;
    for (let e = 0; e < child.edge_count; e++) {
      const ed = readEdge(ord, e);
      const ename = typeof ed.name_or_index === 'number' ? strings[ed.name_or_index] : null;
      if (ename && (ename === 'amount' || ename === 'date' || ename === 'createdAt' || ename === 'wallet' || ename === 'notes')) {
        looksLikeTx = true; break;
      }
    }
    if (looksLikeTx) txCandidates++;
  }
  console.error('Immediate children count:', immediateTargets.size, 'tx-like children:', txCandidates);
}

console.error('Done.');
