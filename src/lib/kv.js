// 扩展页面之间传递较大数据（如待打印的 HTML）的简单键值存储，基于 IndexedDB。

let dbp;
function open() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('ocr-clipper-kv', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', mode);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const kvSet = (key, value) => run('readwrite', (s) => s.put(value, key));
export const kvGet = (key) => run('readonly', (s) => s.get(key));
export const kvDel = (key) => run('readwrite', (s) => s.delete(key));
