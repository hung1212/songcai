const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { InboxStore } = require('./inbox-store.cjs');

function validCrop(value) {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) throw new Error('请先在预览中框选收藏正文');
  if (value.x < 0 || value.y < 0 || value.width < 0.15 || value.height < 0.15 || value.x + value.width > 1.001 || value.y + value.height > 1.001) throw new Error('正文区域无效或过小，请重新框选');
  return value;
}
function runHelper(request, { platform = process.platform, base, signal } = {}) {
  if (!['darwin', 'win32'].includes(platform)) return Promise.reject(new Error('微信读取和本地 OCR 目前支持 Mac 与 Windows 桌面版'));
  const command = platform === 'darwin' ? path.join(base, 'bin/wechat-reader') : 'powershell.exe';
  const args = platform === 'darwin' ? [] : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(base, 'wechat-reader.ps1')];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, signal });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let output = '', errors = '', settled = false;
    const timer = setTimeout(() => { child.kill(); done(new Error('系统识别／读取超时，已保存原图，可手动校正后继续')); }, request.command === 'ocr' ? 90_000 : 20_000);
    function done(error, result) { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); }
    child.on('error', error => done(error.name === 'AbortError' ? new Error('采集已停止') : new Error(`读取组件无法启动：${error.message}`)));
    child.stdout.on('data', chunk => { output += chunk.toString('utf8'); if (output.length > 4_000_000) { child.kill(); done(new Error('识别结果过大，请拆分图片')); } });
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString('utf8')).slice(-2000); });
    child.on('close', code => {
      try { const result = JSON.parse(output.replace(/^\uFEFF/, '')); done(result.error ? new Error(result.error) : code ? new Error(errors || '系统读取失败') : null, result); }
      catch { done(new Error(errors || '读取组件未返回有效结果')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

module.exports = async function installInbox({ electron, window: getWindow, nativeRequest, sleep = delay, spaces, directory, spaceId='default', register=true }) {
  if(spaces)return require('./scoped-service.cjs').scopedService({name:'inbox',electron,getWindow,spaces,
    methods:['list','get','create','update','confirm','skip','asset','clipboard','images','reocr','status','permission','windows','preview','capture','stop','export','restore'],
    readOnly:['list','get','asset','status','windows','stop','export'],exclusive:['images','reocr','capture'],
    create:id=>installInbox({electron,window:getWindow,nativeRequest,sleep,directory:spaces.dataDirectory(id),spaceId:id,register:false})});
  const { app, ipcMain, nativeImage, desktopCapturer, clipboard, systemPreferences, shell, dialog } = electron;
  const core = await import('../src/core/inbox.js');
  const { restoreOcrSpaces } = await import('../src/core/ocr-spacing.js');
  const store = new InboxStore(path.join(directory||app.getPath('userData'), 'wechat-inbox'), core);
  store.recover();
  const base = app.isPackaged ? path.join(process.resourcesPath, 'native') : path.join(__dirname, '../native');
  const helper = nativeRequest || ((request, signal) => runHelper(request, { base, signal }));
  let running = null;
  const emit = id => { const win = getWindow(); if (win && !win.webContents.isDestroyed()) win.webContents.send('inbox:changed', { id,spaceId }); };
  const handlers = {};
  async function snapshot(target) {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 2400, height: 2400 }, fetchWindowIcons: false });
    const source = sources.find(item => item.id.split(':')[1] === String(target.id));
    if (!source || source.thumbnail.isEmpty()) throw new Error('没有取得目标微信窗口画面，请检查屏幕录制权限，保持窗口可见且不要最小化');
    return source.thumbnail;
  }
  function normalizedImage(data) {
    if (typeof data !== 'string' || data.length > 34_000_000 || !/^data:image\/(png|jpeg|webp);base64,/.test(data)) throw new Error('请选择 PNG、JPG 或 WebP 图片（最多25MB）');
    const image = nativeImage.createFromDataURL(data);
    if (image.isEmpty()) throw new Error('图片无法读取');
    const { width, height } = image.getSize();
    if (width * height > 50_000_000 || width > 20_000 || height > 20_000) throw new Error('图片过大，请拆分长图');
    return image;
  }
  function begin(id, work) {
    if (running) throw new Error('已有采集或识别任务，请等待完成或停止');
    const controller = new AbortController();
    const task = { id, controller, done: null };
    running = task;
    task.done = Promise.resolve().then(() => work(controller.signal)).catch(error => {
      const batch = store.get(id); batch.problems.push(error.message); if (batch.capture) batch.capture.status = 'interrupted'; store.save(batch);
    }).finally(() => {
      const batch = store.get(id); batch.busy = false; batch.revision++; store.save(batch);
      if (running === task) running = null;
      emit(id);
    });
  }
  async function recognizeAsset(id, asset, signal) {
    let ocr;
    try { ocr = restoreOcrSpaces(await helper({ command: 'ocr', path: store.assetPath(asset.id) }, signal)); }
    catch (error) {
      const batch = store.get(id); batch.problems.push(`${asset.name}：${error.message}`); store.save(batch); throw error;
    }
    const batch = store.get(id);
    batch.pages.push({ assetId: asset.id, text: ocr.text, rawText: ocr.rawText, lines: ocr.lines, engine: ocr.engine,
      spacingChanges: ocr.spacingChanges, lowConfidenceLines: ocr.lowConfidenceLines || [], capturedAt: new Date().toISOString() });
    if (ocr.spacingWarning) batch.problems.push(`${asset.name}：${ocr.spacingWarning}`);
    if (batch.kind === 'favorite') {
      const transcript = core.stitchPages([...(batch.text ? [{ text: batch.text }] : []), { text: ocr.text }]);
      batch.text = transcript.text; batch.capture.overlaps.push(...transcript.overlaps.map(item => ({ ...item, page: batch.pages.length })));
      batch.problems = [...new Set([...batch.problems, ...transcript.problems.map(text => text.replace('第2页', `第${batch.pages.length}页`))])];
    } else batch.text = [batch.text, ocr.text].filter(Boolean).join('\n');
    batch.revision++; store.save(batch); emit(id);
    return asset;
  }
  async function addImage(id, image, name, signal) {
    const asset = store.addAsset(id, image.toPNG(), name, image.getSize());
    emit(id);
    return recognizeAsset(id, asset, signal);
  }
  handlers.list = input => store.list(input);
  handlers.get = id => store.detail(id);
  handlers.create = fields => store.detail(store.create(fields).id);
  handlers.update = ({ id, revision, patch }) => { const result = store.update(id, revision, patch); emit(id); return result; };
  handlers.confirm = entries => { const result = store.confirm(entries); emit(null); return result; };
  handlers.skip = ({ id, revision }) => { store.skip(id, revision); emit(id); return store.detail(id); };
  handlers.asset = id => fs.readFile(store.assetPath(id)).then(bytes => 'data:image/png;base64,' + bytes.toString('base64'));
  handlers.clipboard = () => {
    const image = clipboard.readImage();
    return image.isEmpty() ? { text: clipboard.readText() } : { image: image.toDataURL(), text: '' };
  };
  handlers.images = ({ fields, images, batchId, revision }) => {
    if (running) throw new Error('请等待当前采集或识别任务结束');
    if (!Array.isArray(images) || images.length < 1 || images.length > 30) throw new Error('每次可导入1～30张图片');
    const prepared = images.map(item => ({ image: normalizedImage(item.data), name: String(item.name || '粘贴图片').slice(0, 160) }));
    const batch = batchId ? store.get(batchId) : store.create({ ...fields, kind: 'image' });
    if (batch.state !== 'draft' || batch.busy || (batchId && batch.revision !== revision)) throw new Error('记录不可修改，请重新打开');
    if (batch.assets.length + prepared.length > 100) throw new Error('一份记录最多100张图片');
    const assets = prepared.map(item => store.addAsset(batch.id, item.image.toPNG(), item.name, item.image.getSize()));
    const saved = store.get(batch.id); saved.busy = true; store.save(saved);
    begin(batch.id, async signal => {
      for (const asset of assets) {
        if (signal.aborted) throw new Error('已停止识别，全部原图已经保存，尚未识别的图片请手动补充文字');
        try { await recognizeAsset(batch.id, asset, signal); } catch { if (signal.aborted) throw new Error('已停止识别，原图已经保存'); }
      }
    });
    return store.detail(batch.id);
  };
  handlers.reocr = ({ id, revision }) => {
    if (running) throw new Error('请等待当前采集或识别任务结束');
    const original = store.get(id);
    if (original.busy || original.revision !== revision || !original.assets.length) throw new Error('记录已变化或没有原图，请重新打开');
    const draft = store.create({ ...original, name: `${original.name} · 重新识别`, text: '' });
    for (const asset of original.assets) store.addAsset(draft.id, require('node:fs').readFileSync(store.assetPath(asset.id)), asset.name, { width: asset.width, height: asset.height });
    const saved = store.get(draft.id);
    saved.busy = true;
    if (original.capture) saved.capture = { ...original.capture, status: 'range-review', overlaps: [] };
    saved.problems.push('这是使用已有原图重新识别的新草稿，原记录仍保留。请核对后仅将同一笔投注入账一次；不再使用的旧草稿可选择跳过。');
    store.save(saved);
    begin(saved.id, async signal => {
      for (const asset of saved.assets) {
        if (signal.aborted) throw new Error('重新识别已停止，全部原图已保存');
        try { await recognizeAsset(saved.id, asset, signal); } catch { if (signal.aborted) throw new Error('重新识别已停止'); }
      }
    });
    return store.detail(saved.id);
  };
  handlers.status = async () => ({ platform: process.platform, ...(await helper({ command: 'status' })), running: running?.id || null });
  handlers.permission = type => {
    if (process.platform !== 'darwin') return false;
    if (type === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true);
    else if (type === 'screen') return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    return true;
  };
  handlers.windows = async () => {
    const found = await helper({ command: 'windows' });
    return found.windows;
  };
  handlers.preview = async id => {
    const { windows } = await helper({ command: 'windows' });
    const target = windows.find(item => item.id === id);
    if (!target) throw new Error('目标窗口不再可用，请刷新列表');
    return { target, image: (await snapshot(target)).toDataURL() };
  };
  handlers.capture = async ({ fields, windowId, crop: inputCrop, maxPages = 30, atStart, batchId, revision }) => {
    if (running) throw new Error('请等待当前采集或识别任务结束');
    if (atStart !== true) throw new Error('请先把收藏滚到需要读取的开头，并确认来源');
    const crop = validCrop(inputCrop);
    const { windows } = await helper({ command: 'windows' });
    const target = windows.find(item => item.id === windowId);
    if (!target) throw new Error('目标微信窗口不存在，请重新预览');
    const limit = Math.max(1, Math.min(100, Math.floor(Number(maxPages) || 30)));
    const batch = batchId ? store.get(batchId) : store.create({ ...fields, kind: 'favorite', text: '' });
    if (batch.state !== 'draft' || batch.busy || (batchId && (batch.revision !== revision || batch.kind !== 'favorite'))) throw new Error('记录不可续读，请重新打开');
    if (batchId && (batch.capture.target.id !== target.id || batch.capture.target.pid !== target.pid || batch.capture.target.name !== target.name)) throw new Error('续读窗口与上次不同，请回到原收藏；另一份收藏请新建记录');
    const lastPage = batch.assets.at(-1);
    batch.busy = true; batch.review = { ...core.REVIEW_DEFAULTS }; batch.revision++;
    batch.capture = { status: 'running', target, crop, maxPages: limit, overlaps: batch.capture?.overlaps || [] }; store.save(batch);
    const identity = { windowId: target.id, pid: target.pid, title: target.name, bounds: target.bounds };
    begin(batch.id, async signal => {
      await helper({ command: 'focus', ...identity }, signal);
      await sleep(1000, signal);
      let previous = batchId ? lastPage?.sha256 || '' : '';
      for (let index = 0; index < limit; index++) {
        await helper({ command: 'check', ...identity }, signal);
        const image = await snapshot(target);
        await helper({ command: 'check', ...identity }, signal);
        const dimensions = image.getSize();
        const area = { x: Math.floor(crop.x * dimensions.width), y: Math.floor(crop.y * dimensions.height),
          width: Math.floor(crop.width * dimensions.width), height: Math.floor(crop.height * dimensions.height) };
        area.width = Math.min(area.width, dimensions.width - area.x); area.height = Math.min(area.height, dimensions.height - area.y);
        const cropped = image.crop(area);
        const hash = createHash('sha256').update(cropped.toPNG()).digest('hex');
        if (hash === previous) {
          if (index === 0 && batchId && limit > 1) { await helper({ command: 'scroll', ...identity, crop }, signal); await sleep(1500, signal); continue; }
          const paused = store.get(batch.id); paused.capture.status = 'range-review';
          paused.problems.push('滚动后画面未变化：可能已到结尾，也可能滚动未生效或尚未加载。请核对原页和读取范围'); store.save(paused); return;
        }
        previous = hash;
        await addImage(batch.id, cropped, `收藏第${store.get(batch.id).assets.length + 1}页`, signal);
        if (index + 1 < limit) { await helper({ command: 'scroll', ...identity, crop }, signal); await sleep(1500, signal); }
      }
      const paused = store.get(batch.id); paused.capture.status = 'page-limit'; paused.problems.push(`达到本次${limit}页上限，请核对是否还有后续内容；不能据此判定收藏已读完`); store.save(paused);
    });
    return store.detail(batch.id);
  };
  handlers.stop = async () => { if (running) { const task = running; task.controller.abort(); await task.done; } return true; };
  handlers.export = async ({ businessDate = '' } = {}) => {
    if (running) throw new Error('请先停止采集，再导出完整备份');
    const result = await dialog.showSaveDialog(getWindow(), { defaultPath: `松财微信收件箱-${businessDate || '全部'}.json`, filters: [{ name: '收件箱备份（含原图）', extensions: ['json'] }] });
    if (result.canceled) return false;
    const backup = JSON.stringify(store.backup(businessDate));
    if (Buffer.byteLength(backup) > 200_000_000) throw new Error('备份超过200MB，请按日期拆分导出');
    await fs.writeFile(result.filePath, backup, 'utf8'); return true;
  };
  handlers.restore = async () => {
    if (running) throw new Error('请先停止采集再恢复备份');
    const selected = await dialog.showOpenDialog(getWindow(), { properties: ['openFile'], filters: [{ name: '松财收件箱备份', extensions: ['json'] }] });
    if (selected.canceled) return null;
    if ((await fs.stat(selected.filePaths[0])).size > 200_000_000) throw new Error('备份超过200MB，请按日期拆分导出');
    const result = store.restore(JSON.parse(await fs.readFile(selected.filePaths[0], 'utf8'))); emit(null); return result;
  };
  if(register)for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`inbox:${name}`, (event, input) => {
    if (event.sender !== getWindow()?.webContents) throw new Error('未知窗口');
    return handler(input);
  });
  return {handlers,busy:()=>!!running, stop: handlers.stop, close: () => store.close(), settlementDocuments: date => store.all(date).filter(batch => batch.state === 'posted').map(batch => ({ ...batch.result, originalText: batch.text })) };
};
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('采集已停止'));
    const done = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('采集已停止')); };
    signal.addEventListener('abort', abort, { once: true });
  });
}
module.exports.validCrop = validCrop;
module.exports.runHelper = runHelper;
