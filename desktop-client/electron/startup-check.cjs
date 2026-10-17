// Invoked only with --startup-check. Exercises the packaged runtime and real IPC
// with isolated temporary data, without opening a visible window or user drafts.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

module.exports = function startupCheck({ app, ipcMain }) {
  const conflictCheck=process.argv.includes('--save-conflict-check');
  const {BrowserWindow,dialog}=require('electron');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'songcai-startup-'));
  app.setPath('userData', directory);
  app.setPath('sessionData', directory);
  const expected = { schemaVersion: 1, activeId: 'startup-check', documents: [{
    id: 'startup-check', name: '启动检查.og', defaultPlayer: '', businessDate: '2026-10-05',
    text: '小明：旧 1 2 3 各100元\n特肖虎100元\n张三：特肖虎100元',
  }] };
  const draftPath = path.join(directory, 'draft.json');
  // The legacy file is a migration fixture and must remain untouched.
  fs.writeFileSync(draftPath, JSON.stringify({ ...expected, mustDisappearOnSave: true }));
  const stages = { pageLoaded: false, rendererInitialized: false, firstPaint: false, interfaceVerified: false, settlementVerified: false, semanticAIVerified:false, latestDrawVerified:false, parserStructure:false,parserUpgrade:false,codexDefault:false,draftSavedOnQuit: false };
  if(conflictCheck)dialog.showMessageBox=async(_win,options)=>{
    assert(options.buttons.includes('保留原文副本并退出'),'关闭冲突时没有安全退出按钮');
    stages.conflictCloseDialog=true;return {response:1};
  };
  let quitting = false, finished = false;
  const fail = message => {
    if (finished) return;
    finished = true;
    console.error('SONGCAI_STARTUP_FAILED', message, JSON.stringify(stages));
    app.exit(1);
  };
  const timeout = setTimeout(() => fail('启动检查超时'), process.argv.includes('--draw-network-check') ? 65000 : 35000);
  const maybeQuit = () => {
    if (!quitting && stages.pageLoaded && stages.rendererInitialized && stages.firstPaint && stages.interfaceVerified) {
      quitting = true;
      // Let the normal IPC listener mark the window ready to flush before quit.
      setImmediate(async () => {
        try{
          if(conflictCheck){
            const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(path.join(directory,'ledger.sqlite'));
            db.prepare('UPDATE ledger_documents SET original_text=?').run(expected.documents[0].text+'\n07各20');
            db.exec("UPDATE ledger_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'");db.close();
            await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(`(()=>{const input=document.querySelector('[aria-label="投注原文"]');input.value+='\\n08各30';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
          }
          app.quit();
        }catch(error){fail(error.message);}
      });
    }
  };
  app.on('browser-window-created', (_event, window) => {
    window.once('ready-to-show', () => { stages.firstPaint = true; maybeQuit(); });
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.once('did-finish-load', () => { stages.pageLoaded = true; maybeQuit(); });
    contents.on('did-fail-load', (_event, code, description) => fail(`页面加载失败 ${code}: ${description}`));
    contents.on('preload-error', (_event, _path, error) => fail(`preload: ${error.message}`));
    contents.on('render-process-gone', (_event, details) => { if (!finished) fail(`renderer: ${details.reason}`); });
  });
  ipcMain.on('project:flush-ready', () => { stages.rendererInitialized = true; maybeQuit(); });
  ipcMain.on('startup:interface-ready', (_event, report) => {
    try {
      assert.equal(report.spacesUI,true,report.spacesError||'空间界面检查失败');stages.spacesUI=true;
      assert.equal(report.recoveryUI,true,'原文冲突恢复界面检查失败');stages.recoveryUI=true;
      assert.equal(report.heading, expected.documents[0].name, '界面标题未渲染');
      assert.equal(report.editor, expected.documents[0].text, '原文编辑器未恢复');
      assert.equal(report.total, '¥500.00', '实际显示的汇总金额不正确');
      assert.deepEqual(report.referenceMenus, ['玩法赔率', '生肖分类'], '规则菜单未渲染');
      assert.equal(report.styledLayout, true, '样式或页面布局未加载');
      assert.deepEqual(report.inbox, { menu: true, intake: true, previewCents: 40000, beforeCents: 0, afterCents: 40000, posted: 1, repeated: 1 }, '收件箱菜单／真实IPC／核对入账／防重检查失败');
      assert.deepEqual(report.ledger, { database: true, autoTitle: true, sameTitleReplaced: true, switchRestored: true }, '数据库保存／同名覆盖／账目切换检查失败');
      assert.equal(report.highlighted, true, '原文高亮未渲染');
      assert.equal(report.stableEditor, true, '空闲时不应反复保存或切换解析按钮');
      assert.equal(report.expandedEditor, true, '专注／结果切换应保留同一原文输入框和光标位置');
      assert.equal(report.numberDistribution, true, '49号码平均、超额、马年生肖和金额／生肖排序检查失败');
      assert.deepEqual(report.settlement, { menu: true, stakeCents: 50000, payoutCents: 234000, complete: true,
        restored: true, originalText: true, deduplicated: true, paid: false }, '赔付真实IPC／SQLite快照／分市场金额／防重检查失败');
      stages.settlementVerified = true;
      assert.equal(report.receiptExportUI,true,'结算单界面或PNG截图导出未通过');
      assert.equal(report.receiptExampleUI,true,'2000元结算单示例的赔付或盈亏未通过');stages.receiptExampleUI=true;
      assert.equal(report.receiptCompactUI,true,'截图精简内容或开奖区域置顶未通过');stages.receiptCompactUI=true;
      assert.equal(report.receiptDrawExportUI,true,'结算截图市场名称、对应开奖或香港单独导出未通过');stages.receiptDrawExportUI=true;
      const receiptPath=path.join(directory,'receipt-startup.png');
      const receiptPNG=fs.readFileSync(receiptPath);assert.equal(receiptPNG.readUInt32BE(16),1280);assert(receiptPNG.readUInt32BE(20)>1000);
      stages.receiptExportUI=true;console.log('SONGCAI_RECEIPT_IMAGE '+receiptPath);
      for(const key of ['rebateUI','issueTitleRebateUI','slashZodiacGroupsUI','flatAnySuffixUI','specialHighlightsUI','flatZodiacHighlightsUI','blankMarketResetUI','blankPlayResetUI','parserStructure','parserUpgrade','codexDefault','ledgerClear','ledgerOverview','pasteEditor','editorMemory','winningsUI','bidirectionalNavigation','navigationHistoryUI','headerStakeUI','multilineNumbersUI','separatePriceLinesUI','incrementalReviewUI','perZodiacPackageUI','compactPerZodiacPackageUI','flatOneZodiacUI','zodiacDragUI','zodiacDelimitedGroupsUI','linkedZodiacDragUI','tripleZodiacDragUI','specialPairDragUI','specialPairCrossUI','tailDragUI','numberCategoryPackageUI','headParityUI','issuePrefixUI','ledgerAmountSortUI','ledgerProfitSortUI','flatZodiacCollectionUI','paragraphMarketUI','playOverviewUI','compactTailGroupsUI','defaultStakeBasisUI','adjacentSubtotalUI','inlineMarketSectionUI','marketPrefixResetUI','hongKongHeadingUI','zodiacPackageUI','reversedZodiacPackageUI','bareMacauMarketUI','marketDirectionUI']){assert.equal(report[key],true,`${key}检查未通过${key==='pasteEditor'?JSON.stringify(report.pasteCheckDetail):''}`);stages[key]=true;}
      assert.equal(report.semanticAI,true,'标准语义／AI菜单／真实IPC未通过');stages.semanticAIVerified=true;
      assert.equal(report.latestDraw,true,'最近开奖赔付IPC未通过');stages.latestDrawVerified=true;
      if (process.argv.includes('--draw-network-check')) {
        console.log('SONGCAI_DRAW_NETWORK', JSON.stringify(report.networkReport));
        assert.equal(report.networkReport?.ok, true, '新市场实际网络读取失败');
        assert.equal(report.networkReport.latest.sourceId, 'macaujc-new');
        for (const market of ['新','旧','港']) {
          assert.equal(report.networkReport.comparisons[market]?.status, 'consistent', `${market}市场未通过真实多来源核对`);
          assert.equal(report.networkReport.comparisons[market].confirmed, true);
        }
      }
      stages.interfaceVerified = true;
      maybeQuit();
    } catch (error) { fail(error.message); }
  });
  ipcMain.on('project:flush-failed', () => fail('关闭时保存失败'));
  app.once('will-quit', () => {
    try {
      assert(stages.pageLoaded && stages.rendererInitialized && stages.firstPaint && stages.interfaceVerified);
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(path.join(directory, 'ledger.sqlite'), { readOnly: true });
      const rows = db.prepare('SELECT * FROM ledger_documents').all();
      assert.equal(rows.length, 1); assert.equal(rows[0].original_text, expected.documents[0].text+(conflictCheck?'\n07各20':''));
      if(conflictCheck){
        assert(stages.conflictCloseDialog);
        const backup=new DatabaseSync(path.join(directory,'draft-recovery.sqlite'),{readOnly:true});
        const drafts=backup.prepare('SELECT payload FROM drafts').all();assert.equal(drafts.length,1);
        assert.equal(JSON.parse(drafts[0].payload).documents[0].text,expected.documents[0].text+'\n08各30');backup.close();
        stages.conflictOriginalPreserved=true;stages.conflictBackupPreserved=true;
      }
      assert.equal(rows[0].title, expected.documents[0].name);
      assert.equal(Number(db.prepare("SELECT value FROM ledger_meta WHERE key = 'revision'").get().value) >= 5, true, '关闭时没有完成数据库保存');
      db.close();
      assert.equal(JSON.parse(fs.readFileSync(draftPath, 'utf8')).mustDisappearOnSave, true, '旧版原文件应保留');
      stages.draftSavedOnQuit = true;
      finished = true;
      clearTimeout(timeout);
      console.log('SONGCAI_STARTUP_OK', JSON.stringify(stages));
    } catch (error) { fail(error.message); }
  });
};
