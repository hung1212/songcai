import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import install,{decodeReceiptPng} from '../electron/receipt-image.cjs';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=';
const image={getSize:()=>({width:1,height:1}),isEmpty:()=>false};
const nativeImage={createFromBuffer:()=>image};
test('导出只接受受限PNG，拒绝脚本、损坏图像、尺寸炸弹与未知窗口',async()=>{
  assert.equal(decodeReceiptPng(png,nativeImage).width,1);
  for(const data of ['data:image/svg+xml,<svg/>','data:image/png;base64,AAA=',null])assert.throws(()=>decodeReceiptPng(data,nativeImage));
  const large=Buffer.from(png.split(',')[1],'base64');large.writeUInt32BE(100000,20);assert.throws(()=>decodeReceiptPng('data:image/png;base64,'+large.toString('base64'),nativeImage),/尺寸/);
  assert.throws(()=>decodeReceiptPng(png,{createFromBuffer:()=>({...image,isEmpty:()=>true})}),/解码/);
  let handle;install({electron:{ipcMain:{handle:(_n,fn)=>handle=fn},nativeImage},window:()=>({webContents:'known'})});
  await assert.rejects(handle({sender:'other'},{action:'copy',dataUrl:png}),/未知窗口/);
});
test('截图复制写入图片，保存通过原生路径选择，取消不落盘；启动测试不覆盖剪贴板',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'receipt-test-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let handle,copied=0,canceled=false,options;
  const electron={app:{getPath:()=>directory},nativeImage,clipboard:{writeImage:value=>{assert.equal(value,image);copied++;}},ipcMain:{handle:(_n,fn)=>handle=fn},dialog:{showSaveDialog:async(_win,value)=>{options=value;return {canceled,filePath:path.join(directory,'saved.png')};}}};
  install({electron,window:()=>({webContents:'known'})});
  assert.equal((await handle({sender:'known'},{action:'copy',dataUrl:png})).copied,true);assert.equal(copied,1);
  await handle({sender:'known'},{action:'save',name:'../../负责人.png',dataUrl:png});assert(fs.existsSync(path.join(directory,'saved.png')));assert.equal(path.dirname(options.defaultPath),directory);
  canceled=true;assert.equal((await handle({sender:'known'},{action:'save',dataUrl:png})).saved,false);
  install({electron,window:()=>({webContents:'known'}),startupCheck:true});await handle({sender:'known'},{action:'copy',dataUrl:png});assert.equal(copied,1);assert(fs.existsSync(path.join(directory,'receipt-startup.png')));
});
