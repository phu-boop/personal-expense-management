#!/usr/bin/env node
const fs = require('fs');
const {parser} = require('stream-json');
const {streamArray} = require('stream-json/streamers/StreamArray');
const {chain} = require('stream-chain');

if (process.argv.length < 3) {
  console.error('Usage: node stream_analyze_heapsnapshot.js <snapshot.heapsnapshot>');
  process.exit(1);
}
const file = process.argv[2];
if (!fs.existsSync(file)) { console.error('File not found:', file); process.exit(2); }

console.error('Streaming parse of', file);

// We'll do two passes: first pass to extract meta and strings and locate target string indices.
// Second pass to stream nodes and edges and build compact structures for traversal.

function extractMetaAndStrings(filePath, targetName) {
  return new Promise((resolve, reject) => {
    const inStream = fs.createReadStream(filePath);
    const p = parser();
    const found = { meta: null, node_fields: null, edge_fields: null, strings: {}, targetIndices: [] };
    let stringIndex = -1;
    p.on('data', ({name, value, key}) => {
      if (name === 'startObject' && key === 'snapshot') {
        // nothing
      }
      if (name === 'key' && value === 'meta') {
        // next object will be meta - allow parser to emit its children
      }
      if (name === 'startArray' && key === 'strings') {
        stringIndex = 0;
      }
      if (name === 'string' && stringIndex >= 0) {
        const s = value;
        if (s === targetName || (s && s.indexOf(targetName) !== -1)) found.targetIndices.push(stringIndex);
        stringIndex++;
      }
      if (name === 'startArray' && key === 'node_fields') {
        // collect node_fields
        found.node_fields = [];
      }
      if (name === 'string' && found.node_fields && key === undefined) {
        // this may also be a string from nodes; ignore
      }
      if (name === 'endArray' && found.node_fields && found.node_fields.length>0) {
        // noop
      }
    });
    p.on('end', () => resolve(found));
    p.on('error', reject);
    inStream.pipe(p);
  });
}

// Fallback simple extractor: read small head to get meta.node_fields and edge_fields by regex and then stream strings separately
function readMetaHead(filePath) {
  const head = fs.readFileSync(filePath, {encoding:'utf8', length: 1024*1024});
  const m = head.match(/"meta"\s*:\s*\{([\s\S]*?)\}\s*,/);
  if (!m) return null;
  const metaText = '{' + m[1] + '}';
  try {
    const meta = JSON.parse(metaText);
    return meta;
  } catch (e) {
    return null;
  }
}

function streamStringsFindIndex(filePath, targetName) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(filePath, {encoding:'utf8'});
    const p = parser();
    let idx = -1;
    const targets = [];
    p.on('data', token => {
      if (token.name === 'startArray' && token.key === 'strings') { idx = 0; return; }
      if (idx >= 0 && token.name === 'string') {
        const s = token.value;
        if (s === targetName || (s && s.indexOf(targetName)!==-1)) targets.push(idx);
        idx++;
      }
      if (idx >=0 && token.name === 'endArray') { p.emit('end'); }
    });
    p.on('end', () => resolve(targets));
    p.on('error', reject);
    rs.pipe(p);
  });
}

// Robust approach: use stream-json to iterate tokens and capture meta, strings, nodes minimally.
const StreamArray = require('stream-json/streamers/StreamArray');

async function analyze(filePath, targetName) {
  const targetIndices = await streamStringsFindIndex(filePath, targetName);
  console.error('Found target string indices:', targetIndices);
  if (targetIndices.length===0) { console.error('target not found'); return; }

  // Now stream nodes to find node ordinals whose name equals target index
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(filePath, {encoding:'utf8'});
    const p = parser();
    let inSnapshotMeta = false;
    let nodeFieldCount = null;
    let node_fields = null;
    let edge_fields = null;
    let nodesStart = false;
    let nodeIdx = 0; // position in nodes numeric sequence
    let nodeOrd = 0;
    const nodeInfo = []; // store minimal per-node: name, self_size, edge_count
    let nodesCollected = 0;

    p.on('data', token => {
      if (!node_fields && token.name === 'startObject' && token.key === 'meta') {
        inSnapshotMeta = true;
      }
      if (inSnapshotMeta && token.name === 'key' && token.value === 'node_fields') {
        // next startArray will be node_fields strings
      }
      if (token.name === 'startArray' && token.key === 'node_fields') {
        node_fields = [];
      }
      if (node_fields !== null && token.name === 'string' && token.key===undefined) {
        node_fields.push(token.value);
      }
      if (node_fields && token.name === 'endArray') {
        nodeFieldCount = node_fields.length;
        inSnapshotMeta = false;
        console.error('node_fields count', nodeFieldCount, 'fields=', node_fields.join(','));
      }
      if (nodeFieldCount && token.name === 'startArray' && token.key === 'nodes') {
        nodesStart = true;
        nodeIdx = 0; nodeOrd = 0;
      }
      if (nodesStart && token.name === 'number') {
        const v = token.value;
        const posInNode = nodeIdx % nodeFieldCount;
        if (posInNode === node_fields.indexOf('name')) {
          nodeInfo.push({name: v});
        } else if (posInNode === node_fields.indexOf('self_size')) {
          nodeInfo[nodeOrd].self_size = v;
        } else if (posInNode === node_fields.indexOf('edge_count')) {
          nodeInfo[nodeOrd].edge_count = v;
        }
        nodeIdx++;
        if (nodeIdx % nodeFieldCount === 0) nodeOrd++;
      }
      if (nodesStart && token.name === 'endArray') {
        console.error('Finished reading nodes, count=', nodeInfo.length);
        // find candidates
        const targets = [];
        for (let i=0;i<nodeInfo.length;i++) {
          if (targetIndices.includes(nodeInfo[i].name)) targets.push({ord:i,self_size:nodeInfo[i].self_size,edge_count:nodeInfo[i].edge_count});
        }
        console.error('Found target node ords:', targets.map(t=>t.ord));
        resolve({targets, node_fields});
      }
    });
    p.on('error', err=>{ reject(err); });
    rs.pipe(p);
  });
}

(async ()=>{
  try {
    const res = await analyze(process.argv[2], '__transactionsForExport');
    console.error('ANALYSIS RESULT:', JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('Error during streaming analysis:', e);
  }
})();
