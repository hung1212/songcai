<script setup>
import {useSpace} from "../space-context.js";
const space=useSpace(),songcai=space.api;
import { computed, nextTick, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { inboxClient } from '../inbox-client.js';
import { REVIEW_DEFAULTS, summarize } from '../core/inbox.js';
import AiReview from './AiReview.vue';
import {documentReviewKey} from '../core/ai-review.js';
import { today, formatMoney } from '../core/rules.js';

const api = inboxClient(space), desktop = !!songcai;
const rows = ref({ items: [], summary: summarize([]), pending: 0, posted: 0, total: 0, page: 1, pages: 1, mappings: [] });
const filter = reactive({ businessDate: today(), state: 'draft', page: 1, search: '' });
const defaults = reactive({ player: '', businessDate: today(), source: '' });
const detail = ref(null), form = ref(null), selected = ref([]), error = ref(''), message = ref(''), saving = ref(false), dirty = ref(false), working = ref(false);
const imageInput = ref(), appendImage = ref(false), originals = ref({}), currentImage = ref(''), originalMode = ref('image');
const captureOpen = ref(false), windows = ref([]), windowId = ref(''), preview = ref(null), crop = ref(null), previewImage = ref(), startPoint = ref(null);
const atStart = ref(false), maxPages = ref(30), permission = ref(null), captureBusy = ref(false);
const resumeCapture = ref(false);
let saveTimer, refreshTimer, unsubscribe, saveQueue = Promise.resolve(), loadToken = 0;
const money = formatMoney;
const showAi=ref(false);
const aiDocument=computed(()=>batch.value&&form.value?{id:batch.value.id,name:form.value.name,text:form.value.text,businessDate:form.value.businessDate,defaultPlayer:form.value.player,assistance:batch.value.assistance}:null);
async function applyAssistance(id,key,assistance){
  await flush();if(batch.value?.id!==id||locked.value||documentReviewKey(aiDocument.value)!==key)return false;
  const value=await api.update({id,revision:batch.value.revision,patch:{...form.value,assistance}});
  if(batch.value?.id===id){if(documentReviewKey(aiDocument.value)===key&&!dirty.value)applyDetail(value);else detail.value=value;}
  await refresh();return true;
}
const batch = computed(() => detail.value?.batch);
const analysis = computed(() => detail.value?.analysis);
const locked = computed(() => !batch.value || batch.value.state !== 'draft' || batch.value.busy);
const currentAsset = computed(() => batch.value?.assets.find(asset => asset.id === currentImage.value));
const currentPage = computed(() => batch.value?.pages.find(page => page.assetId === currentImage.value));
const stateLabel = item => item.busy ? '采集／识别中' : ({ draft: '待核对', posted: '已入账', skipped: '已跳过' }[item.state]);
const kindLabel = kind => ({ text: '文字', image: '图片', favorite: '收藏' }[kind]);
const cropStyle = computed(() => crop.value ? { left: `${crop.value.x * 100}%`, top: `${crop.value.y * 100}%`, width: `${crop.value.width * 100}%`, height: `${crop.value.height * 100}%` } : {});

async function attempt(fn) {
  error.value = '';
  try { return await fn(); } catch (e) { error.value = e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
}
async function refresh() { rows.value = await api.list({ ...filter }); selected.value = selected.value.filter(id => rows.value.items.some(item => item.id === id)); }
function applyDetail(value) {
  detail.value = value;
  form.value = { text: value.batch.text, player: value.batch.player, name: value.batch.name, source: value.batch.source, businessDate: value.batch.businessDate,
    multiplePlayers: value.batch.multiplePlayers, review: { ...value.batch.review } };
  dirty.value = false;
  if (!value.batch.assets.some(asset => asset.id === currentImage.value)) currentImage.value = value.batch.assets[0]?.id || '';
}
async function choose(id) {
  await flush();
  const token = ++loadToken;
  const result = await api.get(id);
  if (token === loadToken) applyDetail(result);
}
function edit() {
  form.value.review = { ...REVIEW_DEFAULTS }; dirty.value = true;
  clearTimeout(saveTimer); saveTimer = setTimeout(() => attempt(flush), 650);
}
async function flush() {
  clearTimeout(saveTimer);
  const next = saveQueue.catch(() => {}).then(async () => {
    if (!dirty.value || locked.value) return;
    const id = batch.value.id, revision = batch.value.revision, patch = JSON.parse(JSON.stringify(form.value));
    saving.value = true;
    try {
      const result = await api.update({ id, revision, patch });
      if (batch.value?.id === id) {
        if (JSON.stringify(form.value) === JSON.stringify(patch)) applyDetail(result);
        else { detail.value = result; dirty.value = true; }
      }
      await refresh();
    } finally { saving.value = false; }
  });
  saveQueue = next; await next;
  // Edits made while the previous IPC write was in flight must also reach disk.
  if (dirty.value && !locked.value) await flush();
}
defineExpose({ flush });
async function review(key, checked) {
  await attempt(async () => {
    await flush();
    form.value.review[key] = checked; dirty.value = true;
    await flush();
  });
}
function fields(name = '微信记录') { return { ...defaults, name: defaults.source || `${name} · ${new Date().toLocaleTimeString('zh-CN')}`, text: '' }; }
async function newText(text = '') {
  await flush(); applyDetail(await api.create({ ...fields('粘贴文字'), text, kind: 'text' }));
  filter.state = 'draft'; filter.businessDate = defaults.businessDate; filter.page = 1; await refresh();
}
async function paste() {
  working.value = true;
  await attempt(async () => { const data = await api.clipboard(); if (data.image) await importImages([{ name: '微信剪贴板图片', data: data.image }]); else if (data.text?.trim()) await newText(data.text); else throw new Error('剪贴板中没有文字或图片'); });
  working.value = false;
}
async function handlePaste(event) {
  const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
  if (!files.length) return;
  event.preventDefault(); await attempt(async () => importImages(await readImages(files)));
}
function pickImages(append = false) { appendImage.value = append; imageInput.value.click(); }
async function readImages(files) {
  if (files.length > 30) throw new Error('一次最多30张图片');
  return Promise.all(files.map(file => new Promise((resolve, reject) => {
    if (file.size > 25_000_000) { reject(new Error('单张图片不能超过25MB')); return; }
    const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, data: reader.result }); reader.onerror = () => reject(new Error('读取图片失败')); reader.readAsDataURL(file);
  })));
}
async function importImages(images, append = false) {
  await flush();
  const result = await api.images({ fields: fields('图片记录'), images, ...(append && batch.value ? { batchId: batch.value.id, revision: batch.value.revision } : {}) });
  applyDetail(result); filter.state = 'draft'; filter.businessDate = result.batch.businessDate; await refresh();
}
async function imageFiles(event) {
  working.value = true;
  await attempt(async () => importImages(await readImages([...event.target.files]), appendImage.value));
  event.target.value = ''; working.value = false;
}
async function reocr() {
  working.value = true;
  await attempt(async () => {
    await flush();
    const result = await api.reocr({ id: batch.value.id, revision: batch.value.revision });
    applyDetail(result); filter.state = 'draft'; filter.businessDate = result.batch.businessDate; filter.page = 1;
    message.value = '已用原图新建识别草稿，原记录和手动校正内容仍然保留。'; await refresh();
  });
  working.value = false;
}
async function confirm(ids) {
  await attempt(async () => {
    await flush(); working.value = true;
    const entries = await Promise.all(ids.map(async id => { const data = await api.get(id); return { id, revision: data.batch.revision }; }));
    const result = await api.confirm(entries);
    message.value = `已入账 ${result.posted.length} 份，已处理 ${result.already.length} 份，待核对 ${result.rejected.length} 份`;
    if (result.rejected.length) error.value = result.rejected.map(item => item.reason).join('；');
    if (batch.value) await choose(batch.value.id); await refresh(); selected.value = [];
  });
  working.value = false;
}
async function skip() { await attempt(async () => { await flush(); applyDetail(await api.skip({ id: batch.value.id, revision: batch.value.revision })); await refresh(); }); }
async function openCapture(resume = false) {
  resumeCapture.value = resume;
  captureOpen.value = true; preview.value = null; crop.value = null; atStart.value = false;
  await attempt(async () => { permission.value = await api.status(); windows.value = await api.windows(); windowId.value = resume ? batch.value.capture.target.id : windows.value[0]?.id || ''; });
}
async function loadPreview() {
  captureBusy.value = true; crop.value = null; atStart.value = false;
  await attempt(async () => { preview.value = await api.preview(windowId.value); });
  captureBusy.value = false;
}
function relativePoint(event) {
  const rect = previewImage.value.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
}
function beginCrop(event) { startPoint.value = relativePoint(event); event.currentTarget.setPointerCapture(event.pointerId); crop.value = null; }
function moveCrop(event) {
  if (!startPoint.value) return;
  const point = relativePoint(event), start = startPoint.value;
  crop.value = { x: Math.min(point.x, start.x), y: Math.min(point.y, start.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) };
}
async function startCapture() {
  captureBusy.value = true;
  await attempt(async () => {
    await flush();
    const result = await api.capture({ fields: fields('收藏记录'), windowId: windowId.value, crop: { ...crop.value }, maxPages: maxPages.value, atStart: atStart.value,
      ...(resumeCapture.value ? { batchId: batch.value.id, revision: batch.value.revision } : {}) });
    applyDetail(result); captureOpen.value = false; filter.state = 'draft'; filter.businessDate = defaults.businessDate; await refresh();
  });
  captureBusy.value = false;
}
async function stop() { await attempt(async () => { await api.stop(); if (batch.value) await choose(batch.value.id); await refresh(); }); }
function sourceChanged() { const mapping = rows.value.mappings.find(item => item.source === defaults.source); if (mapping) defaults.player = mapping.player; }
async function restore() { await attempt(async () => { await flush(); const result = await api.restore(); if (result) { message.value = `恢复 ${result.restored} 份，已有 ${result.skipped} 份，冲突 ${result.conflicts} 份（保留本机版本）`; await refresh(); } }); }
watch(filter, () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => attempt(refresh), 200); }, { deep: true });
watch(currentImage, async id => { if (id && !originals.value[id]) await attempt(async () => { originals.value[id] = await api.asset(id); }); });
onMounted(async () => {
  await attempt(refresh);
  unsubscribe = songcai?.onInboxChanged(({ id }) => {
    attempt(async () => {
      await refresh();
      if (id && batch.value?.id === id && batch.value.busy && !dirty.value) applyDetail(await api.get(id));
    });
  });
});
onBeforeUnmount(() => { clearTimeout(saveTimer); clearTimeout(refreshTimer); unsubscribe?.(); });
</script>

