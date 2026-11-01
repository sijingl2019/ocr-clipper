// IndexedDB：保存每一页的截图切片（Blob）与 OCR 文本。
// page = { id, seq, url, title, createdAt, slices: Blob[], texts: string[], status, error }
//   status: pending | ocr | done | error

const DB_NAME = 'ocr-clipper';
const STORE = 'pages';
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('seq', 'seq');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        Promise.resolve(fn(store)).then((r) => (result = r));
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

const req2p = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function listPages() {
  const pages = await tx('readonly', (s) => req2p(s.getAll()));
  return pages.sort((a, b) => a.seq - b.seq);
}

export async function getPage(id) {
  return tx('readonly', (s) => req2p(s.get(id)));
}

export async function addPage(page) {
  const pages = await listPages();
  const seq = pages.length ? pages[pages.length - 1].seq + 1 : 1;
  const record = { createdAt: Date.now(), texts: [], status: 'pending', error: '', ...page, seq };
  const id = await tx('readwrite', (s) => req2p(s.add(record)));
  return { ...record, id };
}

export async function updatePage(id, patch) {
  return tx('readwrite', async (s) => {
    const cur = await req2p(s.get(id));
    if (!cur) return null;
    const next = { ...cur, ...patch };
    s.put(next);
    return next;
  });
}

export async function deletePage(id) {
  return tx('readwrite', (s) => req2p(s.delete(id)));
}

export async function clearPages() {
  return tx('readwrite', (s) => req2p(s.clear()));
}

// 交换两页的顺序
export async function swapSeq(idA, idB) {
  return tx('readwrite', async (s) => {
    const a = await req2p(s.get(idA));
    const b = await req2p(s.get(idB));
    if (!a || !b) return;
    [a.seq, b.seq] = [b.seq, a.seq];
    s.put(a);
    s.put(b);
  });
}

export const pageText = (page) => (page.texts || []).filter(Boolean).join('\n\n');
