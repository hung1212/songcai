<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch, provide } from 'vue';
import { parseDocument, summarize } from './core/parser.js';
import { ledgerOwnedDocument } from './core/ledger-owner.js';
import { combinationPreview, formatMoney, MARKETS, pad, ruleForDate, today } from './core/rules.js';
import {SPACE_CONTEXT,spaceKey,spaceSession} from './space-context.js';
import { demoText, makeDocument } from './demo.js';
import { STORAGE_KEY, validateProject } from './project.js';
import { canonicalLedger, ledgerTitle, ledgerSnapshotKey, ledgerParseKey, reorderDocuments } from './core/ledger.js';
import {formatBetLines,prepareBetPaste} from './core/text-format.js';
import { highlightText } from './core/highlight.js';
import { numberDistribution, sortDistribution, NUMBER_SORTS } from './core/number-distribution.js';
import ReferencePages from './components/ReferencePages.vue';
import WechatInbox from './components/WechatInbox.vue';
import SettlementPage from './components/SettlementPage.vue';
import SpecialCollection from './components/SpecialCollection.vue';
import FlatZodiacCollection from './components/FlatZodiacCollection.vue';
import LedgerWinnings from './components/LedgerWinnings.vue';
import {upgradeProject,upgradeComparison} from './core/parser-upgrade.js';
import AiReview from './components/AiReview.vue';
import LedgerOverview from './components/LedgerOverview.vue';
import {useLedgerOverview} from './use-ledger-overview.js';
import RebateSettings from './components/RebateSettings.vue';
import {clearPreviewState,clearPreviewContents,restorePreviewContents} from './ledger-clear-preview.js';
import {documentReviewKey} from './core/ai-review.js';
import {issueDetails} from './core/issue-details.js';
import {settleDocuments} from './core/settlement.js';
import {settlementBalance} from './core/ledger-overview.js';
import {winningLineMarks,drawBasisLabel} from './core/winning-display.js';
import {NAVIGATION_KEY,navigationHistory,visitLedger,rememberSearch,sourceSelection,sourceOffsets,sourceResults} from './core/ledger-navigation.js';
import {WORKSPACE_KEY,workspacePreferences,sortLedgers,highlightRows,editorPosition} from './core/workspace.js';

const props=defineProps({space:Object,api:Object,initialView:{type:String,default:'ledger'},switching:Boolean});
const context={id:props.space.id,get name(){return props.space.name;},api:props.api};
const emit=defineEmits(['count']);
provide(SPACE_CONTEXT,context);
const songcai=props.api;
const storageKey=spaceKey(STORAGE_KEY,context.id),navigationKey=spaceKey(NAVIGATION_KEY,context.id),workspaceKey=spaceKey(WORKSPACE_KEY,context.id);
const emptyDocument=makeDocument('','',today());
const documents=ref([]),activeId=ref('');
const results = ref([]), parsedKeys = ref({});
const {overview,loaded:overviewLoaded,busy:overviewBusy,problem:overviewError,mode:overviewMode,drawDate:overviewDate,selection:overviewSelection,verification:overviewVerification,draws:overviewDraws,latest:overviewLatest,refresh:refreshOverview,changeMode:changeOverviewMode,adopt:adoptOverview,select:selectOverview}=useLedgerOverview(results,()=>documents.value,context);
const settlementView=ref(),winningsView=ref(),rebateView=ref(),rebateOpened=ref(props.initialView==='rebates');
const clearDialog=ref(),clearBusy=ref(false),clearBackup=ref(null);let clearExpected='';
const canRestoreClear=computed(()=>!!clearBackup.value&&ledgerParseKey(documents.value)===clearBackup.value.clearedKey);
const overviewLabel=computed(()=>overviewMode.value==='latest'?'最近已获取开奖':overviewDate.value+'开奖');
function profitText(row){if(!row)return '待计算';if(row.status==='empty')return '空账目';if(row.netCents===null)return '待结算';return `${row.status==='trial'?'试算 · ':''}${row.netCents>0?'赢 +':row.netCents<0?'输 −':'持平 '}${formatMoney(Math.abs(row.netCents))}`;}
async function requestClearContents(){
  try{await saveDraft(true);clearExpected=ledgerParseKey(documents.value);clearDialog.value.showModal();}catch{}
}
async function changeLedgerContents(restore=false){
  if(clearBusy.value)return;clearBusy.value=true;
  try{
    await saveDraft(true);
    if(!restore&&clearExpected!==ledgerParseKey(documents.value))throw new Error('账目内容有变化，请重新打开清空确认');
    const operation=saveQueue.catch(()=>{}).then(async()=>{
      const result=songcai?await songcai[restore?'restoreLedgerContents':'clearLedgerContents']({storageRevision}):(restore?restorePreviewContents(project(),context.id):clearPreviewContents(project(),context.id));
      const saved=validateProject(result.project);storageRevision=result.project.storageRevision||0;
      lastSaved=ledgerSnapshotKey(saved);documents.value=saved.documents;activeId.value=saved.activeId;clearBackup.value=result.backup;
      clearTimeout(saveTimer);parseAll();saveState.value=songcai?'已保存到本地数据库':'已保存到浏览器';
    });
    saveQueue=operation;await operation;clearDialog.value.close();toast(restore?'已恢复清空前的全部原文':'全部账目内容已清空，账目名称和顺序已保留，可撤销本次清空');
  }catch(e){toast(e.message);}finally{clearBusy.value=false;}
}
async function openOverviewSource(id){try{if(songcai)await songcai.settlement.openSource({id});else toast('请在桌面客户端打开开奖来源');}catch(e){toast(e.message);}}

const tab = ref('players'), market = ref(''), player = ref(''), search = ref('');
const view = ref(props.initialView);
const ledgerSearch = ref(''), ledgerSearchInput = ref(), searchHistoryOpen=ref(false),searchDirty=ref(false);
let savedNavigation;try{savedNavigation=JSON.parse(localStorage.getItem(navigationKey)||'null');}catch{}
const navigation=ref(navigationHistory(savedNavigation));
const recentDocuments=computed(()=>navigation.value.recent.map(id=>documents.value.find(d=>d.id===id)).filter(Boolean));
watch(navigation,value=>{try{localStorage.setItem(navigationKey,JSON.stringify(value));}catch{}},{deep:true});
function recordVisit(id=activeId.value){navigation.value=visitLedger(navigation.value,id,documents.value);}
watch(ledgerSearch,()=>{searchDirty.value=true;},{flush:'sync'});
function recordSearch(){if(!searchDirty.value)return;navigation.value=rememberSearch(navigation.value,ledgerSearch.value);searchDirty.value=false;}
function useSearchHistory(term){ledgerSearch.value=term;navigation.value=rememberSearch(navigation.value,term);searchDirty.value=false;ledgerSearchInput.value?.focus();searchHistoryOpen.value=false;}
function leaveSearch(event){if(!event.currentTarget.contains(event.relatedTarget)){recordSearch();searchHistoryOpen.value=false;}}
async function openRecent(id){recordSearch();ledgerSearch.value='';listMode.value='all';searchHistoryOpen.value=false;await selectDocument(id);}
const ledgerSearchTerm = computed(() => ledgerSearch.value.trim().normalize('NFKC').toLocaleLowerCase());
const visibleDocuments = computed(() => {
  const term = ledgerSearchTerm.value;
  return sortLedgers(documents.value,ledgerAmounts.value,workspace.value.ledgerSort,overview.value?.byId).filter(doc => (!term || ledgerTitle(doc).normalize('NFKC').toLocaleLowerCase().includes(term)) && (listMode.value !== 'pending' || pendingById.value[doc.id]));
});
function clearLedgerSearch() { recordSearch();ledgerSearch.value = ''; ledgerSearchInput.value?.focus(); }
const draggingDocument = ref(''), dropDocument = ref(''), dropAfter = ref(false);
let documentPointer = null, suppressDocumentClick = false;
function startDocumentDrag(event, id) {
  if(event.button!==0||workspace.value.ledgerSort!=='manual')return;
  suppressDocumentClick=false;
  documentPointer={id,pointerId:event.pointerId,x:event.clientX,y:event.clientY,element:event.currentTarget};
  event.currentTarget.setPointerCapture(event.pointerId);
}
function overDocument(event) {
  const drag=documentPointer;
  if(!drag||event.pointerId!==drag.pointerId)return;
  if(!draggingDocument.value&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;
  event.preventDefault();draggingDocument.value=drag.id;suppressDocumentClick=true;
  const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.file-item[data-document-id]');
  dropDocument.value=target?.dataset.documentId!==drag.id?target?.dataset.documentId||'':'';
  if(target){const rect=target.getBoundingClientRect();dropAfter.value=event.clientY>rect.top+rect.height/2;}
  const list=drag.element.closest('.file-list'),rect=list.getBoundingClientRect();
  if(event.clientY<rect.top+18)list.scrollTop-=12;
  else if(event.clientY>rect.bottom-18)list.scrollTop+=12;
}
function endDocumentDrag(){
  const drag=documentPointer;documentPointer=null;draggingDocument.value='';dropDocument.value='';
  if(drag?.element.hasPointerCapture(drag.pointerId))drag.element.releasePointerCapture(drag.pointerId);
}
async function dropOnDocument(event){
  if(!documentPointer||event.pointerId!==documentPointer.pointerId)return;
  const next=draggingDocument.value&&dropDocument.value?reorderDocuments(documents.value,draggingDocument.value,dropDocument.value,dropAfter.value):documents.value;
  endDocumentDrag();
  if(next!==documents.value){documents.value=next;await saveDraft();}
}
function clickDocument(id){if(suppressDocumentClick){suppressDocumentClick=false;return;}selectDocument(id);}
async function moveDocumentKey(id,direction){
  if(workspace.value.ledgerSort!=='manual')return;
  const i=visibleDocuments.value.findIndex(d=>d.id===id),target=visibleDocuments.value[i+direction];if(i<0||!target)return;
  documents.value=reorderDocuments(documents.value,id,target.id,direction>0);await saveDraft();
}
watch(ledgerSearchTerm, endDocumentDrag);

const pageTitle = computed(() => ({ ledger: '投注账目', overview:'全部账目统计', inbox: '微信收件箱', odds: '玩法赔率', zodiac: '生肖分类', settlement: '开奖与赔付', rebates:'玩家退水', collection: '特码集合', flatZodiac: '平特肖集合', ai:'AI 核验' }[view.value]));
const settlementOpened = ref(props.initialView==='settlement');
const inboxView = ref();
const scope = ref('current'), expanded = ref(''), saveState = ref('准备就绪'), notice = ref('');
const editor = ref(), highlightLayer = ref(), lineNumbers = ref(), inputFile = ref(), composing = ref(false), initialized = ref(false);
let savedWorkspace;
try { const local=JSON.parse(localStorage.getItem(workspaceKey)||'null');const shared=JSON.parse(localStorage.getItem('songcai.workspace.shared.v1')||localStorage.getItem(WORKSPACE_KEY)||'null');savedWorkspace={...local,...shared,ledgerSort:local?.ledgerSort}; } catch {}
const workspace = ref(workspacePreferences(savedWorkspace));
const editorExpanded = computed({get:()=>workspace.value.focused,set:value=>{workspace.value.focused=value;}});
const ledgerSettings = ref(false), sidebarHidden = ref(window.innerWidth<720), listMode = ref('all');
const editorPositions = spaceSession(context.id).editors, rowHeights = ref([]);
let editorObserver, resizePointer, switchRequest=0;
const currentSummary = computed(()=>{try{return summarize(results.value.filter(result=>result.id===activeId.value));}catch{return null;}});
const ledgerAmounts = computed(()=>Object.fromEntries(results.value.map(result=>[result.id,(()=>{try{return summarize([result]).totalCents;}catch{return null;}})()])));
const pendingById = computed(()=>Object.fromEntries(results.value.map(result=>[result.id,result.issues.filter(i=>i.severity!=='warning').length])));
watch(workspace,value=>{try{localStorage.setItem(workspaceKey,JSON.stringify(value));const {ledgerSort,...shared}=value;localStorage.setItem('songcai.workspace.shared.v1',JSON.stringify(shared));}catch{}},{deep:true});
watch(()=>workspace.value.ledgerSort,endDocumentDrag);
function rememberEditor(id=activeId.value){
  const field=editor.value;if(!field||!id)return;
  editorPositions.set(id,{text:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection,top:field.scrollTop,left:field.scrollLeft});
}
function restoreEditor(focus=false){
  const field=editor.value;if(!field)return;
  const pos=editorPosition(editorPositions.get(activeId.value),field.value);
  if(focus)field.focus({preventScroll:true});
  field.setSelectionRange(pos.start,pos.end,pos.direction);field.scrollTop=pos.top;field.scrollLeft=pos.left;syncEditorScroll();updateEditorCursor();
}
function goToEnd(){const field=editor.value;if(!field||composing.value)return;field.focus({preventScroll:true});field.setSelectionRange(field.value.length,field.value.length);field.scrollTop=field.scrollHeight;syncEditorScroll();rememberEditor();updateEditorCursor();}
function showResults(nextTab=tab.value){tab.value=nextTab;editorExpanded.value=false;}
function closeWorkspaceMenus(event){if(event&&!event.target.closest('.ledger-search-region'))searchHistoryOpen.value=false;for(const menu of document.querySelectorAll('details.workspace-menu[open],details.space-picker[open]')){if(!event||!menu.contains(event.target))menu.open=false;}}
function workspaceKeydown(event){
  if(event.isComposing)return;
  if(event.key==='Escape')closeWorkspaceMenus();
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){
    event.preventDefault();sidebarHidden.value=false;nextTick(()=>{ledgerSearchInput.value?.focus();ledgerSearchInput.value?.select();});
  }
}
function searchKeydown(event){
  if(event.isComposing)return;
  if(event.key==='Enter'){event.preventDefault();recordSearch();searchHistoryOpen.value=false;if(visibleDocuments.value.length)selectDocument(visibleDocuments.value[0].id);}
  if(event.key==='ArrowDown'){event.preventDefault();document.querySelector(searchHistoryOpen.value&&navigation.value.searches.length?'.search-history-term':'.file-select')?.focus();}
}
function resizeSidebar(event){
  if(event.button!==0)return;
  resizePointer={id:event.pointerId,element:event.currentTarget};event.currentTarget.setPointerCapture(event.pointerId);
}
function moveSidebar(event){if(resizePointer?.id===event.pointerId)workspace.value.sidebarWidth=Math.max(220,Math.min(360,event.clientX));}
function stopSidebar(){const pointer=resizePointer;resizePointer=null;if(pointer?.element.hasPointerCapture(pointer.id))pointer.element.releasePointerCapture(pointer.id);}
function measureEditor(){
  const field=editor.value,layer=highlightLayer.value;if(!field||!layer||composing.value)return;
  layer.style.width=field.clientWidth+'px';
  rowHeights.value=effectiveWrap.value?[...layer.children].slice(0,10000).map(row=>row.getBoundingClientRect().height):[];
  syncEditorScroll();
}
function observeEditor(){editorObserver?.disconnect();if(editor.value){editorObserver=new ResizeObserver(measureEditor);editorObserver.observe(editor.value);}measureEditor();}

