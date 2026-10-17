import { createBatch, updateBatch, inspectBatch, duplicateCandidates, summarize } from './core/inbox.js';

// Browser previews use IndexedDB. The packaged client always uses the main
// process SQLite store and native OCR; browser records are a separate workspace.
export function inboxClient({id='default',api:desktop=window.songcai}={}) {
  if (desktop?.inbox) return desktop.inbox;
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open(id==='default'?'songcai-inbox-v1':`songcai-inbox-v1-space-${id}`, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('batches', { keyPath: 'id' }); request.result.createObjectStore('images'); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  async function action(name, mode, fn) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode), request = fn(tx.objectStore(name));
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存失败'));
    });
  }
  const all = () => action('batches', 'readonly', store => store.getAll());
  const get = id => action('batches', 'readonly', store => store.get(id));
  const put = batch => action('batches', 'readwrite', store => store.put(batch));
  async function pngData(input) {
    if (typeof input !== 'string' || input.length > 34_000_000 || !/^data:image\/(png|jpeg|webp);base64,/.test(input)) throw new Error('图片格式无效或超过25MB');
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('图片无法读取')); image.src = input; });
    if (image.width * image.height > 50_000_000 || image.width > 20_000 || image.height > 20_000) throw new Error('图片过大，请拆分长图');
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    const data = canvas.toDataURL('image/png');
    if (data.length > 34_000_000) throw new Error('转换后图片超过25MB');
    return data;
  }
  const detail = async id => {
    const batch = await get(id);
    if (!batch) throw new Error('记录不存在');
    return { batch, analysis: batch.state === 'posted' ? { result: batch.result, summary: summarize([batch.result]), blockers: [], duplicates: [], eligible: false }
      : inspectBatch(batch, duplicateCandidates(batch, await all())) };
  };
  let writes = Promise.resolve();
  const serialize = fn => { const next = writes.catch(() => {}).then(fn); writes = next; return next; };
  const api = {
    async list({ businessDate = '', state = '', page = 1, search = '' } = {}) {
      const batches = (await all()).filter(batch => !businessDate || batch.businessDate === businessDate).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const matched = batches.filter(batch => (!state || batch.state === state) && `${batch.name} ${batch.player} ${batch.source} ${batch.text}`.includes(search));
      page = Math.min(page, Math.ceil(matched.length / 40) || 1);
      return { items: matched.slice((page - 1) * 40, page * 40).map(batch => ({ ...batch, pages: batch.pages.length, images: batch.assets.length, preview: batch.text.slice(0, 100), totalCents: batch.result ? summarize([batch.result]).totalCents : 0 })),
        page, pages: Math.ceil(matched.length / 40) || 1, total: matched.length, pending: batches.filter(batch => batch.state === 'draft').length, posted: batches.filter(batch => batch.state === 'posted').length,
        summary: summarize(batches.filter(batch => batch.state === 'posted').map(batch => batch.result)), mappings: [] };
    },
    get: detail,
    create: fields => serialize(async () => { const batch = createBatch(fields, crypto.randomUUID()); await put(batch); return detail(batch.id); }),
    update: ({ id, revision, patch }) => serialize(async () => { const batch = await get(id); if (batch.revision !== revision) throw new Error('记录已更新，请重新打开'); await put(updateBatch(batch, patch)); return detail(id); }),
    confirm: entries => serialize(async () => {
      const outcome = { posted: [], already: [], rejected: [] };
      for (const { id, revision } of entries) {
        const { batch, analysis } = await detail(id);
        if (batch.state === 'posted') { outcome.already.push(id); continue; }
        if (revision !== batch.revision || !analysis.eligible) { outcome.rejected.push({ id, reason: analysis.blockers.join('；') || '记录已更新' }); continue; }
        summarize([...(await all()).filter(item => item.state === 'posted').map(item => item.result), analysis.result]);
        await put({ ...batch, state: 'posted', result: analysis.result, confirmedAt: new Date().toISOString(), revision: batch.revision + 1 }); outcome.posted.push(id);
      }
      return outcome;
    }),
    skip: ({ id, revision }) => serialize(async () => { const batch = await get(id); if (batch.state === 'posted' || batch.revision !== revision) throw new Error('记录不可修改'); await put({ ...batch, state: batch.state === 'skipped' ? 'draft' : 'skipped', revision: revision + 1 }); return detail(id); }),
    asset: id => action('images', 'readonly', store => store.get(id)),
    images: ({ fields, images, batchId, revision }) => serialize(async () => {
      const batch = batchId ? await get(batchId) : createBatch({ ...fields, kind: 'image' }, crypto.randomUUID());
      if (batch.state !== 'draft' || (batchId && batch.revision !== revision)) throw new Error('记录不可修改');
      if (!Array.isArray(images) || images.length > 30 || batch.assets.length + images.length > 100) throw new Error('每次最多30张，一份记录最多100张图片');
      for (const image of images) {
        const id = crypto.randomUUID();
        const data = await pngData(image.data);
        await action('images', 'readwrite', store => store.put(data, id));
        const bytes = Uint8Array.from(atob(data.split(',')[1]), character => character.charCodeAt(0));
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        batch.assets.push({ id, name: image.name, sha256: [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('') });
      }
      batch.problems.push('浏览器预览未启用 OCR，请填写识别文本；桌面版使用本地系统 OCR');
      batch.review = { source: false, content: false, range: false, duplicates: false, warnings: false }; batch.revision++;
      await put(batch); return detail(batch.id);
    }),
    status: async () => ({ platform: 'browser', ocr: false, screen: false, accessibility: false }),
    clipboard: async () => ({ text: await navigator.clipboard.readText() }),
    stop: async () => {},
    async export({ businessDate = '' } = {}) {
      const batches = (await all()).filter(batch => !businessDate || batch.businessDate === businessDate);
      const assets = await Promise.all(batches.flatMap(batch => batch.assets.map(async asset => ({ id: asset.id, data: (await api.asset(asset.id)).split(',')[1] }))));
      const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'songcai-inbox-backup', schemaVersion: 1, batches, assets })], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = '松财微信收件箱.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return true;
    },
  };
  for (const name of ['windows', 'preview', 'capture', 'permission', 'restore', 'reocr']) api[name] = async () => { throw new Error('请在松财桌面版中使用此功能'); };
  return api;
}