<template>
  <div class="page-body inbox-page" @paste="handlePaste">
    <section class="page-heading"><div><div class="eyebrow">WECHAT INBOX</div><h1>记录先收好，账目再核对。</h1><p>文字、图片与收藏统一整理，确认后才计入微信账目。</p></div><div class="heading-actions"><button class="button" @click="restore" :disabled="!desktop || working">恢复备份</button><button class="button" @click="attempt(async () => { await flush(); if (await api.export({ businessDate: filter.businessDate })) message = '已导出所选日期的记录及原图'; })">导出含原图备份</button></div></section>
    <div v-if="!desktop" class="inbox-note">浏览器预览：文字与图片保存在当前浏览器；本地 OCR 和微信收藏读取请使用桌面版。</div>
    <div v-if="error" class="inbox-alert" role="alert">{{ error }}<button aria-label="关闭错误提示" @click="error = ''">×</button></div>
    <div v-if="message" class="inbox-note" role="status">{{ message }}<button @click="message = ''">×</button></div>

    <section class="inbox-intake panel">
      <div class="inbox-fields"><label>本批业务日期<input type="date" v-model="defaults.businessDate" /></label><label>微信来源备注<input v-model="defaults.source" list="wechat-sources" placeholder="例如：小明的私聊／今日收藏" @change="sourceChanged" /><datalist id="wechat-sources"><option v-for="item in rows.mappings" :key="item.source" :value="item.source" /></datalist></label><label>绑定玩家<input v-model="defaults.player" placeholder="可不填，按本单玩家统计" /></label></div>
      <div class="inbox-actions"><button class="button primary" :disabled="working || batch?.busy" @click="paste">▣ 粘贴微信记录</button><button class="button" :disabled="working || batch?.busy" @click="pickImages()">＋ 导入图片</button><button class="button" @click="attempt(() => newText())">＋ 添加文字</button><button class="button" :disabled="!desktop || batch?.busy" @click="openCapture(false)">▤ 读取当前收藏</button><span>来源绑定可复用；新记录段默认新市场</span></div>
    </section>

    <section class="inbox-overview"><div><span>所选日期已入账</span><strong>¥ {{ money(rows.summary.totalCents) }}</strong></div><div v-for="market in ['新','旧','港']" :key="market"><span>{{ market }}市场</span><strong>{{ money(rows.summary.markets[market]) }}</strong></div><div><span>待核对 / 已入账</span><strong>{{ rows.pending }} <small>/ {{ rows.posted }} 份</small></strong></div></section>
    <section class="inbox-filters"><input type="date" v-model="filter.businessDate" aria-label="收件箱日期筛选" @change="filter.page = 1" /><button class="text-button" @click="filter.businessDate = ''; filter.page = 1">全部日期</button><select v-model="filter.state" aria-label="收件箱状态" @change="filter.page = 1"><option value="draft">待核对</option><option value="posted">已入账</option><option value="">全部记录</option><option value="skipped">已跳过</option></select><input v-model="filter.search" placeholder="搜索玩家、来源或原文" aria-label="搜索微信记录" @input="filter.page = 1" /><button class="button" :disabled="!selected.length || working" @click="confirm(selected)">确认选中合格项（{{ selected.length }}）</button></section>

    <div class="inbox-workbench">
      <section class="panel inbox-list"><div class="panel-heading"><h2>收件箱 <small>{{ rows.total }} 份</small></h2><button class="text-button" @click="selected = rows.items.filter(item => item.state === 'draft' && !item.busy).map(item => item.id)">选择本页</button></div><div v-for="item in rows.items" :key="item.id" :class="['inbox-item', { active: item.id === batch?.id }]"><input type="checkbox" v-model="selected" :value="item.id" :disabled="item.state !== 'draft' || item.busy" :aria-label="`选择${item.name}`" /><button @click="attempt(() => choose(item.id))"><div><strong>{{ item.player || '本单玩家' }}</strong><span :class="['inbox-status', item.state]">{{ stateLabel(item) }}</span></div><p>{{ item.name }}</p><small>{{ kindLabel(item.kind) }} · {{ item.businessDate }}<template v-if="item.images"> · {{ item.images }} 张原图</template></small><p class="inbox-preview">{{ item.preview || '等待补充文字…' }}</p><b v-if="item.state === 'posted'">¥ {{ money(item.totalCents) }}</b></button></div><div v-if="!rows.items.length" class="empty-state"><span>▤</span><strong>把微信记录放到这里</strong><p>粘贴文字或图片；未填玩家时整份作为同一玩家。</p></div><div class="pagination"><button :disabled="rows.page === 1" @click="filter.page--">上一页</button><span>{{ rows.page }} / {{ rows.pages }}</span><button :disabled="rows.page === rows.pages" @click="filter.page++">下一页</button></div></section>

      <section class="panel inbox-detail" v-if="batch && form">
        <div class="panel-heading"><h2>{{ stateLabel(batch) }} · {{ kindLabel(batch.kind) }}</h2><button v-if="batch.kind === 'favorite' && batch.state === 'draft' && !batch.busy" class="text-button" @click="openCapture(true)">继续读这份</button><span class="save-state">{{ saving ? '正在保存…' : dirty ? '等待保存' : '已保存到本机' }}</span><button v-if="batch.busy" class="button" @click="stop">停止并保留进度</button></div>
        <div v-if="batch.busy" class="inbox-note">正在采集／识别，已保存 {{ batch.assets.length }} 张原图。收藏自动滚动时请保持微信在前台；切换窗口后会暂停。</div>
        <div class="inbox-detail-config"><label>记录名称<input v-model="form.name" :disabled="locked" @input="edit" /></label><label>玩家<input v-model="form.player" :disabled="locked" placeholder="必填或启用多玩家署名" @input="edit" /></label><label>业务日期<input type="date" v-model="form.businessDate" :disabled="locked" @input="edit" /></label><label>来源备注<input v-model="form.source" :disabled="locked" @input="edit" /></label></div>
        <label class="inbox-check"><input type="checkbox" v-model="form.multiplePlayers" :disabled="locked" @change="edit" />使用原文中的多玩家署名（逐一核对归属）</label>
        <div class="inbox-reading" :class="{ 'has-images': batch.assets.length }">
          <div v-if="batch.assets.length" class="inbox-original"><div class="inbox-original-tools"><select v-model="currentImage" aria-label="查看原图"><option v-for="(asset, index) in batch.assets" :key="asset.id" :value="asset.id">{{ index + 1 }} · {{ asset.name }}</option></select><button class="text-button" @click="originalMode = originalMode === 'image' ? 'text' : 'image'">{{ originalMode === 'image' ? '逐页原始OCR' : '查看原图' }}</button></div><div class="inbox-image-scroll" v-if="originalMode === 'image'"><img v-if="originals[currentImage]" :src="originals[currentImage]" :alt="currentAsset?.name" /><p v-else>原图加载中…</p></div><pre v-else>{{ currentPage?.rawText ?? currentPage?.text ?? '本页未识别成功，请查看原图并手动补充' }}</pre><p>原图保留。缩略图或折叠聊天未展开时，请补充原图。</p>
            <details v-if="currentPage?.spacingChanges?.length" class="ocr-spacing"><summary>已按原图间距恢复 {{ currentPage.spacingChanges.length }} 处号码分隔</summary><p v-for="(change, i) in currentPage.spacingChanges" :key="i">第{{ change.line }}行：<code>{{ change.original }}</code> → <code>{{ change.restored }}</code></p></details>
            <p v-if="currentPage?.lowConfidenceLines?.length" class="ocr-review-note">本页有识别把握较低的文字，请特别核对玩法、号码与金额。</p>
            <button v-if="desktop" class="text-button" :disabled="batch.busy || working" @click="reocr">用原图重新识别（新草稿）</button>
          </div>
          <div class="inbox-transcript"><label for="inbox-transcript">{{ batch.kind === 'text' ? '投注原文' : '识别文本 · 可校正' }}</label><textarea id="inbox-transcript" v-model="form.text" :disabled="locked" @input="edit" placeholder="旧 1 2 3 各100元&#10;特肖虎100元" spellcheck="false" /><div class="inbox-actions"><button class="text-button" :disabled="locked" @click="attempt(flush)">保存并重新解析</button><button class="text-button" :disabled="locked || working" @click="pickImages(true)">补充图片</button></div><details><summary>查看最初导入文字</summary><pre>{{ batch.originalText || '此记录以图片／收藏原页为来源，请在左侧查看。' }}</pre></details></div>
        </div>
        <template v-if="batch.state==='draft'&&!batch.busy"><button class="button inbox-ai-toggle" @click="showAi=!showAi">{{showAi?'收起AI核验':'AI核验与解释确认'}}</button><AiReview v-show="showAi" :key="batch.id" :document="aiDocument" :prepare="flush" :apply="applyAssistance" /></template>
        <div class="inbox-parse-result"><strong>解析预览：¥ {{ money(analysis.summary.totalCents) }}</strong><span v-for="market in ['新','旧','港']" :key="market">{{ market }} {{ money(analysis.summary.markets[market]) }}</span><small>{{ analysis.result?.bets.length || 0 }} 笔 · {{ analysis.summary.players.length }} 位玩家{{ batch.state !== 'posted' ? ' · 尚未入账' : '' }}</small></div>
        <details class="inbox-bets" v-if="analysis.result?.bets.length"><summary>查看投注与市场来源</summary><div v-for="bet in analysis.result.bets" :key="bet.id"><strong>{{ bet.player }} · {{ bet.markets.join('＋') }} · {{ money(bet.totalCents) }}</strong><span>{{ bet.play }} · 第{{ bet.line }}行 · {{ bet.marketSource ? `市场来自第${bet.marketSource}行` : '默认新' }}</span><p>{{ bet.raw }}</p></div></details>
        <div class="inbox-problems" v-if="analysis.result?.issues.length || batch.problems.length || analysis.duplicates.length"><p v-for="issue in analysis.result?.issues || []" :key="issue.id">第{{ issue.line }}行：{{ issue.message }}</p><p v-for="(problem, i) in batch.problems" :key="i">{{ problem }}</p><p v-for="duplicate in analysis.duplicates" :key="duplicate.id">疑似重复：{{ duplicate.name }}（{{ stateLabel(duplicate) }}）。真实再次发送的相同投注可以保留；重复采集请跳过。</p></div>
        <div v-if="batch.state === 'draft'" class="inbox-review"><label class="inbox-check"><input type="checkbox" :checked="form.review.source" :disabled="locked" @change="review('source', $event.target.checked)" />已核对玩家、业务日期和本段市场起点；缺少前文时已补齐市场</label><label class="inbox-check" v-if="batch.kind !== 'text' || batch.assets.length"><input type="checkbox" :checked="form.review.content" :disabled="locked" @change="review('content', $event.target.checked)" />已逐页核对金额、号码和顺序；图片完整，真实重复投注已保留</label><label class="inbox-check" v-if="batch.kind === 'favorite'"><input type="checkbox" :checked="form.review.range" :disabled="locked" @change="review('range', $event.target.checked)" />已对照微信确认本份收藏从起点到结尾完整，没有缺页或未展开图片</label><label class="inbox-check" v-if="analysis.duplicates.length"><input type="checkbox" :checked="form.review.duplicates" :disabled="locked" @change="review('duplicates', $event.target.checked)" />已核对重复提示，这是另一次真实记录</label><label class="inbox-check" v-if="analysis.result?.issues.some(i => i.severity === 'warning') || batch.problems.length"><input type="checkbox" :checked="form.review.warnings" :disabled="locked" @change="review('warnings', $event.target.checked)" />已核对上方提醒，必要修正已反映到识别文本</label></div>
        <footer class="inbox-detail-footer"><span>{{ batch.state === 'posted' ? '已确认账目锁定保存，重复确认不会重复入账' : analysis.blockers[0] || '核对完成，可以入账' }}</span><button class="button" v-if="batch.state !== 'posted'" :disabled="batch.busy" @click="skip">{{ batch.state === 'skipped' ? '恢复待核对' : '跳过这份' }}</button><button class="button primary" :disabled="!analysis.eligible || dirty || saving || working" @click="confirm([batch.id])">确认入账</button></footer>
      </section>
      <section v-else class="panel empty-state inbox-empty"><span>↙</span><strong>选择一份记录开始核对</strong><p>已保存的原文和图片会一直保留，关闭后可继续。</p></section>
    </div>
    <details class="panel inbox-account" :open="filter.state === 'posted'"><summary>玩家 × 市场账目 · 仅含所选日期的已确认微信记录</summary><table class="account-table"><thead><tr><th>玩家</th><th>新</th><th>旧</th><th>港</th><th>合计</th></tr></thead><tbody><tr v-for="player in rows.summary.players" :key="player.id"><td>{{ player.name }}</td><td>{{ money(player.新) }}</td><td>{{ money(player.旧) }}</td><td>{{ money(player.港) }}</td><td>{{ money(player.totalCents) }}</td></tr></tbody></table><p v-if="!rows.posted" class="table-note">确认入账后显示。原“投注账目”中的文本另行统计。</p></details>

    <div v-if="captureOpen" class="inbox-modal" role="dialog" aria-modal="true" aria-label="读取当前微信收藏"><section class="capture-dialog"><header><div><h2>读取当前收藏</h2><p>打开微信收藏详情并滚到开头，选择窗口，在预览上拖出正文区域。</p></div><button class="icon-button" aria-label="关闭收藏读取" @click="captureOpen = false">×</button></header><div v-if="error" class="inbox-alert">{{ error }}</div><div v-if="permission?.platform === 'darwin'" class="capture-permissions"><span>屏幕录制：{{ permission.screen ? '已允许' : '需要授权' }} · 辅助功能：{{ permission.accessibility ? '已允许' : '需要授权' }}</span><button class="text-button" @click="attempt(() => api.permission('screen'))">设置屏幕录制</button><button class="text-button" @click="attempt(() => api.permission('accessibility'))">设置辅助功能</button><small>授权后若仍不可读，请完全退出松财再打开。</small></div><div class="inbox-actions"><select v-model="windowId" aria-label="微信窗口" @change="preview = null; crop = null; atStart = false"><option v-for="item in windows" :key="item.id" :value="item.id">{{ item.name || '微信窗口' }} · {{ item.id }}</option></select><button class="button" @click="attempt(async () => { windows = await api.windows(); permission = await api.status(); })">刷新窗口</button><button class="button" :disabled="!windowId || captureBusy" @click="loadPreview">获取预览</button></div><p class="capture-tip">只框选消息正文，避开标题、侧栏、滚动条和输入框。若收藏显示在主窗口内，也可以框选对应区域。图片目前读取画面中可见内容，模糊缩略图需要补充原图。</p><div v-if="preview" class="capture-preview" @pointerdown="beginCrop" @pointermove="moveCrop" @pointerup="moveCrop($event); startPoint = null" @pointercancel="startPoint = null"><img ref="previewImage" :src="preview.image" alt="待采集微信窗口预览" draggable="false" /><div v-if="crop" class="capture-selection" :style="cropStyle"><span>正文区域</span></div></div><div v-else class="empty-state"><strong>先打开收藏详情，再获取预览</strong><p>没有微信窗口时，请确认微信已打开且没有最小化。</p></div><footer><label class="inbox-check"><input type="checkbox" v-model="atStart" />{{ resumeCapture ? '已回到原收藏的续读位置，并保留上一页重叠区域' : '已确认这是目标收藏，并已滚到要读取的开头' }}</label><div class="inbox-actions"><label>本次最多 <select v-model.number="maxPages"><option :value="1">1页（试读）</option><option :value="10">10页</option><option :value="30">30页</option><option :value="100">100页</option></select></label><span>会自动滚动；停止后仍需核对读取范围</span><button class="button primary" :disabled="!preview || !crop || !atStart || captureBusy" @click="startCapture">{{ captureBusy ? '准备中…' : '开始读取' }}</button></div></footer></section></div>
    <input ref="imageInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden @change="imageFiles" />
  </div>