const help = ref(false), parsing = ref(false), page = ref(1);
let parseTimer, saveTimer, noticeTimer;
let saveQueue = Promise.resolve(), storageRevision = 0, lastSaved = '', loadFailed = false;
const PAGE_SIZE = 70;
const active = computed(() => documents.value.find(d => d.id === activeId.value) || documents.value[0] || emptyDocument);
const currentResult = computed(() => results.value.find(r => r.id === active.value.id));
const winningsContext=ref(null),winningsOpened=ref(false),receiptRequest=ref(0);
function openLedgerReceipt(){receiptRequest.value++;showResults('winnings');}
const activeParseFresh=computed(()=>parsedKeys.value[activeId.value]===ledgerParseKey([active.value]));
function receiveWinningsContext(context){if(context.documentId===activeId.value&&context.businessDate===active.value.businessDate)winningsContext.value=context;}
const winningBasis=computed(()=>winningsContext.value||{ready:!!overviewLoaded.value,draws:overviewDraws.value,odds:overviewLoaded.value?.settings.odds||{},rebates:overviewLoaded.value?.settings.rebates,playerOdds:overviewLoaded.value?.settings.playerOdds,verification:overviewVerification.value,drawDates:overviewSelection.value?.drawDates});
const currentWinning=computed(()=>{
  const basis=winningBasis.value;
  if(!activeParseFresh.value||!basis.ready||basis.history||!currentResult.value?.rule)return null;
  try{const result=settleDocuments([currentResult.value],basis.draws,basis.odds,active.value.businessDate,{drawDates:basis.drawDates,rebates:basis.rebates,playerOdds:basis.playerOdds});
    return {...settlementBalance(result,basis.verification,basis.odds),trial:result.entries.some(e=>e.status!=='pending'&&!(basis.verification[e.market]?.confirmed&&basis.odds[e.market]?.confirmed)),result,wins:result.entries.filter(e=>e.status==='won')};
  }catch{return null;}
});
const winningMarks=computed(()=>winningLineMarks(currentResult.value,currentWinning.value?.result,{...winningBasis.value,fresh:activeParseFresh.value&&!composing.value}));
const winningHeading=computed(()=>winningBasis.value.history?'查看历史赔付':!activeParseFresh.value?'更新中奖数据中…':currentWinning.value?profitText(currentWinning.value).replace(/^试算 · /,''):'待计算中奖');
const winningBasisTitle=computed(()=>drawBasisLabel(winningBasis.value.draws)+(winningBasis.value.history?' · 历史版本不标记当前原文':' · 赔付加退水减投注为玩家净输赢'));
watch(()=>[activeId.value,active.value.businessDate],()=>{receiptRequest.value=0;winningsContext.value=null;winningsOpened.value=tab.value==='winnings';});
watch(tab,value=>{if(value==='winnings')winningsOpened.value=true;});
const scoped = computed(() => results.value.filter(r => scope.value === 'all' || r.id === active.value.id).map(ledgerOwnedDocument));
const dateGroups = computed(() => [...new Set(scoped.value.map(r => r.rule?.date).filter(Boolean))]);
const account = computed(() => {
  try { return { summary: summarize(scoped.value, { market: market.value, player: player.value }), error: '' }; }
  catch (e) { return { summary: summarize([]), error: e.message }; }
});
const summary = computed(() => account.value.summary);
const distribution = computed(() => numberDistribution(summary.value.numbers));
const numberSort = ref('number');
const sortedNumbers = computed(() => sortDistribution(distribution.value.numbers, rule.value, numberSort.value));
const numberSortHint = computed(() => NUMBER_SORTS.find(option => option.value === numberSort.value)?.hint);
const mixedZodiacYears = computed(() => scope.value === 'all' && scoped.value.some(result => result.rule && result.rule.lunarYear !== rule.value?.lunarYear));
const allPlayers = computed(() => [...new Map(scoped.value.flatMap(r => r.bets.map(b => [b.playerId, {id:b.playerId,name:b.player}]))).values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')));
const issues = computed(() => scoped.value.flatMap(r => r.issues).filter(i => !player.value || (i.playerId || i.player) === player.value));
const errors = computed(() => issues.value.filter(i => i.severity !== 'warning'));
const confirmed = computed(() => scoped.value.flatMap(r => r.bets).filter(b => b.status === 'parsed' && (!market.value || b.markets.includes(market.value)) && (!player.value || b.playerId === player.value)));
const visibleBets = computed(() => confirmed.value.filter(b => !search.value || `${b.player} ${b.raw} ${b.play}`.includes(search.value)));
const pageBets = computed(() => visibleBets.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const maxPage = computed(() => Math.max(1, Math.ceil(visibleBets.value.length / PAGE_SIZE)));
const rule = computed(() => { try { return ruleForDate(active.value.businessDate); } catch { return null; } });
const sourceLines = computed(() => active.value.text.split('\n'));
const snapshotKey = computed(() => ledgerSnapshotKey({ activeId: activeId.value, documents: documents.value }));
const parseKey = computed(() => ledgerParseKey(documents.value));
const titleInput = computed({ get: () => active.value.autoTitle ? '' : active.value.name, set: name => { active.value.name = name; active.value.autoTitle = !name.trim(); } });
const highlightEnabled = computed(() => active.value.text.length <= 200_000);
const highlighted = computed(() => highlightEnabled.value ? highlightText(active.value.text,active.value.defaultPlayer,activeParseFresh.value?(currentResult.value?.bets||[]).filter(b=>b.status==='parsed'&&['special-number','flat-number','linked-number-3-3'].includes(b.playType)&&b.endLine>b.line).flatMap(b=>Array.from({length:b.endLine-b.line},(_,i)=>b.line+i)):[]) : []);
const sourceRows = computed(()=>highlightRows(highlighted.value));
const effectiveWrap = computed(()=>workspace.value.wrap&&highlightEnabled.value);
watch([sourceRows,()=>workspace.value.fontSize,effectiveWrap],()=>nextTick(measureEditor));
const countIssues = computed(() => errors.value.length);
const editorLines=ref({line:1,endLine:1}),linkedSource=ref(null);
const linkedRange=computed(()=>linkedSource.value?.fileId===activeId.value&&linkedSource.value.sourceKey===ledgerParseKey([active.value])?linkedSource.value:null);
const linkedRows=computed(()=>linkedRange.value?sourceResults(currentResult.value,linkedRange.value.line,linkedRange.value.endLine):{bets:[],issues:[]});
const linkedLabel=computed(()=>linkedRange.value?`第 ${linkedRange.value.line}${linkedRange.value.endLine!==linkedRange.value.line?'–'+linkedRange.value.endLine:''} 行`:'');
function isLinkedLine(line){return linkedRange.value&&line>=linkedRange.value.line&&line<=linkedRange.value.endLine;}
function updateEditorCursor(){if(editor.value)editorLines.value=sourceSelection(editor.value.value,editor.value.selectionStart,editor.value.selectionEnd);}
function linkSource(line,endLine=line){linkedSource.value={fileId:activeId.value,line,endLine,sourceKey:ledgerParseKey([active.value])};}
function scrollResultTo(element){const panel=document.getElementById('ledger-results');if(element&&panel)panel.scrollTop+=element.getBoundingClientRect().top-panel.getBoundingClientRect().top-65;}
async function locateResults(line=editorLines.value.line,endLine=editorLines.value.endLine,requestedTab){
  if(composing.value)return;
  if(!activeParseFresh.value)parseAll();
  const matches=sourceResults(currentResult.value,line,endLine);
  if(!matches.bets.length&&!matches.issues.length){toast(`第${line}行没有独立投注结果，请选择投注所在行`);return;}
  linkSource(line,endLine);market.value='';player.value='';search.value='';scope.value='current';
  const targetTab=requestedTab||(matches.bets.length?'details':'issues');showResults(targetTab);await nextTick();
  if(targetTab==='details'){
    const target=matches.bets[0];if(!target)return;
    const index=visibleBets.value.findIndex(b=>b.id===target.id);page.value=Math.floor(Math.max(0,index)/PAGE_SIZE)+1;expanded.value=target.id;
    await nextTick();scrollResultTo([...document.querySelectorAll('.bet-row')].find(e=>e.dataset.betId===target.id));
  }else{
    const target=matches.issues[0];if(!target)return;
    issueLimit.value=Math.max(150,issues.value.findIndex(i=>i.id===target.id)+1);await nextTick();
    scrollResultTo([...document.querySelectorAll('.issue-card')].find(e=>e.dataset.issueId===target.id));
  }
}
const issueLimit=ref(150);
const visibleIssues = computed(() => issues.value.slice(0,issueLimit.value).map(issue=>({...issue,detail:issueDetails(issue)})));
const marketClass = m => ({ 新: 'new', 旧: 'old', 港: 'hk' }[m]);
const money = cents => formatMoney(cents);

function toast(message) { notice.value = message; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.value = ''; }, 5000); }
function project() { return { schemaVersion: 1, activeId: activeId.value, documents: JSON.parse(JSON.stringify(documents.value)) }; }
let disposed=false;
async function applyAssistance(id,sourceKey,assistance){
  if(disposed)return false;
  const doc=documents.value.find(d=>d.id===id);if(clearBusy.value||!doc||documentReviewKey(doc)!==sourceKey)return false;
  doc.assistance=assistance;parseAll();await saveDraft(true);return true;
}
function parseAll() {
  clearTimeout(parseTimer);
  parsing.value = true;
  results.value = documents.value.map(doc => {
    try { return parseDocument(doc.text, { ...doc }); }
    catch (e) { return { id: doc.id, name: doc.name, bets: [], metadata: [], coverage: [], issues: [{ id: `${doc.id}:fatal`, fileId: doc.id, fileName: doc.name, line: 1, endLine: 1, raw: '', player: '', severity: 'error', code: 'DOCUMENT', message: e.message }] }; }
  });
  parsedKeys.value=Object.fromEntries(documents.value.map(doc=>[doc.id,ledgerParseKey([doc])]));
  parsing.value = false;
}
async function saveDraft(requireSuccess = false) {
  clearTimeout(saveTimer);
  const pending = saveQueue.catch(() => {}).then(async () => {
    if (loadFailed) throw new Error('旧账目尚未恢复，已暂停自动保存，请先导出当前原文备份');
    saveState.value = '正在保存';
    const normalized = canonicalLedger(project());
    // Resolve title collisions before the IPC await so a stale duplicate cannot
    // be selected while its replacement is being saved.
    if (snapshotKey.value !== ledgerSnapshotKey(normalized)) { documents.value = normalized.documents; activeId.value = normalized.activeId; }
    const before = snapshotKey.value;
    if(before===lastSaved){saveState.value=songcai?'已保存到本地数据库':'已保存到浏览器';return normalized;}
    let saved;
    if (songcai) saved = await songcai.writeDraft({ ...normalized, storageRevision });
    else { localStorage.setItem(storageKey, JSON.stringify(normalized)); saved = normalized; }
    storageRevision = saved.storageRevision || 0;
    const clean = validateProject(saved);
    lastSaved = ledgerSnapshotKey(clean);
    if (snapshotKey.value === before && before !== lastSaved) { documents.value = clean.documents; activeId.value = clean.activeId; }
    saveState.value = songcai ? '已保存到本地数据库' : '已保存到浏览器';
    return clean;
  });
  saveQueue = pending;
  try { return await pending; }
  catch (e) { saveState.value = '保存失败，请导出备份'; toast(e.message); if (requireSuccess) throw e; }
}
watch(()=>documents.value.length,count=>emit('count',count));
watch(parseKey, () => {
  if (!composing.value) { clearTimeout(parseTimer); parseTimer = setTimeout(parseAll, 300); }
});
watch(snapshotKey, value => {
  clearTimeout(saveTimer);
  if (initialized.value && !composing.value && value !== lastSaved) {
    if(!loadFailed)saveState.value='有更改，自动保存中';
    saveTimer = setTimeout(saveDraft, 650);
  }
});
watch([market, player, search, activeId, scope], () => { page.value = 1; });
watch(activeId, (id,previous) => {
  rememberEditor(previous);market.value='';player.value='';expanded.value='';ledgerSettings.value=false;linkedSource.value=null;editorLines.value={line:1,endLine:1};issueLimit.value=150;if(initialized.value)recordVisit(id);
  const source=active.value.text;
  nextTick(()=>{if(activeId.value===id){observeEditor();if(active.value.text===source)restoreEditor();}});
});
watch(view, (value,previous) => { if(value==='rebates')rebateOpened.value=true; if (value === 'settlement') settlementOpened.value = true; if(['collection','flatZodiac'].includes(value))refreshOverview({sync:!!songcai&&!songcai.reportStartup,latest:true,auto:true}); if(previous==='settlement'&&value!=='settlement'){winningsContext.value=null;if(!['collection','flatZodiac'].includes(value))refreshOverview();} nextTick(() => window.scrollTo(0, 0)); });
onMounted(async () => {
  try {
    const raw = songcai ? await songcai.readDraft() : JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (raw?.loadError) { loadFailed = true; toast(raw.loadError); }
    else if (raw) { const p = upgradeProject(validateProject(raw)); storageRevision = raw.storageRevision || 0; lastSaved = ledgerSnapshotKey(p); documents.value = p.documents; activeId.value = p.activeId; }
  } catch (e) { loadFailed = true; toast(`账目恢复失败：${e.message}`); }
  parseAll(); initialized.value = true;recordVisit();
  await nextTick();observeEditor();restoreEditor();window.addEventListener('keydown',workspaceKeydown);window.addEventListener('pointerdown',closeWorkspaceMenus);
  try{clearBackup.value=songcai?await songcai.clearLedgerState():clearPreviewState(context.id);}catch(e){toast(e.message);}
  refreshOverview(['collection','flatZodiac'].includes(view.value)?{sync:!!songcai&&!songcai.reportStartup,latest:true,auto:true}:{});
  saveState.value = loadFailed ? '旧账目读取失败' : '本地自动保存';
  songcai?.onBeforeClose?.(async () => { clearTimeout(saveTimer); await flushWorkspace(); });
  if (songcai?.reportStartup) {
    const inboxAPI = songcai.inbox;
    const fixture = await inboxAPI.create({ player: '启动检查玩家', businessDate: '2026-10-05', name: '收件箱启动检查', source: '隔离测试', text: '旧 1 2 3 各100元\n特肖虎100元' });
    const beforeConfirm = await inboxAPI.list({});
    const checked = await inboxAPI.update({ id: fixture.batch.id, revision: fixture.batch.revision, patch: { review: { source: true } } });
    const request = [{ id: checked.batch.id, revision: checked.batch.revision }];
    const posted = await inboxAPI.confirm(request), repeated = await inboxAPI.confirm(request);
    const afterConfirm = await inboxAPI.list({});
    const originalProject = project();
    const dbFirst = await songcai.writeDraft({ schemaVersion: 1, activeId: 'db-first', storageRevision,
      documents: [{ id: 'db-first', name: '', text: '数据库玩家：特肖牛100元', businessDate: '2026-10-05', defaultPlayer: '' }] });
    storageRevision = dbFirst.storageRevision;
    const dbSecond = await songcai.writeDraft({ ...dbFirst, activeId: 'db-second', documents: [...dbFirst.documents,
      { id: 'db-second', name: '', text: '数据库玩家：特肖牛200元', businessDate: '2026-10-05', defaultPlayer: '' }] });
    storageRevision = dbSecond.storageRevision;
    const dbRestored = await songcai.writeDraft({ ...originalProject, storageRevision }); storageRevision = dbRestored.storageRevision;
    const dbRead = await songcai.readDraft();
    await nextTick();
    await setEditorExpanded(false);
    const originalEditor = editor.value, smallSize = originalEditor.getBoundingClientRect();
    originalEditor.setSelectionRange(3, 8);
    await setEditorExpanded(true);
    const largeSize = originalEditor.getBoundingClientRect();
    const expansionWorks = editorExpanded.value && editor.value === originalEditor && largeSize.width > smallSize.width + 100
      && largeSize.height >= smallSize.height && originalEditor.selectionStart === 3 && originalEditor.selectionEnd === 8;
    await setEditorExpanded(false);
    const expansionRestored=expansionWorks&&!editorExpanded.value&&editor.value===originalEditor&&originalEditor.selectionStart===3&&originalEditor.selectionEnd===8;
    const memoryOriginal=activeId.value;
    documents.value.push({...makeDocument('位置记忆测试','新 01各10','2026-10-05'),id:'editor-memory-check'});
    activeId.value='editor-memory-check';await nextTick();observeEditor();restoreEditor();
    const otherEditor=editor.value;otherEditor.setSelectionRange(1,3);
    activeId.value=memoryOriginal;await nextTick();observeEditor();restoreEditor();
    const firstRestored=editor.value!==otherEditor&&editor.value.selectionStart===3&&editor.value.selectionEnd===8;
    activeId.value='editor-memory-check';await nextTick();observeEditor();restoreEditor();
    const secondRestored=editor.value.selectionStart===1&&editor.value.selectionEnd===3;
    activeId.value=memoryOriginal;await nextTick();observeEditor();restoreEditor();
    documents.value=documents.value.filter(doc=>doc.id!=='editor-memory-check');parseAll();
    const editorMemory=firstRestored&&secondRestored;
    const pasteSample='46.22.10.34.18.24.23.07.43.各.5.米，04.40.13.01.49.各.10.米，28.16.各.20.米，37.25.各.50.米，共.235.米，香港';
    editor.value.setSelectionRange(0,editor.value.value.length);
    pasteEditor({currentTarget:editor.value,clipboardData:{getData:()=>pasteSample},preventDefault(){}});
    parseAll();await nextTick();
    const pasteParsed=results.value.find(r=>r.id===activeId.value);
    const pasteBeforeUndo={sourceMatched:active.value.text===formatBetLines(pasteSample)+'\n',cursor:editor.value.selectionStart,length:active.value.text.length,issues:pasteParsed.issues.length,bets:pasteParsed.bets.length,total:summarize([pasteParsed]).markets.港};
    const pasteWorked=active.value.text===formatBetLines(pasteSample)+'\n'&&editor.value.selectionStart===active.value.text.length
      &&pasteParsed.issues.length===0&&pasteParsed.bets.length===4&&summarize([pasteParsed]).markets.港===23500;
    editor.value.focus();document.execCommand('undo');await nextTick();parseAll();
    const pasteEditorPassed=pasteWorked&&active.value.text===originalProject.documents[0].text;
    const pasteCheckDetail={pasteBeforeUndo,pasteWorked,undoMatched:active.value.text===originalProject.documents[0].text,source:active.value.text,cursor:editor.value.selectionStart};
    const navigationBefore=JSON.parse(JSON.stringify(navigation.value));
    const navDoc={...makeDocument('定位检查',Array.from({length:76},(_,i)=>`${i%2?'02':'49'}各10`).join('\n'),'2026-10-05'),id:'navigation-check'};
    documents.value.push(navDoc);parseAll();
    ledgerSearch.value='定位';await selectDocument(navDoc.id);await nextTick();
    const historyStored=JSON.parse(localStorage.getItem(navigationKey));
    const navigationHistoryUI=historyStored.recent[0]===navDoc.id&&historyStored.searches[0]==='定位'
      &&!!document.querySelector('[aria-label="最近访问：定位检查"]');
    market.value='港';player.value='missing-player';search.value='不匹配';
    await locateResults(76,76);
    const selectedBet=currentResult.value.bets.at(-1);
    const linkedResult=[...document.querySelectorAll('.bet-row')].find(e=>e.dataset.betId===selectedBet.id);
    const forwardLink=page.value===2&&linkedResult?.classList.contains('located-result')&&market.value===''&&player.value===''&&search.value==='';
    const sortBefore=workspace.value.ledgerSort;ledgerSearch.value='';workspace.value.ledgerSort='stake-desc';await nextTick();
    const sortedLedgerIds=[...document.querySelectorAll('#saved-ledger-list .file-item')].map(e=>e.dataset.documentId);
    const ledgerAmountSortUI=sortedLedgerIds[0]===navDoc.id&&document.querySelector('[aria-label="账目排序"]').value==='stake-desc'
      &&sortedLedgerIds.every((id,i,a)=>!i||(ledgerAmounts.value[a[i-1]]||0)>=(ledgerAmounts.value[id]||0));
    workspace.value.ledgerSort=sortBefore;
    const navField=editor.value;
    // Click the visible result summary, just as in normal daily use.
    linkedResult.querySelector('.bet-main').click();await nextTick();await nextTick();
    const reverseLink=navField===editor.value&&navField.value.slice(navField.selectionStart,navField.selectionEnd)==='02各10'
      &&editorLines.value.line===76&&document.querySelectorAll('.located-line').length===1
      &&navField.scrollTop>0;
    const readableAmounts=parseFloat(getComputedStyle(linkedResult.querySelector('.bet-count')).fontSize)>=13
      &&parseFloat(getComputedStyle(linkedResult.querySelector('.bet-amount')).fontSize)>=18;
    active.value.text+='\n01各10';await nextTick();
    const staleLocationCleared=document.querySelectorAll('.located-line').length===0;
    const bidirectionalNavigation=!!(forwardLink&&reverseLink&&readableAmounts&&staleLocationCleared);
    active.value.text='新凹\n09, 24, 28, 29, 49\n06, 23, 16, 21, 26各2\n42 44 45 47\n12 15 26 32各5块\n11 19 29各10块';parseAll();await nextTick();
    await locateResults(4,4);
    const merged=currentResult.value.bets[1];
    const headerStakeUI=document.querySelector('.entry-heading .entry-total')?.textContent==='¥90.00'&&!document.querySelector('.entry-summary')
      &&document.querySelector('.entry-stake .entry-market-totals')?.textContent.includes('新 90.00');
    const originalNumberBlue=[...highlightLayer.value.children[3].querySelectorAll('.token-selection')].some(e=>e.textContent==='47');
    await locate(merged);
    const multilineNumbersUI=merged.line===4&&merged.endLine===5&&merged.count===8&&merged.totalCents===4000&&originalNumberBlue
      &&editor.value.value.slice(editor.value.selectionStart,editor.value.selectionEnd)==='42 44 45 47\n12 15 26 32各5块';
    active.value.text='新澳特\n27 39 36 48 49 26 28\n各50米\n15 24 14 04 16 17 19\n各20米\n01 02 03 12 13各10米';parseAll();await nextTick();
    await locateResults(5,5);
    const priceRows=currentResult.value.bets;
    const separatePriceLinked=linkedRows.value.bets.length===1&&linkedRows.value.bets[0].line===4;
    await locate(priceRows[1]);
    const separatePriceLinesUI=currentResult.value.issues.length===0&&priceRows.length===3
      &&priceRows.map(b=>b.totalCents).join()==='35000,14000,5000'
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥540.00'
      &&separatePriceLinked&&editor.value.value.slice(editor.value.selectionStart,editor.value.selectionEnd)==='15 24 14 04 16 17 19\n各20米'
      &&[...highlightLayer.value.children[1].querySelectorAll('.token-selection')].some(e=>e.textContent==='28');
    active.value.text='雨：\n门猴龙每个号5米\n10，19，21各5米';parseAll();await nextTick();await locateResults(2,3);
    const menMarketUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===2
      &&currentResult.value.bets.every(b=>b.playerId==='雨'&&b.markets.join()==='新'&&b.playType==='special-number')
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥55.00'
      &&[...document.querySelectorAll('.bet-row .bet-amount')].map(el=>el.textContent).join('|')==='40.00|15.00';
    active.value.text='雨：\n澳三中三。\n10-28-07\n14-29-33\n24-12-29\n38-25-41\n18-48-09\n14-44-31各10米';parseAll();await nextTick();await locateResults(4,4);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const multilineTriplesUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&currentResult.value.bets[0].count===6&&currentResult.value.bets[0].playerId==='雨'
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥60.00'
      &&document.querySelector('.bet-count')?.textContent.includes('6 组 × 10.00')
      &&document.querySelector('.continuation-note')?.textContent.includes('第3–8行按行分组，使用第8行的每组金额')
      &&[...document.querySelectorAll('.bet-expanded .combination-list span')].map(el=>el.textContent).join('|')==='10 · 28 · 07|14 · 29 · 33|24 · 12 · 29|38 · 25 · 41|18 · 48 · 09|14 · 44 · 31'
      &&[...highlightLayer.value.children[2].querySelectorAll('.token-selection')].some(el=>el.textContent==='07')
      &&linkedRows.value.bets.length===1&&editor.value.value===active.value.text;
    active.value.text='雨：\n01.13.34.46.06.18各5=30米。';parseAll();await nextTick();await locateResults(2,2);
    const equalitySubtotalUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥30.00'
      &&currentResult.value.metadata.some(m=>m.inlineEquation&&m.expectedCents===3000&&m.actualCents===3000)
      &&document.querySelector('.bet-count')?.textContent.includes('6 份 × 5.00')&&editor.value.value===active.value.text;
    active.value.text='雨：\n牛，猪，鸡，羊，各肖40元';parseAll();await nextTick();await locateResults(2,2);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const perZodiacStakeUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&currentResult.value.bets[0].playType==='special-zodiac'&&currentResult.value.bets[0].count===4
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥160.00'
      &&document.querySelector('.bet-count')?.textContent.includes('4 份 × 40.00 / 肖')
      &&document.querySelector('.bet-description strong')?.textContent==='特肖'
      &&document.querySelector('.bet-values')?.textContent==='牛 · 猪 · 鸡 · 羊'
      &&document.querySelector('.raw-quote')?.textContent==='牛，猪，鸡，羊，各肖40元';
    active.value.text='平特四连尾（1269）（2679）（1267）（1467）（4679）各500';parseAll();await nextTick();
    await locateResults(1,1);
    const tailGroups=currentResult.value.bets[0];
    const compactTailGroupsUI=currentResult.value.issues.length===0&&tailGroups?.playType==='linked-tail'&&tailGroups.groups.length===5
      &&tailGroups.count===5&&tailGroups.totalCents===250000&&document.querySelector('.entry-heading .entry-total')?.textContent==='¥2,500.00'
      &&document.querySelector('.combination-list')?.textContent.includes('1尾 · 2尾 · 6尾 · 9尾');
    active.value.text='新奥大数200.\n羊50.';parseAll();await nextTick();
    await locateResults(1,2);
    const defaultStakeBasisUI=currentResult.value.issues.length===0&&currentResult.value.bets[0]?.play==='大小·大数'
      &&currentResult.value.bets[1]?.playType==='special-zodiac'&&document.querySelector('.entry-heading .entry-total')?.textContent==='¥250.00'
      &&document.querySelector('.detail-area')?.textContent.includes('大数（25—49）');
    active.value.text='新澳特：02,05,06,09,10,11,14,17,18,21,22,23,26,29各10\n\n新澳特03.06.08.13.16.18.23.27.28.32.37.39.42.43.47.49各15\n\n新澳特19.31.01.49.03.27.29.41.14.26各5\n共50';parseAll();await nextTick();
    const subtotal=currentResult.value.metadata.find(m=>m.subtotalRule==='R22');
    const adjacentSubtotalUI=currentResult.value.issues.length===0&&subtotal?.fromLine===5&&subtotal.actualCents===5000
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥430.00';
    active.value.text='新奥\n蛇各号二十五米\n02/26/36/34/38/02/26/36各二十米\n26/36/38/02各十米\n\n26/34/02/36/35复式三中三各组十米\n\n共400\n\n新门：30–42–18–36–48–12–32–44–各5\n06–24–46–10–26–38–14–16–28–40–33–45–21–各3';parseAll();await nextTick();
    await locateResults(10,11);
    const inlineMarketSectionUI=currentResult.value.issues.length===0&&currentResult.value.bets.slice(-2).every(b=>b.playType==='special-number')
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥479.00'
      &&[...document.querySelectorAll('.bet-amount')].some(e=>e.textContent.trim()==='40.00')
      &&[...document.querySelectorAll('.bet-amount')].some(e=>e.textContent.trim()==='39.00');
    active.value.text='二中二30 7各10\n二中二30 19各10\n二中二30 31各10\n二中二30 43各10\n香港33，34，36各5';parseAll();await nextTick();await locateResults(5,5);
    expanded.value=currentResult.value.bets.at(-1)?.id;await nextTick();
    const marketPrefixResetUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===5
      &&currentResult.value.bets.at(-1).playType==='special-number'&&!currentResult.value.bets.at(-1).semantic.inherited
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥55.00'
      &&document.querySelector('.bet-expanded .semantic-explanation')?.textContent.includes('港 ｜ 特码 ｜ 33 · 34 · 36 ｜ 每号5.00元 ｜ 合计15.00元')
      &&!document.querySelector('.bet-expanded .combination-list')
      &&editor.value.value.endsWith('香港33，34，36各5');
    active.value.text='香菜\nT:01 13 33 41 49(共5个各50斤)\nT:01(共一个150斤)';parseAll();await nextTick();
    await locateResults(2,3);
    const hongKongHeadingUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===2
      &&currentResult.value.bets.every(b=>b.markets.join()==='港'&&b.playType==='special-number'&&b.player!=='T')
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥400.00'
      &&document.querySelector('.entry-stake .entry-market-totals')?.textContent.includes('港 400.00')
      &&editor.value.value===active.value.text;
    active.value.text='包龙 40\n包蛇 160';parseAll();await nextTick();await locateResults(1,2);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const zodiacPackageUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===2
      &&currentResult.value.bets[0]?.unitCents===1000&&currentResult.value.bets[1]?.unitCents===4000
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥200.00'
      &&document.querySelector('.allocation-note')?.textContent.includes('40.00元 ÷ 4个号码＝每号 10.00元');
    active.value.text='新澳。\n鼠，羊，各10。\n猴，各15。\n兔，鸡，猪，各25。\n蛇，狗，各35。\n\n40元包羊\n包蛇60元';parseAll();await nextTick();await locateResults(7,8);
    const reversedZodiacPackageUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===6
      &&currentResult.value.bets.at(-2).unitCents===1000&&currentResult.value.bets.at(-1).unitCents===1500
      &&currentResult.value.bets.at(-2).values.join()==='12,24,36,48'
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥820.00'
      &&editor.value.value.includes('40元包羊')&&linkedRows.value.bets.length===2;
    active.value.text='特包猪兔龙各十米一肖';parseAll();await nextTick();await locateResults(1,1);
    const perZodiacPackageUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===3
      &&currentResult.value.bets.every(b=>b.playType==='special-number'&&b.unitCents===250&&b.totalCents===1000)
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥30.00';
    active.value.text='特包龙虎各二十一肖';parseAll();await nextTick();await locateResults(1,1);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const compactPerZodiacPackageUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===2
      &&currentResult.value.bets.every(b=>b.playType==='special-number'&&b.unitCents===500&&b.totalCents===2000)
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥40.00'
      &&document.querySelector('.allocation-note')?.textContent.includes('20.00元 ÷ 4个号码＝每号 5.00元')
      &&[...document.querySelectorAll('.highlight-viewport .token-amount')].some(t=>t.textContent==='二十')
      &&[...document.querySelectorAll('.highlight-viewport .token-play')].some(t=>t.textContent==='一肖');
    active.value.text='奥平特一肖狗五十';parseAll();await nextTick();await locateResults(1,1);
    const flatOneZodiacUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&currentResult.value.bets[0].playType==='flat-zodiac'&&currentResult.value.bets[0].values.join()==='狗'
      &&currentResult.value.bets[0].markets.join()==='新'&&currentResult.value.bets[0].totalCents===5000
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥50.00'
      &&[...document.querySelectorAll('.highlight-viewport .token-play')].some(t=>t.textContent==='平特一肖');
    active.value.text='二中二30拖鼠各10';parseAll();await nextTick();await locateResults(1,1);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const zodiacDragUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&JSON.stringify(currentResult.value.bets[0].groups)==='[[30,7],[30,19],[30,31],[30,43]]'
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥40.00'
      &&document.querySelector('.bet-count')?.textContent.includes('4 组 × 10.00')
      &&document.querySelector('.drag-note')?.textContent.includes('分别搭配07、19、31、43，共4组')
      &&document.querySelectorAll('.bet-expanded .combination-list span').length===4
      &&editor.value.value==='二中二30拖鼠各10';
    active.value.text='二连肖牛羊、羊猪、羊兔、牛兔各30';parseAll();await nextTick();await locateResults(1,1);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const zodiacDelimitedGroupsUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&currentResult.value.bets[0].groups?.length===4&&currentResult.value.bets[0].warnings.length===0
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥120.00'
      &&document.querySelector('.bet-count')?.textContent.includes('4 组 × 30.00')
      &&[...document.querySelectorAll('.bet-expanded .combination-list span')].map(el=>el.textContent).join('|')==='牛 · 羊|羊 · 猪|羊 · 兔|牛 · 兔'
      &&!document.querySelector('.bet-expanded .warning-text')
      &&editor.value.value==='二连肖牛羊、羊猪、羊兔、牛兔各30';
    active.value.text='二连肖马拖（兔羊猪虎鸡）各20';parseAll();await nextTick();await locateResults(1,1);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const linkedZodiacDragUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&currentResult.value.bets[0].groups?.length===5&&currentResult.value.bets[0].warnings.length===0
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥100.00'
      &&document.querySelector('.bet-count')?.textContent.includes('5 组 × 20.00')
      &&document.querySelector('.zodiac-drag-note')?.textContent.includes('固定马，分别搭配兔、羊、猪、虎、鸡，共5组')
      &&[...document.querySelectorAll('.bet-expanded .combination-list span')].map(el=>el.textContent).join('|')==='马 · 兔|马 · 羊|马 · 猪|马 · 虎|马 · 鸡'
      &&!document.querySelector('.bet-expanded .warning-text')
      &&editor.value.value==='二连肖马拖（兔羊猪虎鸡）各20';
    active.value.text='新澳三连肖：兔蛇拖（牛羊鼠猪羊马鸡猴）各十';parseAll();await nextTick();await locateResults(1,1);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const tripleZodiacDragUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&currentResult.value.bets[0].size===3&&currentResult.value.bets[0].warnings.length===0
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥80.00'
      &&document.querySelector('.bet-count')?.textContent.includes('8 组 × 10.00')
      &&document.querySelector('.zodiac-drag-note')?.textContent.includes('固定兔、蛇，分别搭配牛、羊、鼠、猪、羊、马、鸡、猴，共8组')
      &&document.querySelector('.drag-repeat-note')?.textContent.includes('羊重复列出')
      &&[...document.querySelectorAll('.bet-expanded .combination-list span')].map(el=>el.textContent).join('|')==='兔 · 蛇 · 牛|兔 · 蛇 · 羊|兔 · 蛇 · 鼠|兔 · 蛇 · 猪|兔 · 蛇 · 羊|兔 · 蛇 · 马|兔 · 蛇 · 鸡|兔 · 蛇 · 猴'
      &&editor.value.value==='新澳三连肖：兔蛇拖（牛羊鼠猪羊马鸡猴）各十';
    active.value.text='特串45 拖 鸡各10，';parseAll();await nextTick();await locateResults(1,1);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const specialPairDragUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&currentResult.value.bets[0].playType==='special-pair'&&currentResult.value.bets[0].warnings.length===0
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥40.00'
      &&document.querySelector('.bet-count')?.textContent.includes('4 组 × 10.00')
      &&document.querySelector('.drag-note')?.textContent.includes('固定45，分别搭配10、22、34、46，共4组')
      &&[...document.querySelectorAll('.bet-expanded .combination-list span')].map(el=>el.textContent).join('|')==='45 · 10|45 · 22|45 · 34|45 · 46'
      &&!document.querySelector('.bet-expanded .warning-text')
      &&editor.value.value==='特串45 拖 鸡各10，';
    active.value.text='新凹特碰\n龙狗每组2';parseAll();await nextTick();await locateResults(2,2);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const specialPairCrossUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&currentResult.value.bets[0].playType==='special-pair'&&currentResult.value.bets[0].warnings.length===0
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥32.00'
      &&document.querySelector('.bet-count')?.textContent.includes('16 组 × 2.00')
      &&document.querySelector('.zodiac-cross-note')?.textContent.includes('龙（03、15、27、39）与狗（09、21、33、45）交叉配对，共16组，每组2.00元')
      &&document.querySelectorAll('.bet-expanded .combination-list span').length===16
      &&document.querySelector('.bet-expanded .combination-list span')?.textContent==='03 · 09'
      &&!document.querySelector('.bet-expanded .warning-text')
      &&editor.value.value==='新凹特碰\n龙狗每组2';
    active.value.text='特串、猴拖鸡每组5米';parseAll();await nextTick();await locateResults(1,1);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const specialPairZodiacDragUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&currentResult.value.bets[0].playType==='special-pair'&&currentResult.value.bets[0].warnings.length===0
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥80.00'
      &&document.querySelector('.bet-count')?.textContent.includes('16 组 × 5.00')
      &&document.querySelector('.zodiac-cross-note')?.textContent.includes('猴（11、23、35、47）与鸡（10、22、34、46）交叉配对，共16组，每组5.00元')
      &&[...document.querySelectorAll('.bet-expanded .combination-list span')].map(el=>el.textContent).join('|')===[11,23,35,47].flatMap(a=>[10,22,34,46].map(b=>a+' · '+b)).join('|')
      &&editor.value.value==='特串、猴拖鸡每组5米';
    active.value.text='二中二，5尾拖鸡各10';parseAll();await nextTick();await locateResults(1,1);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const tailZodiacCrossUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&currentResult.value.bets[0].playType==='linked-number-2-2'&&currentResult.value.bets[0].warnings.length===0
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥200.00'
      &&document.querySelector('.bet-count')?.textContent.includes('20 组 × 10.00')
      &&document.querySelector('.tail-zodiac-cross-note')?.textContent.includes('5尾（05、15、25、35、45）与鸡（10、22、34、46）交叉配对，共20组，每组10.00元')
      &&[...document.querySelectorAll('.bet-expanded .combination-list span')].map(el=>el.textContent).join('|')===[5,15,25,35,45].flatMap(a=>[10,22,34,46].map(b=>String(a).padStart(2,'0')+' · '+b)).join('|')
      &&editor.value.value==='二中二，5尾拖鸡各10';
    active.value.text='新澳门三中二:11.33拖5尾，组10米。';parseAll();await nextTick();await locateResults(1,1);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const tailDragUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&currentResult.value.bets[0].playType==='linked-number-3-2'&&currentResult.value.bets[0].warnings.length===0
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥50.00'
      &&document.querySelector('.bet-count')?.textContent.includes('5 组 × 10.00')
      &&document.querySelector('.tail-drag-note')?.textContent.includes('固定11、33，分别搭配5尾号码05、15、25、35、45，共5组')
      &&[...document.querySelectorAll('.bet-expanded .combination-list span')].map(el=>el.textContent).join('|')==='11 · 33 · 05|11 · 33 · 15|11 · 33 · 25|11 · 33 · 35|11 · 33 · 45'
      &&!document.querySelector('.bet-expanded .warning-text')
      &&editor.value.value==='新澳门三中二:11.33拖5尾，组10米。';
    active.value.text='包猪数+绿波数各十';parseAll();await nextTick();await locateResults(1,1);
    const numberCategoryPackageUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===2
      &&currentResult.value.bets.every(b=>b.playType==='special-number'&&b.unitCents===1000&&!b.allocation&&b.warnings.length===0)
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥200.00'
      &&[...document.querySelectorAll('.bet-row .bet-amount')].map(el=>el.textContent).join('|')==='40.00|160.00'
      &&linkedRows.value.bets.length===2&&editor.value.value==='包猪数+绿波数各十';
    active.value.text='新奥，3，4头双数各十五，\n3，4头单数各五，';parseAll();await nextTick();await locateResults(1,2);
    expanded.value=currentResult.value.bets[0]?.id;await nextTick();
    const headParityUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===2
      &&currentResult.value.bets.every(b=>b.playType==='special-number'&&b.count===10&&b.markets.join()==='新'&&b.warnings.length===0)
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥200.00'
      &&[...document.querySelectorAll('.bet-row .bet-amount')].map(el=>el.textContent).join('|')==='150.00|50.00'
      &&document.querySelector('.expansion-note')?.textContent.includes('3、4头中的双数 → 30、32、34、36、38、40、42、44、46、48')
      &&linkedRows.value.bets.length===2&&editor.value.value===active.value.text;
    active.value.text='285新澳三中三：01、10、18、21、28、31、41、49每组3';parseAll();await nextTick();await locateResults(1,1);
    const issuePrefixUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&currentResult.value.bets[0].playType==='linked-number-3-3'&&currentResult.value.bets[0].count===56
      &&currentResult.value.bets[0].values.join()==='1,10,18,21,28,31,41,49'
      &&currentResult.value.metadata.some(m=>m.kind==='期号备注'&&m.text==='285')
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥168.00'
      &&document.querySelector('.bet-count')?.textContent.includes('56 组 × 3.00')
      &&linkedRows.value.bets.length===1&&editor.value.value===active.value.text;
    active.value.text='新门平特三肖全中：鼠狗猪／鼠猪马／鼠猪兔／鼠猪牛／各10';parseAll();await nextTick();await locateResults(1,1);
    const slashZodiacGroupsUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===1
      &&currentResult.value.bets[0].groups?.map(g=>g.join('')).join('|')==='鼠狗猪|鼠猪马|鼠猪兔|鼠猪牛'
      &&currentResult.value.bets[0].playType==='linked-zodiac'&&currentResult.value.bets[0].markets.join()==='新'
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥40.00'
      &&document.querySelector('.bet-count')?.textContent.includes('4 组 × 10.00');
    active.value.text='新澳平特任中一：44/75。\n香港平特任中一：32/75。';parseAll();await nextTick();await locateResults(1,2);
    const flatAnySuffixUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===2
      &&currentResult.value.bets.every(b=>b.playType==='flat-any'&&b.size===1&&b.unitCents===7500&&b.count===1)
      &&currentResult.value.bets.map(b=>b.markets.join()).join()==='新,港'
      &&new Set(currentResult.value.bets.map(b=>b.playerId)).size===1
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥150.00'
      &&document.querySelector('.entry-stake .entry-market-totals')?.textContent.includes('新 75.00')
      &&document.querySelector('.entry-stake .entry-market-totals')?.textContent.includes('港 75.00')
      &&[...document.querySelectorAll('.bet-row .bet-amount')].map(el=>el.textContent).join('|')==='75.00|75.00'
      &&linkedRows.value.bets.length===2&&editor.value.value===active.value.text;
    active.value.text='香港01各10\n澳\n包龙40\n旧澳02各20\n奥特03各30\n04各5';parseAll();await nextTick();await locateResults(1,6);
    const bareMacauMarketUI=currentResult.value.issues.length===0
      &&currentResult.value.bets.map(b=>b.markets.join()).join()==='港,新,旧,新,新'
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥105.00'
      &&document.querySelector('.entry-stake .entry-market-totals')?.textContent.includes('新 75.00')
      &&document.querySelector('.entry-stake .entry-market-totals')?.textContent.includes('旧 20.00')
      &&document.querySelector('.entry-stake .entry-market-totals')?.textContent.includes('港 10.00');
    active.value.text='新澳特，02--14各30#\n26--38各20#\n\n香港特，蛇号各10#\n\n狗各10，\n33，20块';parseAll();await nextTick();await locateResults(6,7);
    const blankMarketResetUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===5
      &&currentResult.value.bets.map(b=>b.markets.join()).join()==='新,新,港,新,新'
      &&currentResult.value.bets.slice(-2).every(b=>b.marketSource===null&&b.playType==='special-number')
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥200.00'
      &&document.querySelector('.entry-stake .entry-market-totals')?.textContent.includes('新 160.00')
      &&document.querySelector('.entry-stake .entry-market-totals')?.textContent.includes('港 40.00')
      &&linkedRows.value.bets.length===2&&editor.value.value===active.value.text;
    active.value.text='平特 2尾 100\n\n16 36各5';parseAll();await nextTick();await locateResults(3,3);
    const blankPlayResetUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===2
      &&currentResult.value.bets.map(b=>b.playType).join()==='flat-tail,special-number'
      &&currentResult.value.bets[1].values.join()==='16,36'&&currentResult.value.bets[1].totalCents===1000
      &&!currentResult.value.bets[1].semantic.inherited&&!currentResult.value.bets[1].semantic.declaration
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥110.00'
      &&linkedRows.value.bets.length===1&&linkedRows.value.bets[0].line===3
      &&editor.value.value==='平特 2尾 100\n\n16 36各5';
    active.value.text='新 1 2 各 100\n2 4 各 50\n港';parseAll();await nextTick();await locateResults(2,3,'issues');
    const trailingMarketUI=currentResult.value.bets[0]?.status==='parsed'&&currentResult.value.bets[1]?.status==='review'
      &&currentResult.value.issues[0]?.line===2&&document.querySelector('.entry-heading .entry-total')?.textContent==='¥200.00'
      &&document.querySelector('.issue-reason')?.textContent.includes('新澳')&&document.querySelector('.issue-reason')?.textContent.includes('香港');
    active.value.text='新 1 2 各 100\n\n2 4 各 50港';parseAll();await nextTick();
    const inlineTrailingUI=currentResult.value.issues.length===1&&currentResult.value.bets[1]?.status==='review'
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥200.00';
    active.value.text='新 1 2 各 100\n\n2 4 各 50\n\n港\n2 5 各40';parseAll();await nextTick();
    const forwardMarketUI=currentResult.value.issues.length===0
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥380.00'
      &&document.querySelector('.entry-stake .entry-market-totals')?.textContent.includes('新 300.00')
      &&document.querySelector('.entry-stake .entry-market-totals')?.textContent.includes('港 80.00');
    active.value.text='旧01各10\n\n新\n澳特41 09各5米';parseAll();await nextTick();
    const marketDirectionUI=trailingMarketUI&&inlineTrailingUI&&forwardMarketUI&&currentResult.value.issues.length===0
      &&currentResult.value.bets[0]?.markets.join()==='旧'&&currentResult.value.bets[1]?.markets.join()==='新';
    active.value.text='11.35.47.各.5.米，\n23..10米，\n香港\n\n19.39.27.各20米，\n03..40米，\n15.100米，\n，香港';parseAll();await nextTick();await locateResults(1,2);
    const paragraphMarketUI=currentResult.value.issues.length===0&&currentResult.value.bets.length===5
      &&currentResult.value.bets.every(b=>b.markets.join()==='港')
      &&document.querySelector('.entry-heading .entry-total')?.textContent==='¥225.00'
      &&document.querySelector('.entry-stake .entry-market-totals')?.textContent.includes('港 225.00')
      &&linkedRows.value.bets.length===2&&editor.value.value===active.value.text;
    active.value.text='两边平特肖鼠牛各100\n香港平肖鼠各50\n新特肖鼠999\n新三连肖鼠牛虎各10';
    const flatSourceDoc={...makeDocument('平特肖来源检查','旧平肖鼠各30','2026-10-04'),id:'flat-collection-check'};
    documents.value.push(flatSourceDoc);parseAll();await nextTick();
    document.querySelector('[aria-label="平特肖集合"]').click();await nextTick();
    const flatTotal=()=>document.querySelector('.flat-zodiac-page .total-card .metric-value')?.textContent.trim();
    const flatCard=name=>document.querySelector(`.flat-zodiac-card[data-animal="${name}"]`);
    const flatInitial=flatTotal()==='¥ 480.00'&&document.querySelectorAll('.flat-zodiac-card').length===12
      &&flatCard('鼠')?.querySelector('.flat-zodiac-amount').textContent==='¥ 280.00'
      &&document.querySelector('.flat-zodiac-card')?.dataset.animal==='鼠'
      &&flatCard('鼠').getBoundingClientRect().width>90&&getComputedStyle(document.querySelector('.flat-zodiac-grid')).display==='grid';
    flatCard('鼠').click();await nextTick();
    const flatSources=document.querySelectorAll('.flat-collection-sources tbody tr').length===3
      &&document.querySelector('.flat-collection-sources header').textContent.includes('280.00');
    const flatSelect=async(label,value)=>{const input=document.querySelector(`[aria-label="${label}"]`);input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();};
    await flatSelect('平特肖市场','港');
    const flatMarket=flatTotal()==='¥ 50.00'&&document.querySelectorAll('.flat-collection-sources tbody tr').length===1;
    await flatSelect('平特肖业务日期','2026-10-04');
    const flatEmpty=flatTotal()==='¥ 0.00'&&!!document.querySelector('.flat-collection-sources .empty-state');
    await flatSelect('平特肖市场','旧');
    const flatDate=flatTotal()==='¥ 30.00';
    await flatSelect('平特肖排序','amount-asc');
    const flatAscending=document.querySelector('.flat-zodiac-card')?.dataset.animal==='牛';
    await flatSelect('平特肖排序','zodiac');
    const flatSorted=document.querySelector('.flat-zodiac-card')?.dataset.animal==='鼠';
    document.querySelector('.flat-collection-sources tbody .text-button').click();
    for(let retry=0;retry<40&&(activeId.value!==flatSourceDoc.id||view.value!=='ledger'||editor.value.selectionEnd===0);retry++)await new Promise(resolve=>setTimeout(resolve,25));
    const flatLocated=activeId.value===flatSourceDoc.id&&view.value==='ledger'
      &&editor.value.value.slice(editor.value.selectionStart,editor.value.selectionEnd)==='旧平肖鼠各30';
    active.value.text='旧平肖鼠各60';parseAll();await nextTick();
    document.querySelector('[aria-label="平特肖集合"]').click();await nextTick();
    const flatUpdated=flatTotal()==='¥ 510.00';
    active.value.text='';parseAll();await nextTick();
    const flatZodiacCollectionUI=flatInitial&&flatSources&&flatMarket&&flatEmpty&&flatDate&&flatAscending&&flatSorted&&flatLocated&&flatUpdated&&flatTotal()==='¥ 450.00';
    await selectDocument(memoryOriginal);documents.value=documents.value.filter(d=>d.id!==navDoc.id);
    documents.value=documents.value.filter(d=>d.id!==flatSourceDoc.id);
    ledgerSearch.value='';searchDirty.value=false;navigation.value=navigationBefore;linkedSource.value=null;parseAll();
    await setEditorExpanded(false);await saveDraft(true);
    const idleRevision = storageRevision;
    await new Promise(resolve => setTimeout(resolve, 1700));
    const afterIdle = await songcai.readDraft();
    tab.value = 'numbers'; numberSort.value = 'amount-desc'; await nextTick();
    const numberPanelWorks = document.querySelectorAll('.number-grid > div').length === 49
      && document.querySelector('.number-grid > div')?.dataset.number === '1'
      && document.querySelector('[data-number="1"] .number-animal')?.textContent === '马'
      && document.querySelector('[data-number="1"] .number-excess')?.textContent === '超出 +93.88'
      && document.querySelector('.number-summary strong')?.textContent.trim() === '¥ 6.12';
    numberSort.value = 'zodiac'; await nextTick();
    const zodiacSortWorks = document.querySelector('.number-grid > div')?.dataset.number === '7'
      && document.querySelector('.number-grid .number-animal')?.textContent === '鼠';
    const settlementAPI = songcai.settlement, settlementDate = '2026-10-05';
    const settlementConfig = (await settlementAPI.load({ date: settlementDate })).settings;
    if (!songcai.checkDrawNetwork) settlementConfig.sources.港 = []; 
    for (const m of ['新', '旧']) {
      settlementConfig.odds[m].confirmed = true;
      await settlementAPI.manual({ market: m, issue: '2026278', date: settlementDate, numbers: [1, 2, 3, 4, 6, 7, 5], sourceName: '隔离启动测试' });
    }
    await settlementAPI.settings(settlementConfig);
    const settlementData = await settlementAPI.load({ date: settlementDate });
    const settlementInput = { date: settlementDate, kind: 'current', activeId: originalProject.activeId,
      drawIds: Object.fromEntries(['新', '旧'].map(m => [m, settlementData.draws[m][0].id])) };
    const unverifiedTrial = await settlementAPI.preview(settlementInput);
    settlementInput.decisions = Object.fromEntries(['新','旧'].map(m=>[m,{drawId:settlementInput.drawIds[m],reviewKey:unverifiedTrial.inputs.verification[m].reviewKey}]));
    const trial = await settlementAPI.preview(settlementInput);
    const settlementRecord = await settlementAPI.save({ ...settlementInput, inputHash: trial.inputHash, reviewed: true });
    const duplicate = await settlementAPI.save({ ...settlementInput, inputHash: trial.inputHash, reviewed: true });
    const restoredSettlement = await settlementAPI.get({ id: settlementRecord.id });
    // Exercise destructive actions only in the isolated startup database, then undo.
    await requestClearContents();
    await changeLedgerContents(false);
    const clearedRead=await songcai.readDraft();
    const clearPassed=clearedRead.documents.length===originalProject.documents.length
      &&clearedRead.documents.every((d,i)=>d.text===''&&d.name===originalProject.documents[i].name)
      &&!!(await songcai.clearLedgerState());
    await changeLedgerContents(true);
    const restoredRead=await songcai.readDraft();
    const clearRestorePassed=clearPassed&&ledgerParseKey(restoredRead.documents)===ledgerParseKey(originalProject.documents)
      &&(await songcai.clearLedgerState())===null;
    await refreshOverview();
    for(const m of ['新','旧'])adoptOverview(m,settlementInput.drawIds[m]);
    const collectionOriginal=active.value.text;
    active.value.text='新05各10\n旧05各30\n香港48各20';parseAll();view.value='collection';await nextTick();await refreshOverview();await nextTick();
    const collectionCard=n=>document.querySelector(`.collection-numbers [data-number="${n}"]`);
    const highlightsInitial=document.querySelectorAll('.collection-numbers .number-won').length===1
      &&collectionCard(5)?.querySelectorAll('.number-win-badge').length===2
      &&collectionCard(5)?.textContent.includes('新澳 · 中')&&collectionCard(5)?.textContent.includes('旧澳 · 中')
      &&!collectionCard(48)?.classList.contains('number-won')
      &&getComputedStyle(collectionCard(5)).backgroundImage.includes('gradient')
      &&document.querySelector('[aria-label="特码集合最新开奖"]')?.textContent.includes('2026-10-05');
    const collectionMarket=document.querySelector('[aria-label="集合市场"]');collectionMarket.value='港';collectionMarket.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();
    const highlightsMarket=document.querySelectorAll('.collection-numbers .number-won,.collection-numbers .number-win-pending').length===0;
    collectionMarket.value='新';collectionMarket.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();
    const highlightsFiltered=collectionCard(5)?.querySelectorAll('.number-win-badge').length===1&&collectionCard(5)?.textContent.includes('新澳 · 中');
    collectionCard(5).querySelector('button').click();await nextTick();
    const highlightsSources=document.querySelector('.collection-sources h2')?.textContent.includes('05号的来源')
      &&document.querySelectorAll('.collection-sources tbody tr').length===1;
    active.value.text='新06各10';parseAll();await nextTick();
    const specialHighlightsUI=highlightsInitial&&highlightsMarket&&highlightsFiltered&&highlightsSources
      &&document.querySelectorAll('.collection-numbers .number-won,.collection-numbers .number-win-pending').length===0;
    active.value.text='新平特肖马虎各10\n旧平特肖马各30\n香港平特肖马各20\n新平特肖狗各5';parseAll();view.value='flatZodiac';await nextTick();await refreshOverview();await nextTick();
    const flatHighlightCard=a=>document.querySelector(`.flat-zodiac-card[data-animal="${a}"]`);
    const flatHighlightsInitial=document.querySelectorAll('.flat-zodiac-card.zodiac-won').length===2
      &&flatHighlightCard('马')?.querySelectorAll('.flat-win-badge').length===2
      &&flatHighlightCard('马')?.textContent.includes('新澳 · 中')&&flatHighlightCard('马')?.textContent.includes('旧澳 · 中')
      &&!flatHighlightCard('狗')?.classList.contains('zodiac-won')
      &&getComputedStyle(flatHighlightCard('马')).backgroundImage.includes('gradient')
      &&document.querySelector('[aria-label="平特肖集合最新开奖"]')?.textContent.includes('正码＋特码算中');
    const highlightFlatMarket=document.querySelector('[aria-label="平特肖市场"]');highlightFlatMarket.value='港';highlightFlatMarket.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();
    const flatHighlightsMarket=document.querySelectorAll('.flat-zodiac-card.zodiac-won,.flat-zodiac-card.zodiac-win-pending').length===0;
    highlightFlatMarket.value='新';highlightFlatMarket.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();
    const flatHighlightsFiltered=flatHighlightCard('马')?.querySelectorAll('.flat-win-badge').length===1&&flatHighlightCard('虎')?.classList.contains('zodiac-won');
    flatHighlightCard('马').click();await nextTick();
    const flatHighlightsSources=document.querySelector('.flat-collection-sources h2')?.textContent.includes('马肖的来源')
      &&document.querySelectorAll('.flat-collection-sources tbody tr').length===1;
    active.value.text='新平特肖狗各10';parseAll();await nextTick();
    const flatZodiacHighlightsUI=flatHighlightsInitial&&flatHighlightsMarket&&flatHighlightsFiltered&&flatHighlightsSources
      &&document.querySelectorAll('.flat-zodiac-card.zodiac-won,.flat-zodiac-card.zodiac-win-pending').length===0;
    active.value.text=collectionOriginal;parseAll();
    view.value='overview';await nextTick();
    const playOverviewUI=!!document.querySelector('[aria-label="按玩法统计"]')
      &&document.querySelector('[aria-label="玩法：特码"]')?.textContent.includes('300.00')
      &&document.querySelector('[aria-label="玩法：特肖"]')?.textContent.includes('200.00');
    document.querySelector('[aria-label="玩法：特肖"]').click();await nextTick();
    const playFilterUI=document.querySelector('[aria-label="当前玩法汇总"]')?.textContent.includes('200.00')
      &&document.querySelector('.play-table')?.textContent.includes('2,340.00');
    [...document.querySelectorAll('.overview-perspective button')].find(e=>e.textContent==='账目视角').click();await nextTick();
    const overviewPassed=overview.value?.stakeCents===50000&&overview.value?.payoutCents===234000
      &&overview.value?.netCents===184000&&overview.value?.rows.length===1
      &&document.querySelector('.overview-table')?.textContent.includes('赢 +1,840.00')
      &&document.querySelector('.file-profit')?.textContent.includes('赢 +1,840.00');
    const profitDocs=[['profit-win','赢的账目','新05各20'],['profit-loss','亏的账目','新01各1000'],['profit-pending','待结算账目','香港01各10'],['profit-empty','空账目','']]
      .map(([id,name,text])=>({...makeDocument(name,text,settlementDate),id}));
    documents.value.push(...profitDocs);parseAll();await nextTick();
    const profitSortBefore=workspace.value.ledgerSort,sortSelect=document.querySelector('[aria-label="账目排序"]');
    sortSelect.value='profit-desc';sortSelect.dispatchEvent(new Event('change',{bubbles:true}));await nextTick();
    const profitIds=()=>[...document.querySelectorAll('#saved-ledger-list .file-item')].map(e=>e.dataset.documentId);
    const profitOrder=profitIds().join()===`${originalProject.activeId},profit-win,profit-loss,profit-pending,profit-empty`;
    const profitSaved=JSON.parse(localStorage.getItem(workspaceKey)).ledgerSort==='profit-desc';
    documents.value.find(d=>d.id==='profit-win').text='新05各100';parseAll();await nextTick();
    const ledgerProfitSortUI=profitOrder&&profitSaved&&profitIds()[0]==='profit-win'
      &&document.querySelector('[data-document-id="profit-win"] .file-profit')?.textContent.includes('4,600.00');
    documents.value=documents.value.filter(d=>!profitDocs.some(p=>p.id===d.id));workspace.value.ledgerSort=profitSortBefore;parseAll();
    view.value='ledger';await nextTick();
    const winningEditor=editor.value;winningEditor.setSelectionRange(3,8);
    const headerAndMarks=document.querySelector('.entry-winnings')?.textContent.includes('应付 ¥2,340.00')
      &&document.querySelector('.entry-winnings')?.textContent.includes('赢 +1,840.00')
      &&document.querySelectorAll('.winning-line').length===2
      &&document.querySelectorAll('.winning-gutter').length===2;
    const originalWinningSource=active.value.text;
    active.value.text+='\n01各10';await nextTick();
    const staleMarksCleared=document.querySelectorAll('.winning-line').length===0;
    parseAll();await nextTick();
    const freshMarksRestored=document.querySelectorAll('.winning-line').length===2;
    active.value.text=originalWinningSource;parseAll();await nextTick();
    await settlementAPI.manual({market:'新',issue:'2026279',date:'2026-10-06',numbers:[1,2,3,4,6,7,5],sourceName:'隔离截图日期测试'});
    await settlementAPI.manual({market:'港',issue:'26/105',date:'2026-10-05',numbers:[31,23,34,43,29,8,48],sourceName:'隔离香港截图测试'});
    tab.value='winnings';await nextTick();
    for(let retry=0;retry<40&&!document.querySelector('.winning-entry-stake');retry++)await new Promise(resolve=>setTimeout(resolve,50));
    const compactWin=document.querySelector('.winning-entry summary')?.textContent;
    const winningDetails=compactWin?.includes('特肖100.00元')&&compactWin?.includes('赔付 1,170.00元');
    const inputRetained=editor.value===winningEditor;
    document.querySelector('.receipt-heading-button').click();await nextTick();await nextTick();
    for(let retry=0;retry<40&&!document.querySelector('.receipt-dialog .receipt-preview')?.complete;retry++)await new Promise(resolve=>setTimeout(resolve,50));
    const receiptImage=document.querySelector('.receipt-dialog .receipt-preview');
    const receiptSummary=receiptImage?.alt;
    const receiptSVG=decodeURIComponent(receiptImage?.src.split(',').slice(1).join(',')||'');
    const receiptCompactUI=receiptSVG.indexOf('本单开奖')>=0&&receiptSVG.indexOf('本单开奖')<receiptSVG.indexOf('总 · 投注金额')
      &&['开奖日期','账目结算单','启动检查.og','试算','账目日期','四舍五入','不代表已付款'].every(text=>!receiptSVG.includes(text));
    const receiptMultiDrawUI=['新澳','旧澳','data-draw-market="新"','data-draw-market="旧"'].every(text=>receiptSVG.includes(text))
      &&!receiptSVG.includes('data-draw-market="港"')&&!/新市场|旧市场|港市场/.test(receiptSVG)
      &&(receiptSVG.match(/aria-label="特码 /g)||[]).length===2;
    const receiptVisible=document.querySelector('.receipt-dialog')?.open&&receiptImage?.naturalWidth===640
      &&receiptSummary?.includes('总投注500元')&&receiptSummary?.includes('赔付2,340元')&&receiptSummary?.includes('盈1,840元');
    [...document.querySelectorAll('.receipt-export-actions button')].find(b=>b.textContent==='截图并复制').click();
    for(let retry=0;retry<80&&!document.querySelector('.receipt-success');retry++)await new Promise(resolve=>setTimeout(resolve,50));
    const receiptExportUI=!!(receiptVisible&&document.querySelector('.receipt-success')?.textContent.includes('已复制'));
    document.querySelector('.receipt-close').click();await nextTick();
    const receiptOriginal=active.value.text;
    active.value.text='05各100\n平特蛇1000\n20各900';parseAll();await nextTick();
    document.querySelector('.receipt-heading-button').click();await nextTick();
    for(let retry=0;retry<80&&!document.querySelector('.receipt-preview')?.alt.includes('赔付6,750元');retry++)await new Promise(resolve=>setTimeout(resolve,50));
    const receiptExample=document.querySelector('.receipt-preview')?.alt;
    [...document.querySelectorAll('.receipt-export-actions button')].find(b=>b.textContent==='截图并复制').click();
    for(let retry=0;retry<80&&!document.querySelector('.receipt-success');retry++)await new Promise(resolve=>setTimeout(resolve,50));
    const receiptExampleUI=!!(receiptExample?.includes('总投注2,000元')&&receiptExample.includes('盈4,750元')&&document.querySelector('.receipt-success')?.textContent.includes('已复制'));
    document.querySelector('.receipt-close').click();await nextTick();
    active.value.text='香港48各100\n01各50';parseAll();await nextTick();
    document.querySelector('.receipt-heading-button').click();await nextTick();
    for(let retry=0;retry<80&&!document.querySelector('.receipt-preview')?.alt.includes('赔付4,700元');retry++)await new Promise(resolve=>setTimeout(resolve,50));
    const hongKongReceipt=document.querySelector('.receipt-preview'),hongKongSVG=decodeURIComponent(hongKongReceipt?.src.split(',').slice(1).join(',')||'');
    const receiptDrawsUI=!!(receiptMultiDrawUI&&hongKongReceipt?.alt.includes('总投注150元')&&hongKongReceipt.alt.includes('盈4,550元')
      &&hongKongSVG.includes('>香港</text>')&&!hongKongSVG.includes('新澳')&&!hongKongSVG.includes('旧澳')
      &&hongKongSVG.includes('2026-10-05 · 第26/105期')&&hongKongSVG.includes('特码 48，蓝波，羊')
      &&(hongKongSVG.match(/aria-label="正码 /g)||[]).length===6&&(hongKongSVG.match(/aria-label="特码 /g)||[]).length===1);
    [...document.querySelectorAll('.receipt-export-actions button')].find(b=>b.textContent==='截图并复制').click();
    for(let retry=0;retry<80&&!document.querySelector('.receipt-success');retry++)await new Promise(resolve=>setTimeout(resolve,50));
    const receiptDrawExportUI=receiptDrawsUI&&!!document.querySelector('.receipt-success')?.textContent.includes('已复制');
    document.querySelector('.receipt-close').click();await nextTick();
    active.value.text=receiptOriginal;parseAll();await nextTick();
    for(let retry=0;retry<80&&!document.querySelector('.winning-entry-stake')?.textContent.includes('特肖100.00元');retry++)await new Promise(resolve=>setTimeout(resolve,50));
    // A saved historical version must never mark the currently editable original.
    const currentContext=winningsContext.value;
    receiveWinningsContext({...currentContext,history:true});await nextTick();
    const historyUnmarked=document.querySelectorAll('.winning-line').length===0;
    receiveWinningsContext(currentContext);await nextTick();
    const winningsUI=!!(headerAndMarks&&staleMarksCleared&&freshMarksRestored&&winningDetails&&inputRetained&&historyUnmarked);
    tab.value='numbers';await saveDraft(true);await nextTick();
    let networkReport = null;
    if (songcai.checkDrawNetwork) {
      const reports=await settlementAPI.sync({ date: settlementDate }),live=await settlementAPI.load({date:settlementDate});
      const {verifyDraws}=await import('./core/draw-verification.js');
      const comparisons=Object.fromEntries(MARKETS.map(m=>{
        const latest=reports.find(r=>r.market===m&&r.ok)?.latest;
        const chosen=latest&&live.draws[m].find(d=>d.sourceId===latest.sourceId&&d.issue===latest.issue&&d.date===latest.date);
        const check=verifyDraws(live.draws,live.settings,latest?.date||settlementDate,{[m]:chosen?.id}, {}, live.reports)[m];
        return [m,{status:check.status,confirmed:check.confirmed,date:check.date,issue:check.issue,providers:check.providers}];
      }));
      networkReport={...reports.find(r=>r.sourceId==='macaujc-new'),sources:reports,comparisons};
    }
    // Test mode uses an isolated fixture. Verify rendered DOM and loaded CSS,
    // rather than considering a live renderer or first paint sufficient.
    const shell = document.querySelector('.app-shell');
    const workbench = document.querySelector('.workbench');
    const aiConfig=await songcai.ai.load();
    const semanticTrial=parseDocument('平特牛各十\n新奥牛鼠数各十五',{businessDate:'2026-10-05'});
    const latestTrial=await settlementAPI.preview({...settlementInput,drawMode:'latest'});
    const structureTrial=parseDocument('小明：旧1各10\n四肖中特：龙牛狗蛇200\n特肖虎100',{businessDate:'2026-10-06'});
    const upgradeFixture=upgradeProject({schemaVersion:1,activeId:'upgrade-check',documents:[{id:'upgrade-check',name:'旧账',text:'旧 四肖中特：龙牛狗蛇200',businessDate:'2026-10-06',defaultPlayer:'',autoTitle:true}]}).documents[0];
    const upgradeCheck=upgradeComparison(upgradeFixture);
    songcai.reportStartup({
      menMarketUI,multilineTriplesUI,equalitySubtotalUI,perZodiacStakeUI,specialTransferUI:await (await import('./special-transfer-startup-check.js')).checkSpecialTransferUI(),
      receiptPlayStakesUI:await (await import('./receipt-play-stakes-startup-check.js')).checkReceiptPlayStakesUI(context),receiptNameUI:await (await import('./receipt-name-startup-check.js')).checkReceiptNameUI(context),compactLinkedZodiacUI:await (await import('./compact-linked-zodiac-startup-check.js')).checkCompactLinkedZodiacUI(context),rebateUI:await (await import('./rebate-startup-check.js')).checkRebateUI(context,originalProject,settlementInput),issueTitleRebateUI:await (await import('./issue-title-startup-check.js')).checkIssueTitleRebateUI(context),specialHighlightsUI,flatZodiacHighlightsUI,incrementalReviewUI:await (await import('./ai-cache-startup-check.js')).checkIncrementalReviewUI(),flatZodiacCollectionUI,ledgerProfitSortUI,paragraphMarketUI,perZodiacPackageUI,compactPerZodiacPackageUI,flatOneZodiacUI,zodiacDragUI,zodiacDelimitedGroupsUI,linkedZodiacDragUI,tripleZodiacDragUI,specialPairDragUI,specialPairCrossUI,specialPairZodiacDragUI,tailZodiacCrossUI,tailDragUI,numberCategoryPackageUI,headParityUI,issuePrefixUI,slashZodiacGroupsUI,flatAnySuffixUI,blankMarketResetUI,blankPlayResetUI,separatePriceLinesUI,reversedZodiacPackageUI,receiptDrawExportUI,marketDirectionUI,bareMacauMarketUI,zodiacPackageUI,hongKongHeadingUI,receiptCompactUI,receiptExportUI,receiptExampleUI,headerStakeUI,multilineNumbersUI,compactTailGroupsUI,defaultStakeBasisUI,adjacentSubtotalUI,inlineMarketSectionUI,marketPrefixResetUI,ledgerAmountSortUI,playOverviewUI:playOverviewUI&&playFilterUI,bidirectionalNavigation,navigationHistoryUI,winningsUI,ledgerClear:clearRestorePassed,ledgerOverview:overviewPassed,pasteEditor:pasteEditorPassed,editorMemory,pasteCheckDetail,
      parserStructure:structureTrial.issues.length===0&&summarize([structureTrial]).totalCents===31000&&structureTrial.bets.every(b=>b.player==='小明'&&b.markets.join()==='旧')&&structureTrial.bets[1].basis==='整项',
      parserUpgrade:upgradeCheck.before.totalCents===320000&&upgradeCheck.after.totalCents===20000&&upgradeFixture.autoTitle===false&&parseDocument(upgradeFixture.text,upgradeFixture).bets[0].status==='parsed'&&!document.querySelector('.parser-upgrade'),
      codexDefault:aiConfig.settings.transport==='codex', 
      semanticAI:!!document.querySelector('[aria-label="AI 核验"]')&&aiConfig.settings.enabled===false&&!aiConfig.settings.hasKey&&semanticTrial.bets[1].totalCents===12000,
      latestDraw:latestTrial.result.payoutCents===trial.result.payoutCents&&latestTrial.inputs.drawDates.新===settlementDate,
      heading: document.querySelector('h1')?.textContent,
      editor: editor.value?.value,
      total: document.querySelector('.entry-total')?.textContent.replace(/\s/g, ''),
      referenceMenus: [...document.querySelectorAll('.app-navigation button[aria-label]')]
        .map(button => button.getAttribute('aria-label')).filter(label => ['玩法赔率', '生肖分类'].includes(label)),
      styledLayout: !!shell && !!workbench && getComputedStyle(shell).display === 'flex'
        && getComputedStyle(workbench).display === 'grid' && editor.value.getBoundingClientRect().width > 100,
      inbox: { menu: !!document.querySelector('[aria-label="微信收件箱"]'), intake: !!document.querySelector('.inbox-intake'),
        previewCents: fixture.analysis.summary.totalCents, beforeCents: beforeConfirm.summary.totalCents,
        afterCents: afterConfirm.summary.totalCents, posted: posted.posted.length, repeated: repeated.already.length },
      ledger: { database: dbRead.storageRevision > 0, autoTitle: dbFirst.documents[0].name === '数据库玩家',
        sameTitleReplaced: dbSecond.documents.length === 1 && dbSecond.documents[0].text.endsWith('200元'), switchRestored: dbRead.activeId === originalProject.activeId },
      highlighted: ['play', 'selection', 'amount'].every(kind => document.querySelector(`.highlight-viewport .token-${kind}`)),
      stableEditor: afterIdle.storageRevision === idleRevision && document.querySelector('.editor-footer')?.textContent.includes('自动解析'),
      expandedEditor: expansionRestored,
      numberDistribution: numberPanelWorks && zodiacSortWorks,
      settlement: { menu: !!document.querySelector('[aria-label="开奖与赔付"]'), stakeCents: trial.result.stakeCents,
        payoutCents: trial.result.payoutCents, complete: trial.result.complete, restored: restoredSettlement.inputHash === trial.inputHash,
        originalText: restoredSettlement.inputs.documents[0].originalText === originalProject.documents[0].text,
        deduplicated: duplicate.reused === true && duplicate.id === settlementRecord.id, paid: settlementRecord.paid },
      networkReport,
    });
  }
});
// Browser shutdown cannot wait for promises; localStorage writes synchronously.
window.addEventListener('pagehide', () => {
  if (!songcai && initialized.value) { try { localStorage.setItem(storageKey, JSON.stringify(project())); } catch { /* The visible save state reports storage failures. */ } }
});
function insertEditorText(field,text) {
  field.focus({preventScroll:true});
  // Chromium's editing command keeps the operation in the native Undo stack.
  if(!document.execCommand('insertText',false,text)){
    field.setRangeText(text,field.selectionStart,field.selectionEnd,'end');
    field.dispatchEvent(new Event('input',{bubbles:true}));
  }
  active.value.text=field.value;
  nextTick(()=>{const caret=field.selectionStart;field.setSelectionRange(caret,caret);syncEditorScroll();});
}
function pasteEditor(event) {
  if(composing.value||clearBusy.value)return;
  const text=event.clipboardData?.getData('text/plain');if(!text)return;
  event.preventDefault();
  const field=event.currentTarget;
  insertEditorText(field,prepareBetPaste(field.value,field.selectionStart,field.selectionEnd,text));
}
function formatEditor() {
  const field=editor.value,next=formatBetLines(field.value);
  if(next===field.value){toast('当前原文已分行，无需整理');return;}
  field.setSelectionRange(0,field.value.length);insertEditorText(field,next);toast('已按投注金额分行，可使用撤销恢复');
}
function compositionStart() { composing.value = true; clearTimeout(saveTimer); clearTimeout(parseTimer); }
function compositionEnd() { composing.value = false; clearTimeout(parseTimer); parseTimer = setTimeout(parseAll, 300); clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 650); }
function syncEditorScroll() {
  if (!editor.value) return;
  if (lineNumbers.value) lineNumbers.value.scrollTop = editor.value.scrollTop;
  if (highlightLayer.value) highlightLayer.value.style.transform = `translate(${-editor.value.scrollLeft}px, ${-editor.value.scrollTop}px)`;
}
async function setEditorExpanded(open) {
  if(composing.value)return;
  rememberEditor();editorExpanded.value=open;await nextTick();measureEditor();restoreEditor(true);
}
onBeforeUnmount(() => {
  disposed=true;rememberEditor();
  clearTimeout(parseTimer);clearTimeout(saveTimer);clearTimeout(noticeTimer);endDocumentDrag();stopSidebar();editorObserver?.disconnect();window.removeEventListener('keydown',workspaceKeydown);window.removeEventListener('pointerdown',closeWorkspaceMenus);
});
async function newDocument() {
  try { await saveDraft(true); } catch { return; }
  ledgerSearch.value = '';listMode.value='all';
  view.value = 'ledger';
  const doc = { ...makeDocument('', '', active.value.businessDate), autoTitle: true };
  documents.value.push(doc); activeId.value = doc.id; nextTick(() => editor.value?.focus());
}
function addDemo() {
  ledgerSearch.value = '';listMode.value='all';
  view.value = 'ledger';
  const doc = makeDocument('演示账单.og', demoText, today());
  documents.value.push(doc); activeId.value = doc.id; toast('已新增演示文件，原有文本保留');
}
async function consumeFiles(files) {
  try {
    if (files.some(f => f.name.toLowerCase().endsWith('.json'))) {
      if (files.length !== 1) throw new Error('恢复账单时请单独选择一个JSON文件');
      const p = validateProject(JSON.parse(files[0].text));
      // Import as new sources instead of overwriting the user's current work.
      const incoming = p.documents.map(d => ({ ...d, id: crypto.randomUUID() }));
      if (documents.value.length + incoming.length > 200) throw new Error('文件数量超过200');
      if(!incoming.length){toast('备份中没有账目');return;}
      const restored=upgradeProject({...p,documents:incoming,activeId:incoming[0].id});
      documents.value.push(...restored.documents); activeId.value = incoming[0].id;
      toast(`已导入${incoming.length}份账单，同名标题将在保存时覆盖`);
    } else {
      if (documents.value.length + files.length > 200) throw new Error('最多同时打开200份文本');
      const incoming = files.map(f => makeDocument(f.name, f.text, active.value.businessDate));
      const duplicate = incoming.some(d => documents.value.some(old => old.text === d.text));
      documents.value.push(...incoming); if (incoming[0]) activeId.value = incoming[0].id;
      toast(duplicate ? '导入完成；发现相同内容，请核对来源。同名标题将在保存时覆盖。' : `已导入${files.length}份文本，请核对业务日期和玩家归属`);
    }
    ledgerSearch.value = ''; listMode.value='all'; scope.value = 'current'; view.value = 'ledger'; await saveDraft(true); parseAll();
  } catch (e) { toast(`导入失败：${e.message}`); }
}
async function openFiles() {
  if (songcai) { try { await consumeFiles(await songcai.openFiles()); } catch (e) { toast(e.message); } }
  else inputFile.value.click();
}
async function browserFiles(event) {
  try {
    const files = await Promise.all([...event.target.files].map(async f => {
      const maxBytes = f.name.toLowerCase().endsWith('.json') ? 20_000_000 : 5_000_000;
      if (f.size > maxBytes) throw new Error(`单个文件不能超过${maxBytes / 1_000_000}MB`);
      return { name: f.name, text: new TextDecoder('utf-8', { fatal: true }).decode(await f.arrayBuffer()) };
    }));
    await consumeFiles(files);
  } catch (e) { toast(`无法读取文件：${e.message}`); }
  event.target.value = '';
}
async function saveFile(name, text) {
  if (songcai) return songcai.saveFile(name, text);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); return true;
}
async function exportProject() {
  try {
    parseAll();
    const data = { ...project(), exportedAt: new Date().toISOString(), results: results.value };
    if (await saveFile(`松财账单-${context.name.replace(/[\\/:*?"<>|]/g,"_")}-${active.value.businessDate}.json`, JSON.stringify(data, null, 2))) toast('已导出全部文本、日期、玩家归属与解析结果');
  } catch (e) { toast(`导出失败：${e.message}`); }
}
async function saveText() {
  try { await saveDraft(true); parseAll(); toast(`已保存“${active.value.name}”，同名账目已更新`); } catch { /* saveDraft displays the cause. */ }
}
async function copySummary() {
  if (account.value.error) { toast(account.value.error); return; }
  const lines = [`松财投注汇总 · ${dateGroups.value.join('、')}`, '玩家\t新\t旧\t港\t合计', ...summary.value.players.map(p => `${p.name}\t${money(p.新)}\t${money(p.旧)}\t${money(p.港)}\t${money(p.totalCents)}`), `合计\t${money(summary.value.markets.新)}\t${money(summary.value.markets.旧)}\t${money(summary.value.markets.港)}\t${money(summary.value.totalCents)}`, `待处理${errors.value.length}项；未署名按本单玩家统计`];
  try { await navigator.clipboard.writeText(lines.join('\n')); toast('已复制当前筛选范围的汇总'); } catch { toast('无法访问剪贴板，请使用导出账单'); }
}
async function locate(item) {
  if(composing.value)return;
  const target=documents.value.find(d=>d.id===item.fileId);if(!target)return;
  if(parsedKeys.value[target.id]!==ledgerParseKey([target])){parseAll();toast('原文已变化，结果已更新，请重新选择要定位的条目');return;}
  if(target.id!==activeId.value){await selectDocument(target.id);if(activeId.value!==target.id)return;}
  if(window.innerWidth<=1350)editorExpanded.value=true;
  view.value='ledger';await nextTick();observeEditor();
  const range=sourceOffsets(active.value.text,item.line,item.endLine);
  linkSource(range.line,range.endLine);
  editor.value.focus({preventScroll:true});editor.value.setSelectionRange(range.start,range.end);
  const row=highlightLayer.value?.children[range.line-1];
  editor.value.scrollTop=Math.max(0,(row?.offsetTop??(range.line-1)*28)-60);syncEditorScroll();rememberEditor();updateEditorCursor();
}

function preview(bet) { return bet.groups || (bet.mode === 'combination' ? combinationPreview(bet.values, bet.size) : [bet.values]); }
function displayValues(values, bet) { return values.map(v => typeof v === 'number' ? /tail/.test(bet?.playType || '') ? `${v}尾` : pad(v) : bet?.playType==='attribute'?({大:'大数（25—49）',小:'小数（01—24）',单:'单数（01、03…49）',双:'双数（02、04…48）'}[v]||v):v).join(' · '); }
function displayBetValues(bet) { return bet.groups ? bet.groups.slice(0,3).map(group=>'（'+displayValues(group,bet)+'）').join(' ') + (bet.groups.length>3?' …':'') : displayValues(bet.values,bet); }
function selectPlayer(name) { player.value = name; showResults('details'); }
function showLedger(nextTab) { view.value='ledger';scope.value='current';if(nextTab)showResults(nextTab); }
function openIssueReview(issue) { activeId.value=issue.fileId; view.value='ai'; }
function showHelp() { view.value = 'ledger'; help.value = !help.value; }
async function showLatestOverview(){view.value='overview';if(overviewMode.value!=='latest')await changeOverviewMode('latest');else await refreshOverview();}
async function showRebates(){try{await settlementView.value?.flush();view.value='rebates';}catch(e){toast(e.message);}}
async function rebatesSaved(){winningsContext.value=null;await refreshOverview();}
async function showSettlement() { try { await saveDraft(true); settlementOpened.value = true; view.value = 'settlement'; } catch {} }
async function selectDocument(id) {
  const request=++switchRequest;rememberEditor();recordSearch();searchHistoryOpen.value=false;
  try { await saveDraft(true); } catch { return; }
  if(request!==switchRequest)return;
  if(documents.value.some(doc=>doc.id===id)){activeId.value=id;recordVisit(id);}
  view.value='ledger';scope.value='current';await nextTick();observeEditor();restoreEditor(true);
}

async function flushWorkspace(){
  if(composing.value){editor.value?.blur();await nextTick();if(composing.value)throw new Error('请先完成正在输入的文字');}
  if(!initialized.value)throw new Error('正在加载空间，请稍候');
  rememberEditor();recordSearch();clearTimeout(saveTimer);await inboxView.value?.flush();await settlementView.value?.flush();await rebateView.value?.flush();await winningsView.value?.flush?.();await saveDraft(true);
}
async function backupWorkspace(){
  clearTimeout(saveTimer);
  await saveQueue.catch(()=>{});
  await nextTick();
  const snapshot=JSON.parse(JSON.stringify(project()));
  // Capture the visible text even when a composition has not committed v-model.
  const current=snapshot.documents.find(doc=>doc.id===activeId.value);
  if(current&&editor.value)current.text=editor.value.value;
  return songcai.backupDraft({...snapshot,storageRevision});
}
defineExpose({flush:flushWorkspace,backup:backupWorkspace,currentView:()=>view.value,ready:()=>initialized.value&&!loadFailed});
</script>

<template>
  <div class="app-shell entry-workspace" :data-space-id="space.id" :class="{'ledger-view':view==='ledger','sidebar-hidden':sidebarHidden}" :style="{'--sidebar-width':workspace.sidebarWidth+'px','--editor-font-size':workspace.fontSize+'px'}">
    <header class="app-navigation" :inert="clearBusy||switching">
      <button class="navigation-brand" @click="showLedger()"><span class="brand-mark">松</span><strong>松财</strong></button>
      <slot name="space-picker" />
      <button class="sidebar-toggle" :aria-expanded="!sidebarHidden" aria-controls="account-sidebar" @click="sidebarHidden=!sidebarHidden" title="显示或收起账目列表">☰ <span>账目列表</span></button>
      <nav aria-label="功能导航">
        <button :class="{selected:view==='ledger'}" @click="showLedger()">投注账目</button>
        <button :class="{selected:view==='inbox'}" aria-label="微信收件箱" @click="view='inbox'">微信收件箱</button>
        <button :class="{selected:view==='overview'}" aria-label="全部账目统计" @click="view='overview';refreshOverview()">全部统计</button>
        <button :class="{selected:view==='settlement'}" aria-label="开奖与赔付" @click="showSettlement">开奖赔付</button>
        <button :class="{selected:view==='collection'}" aria-label="特码集合" @click="view='collection'">特码集合</button>
        <button :class="{selected:view==='flatZodiac'}" aria-label="平特肖集合" @click="view='flatZodiac'">平特肖集合</button>
        <button :class="{selected:view==='rebates'}" aria-label="玩家退水" @click="showRebates">玩家退水／赔率</button>
        <details class="workspace-menu"><summary>更多 ⌄</summary><div class="workspace-menu-items" @click="$event.currentTarget.parentElement.removeAttribute('open')">
          <button @click="showLedger('issues')">本单待处理 · {{pendingById[activeId]||0}}</button>
          <button aria-label="AI 核验" @click="view='ai'">AI 核验</button>
          <button aria-label="玩法赔率" @click="view='odds'">玩法赔率</button>
          <button aria-label="生肖分类" @click="view='zodiac'">生肖分类</button>
          <button @click="showHelp">使用说明</button>
        </div></details>
      </nav><span class="navigation-local">本地存储 <small>v0.6.35</small></span>
    </header>
    <dialog ref="clearDialog" class="clear-ledger-dialog" aria-label="清空本空间账目内容" @cancel="clearBusy&&$event.preventDefault()">
      <h2>清空“{{space.name}}”的 {{documents.length}} 份账目内容？</h2>
      <p>清空所有投注原文和对应解析记录，保留左侧账目名称、顺序、业务日期及玩家绑定。</p>
      <p>自动保留最近一次清空前的备份，可点击“撤销上次清空”恢复。已保存的赔付历史、开奖记录和赔率保留。</p>
      <div><button class="button" :disabled="clearBusy" autofocus @click="clearDialog.close()">取消</button><button class="button danger" :disabled="clearBusy" @click="changeLedgerContents(false)">{{clearBusy?'正在清空…':'确认清空内容'}}</button></div>
    </dialog>
    <aside id="account-sidebar" class="sidebar" :inert="clearBusy||sidebarHidden||switching">
      <p class="space-sidebar-name" :title="space.name">{{space.name}}</p>
      <div class="file-heading"><strong>账目 <small>{{documents.length}}</small></strong><button aria-label="新建账目" title="新建账目" @click="newDocument">＋</button></div>
      <div class="ledger-search-region" @focusout="leaveSearch"><div class="ledger-search">
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
        <input ref="ledgerSearchInput" v-model="ledgerSearch" type="search" placeholder="搜索本空间账目" aria-label="搜索账目名称" aria-controls="saved-ledger-list ledger-search-history" :aria-expanded="searchHistoryOpen" autocomplete="off" @focus="searchHistoryOpen=true" @keydown="searchKeydown" @keydown.esc="!$event.isComposing && (searchHistoryOpen ? searchHistoryOpen=false : clearLedgerSearch())" />
        <button v-if="ledgerSearch" aria-label="清空账目搜索" @click="clearLedgerSearch">×</button>
      </div><div v-if="searchHistoryOpen" id="ledger-search-history" class="ledger-search-history" role="group" aria-label="搜索历史"><header><strong>最近搜索</strong><button v-if="navigation.searches.length" @click="navigation.searches=[];searchDirty=false" aria-label="清空搜索历史">清空</button></header><div v-for="term in navigation.searches" :key="term" class="search-history-row"><button class="search-history-term" @click="useSearchHistory(term)" :title="term">{{term}}</button><button class="search-history-remove" :aria-label="'删除搜索记录：'+term" @click="navigation.searches=navigation.searches.filter(t=>t!==term)">×</button></div><p v-if="!navigation.searches.length">搜索后打开账目、按回车或离开搜索框，即可记录。</p></div></div>
      <section v-if="recentDocuments.length" class="recent-ledgers" aria-label="最近访问的账目"><header><strong>最近访问</strong><small>最近 {{recentDocuments.length}} 条</small></header><div><button v-for="doc in recentDocuments" :key="doc.id" :class="{active:doc.id===activeId}" :title="ledgerTitle(doc)" :aria-label="'最近访问：'+ledgerTitle(doc)" @click="openRecent(doc.id)">{{ledgerTitle(doc)}}</button></div></section>
      <div class="ledger-list-tools"><button :class="{active:listMode==='all'}" @click="listMode='all'">全部</button><button :class="{active:listMode==='pending'}" @click="listMode='pending'">有待处理</button><select v-model="workspace.ledgerSort" aria-label="账目排序" :title="workspace.ledgerSort==='profit-desc'?'按玩家净盈利（赔付减投注）降序；待结算和空账目在后':''"><option value="stake-desc">投注从高到低</option><option value="profit-desc">盈利从高到低</option><option value="manual">手动排序</option></select></div>
      <p v-if="ledgerSearchTerm" class="ledger-search-count" role="status">找到 {{visibleDocuments.length}} 份账目</p>
      <div id="saved-ledger-list" class="file-list">
        <div v-for="doc in visibleDocuments" :key="doc.id" :class="['file-item',{active:doc.id===activeId&&view==='ledger',dragging:draggingDocument===doc.id,'drop-before':dropDocument===doc.id&&!dropAfter,'drop-after':dropDocument===doc.id&&dropAfter}]" :data-document-id="doc.id" @keydown.alt.up.prevent="moveDocumentKey(doc.id,-1)" @keydown.alt.down.prevent="moveDocumentKey(doc.id,1)">
          <button class="file-drag-handle" :disabled="workspace.ledgerSort!=='manual'" :aria-label="'调整顺序：'+ledgerTitle(doc)" :title="workspace.ledgerSort==='manual'?'拖动排序；Alt＋上／下移动':'选择手动排序后可拖动'" @pointerdown="startDocumentDrag($event,doc.id)" @pointermove="overDocument" @pointerup="dropOnDocument" @pointercancel="endDocumentDrag" @lostpointercapture="endDocumentDrag" @click.stop>⠿</button>
          <button class="file-select" :aria-label="'账目：'+ledgerTitle(doc)" :aria-current="doc.id===activeId?'true':undefined" :title="ledgerTitle(doc)" @click="selectDocument(doc.id)">
            <span class="file-name-row"><span class="file-name">{{ledgerTitle(doc)}}</span><span v-if="pendingById[doc.id]" class="file-pending">待 {{pendingById[doc.id]}}</span></span>
            <span class="file-stats"><small>已计 {{ledgerAmounts[doc.id]===null?'待核对':'¥'+money(ledgerAmounts[doc.id]||0)}}</small><small :class="['file-profit',{'profit-positive':overview?.byId[doc.id]?.netCents>0,'profit-negative':overview?.byId[doc.id]?.netCents<0}]">{{profitText(overview?.byId[doc.id])}}</small></span>
          </button>
        </div>
        <p v-if="!visibleDocuments.length" class="ledger-search-empty">没有匹配的账目<button class="text-button" @click="listMode='all';clearLedgerSearch()">显示全部账目</button></p>
      </div>
      <div class="ledger-list-footer"><small>玩家净输赢 · {{overviewLabel}}</small><details class="workspace-menu account-management"><summary>账目管理 ⌄</summary><div class="workspace-menu-items" @click="$event.currentTarget.parentElement.removeAttribute('open')">
        <button @click="openFiles">导入文本／备份</button><button @click="exportProject">导出全部账目</button>
        <button class="clear-ledger-button" :disabled="clearBusy||loadFailed||!initialized||!documents.some(d=>d.text||d.assistance||d.parserReview)" @click="requestClearContents">清空本空间内容</button>
        <button v-if="clearBackup" :disabled="clearBusy||!canRestoreClear" @click="changeLedgerContents(true)">撤销上次清空</button>
      </div></details></div>
      <div class="sidebar-resizer" role="separator" aria-label="调整账目列表宽度" aria-orientation="vertical" :aria-valuenow="workspace.sidebarWidth" aria-valuemin="220" aria-valuemax="360" tabindex="0" @pointerdown="resizeSidebar" @pointermove="moveSidebar" @pointerup="stopSidebar" @pointercancel="stopSidebar" @lostpointercapture="stopSidebar" @keydown.left.prevent="workspace.sidebarWidth=Math.max(220,workspace.sidebarWidth-10)" @keydown.right.prevent="workspace.sidebarWidth=Math.min(360,workspace.sidebarWidth+10)"></div>
    </aside>
    <main class="main-area" :inert="clearBusy||switching">
      <header v-if="view!=='ledger'" class="topbar"><div class="breadcrumb">工作空间 <span>/</span><strong>{{pageTitle}}</strong></div><button class="text-button" @click="showLedger()">返回原文编辑 →</button></header>
      <div v-show="view === 'ledger'&&documents.length" class="page-body">
        <header class="entry-heading"><div class="entry-title-group"><div class="entry-title"><h1 :title="ledgerTitle(active)">{{ledgerTitle(active)}}</h1><span>{{active.businessDate}}<span v-if="rule"> · {{rule.animal}}年</span></span></div><section class="entry-stake" aria-label="本单投注汇总"><div><span>{{pendingById[activeId]?'已计投注':'本单投注'}}</span><strong class="entry-total">¥{{ledgerAmounts[activeId]===null?'待核对':money(ledgerAmounts[activeId]||0)}}</strong></div><div class="entry-market-totals" v-if="currentSummary"><span>新 {{money(currentSummary.markets.新)}}</span><i>·</i><span>旧 {{money(currentSummary.markets.旧)}}</span><i>·</i><span>港 {{money(currentSummary.markets.港)}}</span></div></section><button class="entry-winnings" :title="winningBasisTitle" @click="showResults('winnings')"><span v-if="currentWinning" class="entry-winnings-amount"><span>{{currentWinning.trial?'试算 · ':''}}中奖 {{currentWinning.wins.length}}笔</span><strong>{{currentWinning.result.complete?'应付':'已算应付'}} ¥{{money(currentWinning.result.payableCents)}}</strong></span><span class="entry-winnings-net"><strong :class="{'profit-positive':currentWinning?.netCents>0,'profit-negative':currentWinning?.netCents<0}">{{winningHeading}}</strong><small>中奖明细 →</small></span></button></div><div class="entry-heading-actions"><button class="button compact receipt-heading-button" @click="openLedgerReceipt">结算单 / 截图</button><span class="save-state" :class="{'save-error':loadFailed||saveState.includes('失败')}" role="status">{{saveState}}</span><button :class="['entry-pending',{'has-pending':pendingById[activeId]}]" @click="showResults('issues')">待处理 {{pendingById[activeId]||0}} →</button><button class="button compact" :aria-expanded="ledgerSettings" @click="ledgerSettings=!ledgerSettings">账目设置</button><button class="button compact" :disabled="composing" @click="goToEnd">到末尾录入</button><button class="button primary compact" :aria-expanded="!editorExpanded" aria-controls="ledger-results" :disabled="composing" @click="setEditorExpanded(!editorExpanded)">{{editorExpanded?'查看结果':'专注编辑'}}</button></div></header>
        <section v-if="ledgerSettings" class="entry-settings" aria-label="账目设置">
          <label>账目标题<input v-model="titleInput" :placeholder="ledgerTitle({...active,autoTitle:true})+'（自动）'" maxlength="200" /><small>留空自动取玩家名称；同名保存覆盖。</small></label>
          <label>业务日期<input type="date" v-model="active.businessDate" min="1900-01-01" max="2100-12-31" /><small v-if="rule">{{rule.lunarYear}} · {{rule.lunarDate}}</small></label>
          <label>原文默认署名<input v-model="active.defaultPlayer" placeholder="仅辅助解析，退水和赔率按账单名" /></label>
          <div><button class="text-button" @click="saveText">立即保存</button><button class="text-button" @click="exportProject">导出备份</button></div>
        </section>
        <div v-if="help" class="help-panel"><div><strong>粘贴原文 → 核对归属 → 查看账目</strong><button class="icon-button" @click="help = false">×</button></div><p>使用“小明：”标明发送人。同一人继承上一次市场；换人默认新。两边＝新＋旧，三边＝新＋旧＋港。生肖按业务日期的农历年换表。</p><p>支持特码、特肖/多肖中特、连肖、连码（含二中特）、二至四连尾、一至五粒平特任中、平码、平肖、平尾、不中，以及生肖分类和固定五行。胆拖、含义不明的“包”、后置市场冲突等会提示处理。重复选号按旧项目的累计口径，组合池按不同选项计数。</p><p>“天肖各100”按马年25个特码号码计2500元；“红波100”整项100元，“红波各100”逐号共1700元。蓝/绿波、半波、大小单双/合数沿用同类口径。任中多于声明粒数时请写“复式”或用括号列组。</p><p>左侧“玩法赔率”可查马年赔率及输入示例；“生肖分类”可查生肖、分类、波色和固定五行。“开奖与赔付”可配置各市场赔率并计算应付金额。</p><p>浏览器预览保存到当前浏览器；桌面版原文自动保存到本地数据库，左侧可切换账目。标题留空时取第一个玩家名称；标题相同会覆盖。导出JSON可备份全部原文与配置；赔付计算在“开奖与赔付”中单独保存。</p><button class="text-button" @click="addDemo">新增一份演示账单 →</button></div>

        <div v-if="account.error" class="review-banner" role="alert">{{account.error}}，原文保留。</div>
        <section class="workbench" :class="{'focus-editing':editorExpanded}">
          <div class="editor-panel panel">
            <div class="panel-heading"><h2>投注原文</h2><div class="editor-heading-actions"><label class="editor-font-control">字号<select v-model.number="workspace.fontSize" aria-label="原文字号"><option v-for="size in [14,15,16,17,18]" :key="size" :value="size">{{size}}</option></select></label><label class="editor-wrap-control"><input v-model="workspace.wrap" type="checkbox" :disabled="!highlightEnabled" />折行显示</label><button class="text-button" :disabled="composing" @click="formatEditor">整理换行</button></div></div>
            <div class="highlight-legend"><span class="token-play">● 玩法</span><span class="token-selection">● 生肖／号码</span><span class="token-amount">● 金额</span><span v-if="Object.keys(winningMarks).length" class="winning-legend" :title="winningBasisTitle">◆ 金色行为中奖 <small v-if="Object.values(winningMarks).some(m=>m.trial)">（试：未完成核对）</small></span><small v-if="!highlightEnabled">长文本使用普通显示</small><small v-else>粘贴自动分段，可撤销</small></div>
            <div class="editor-wrap"><div ref="lineNumbers" class="line-numbers" aria-label="原文行号，点击定位结果"><button tabindex="-1" v-for="(_,i) in sourceLines.slice(0,10000)" :key="i" :class="{'winning-gutter':winningMarks[i+1],'trial-winning':winningMarks[i+1]?.trial,'located-gutter':isLinkedLine(i+1)}" :aria-label="'查看第'+(i+1)+'行结果'" :title="[winningMarks[i+1]?.title,'点击查看第'+(i+1)+'行结果'].filter(Boolean).join('\n')" @click="locateResults(i+1,i+1)" :style="rowHeights[i]?{height:rowHeights[i]+'px'}:undefined"><b v-if="winningMarks[i+1]">{{winningMarks[i+1].trial?'试':'中'}}</b>{{i+1}}</button></div><div :key="active.id" class="source-editor" :class="{'highlight-active':highlightEnabled&&!composing,'soft-wrap':effectiveWrap}"><div class="highlight-viewport" aria-hidden="true"><pre ref="highlightLayer"><span v-for="(row,i) in sourceRows" :key="i" class="source-line" :class="{'winning-line':winningMarks[i+1],'trial-winning':winningMarks[i+1]?.trial,'located-line':isLinkedLine(i+1)}" :title="winningMarks[i+1]?.title"><template v-for="(token,j) in row" :key="j"><span :class="token.kind?'token-'+token.kind:''">{{token.text}}</span></template>{{row.length?'':' '}}</span></pre></div><textarea ref="editor" v-model="active.text" :wrap="effectiveWrap?'soft':'off'" spellcheck="false" aria-label="投注原文" placeholder="粘贴或输入玩家投注…&#10;&#10;小明：旧 1 2 3 各100元&#10;特肖虎100元" @paste="pasteEditor" @compositionstart="compositionStart" @compositionend="compositionEnd" @scroll="syncEditorScroll" @click="updateEditorCursor" @keyup="updateEditorCursor" @select="updateEditorCursor" @input="updateEditorCursor" @keydown.meta.enter.prevent="locateResults()" @keydown.ctrl.enter.prevent="locateResults()"></textarea></div></div>
            <div class="editor-footer"><span>{{sourceLines.length}} 行 · 自动解析</span><button class="source-result-link" :disabled="composing" @click="locateResults()" title="⌘ / Ctrl + Enter；选中多行可查看对应投注">查看第 {{editorLines.line}}{{editorLines.endLine!==editorLines.line?'–'+editorLines.endLine:''}} 行结果 ↗</button></div>
          </div>
          <div id="ledger-results" v-show="!editorExpanded" class="results-panel panel">
            <div class="entry-results-heading"><strong>本单结果</strong><button aria-label="收起结果，专注编辑" @click="setEditorExpanded(true)">收起 ×</button></div>
            <div class="result-tabs"><button :class="{ active: tab === 'players' }" @click="tab = 'players'">玩家账目</button><button :class="{ active: tab === 'details' }" @click="tab = 'details'">投注明细 <span>{{ confirmed.length }}</span></button><button :class="{ active: tab === 'issues' }" @click="tab = 'issues'">待处理 <span :class="{ amber: issues.length }">{{ issues.length }}</span></button><button :class="{ active: tab === 'numbers' }" @click="tab = 'numbers'">号码分布</button><button :class="{ active: tab === 'winnings' }" @click="tab = 'winnings'">中奖数据</button></div>
            <div v-if="linkedRange" class="source-result-context"><span>{{linkedLabel}} · {{linkedRows.bets.length}}笔投注<template v-if="linkedRows.issues.length"> · {{linkedRows.issues.length}}项提示</template></span><button v-if="linkedRows.bets.length&&tab!=='details'" @click="locateResults(linkedRange.line,linkedRange.endLine,'details')">查看投注</button><button v-if="linkedRows.issues.length&&tab!=='issues'" @click="locateResults(linkedRange.line,linkedRange.endLine,'issues')">查看提示</button><button @click="locate(linkedRange)">返回原文 ↗</button><button aria-label="取消原文定位标记" @click="linkedSource=null">×</button></div><div v-if="tab !== 'winnings'" class="result-filters"><select v-model="player" aria-label="筛选玩家"><option value="">全部玩家</option><option v-for="p in allPlayers" :key="p.id" :value="p.id">{{ p.name }}</option></select><select v-model="market" aria-label="筛选市场"><option value="">全部市场</option><option v-for="m in MARKETS" :key="m" :value="m">{{ m }}市场</option></select><button v-if="player || market" class="text-button" @click="player = ''; market = ''">重置</button><button class="copy-button" @click="copySummary" title="复制当前汇总">▣ 复制汇总</button></div>
            <div v-if="countIssues && tab !== 'winnings'" class="review-banner"><span>!</span><div><strong>{{ errors.length }} 项输入待处理</strong><small>有歧义的投注暂不计入金额，请核对原文。</small></div><button @click="tab = 'issues'">查看 →</button></div>
            <div v-if="tab === 'players'" class="table-area"><table class="account-table"><thead><tr><th>玩家</th><th>新市场</th><th>旧市场</th><th>港市场</th><th>投注合计</th></tr></thead><tbody><tr v-for="(p, i) in summary.players" :key="p.id" @click="selectPlayer(p.id)" tabindex="0" @keydown.enter="selectPlayer(p.id)"><td><span :class="['avatar', `tone-${i % 4}`]">{{ p.name.slice(0, 1) }}</span><span>{{ p.name }}<small>{{ p.count }} 笔市场明细</small></span><span class="row-arrow">›</span></td><td :class="{ zero: !p.新 }">{{ p.新 ? money(p.新) : '—' }}</td><td :class="{ zero: !p.旧 }">{{ p.旧 ? money(p.旧) : '—' }}</td><td :class="{ zero: !p.港 }">{{ p.港 ? money(p.港) : '—' }}</td><td class="row-total">{{ money(p.totalCents) }}</td></tr></tbody><tfoot v-if="summary.players.length"><tr><td>合计</td><td>{{ money(summary.markets.新) }}</td><td>{{ money(summary.markets.旧) }}</td><td>{{ money(summary.markets.港) }}</td><td>{{ money(summary.totalCents) }}</td></tr></tfoot></table><div v-if="!summary.players.length" class="empty-state"><span>▤</span><strong>这里将显示玩家账目</strong><p>粘贴或导入投注文本，解析后即可核对。</p></div><div class="table-note">点击玩家查看投注明细；切换“中奖数据”查看本账目的中奖与应付金额。</div></div>

            <div v-if="tab === 'details'" class="detail-area"><input class="search-input" v-model="search" placeholder="搜索玩家、玩法或原文…" aria-label="搜索投注" /><div v-for="b in pageBets" :key="b.id" class="bet-row" :class="{'located-result':linkedRows.bets.some(row=>row.id===b.id)}" :data-bet-id="b.id"><div class="bet-summary-row"><button class="bet-main" title="点击定位这笔投注的原文" @click="locate(b)"><span class="bet-person">{{ b.player }}<small>第 {{ b.line }}{{ b.endLine !== b.line ? `–${b.endLine}` : '' }} 行</small></span><span class="bet-description"><strong>{{ b.play }}</strong><span class="bet-values">{{ displayBetValues(b).slice(0, 100) }}</span><span class="bet-count">{{ b.count }} {{ b.basis === '每组' ? '组' : '份' }} × {{ money(b.unitCents) }} / {{ b.basis.replace('每', '') }}</span></span><span class="bet-markets"><i v-for="m in b.markets" :key="m" :class="['market-badge', marketClass(m)]">{{ m }}</i></span><strong class="bet-amount">{{ money(market ? b.perMarketCents : b.totalCents) }}</strong><span class="bet-locate-icon">↖</span></button><button class="bet-expand-toggle" :aria-label="(expanded===b.id?'收起':'展开')+'第'+b.line+'行投注详情'" :aria-expanded="expanded===b.id" @click="expanded=expanded===b.id?'':b.id">{{expanded===b.id?'收起':'详情'}}⌄</button></div><div v-if="expanded === b.id" class="bet-expanded"><div class="raw-quote">{{ b.raw }}</div><p class="semantic-explanation">{{b.markets.join("／")}} ｜ {{b.play}} ｜ {{b.groups?'已列'+b.groups.length+'组（分组见下方）':displayValues(b.values,b)}} ｜ {{b.basis}}{{money(b.unitCents)}}元 ｜ 合计{{money(b.totalCents)}}元</p><p v-if="b.continuation" class="continuation-note">第{{b.line}}–{{b.endLine}}行{{b.continuation.kind==='groups'?'按行分组':'合并选号'}}，使用第{{b.continuation.amountLine}}行的{{b.continuation.kind==='groups'?'每组':'每号'}}金额。</p><p v-if="['R33','R41'].includes(b.drag?.ruleId)" class="zodiac-drag-note">固定{{b.drag.anchors?.join("、")||b.drag.anchor}}，分别搭配{{b.drag.animals.join("、")}}，共{{b.count}}组，每组{{money(b.unitCents)}}元。<span v-if="b.drag.repeatedAnimals?.length" class="drag-repeat-note">{{b.drag.repeatedAnimals.join("、")}}重复列出，对应分组按实际份数计费和赔付。</span></p><p v-if="['R30','R34'].includes(b.drag?.ruleId)" class="drag-note">{{pad(b.drag.anchor)}}拖{{b.drag.animal}}：固定{{pad(b.drag.anchor)}}，分别搭配{{b.drag.numbers.map(pad).join("、")}}，共{{b.count}}组，每组{{money(b.unitCents)}}元。<span v-if="b.drag.excluded.length">已排除与{{pad(b.drag.anchor)}}自身配对。</span></p><p v-if="b.drag?.ruleId==='R40'" class="tail-drag-note">固定{{b.drag.anchors.map(pad).join("、")}}，分别搭配{{b.drag.tail}}尾号码{{b.drag.numbers.map(pad).join("、")}}，共{{b.count}}组，每组{{money(b.unitCents)}}元。<span v-if="b.drag.excluded.length">已排除与固定号码重复的{{b.drag.excluded.map(pad).join("、")}}。</span></p><p v-if="b.drag?.ruleId==='R46'" class="tail-zodiac-cross-note">{{b.drag.tail}}尾（{{b.drag.anchors.map(pad).join("、")}}）与{{b.drag.animal}}（{{b.drag.numbers.map(pad).join("、")}}）交叉配对，共{{b.count}}组，每组{{money(b.unitCents)}}元。两个正码同时命中，按二中二赔率计算。<span v-if="b.drag.excluded.length">已排除{{b.drag.excluded.map(pad).join("、")}}与自身配对，其余配对保留。</span></p><p v-if="b.zodiacCross" class="zodiac-cross-note">{{b.zodiacCross.animals[0]}}（{{b.zodiacCross.numbers[0].map(pad).join("、")}}）与{{b.zodiacCross.animals[1]}}（{{b.zodiacCross.numbers[1].map(pad).join("、")}}）交叉配对，共{{b.count}}组，每组{{money(b.unitCents)}}元。一正码加一特码中奖，按特串赔率计算。</p><p v-if="b.allocation" class="allocation-note">{{b.allocation.source}}：每个市场总额 {{money(b.allocation.totalCents)}}元 ÷ {{b.count}}个号码＝每号 {{money(b.unitCents)}}元</p><p v-if="b.semantic?.declaration">玩法依据第{{b.semantic.declaration.line}}行：{{b.semantic.declaration.body}}</p><p>{{ b.fileName }} · {{ b.businessDate }} · {{ b.marketSource ? `市场来自第${b.marketSource}行声明` : '默认新市场' }}</p><p v-for="(entry, index) in b.expansions" :key="index" class="expansion-note">{{ entry.source }} → {{ entry.kind==='head-parity' ? entry.heads.join('、')+'头中的'+entry.parity+'数' : entry.members?.join('、') || '固定五行' }} → {{ entry.numbers.map(pad).join('、') }} <small>（{{ entry.businessDate || '全年份固定' }}）</small></p><p v-for="w in b.warnings" :key="w" class="warning-text">ⓘ {{ w }}</p><div v-if="b.basis === '每组'" class="combination-list"><span v-for="(g, i) in preview(b)" :key="i">{{ displayValues(g, b) }}</span><small v-if="b.count > 60">仅预览前60组，完整金额按{{ b.count }}组计算</small></div><button class="text-button" @click="locate(b)">定位原文 ↗</button></div></div><div v-if="!visibleBets.length" class="empty-state"><strong>暂无匹配的投注</strong></div><div class="pagination"><span>共 {{ visibleBets.length }} 笔</span><button :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }} / {{ maxPage }}</span><button :disabled="page >= maxPage" @click="page++">下一页</button></div></div>

            <div v-if="tab === 'issues'" class="issue-area">
              <div v-for="i in visibleIssues" :key="i.id" :data-issue-id="i.id" :class="['issue-card', { warning: i.severity === 'warning','located-result':linkedRows.issues.some(row=>row.id===i.id) }]">
                <span class="issue-icon">{{ i.severity === 'warning' ? 'ⓘ' : '!' }}</span>
                <div class="issue-content"><strong>{{i.detail.title}}</strong>
                  <small>{{ i.fileName }} · 第{{ i.line }}{{ i.endLine !== i.line ? `–${i.endLine}` : '' }}行 · {{ i.player || '文档' }}</small>
                  <p class="issue-raw">{{i.raw}}</p>
                  <p class="issue-reason"><b>待处理原因：</b>{{i.detail.reason}}</p>
                  <p v-if="i.detail.aiStatus"><b>核验状态：</b>{{i.detail.aiStatus}}</p>
                  <p v-if="i.detail.localExplanation"><b>本地试算（未计入）：</b>{{i.detail.localExplanation}}</p>
                  <p><b>处理建议：</b>{{i.detail.suggestion}}</p>
                  <div class="issue-actions"><button class="text-button" @click="locate(i)">定位并修改 →</button><button v-if="i.code==='AI_REVIEW'" class="text-button" @click="openIssueReview(i)">查看AI核验 →</button></div>
                </div>
              </div>
              <div v-if="!issues.length" class="empty-state good"><span>✓</span><strong>当前没有待处理项</strong><p>你仍可以逐笔核对原文与金额。</p></div><p v-if="issues.length > issueLimit" class="table-note">显示前{{issueLimit}}项。修正后重新解析即可继续查看。</p>
            </div>

            <div v-if="tab === 'numbers'" class="number-area">
              <div class="number-summary"><div><span>49个号码平均金额</span><strong>¥ {{ money(distribution.averageCents) }}</strong></div><small>{{ distribution.aboveCount }} 个号码高于平均</small></div>
              <p>当前筛选的特码逐号金额合计 ÷ 49，未投注号码也计入平均。连肖、连码、特肖等单独计费。</p>
              <div class="number-toolbar"><label for="number-sort">排列方式</label><select id="number-sort" v-model="numberSort"><option v-for="option in NUMBER_SORTS" :key="option.value" :value="option.value" :disabled="option.value === 'zodiac' && !rule">{{ option.label }}</option></select></div>
              <p class="number-sort-hint">{{ numberSortHint }}</p>
              <p class="number-zodiac-date" v-if="rule">生肖按当前账目：{{ rule.lunarYear }} {{ rule.animal }}年 · {{ active.businessDate }}<small v-if="mixedZodiacYears">含不同农历年份，生肖标签与排序统一按当前账目日期；各账目金额仍按原业务日期解析。</small></p>
              <p v-else class="number-zodiac-date">请填写有效的业务日期以显示生肖。</p>
              <div class="number-grid"><div v-for="n in sortedNumbers" :key="n.number" :data-number="n.number" :class="{ funded: n.cents, 'above-average': n.aboveAverage }">
                <div class="number-excess-slot"><small v-if="n.aboveAverage" class="number-excess">{{ n.excessCents ? `超出 +${money(n.excessCents)}` : '超出 <0.01' }}</small></div>
                <small class="number-animal">{{ n.animal || '—' }}</small><strong>{{ n.label }}</strong><small class="number-wave" :class="{ red: n.wave === '红', blue: n.wave === '蓝', green: n.wave === '绿' }">{{ n.wave }}波</small><span>{{ n.cents ? money(n.cents) : '—' }}</span>
              </div></div>
              <p class="number-rounding">金额显示到分；超出金额按未取整的平均值计算。排序只改变显示顺序，保留全部49个号码。</p>
            </div>
            <LedgerWinnings ref="winningsView" :settings-revision="overviewLoaded?.settings.revision" :receipt-request="receiptRequest" v-if="winningsOpened" v-show="tab === 'winnings'" :key="active.id + active.businessDate" :document="active" :documents="documents" :prepare="() => saveDraft(true)" @context="receiveWinningsContext" @locate="locate" @updated="refreshOverview()" @settings="showSettlement" @rebates="showRebates" />
            <footer class="results-footer"><span><i class="status-dot"></i> {{ errors.length ? '仍有待确认输入' : '解析完成' }}</span><span>金额单位：元 <span>·</span> 赔付：按期号核算</span></footer>
          </div>
        </section>

      </div>
      <section v-if="view==='ledger'&&!documents.length" class="space-empty"><h1>{{space.name}}</h1><p>这个空间还没有账目</p><button class="button primary" @click="newDocument">＋ 新建账目</button><button class="button" @click="openFiles">导入账目</button></section>
      <AiReview v-if="initialized&&documents.length" v-show="view==='ai'" :document="active" :prepare="()=>saveDraft(true)" :apply="applyAssistance" />
      <p v-if="['overview','collection','flatZodiac','settlement','inbox','rebates'].includes(view)" class="space-page-label">当前空间 · {{space.name}}</p>
      <LedgerOverview v-if="view==='overview'" :overview="overview" :loaded="overviewLoaded" :busy="overviewBusy" :error="overviewError" :mode="overviewMode" :draw-date="overviewDate" :selection="overviewSelection" :verification="overviewVerification" :draws="overviewDraws" @refresh="refreshOverview()" @sync="refreshOverview({sync:true})" @mode="changeOverviewMode" @select="selectOverview" @adopt="adoptOverview" @open="selectDocument" @locate="locate" @settings="showSettlement" @source="openOverviewSource" />
      <SpecialCollection v-if="view === 'collection'" :results="results" :reference-date="active.businessDate" :latest="overviewLatest" :busy="overviewBusy" :draw-error="overviewError" :settings="overviewLoaded?.settings" @locate="locate" @sync="refreshOverview({sync:true,latest:true})" @review="showLatestOverview" />
      <FlatZodiacCollection v-if="view === 'flatZodiac'" :results="results" :latest="overviewLatest" :busy="overviewBusy" :draw-error="overviewError" @locate="locate" @sync="refreshOverview({sync:true,latest:true})" @review="showLatestOverview" />
      <RebateSettings ref="rebateView" v-if="rebateOpened" v-show="view==='rebates'" :documents="results" :active="view==='rebates'" @saved="rebatesSaved" />
      <WechatInbox ref="inboxView" v-show="view === 'inbox'" />
      <ReferencePages v-if="['odds', 'zodiac'].includes(view)" :view="view" />
      <SettlementPage :parsed-documents="results" :active="view==='settlement'" ref="settlementView" v-if="settlementOpened" v-show="view === 'settlement'" :documents="documents" :active-id="activeId" :initial-date="active.businessDate" @updated="winningsContext=null;refreshOverview()" @rebates="showRebates" :prepare="() => saveDraft(true)" />
    </main>
    <input ref="inputFile" type="file" accept=".og,.txt,.json" multiple hidden @change="browserFiles" />
    <Transition name="toast"><div v-if="notice" class="toast-message" role="status">{{ notice }}</div></Transition>
  </div>
</template>
