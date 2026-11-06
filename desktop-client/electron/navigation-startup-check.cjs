const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
module.exports=async function checkNavigation(contents,{unlock=true,capture=false}={}){
  const {BrowserWindow,shell}=require('electron');
  const win=BrowserWindow.fromWebContents(contents);
  const evaluate=script=>contents.executeJavaScript(script);
  const landing=()=>evaluate(`!!document.querySelector('[data-navigation-home]') && !document.querySelector('.app-shell') && !document.querySelector('[aria-label="投注原文"]') && document.title==='上网导航'`);
  const key=async(key='o',extra={})=>evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,...${JSON.stringify(extra)}}))`);
  const press=async n=>{for(let i=0;i<n;i++)await key();};
  assert(await landing(),'启动应只显示导航页');
  assert(!win.canFlushDraft,'导航页不应加载账目保存流程');
  assert.equal(win.getTitle(),'上网导航');
  if(capture){
    for(const [width,height] of [[1480,960],[1060,700]]){
      win.setSize(width,height);await wait(150);
      const size=await evaluate(`({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight})`);
      fs.writeFileSync(path.resolve(`reports/navigation-${width}.png`),(await contents.capturePage()).toPNG());
      assert(size.scrollWidth<=size.width,'导航页不应有横向滚动条 '+JSON.stringify(size));
      assert(size.scrollHeight<=size.height,'导航页不应有多余纵向滚动条 '+JSON.stringify(size));
    }
    win.setSize(1480,960);
  }
  await press(4);assert(await landing(),'不足五次不应进入');
  await key('o',{repeat:true});assert(await landing(),'长按不应算作第五次');
  await key('x');await key();assert(await landing(),'其他按键应中断连续计数');
  await evaluate(`window.dispatchEvent(new Event('blur'))`);
  const opened=[],original=shell.openExternal;
  shell.openExternal=async url=>{opened.push(url);};
  try{
    await evaluate(`document.querySelector('.navigation-featured a').click()`);
    for(let i=0;i<50&&!opened.length;i++)await wait(20);
    assert.equal(opened[0],'https://www.baidu.com/');
    await evaluate(`(()=>{const input=document.querySelector('[aria-label="百度搜索内容"]');input.focus();input.value='天气 & 出行';input.dispatchEvent(new Event('input',{bubbles:true}));for(let i=0;i<5;i++)input.dispatchEvent(new KeyboardEvent('keydown',{key:'o',bubbles:true}));input.form.requestSubmit();})()`);
    for(let i=0;i<50&&opened.length<2;i++)await wait(20);
    assert.equal(opened[1],'https://www.baidu.com/s?wd='+encodeURIComponent('天气 & 出行'));
    assert(await landing(),'搜索输入不能触发入口');
    assert(await evaluate(`window.songcai.openNavigation({url:'file:///C:/Windows'}).then(()=>false,()=>true)`),'应拒绝任意外部地址');
  }finally{shell.openExternal=original;}
  await evaluate(`document.activeElement.blur()`);
  await press(4);
  // Model the main-process state left by a previously mounted workspace.
  win.canFlushDraft=true;
  const loaded=new Promise(resolve=>contents.once('did-finish-load',resolve));contents.reload();await loaded;
  assert(await landing(),'重新加载必须恢复导航页');
  assert(!win.canFlushDraft,'重新加载后导航页不应等待旧页面的保存回调');
  await key();assert(await landing(),'重新加载必须清除原有计数');
  await key('x');
  if(unlock){
    // Exercise actual Electron key events for the final entrance.
    for(let i=0;i<5;i++){contents.sendInputEvent({type:'keyDown',keyCode:'O'});contents.sendInputEvent({type:'keyUp',keyCode:'O'});}
    for(let i=0;i<150 && await landing();i++)await wait(20);
    assert.equal(await landing(),false,'五次 O 应进入工作界面');
    assert.equal(await evaluate('document.title'),'松财 · 玩家算账');
  }
  return true;
};
