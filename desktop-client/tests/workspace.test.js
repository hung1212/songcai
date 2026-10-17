import test from 'node:test';
import assert from 'node:assert/strict';
import { workspacePreferences, sortLedgers, highlightRows, editorPosition } from '../src/core/workspace.js';
import {parseDocument} from '../src/core/parser.js';
import {ledgerOverview} from '../src/core/ledger-overview.js';
import {defaultOdds} from '../src/core/settlement.js';

test('损坏或越界的界面偏好不会挤掉编辑区', () => {
  assert.deepEqual(workspacePreferences(null), { sidebarWidth:260, fontSize:15, wrap:true, focused:true, ledgerSort:'stake-desc' });
  assert.deepEqual(workspacePreferences({sidebarWidth:9999,fontSize:0,wrap:false,focused:false,ledgerSort:'stake-desc'}), {sidebarWidth:360,fontSize:14,wrap:false,focused:false,ledgerSort:'stake-desc'});
  assert.equal(workspacePreferences({sidebarWidth:'bad',fontSize:NaN}).fontSize,15);
});
test('跨行高亮拆分保持空行、尾部空行和原始文字', () => {
  const tokens=[{text:'新\n\n',kind:'market'},{text:'特肖',kind:'play'},{text:'牛\n',kind:'selection'}];
  const rows=highlightRows(tokens);
  assert.equal(rows.length,4);
  assert.deepEqual(rows[1],[]);
  assert.equal(rows.map(row=>row.map(token=>token.text).join('')).join('\n'),tokens.map(t=>t.text).join(''));
  assert.equal(rows[2][0].kind,'play');
});
test('切单恢复选区；清空或外部修改原文后不会恢复旧滚动位置', () => {
  const position={text:'12345',start:1,end:4,direction:'backward',top:500,left:20};
  assert.deepEqual(editorPosition(position,'12345'),{start:1,end:4,direction:'backward',top:500,left:20});
  assert.deepEqual(editorPosition(position,''),{start:0,end:0,direction:'none',top:0,left:0});
  assert.equal(editorPosition({...position,end:999},'12345').end,5);
});


test('默认金额降序、同额同字数保留手动顺序，无法计算的排最后，不修改原数组',()=>{
  const docs=['empty','small','big','same','broken'].map(id=>({id}));
  const amounts={empty:0,small:500,big:10000,same:500,broken:null};
  assert.deepEqual(sortLedgers(docs,amounts).map(d=>d.id),['big','small','same','empty','broken']);
  assert.deepEqual(docs.map(d=>d.id),['empty','small','big','same','broken']);
  assert.equal(sortLedgers(docs,amounts,'manual'),docs);
  assert.equal(workspacePreferences({ledgerSort:'manual'}).ledgerSort,'manual');
  assert.equal(workspacePreferences({ledgerSort:'unknown'}).ledgerSort,'stake-desc');
  amounts.small=20000;
  assert.equal(sortLedgers(docs,amounts)[0].id,'small');
});

test('同额标题长的排前面，按显示标题和可见字符计数，手动顺序不改',()=>{
 const docs=[{id:'a',name:'小明'},{id:'b',name:'玩家，不惧前行，不忘沧桑。'},{id:'c',name:'送菜，李军，黑'},{id:'d',name:'李金普'},{id:'e',name:'😀明'},{id:'f',name:'',autoTitle:true,text:'负责人小王：01各10'}];
 const amounts={a:100,b:100,c:100,d:100,e:100,f:100};
 assert.deepEqual(sortLedgers(docs,amounts).map(d=>d.id),['b','c','f','d','a','e']);
 amounts.a=101;assert.equal(sortLedgers(docs,amounts)[0].id,'a');assert.equal(sortLedgers(docs,amounts,'manual'),docs);
});

test('盈利按玩家净额降序，负数保持顺序，未结算和空账目在后，同额按标题长度',()=>{
  const docs=['pending','empty','loss','equal','more','win','longtitle'].map(id=>({id,name:id}));
  const balances={pending:{netCents:null,status:'pending'},empty:{netCents:0,status:'empty'},loss:{netCents:-10000},equal:{netCents:0},more:{netCents:-10},win:{netCents:1000},longtitle:{netCents:1000}};
  const original=docs.map(d=>d.id);
  assert.deepEqual(sortLedgers(docs,{},'profit-desc',balances).map(d=>d.id),['longtitle','win','equal','more','loss','pending','empty']);
  assert.deepEqual(docs.map(d=>d.id),original);
  assert.equal(sortLedgers(docs,{},'manual',balances),docs);
  assert.equal(workspacePreferences({ledgerSort:'profit-desc'}).ledgerSort,'profit-desc');
});

test('盈利排序随开奖和原文重算，以赔付减投注排序而非赔付，未知赔付不能当零',()=>{
  const date='2026-10-10',odds=defaultOdds();odds.confirmed=true;
  const documents=[{id:'large',text:'01各100\n02各4000'},{id:'small',text:'01各20'},{id:'pending',text:'香港01各100'},{id:'loser',text:'03各10'}];
  const draw={market:'新',date,issue:'2026283',numbers:[10,11,12,13,14,15,1]};
  const calculate=()=>ledgerOverview(documents.map(d=>parseDocument(d.text,{...d,businessDate:date})),{新:draw},{odds:{新:odds}},{新:{confirmed:true}}).byId;
  let balances=calculate();
  assert.equal(balances.large.netCents,60000);assert.equal(balances.small.netCents,92000);
  assert.deepEqual(sortLedgers(documents,{},'profit-desc',balances).map(d=>d.id),['small','large','loser','pending']);
  draw.numbers[6]=2;balances=calculate();
  assert.deepEqual(sortLedgers(documents,{},'profit-desc',balances).map(d=>d.id),['large','loser','small','pending']);
  documents[1].text='02各10000';balances=calculate();
  assert.equal(sortLedgers(documents,{},'profit-desc',balances)[0].id,'small');
});
