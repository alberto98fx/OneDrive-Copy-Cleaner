const fmtBytes = (b) => {
  if (b === 0) return '0 B';
  const k = 1024;
  const sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

let root = null;
let items = []; // all copy candidates
let filtered = []; // after search filter
let selection = new Set();
let strictHash = false;
let folderCounts = new Map(); // dir -> {count, size}
let currentFolder = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function switchTab(tab) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('#tab-copies, #tab-folders').forEach(p => p.classList.remove('active'));
  $('#tab-' + tab).classList.add('active');
}

function updateStats() {
  const total = items.length;
  const bytes = items.reduce((a, x) => a + (x.deletable ? x.size : 0), 0);
  $('#stats').textContent = total ? `${total} copies · Potential save: ${fmtBytes(bytes)}` : '';

  const selArr = Array.from(selection);
  const selBytes = items.filter(i => selArr.includes(i.path)).reduce((a, x) => a + x.size, 0);
  $('#selectedStats').textContent = selection.size ? `${selection.size} selected · ${fmtBytes(selBytes)}` : '';
  $('#deleteSelectedBtn').disabled = selection.size === 0;
}

function buildCard(x) {
  const tpl = document.getElementById('cardTemplate');
  const el = tpl.content.firstElementChild.cloneNode(true);
  const img = el.querySelector('.thumb');
  const fname = el.querySelector('.fname');
  const size = el.querySelector('.size');
  const orig = el.querySelector('.orig');
  const hash = el.querySelector('.hash');
  const sel = el.querySelector('.sel');

  const fileUrl = 'file:///' + x.path.replaceAll('\\', '/');
  img.src = fileUrl;
  img.alt = x.name;
  fname.textContent = x.name;
  size.textContent = fmtBytes(x.size);

  if (x.originalExists) { orig.textContent = 'Original: found'; orig.classList.add('ok'); }
  else { orig.textContent = 'Original: missing'; orig.classList.add('missing'); }

  hash.textContent = 'Hash: idle';

  sel.checked = selection.has(x.path);
  sel.addEventListener('change', () => {
    if (sel.checked) selection.add(x.path); else selection.delete(x.path);
    updateStats();
  });

  // On click of hash status, compute now
  hash.addEventListener('click', async () => {
    if (!x.deletable || !x.originalPath) return;
    hash.textContent = 'Hash: computing…';
    const res = await window.api.hashCompare(x.path, x.originalPath);
    if (res.ok) {
      if (res.match) { hash.textContent = 'Hash: match'; hash.classList.remove('mismatch'); hash.classList.add('match'); }
      else { hash.textContent = 'Hash: mismatch'; hash.classList.remove('match'); hash.classList.add('mismatch'); }
    } else {
      hash.textContent = 'Hash: error';
    }
  });

  return el;
}

function renderGrid() {
  const q = $('#searchInput').value.trim().toLowerCase();
  filtered = !q ? items : items.filter(i => i.name.toLowerCase().includes(q) || i.path.toLowerCase().includes(q));

  const grid = $('#grid');
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  filtered.forEach(x => frag.appendChild(buildCard(x)));
  grid.appendChild(frag);
  updateStats();
}

function computeFolderCounts() {
  folderCounts = new Map();
  for (const it of items) {
    if (!it.deletable) continue;
    const k = it.dir;
    const prev = folderCounts.get(k) || { count: 0, size: 0 };
    prev.count += 1;
    prev.size += it.size;
    folderCounts.set(k, prev);
  }
}

function buildFolderTree() {
  computeFolderCounts();
  const tree = $('#folderTree');
  tree.innerHTML = '';
  if (!root) return;

  // Build a nested object structure from folderCounts
  const rootNode = { name: root, path: root, children: {}, count: 0, size: 0 };
  folderCounts.forEach((v, dir) => {
    const rel = dir.startsWith(root) ? dir.slice(root.length).replace(/^\\|\//, '') : dir;
    const parts = rel.split(/\\|\//).filter(Boolean);
    let node = rootNode;
    for (const p of parts) {
      const nextPath = (node.path.endsWith('\\') || node.path.endsWith('/')) ? node.path + p : node.path + pathSep() + p;
      node.children[p] = node.children[p] || { name: p, path: nextPath, children: {}, count: 0, size: 0 };
      node = node.children[p];
    }
    node.count += v.count;
    node.size += v.size;
  });

  function pathSep() {
    return root.includes('\\') ? '\\' : '/';
  }

  function renderNode(node, depth = 0) {
    const div = document.createElement('div');
    div.className = 'node';
    const label = document.createElement('div');
    label.className = 'label';
    label.innerHTML = `<span>${node.name === root ? '(root)' : node.name}</span>` +
      (node.count ? ` <span class="count">${node.count} · ${fmtBytes(node.size)}</span>` : '');
    label.addEventListener('click', () => {
      currentFolder = node.path;
      $('#currentFolder').textContent = node.path;
      $('#deleteFolderBtn').disabled = !(folderCounts.get(node.path));
    });
    div.appendChild(label);
    for (const childName of Object.keys(node.children).sort()) {
      div.appendChild(renderNode(node.children[childName], depth + 1));
    }
    return div;
  }

  tree.appendChild(renderNode(rootNode));
}

async function refreshAll(newItems) {
  items = newItems.sort((a,b) => a.dir.localeCompare(b.dir) || a.name.localeCompare(b.name));
  renderGrid();
  buildFolderTree();
}

// ---------- Event wiring ----------
window.addEventListener('DOMContentLoaded', () => {
  $('#selectRootBtn').addEventListener('click', async () => {
    const sel = await window.api.selectRoot();
    if (!sel) return;
    root = sel;
    $('#rootPath').textContent = root;
    const data = await window.api.scan(root);
    await window.api.startWatch(root);
    selection.clear();
    refreshAll(data);
  });

  $('#searchInput').addEventListener('input', () => renderGrid());

  $('#deleteSelectedBtn').addEventListener('click', async () => {
    if (!selection.size) return;
    const strict = $('#strictHashChk').checked;
    const proceed = confirm(`Delete ${selection.size} selected file(s)? They will go to the Recycle Bin.`);
    if (!proceed) return;
    const paths = Array.from(selection);
    const res = await window.api.deleteSelected(paths, strict);
    selection.clear();
    alert(`Deleted ${res.deleted} file(s).`);
  });

  $('#deleteFolderBtn').addEventListener('click', async () => {
    if (!currentFolder) return;
    const strict = $('#strictHashChk').checked;
    const info = folderCounts.get(currentFolder);
    if (!info) { alert('No deletable copies in this folder.'); return; }
    const proceed = confirm(`Delete ALL ${info.count} copy file(s) in:\n${currentFolder}\nThey will go to the Recycle Bin.`);
    if (!proceed) return;
    const res = await window.api.deleteFolderCopies(currentFolder, strict);
    alert(`Deleted ${res.deleted} file(s).`);
  });

  strictHash = $('#strictHashChk').checked;
  $('#strictHashChk').addEventListener('change', () => { strictHash = $('#strictHashChk').checked; });

  // Tabs
  $$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // FS updates
  window.api.onFsUpdated((data) => {
    // Keep selection only for still-existing paths
    const set = new Set(data.map(x => x.path));
    selection.forEach(p => { if (!set.has(p)) selection.delete(p); });
    refreshAll(data);
  });
});