</template>

<style scoped>
.inbox-ai-toggle{margin:0 16px 14px}.inbox-detail :deep(.ai-page){padding:0 16px 20px}.inbox-detail :deep(.ai-page h1){font-size:20px}.ocr-spacing{font-size:11px;line-height:1.8;color:#536d87;margin-top:10px}.ocr-spacing summary{cursor:pointer}.ocr-spacing code{white-space:pre-wrap}.inbox-original .ocr-review-note{color:#9d6b32}
.inbox-page{padding-bottom:30px}.inbox-note,.inbox-alert{padding:12px 15px;border-radius:7px;margin-bottom:14px;line-height:1.7;background:#edf5f0;color:#456f59;overflow-wrap:anywhere}.inbox-alert{background:#fff3e6;color:#9c612c;border:1px solid #eed5b7}.inbox-note button,.inbox-alert button{float:right}.inbox-intake{padding:18px;margin-bottom:18px}.inbox-fields{display:grid;grid-template-columns:160px 1fr 1fr;gap:14px}.inbox-fields label,.inbox-detail-config label{display:flex;flex-direction:column;gap:7px;font-size:11px;color:#788a7d}.inbox-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px}.inbox-actions>span{color:#8a998e;font-size:10px}.inbox-overview{display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr 1.1fr;gap:10px;margin-bottom:18px}.inbox-overview>div{background:#fff;border:1px solid #e0e8e2;border-radius:8px;padding:15px}.inbox-overview>div:first-child{background:#eef6ef}.inbox-overview span{display:block;color:#7e9384;font-size:10px;margin-bottom:10px}.inbox-overview strong{font-size:22px;font-variant-numeric:tabular-nums;color:#2f664d}.inbox-overview small{font-size:11px;color:#8a9c8b;font-weight:400}.inbox-filters{display:flex;gap:10px;margin-bottom:15px;align-items:center;flex-wrap:wrap}.inbox-filters>input:last-of-type{flex:1}.inbox-workbench{display:grid;grid-template-columns:270px minmax(0,1fr);gap:18px;align-items:start}.inbox-list{max-height:900px;overflow:auto}.inbox-item{display:flex;gap:6px;align-items:flex-start;padding:14px 10px;border-bottom:1px solid #eaf0eb}.inbox-item.active{background:#eff6f0;box-shadow:inset 3px 0 #317752}.inbox-item>input{margin-top:4px}.inbox-item>button{flex:1;min-width:0;text-align:left}.inbox-item button>div{display:flex;align-items:center;justify-content:space-between;gap:5px}.inbox-item strong{font-size:12px}.inbox-item p{font-size:11px;color:#7e8c82;margin:7px 0;overflow-wrap:anywhere}.inbox-item small{color:#9ba79b;font-size:9px}.inbox-item .inbox-preview{max-height:40px;overflow:hidden;line-height:1.8;color:#9aa99a}.inbox-status{font-size:9px;border-radius:4px;padding:3px 5px;background:#f6eddd;color:#ab8852;white-space:nowrap}.inbox-status.posted{background:#e2eee6;color:#4e825f}.inbox-status.skipped{background:#ecf0ee;color:#8a978c}.inbox-item b{font-size:13px;color:#487256}.inbox-detail-config{padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:12px}.inbox-check{display:flex;align-items:flex-start;gap:7px;font-size:11px;line-height:1.7;padding:7px 16px;color:#69836d}.inbox-check input{margin-top:3px;flex-shrink:0}.inbox-reading{padding:14px 16px;display:grid;grid-template-columns:1fr;gap:15px}.inbox-reading.has-images{grid-template-columns:1fr 1fr}.inbox-original{min-width:0}.inbox-original-tools{display:flex;gap:7px;align-items:center;margin-bottom:9px;flex-wrap:wrap}.inbox-original-tools select{max-width:100%;font-size:10px}.inbox-image-scroll{height:340px;overflow:auto;border:1px solid #e2e8e3;border-radius:6px;background:#f4f6f4}.inbox-image-scroll img{width:100%;display:block;min-width:280px}.inbox-original>p{font-size:10px;color:#8e9d8f;margin-top:8px;line-height:1.6}.inbox-original pre{height:340px;overflow:auto;padding:10px;border:1px solid #e5eae4;white-space:pre-wrap;line-height:1.8}.inbox-transcript{min-width:0}.inbox-transcript>label{display:block;font-size:11px;color:#729079;margin-bottom:10px}.inbox-transcript textarea{width:100%;height:340px;border:1px solid #dfe7de;border-radius:6px;padding:12px;background:#fcfdfb;font:12px/1.9 ui-monospace,'PingFang SC',monospace;color:#496b52;resize:vertical}.inbox-transcript textarea:focus{outline:2px solid #bad9c6}.inbox-transcript details{font-size:10px;color:#99a691;margin-top:12px}.inbox-transcript pre{white-space:pre-wrap;max-height:240px;overflow:auto}.inbox-parse-result{display:flex;gap:14px;align-items:center;padding:16px;border-top:1px solid #e9eee6;flex-wrap:wrap;background:#f5f9f1}.inbox-parse-result strong{color:#427447;font-size:15px}.inbox-parse-result span,.inbox-parse-result small{font-size:10px;color:#7c9370}.inbox-bets{padding:12px 16px;font-size:11px}.inbox-bets>div{border-top:1px solid #e9eee5;padding:10px 0;line-height:1.8}.inbox-bets strong{font-size:11px;color:#5e7d53}.inbox-bets span{display:block;color:#97a48a;font-size:10px}.inbox-bets p{white-space:pre-wrap;color:#879f7a}.inbox-problems{margin:8px 16px;padding:12px;border:1px solid #eedfc4;background:#fffaf1;border-radius:6px;max-height:220px;overflow:auto;color:#a18757;font-size:11px;line-height:1.8}.inbox-problems p+p{margin-top:7px}.inbox-review{padding:7px 0 14px}.inbox-detail-footer{padding:14px 16px;display:flex;gap:10px;align-items:center;border-top:1px solid #e6ede1}.inbox-detail-footer>span{margin-right:auto;font-size:10px;color:#839777;line-height:1.7}.inbox-empty{min-height:490px}.inbox-account{margin-top:20px}.inbox-account>summary{padding:17px;font-size:12px;cursor:pointer}.inbox-modal{position:fixed;inset:0;z-index:10;background:#182f286e;display:flex;align-items:center;justify-content:center;padding:28px}.capture-dialog{background:#fff;border-radius:12px;width:min(900px,95vw);max-height:92vh;overflow:auto;padding:22px;box-shadow:0 18px 70px #18342750}.capture-dialog>header{display:flex;justify-content:space-between;gap:14px}.capture-dialog h2{font-size:18px}.capture-dialog header p{color:#8c9a8d;font-size:11px;margin-top:9px}.capture-permissions{background:#f1f6ef;border-radius:6px;padding:12px;display:flex;align-items:center;flex-wrap:wrap;gap:13px;margin-top:15px;font-size:11px;color:#6f8b65}.capture-permissions small{width:100%;color:#8e9f86}.capture-tip{font-size:11px;line-height:1.8;color:#8b9c80;margin:12px 0}.capture-preview{position:relative;max-width:680px;margin:0 auto;border:1px solid #dce7d4;cursor:crosshair;touch-action:none;user-select:none;line-height:0}.capture-preview img{display:block;width:100%;pointer-events:none}.capture-selection{position:absolute;border:2px solid #337b48;background:#5db26224;pointer-events:none;line-height:1}.capture-selection span{background:#337b48;color:#fff;font-size:10px;padding:4px;position:absolute;top:0;left:0}.capture-dialog footer{border-top:1px solid #e1eadd;margin-top:15px;padding-top:12px}.capture-dialog footer .inbox-check{padding-left:0}.capture-dialog footer .inbox-actions{justify-content:space-between}.capture-dialog footer label{font-size:11px}.inbox-bets>summary,.inbox-transcript summary{cursor:pointer}@media(max-width:1200px){.inbox-workbench{grid-template-columns:230px minmax(0,1fr)}.inbox-reading.has-images{grid-template-columns:1fr}.inbox-overview strong{font-size:18px}}@media(max-width:850px){.inbox-workbench{grid-template-columns:1fr}.inbox-list{max-height:340px}.inbox-fields{grid-template-columns:1fr}.inbox-overview{grid-template-columns:repeat(2,1fr)}.inbox-detail-footer{flex-wrap:wrap}.inbox-modal{padding:12px}}
</style>
