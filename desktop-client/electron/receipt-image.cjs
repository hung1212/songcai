const fs=require('node:fs/promises');
const path=require('node:path');
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
function decodeReceiptPng(dataUrl,nativeImage){
  if(typeof dataUrl!=='string'||dataUrl.length>20_000_000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl))throw new Error('结算图片格式无效或过大');
  const buffer=Buffer.from(dataUrl.slice(22),'base64');
  if(buffer.length<33||!buffer.subarray(0,8).equals(SIGNATURE)||buffer.toString('ascii',12,16)!=='IHDR')throw new Error('结算图片不是有效PNG');
  const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20);
  if(width<1||width>2560||height<1||height>16000||width*height>24_000_000)throw new Error('结算图片尺寸超出限制');
  const image=nativeImage.createFromBuffer(buffer),size=image.getSize();
  if(image.isEmpty()||size.width!==width||size.height!==height)throw new Error('结算图片解码失败');
  return {buffer,image,width,height};
}
module.exports=function install({electron,window,startupCheck=false}){
  const {ipcMain,nativeImage,clipboard,dialog,app}=electron;
  ipcMain.handle('receipt:image',async(event,input)=>{
    if(event.sender!==window()?.webContents)throw new Error('未知窗口');
    if(!input||!['copy','save'].includes(input.action))throw new Error('图片操作无效');
    const {buffer,image,width,height}=decodeReceiptPng(input.dataUrl,nativeImage);
    // Native smoke checks export to their isolated profile, never overwrite the
    // user's clipboard or open a save dialog.
    if(startupCheck){await fs.writeFile(path.join(app.getPath('userData'),'receipt-startup.png'),buffer);return {copied:input.action==='copy',saved:input.action==='save',width,height};}
    if(input.action==='copy'){clipboard.writeImage(image);return {copied:true,width,height};}
    const name=String(input.name||'账目结算单.png').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,160).replace(/(?:\.png)?$/i,'.png');
    const result=await dialog.showSaveDialog(window(),{title:'保存账目结算单',defaultPath:path.join(app.getPath('downloads'),name),filters:[{name:'PNG 图片',extensions:['png']}]});
    if(result.canceled)return {saved:false};
    await fs.writeFile(result.filePath,buffer);return {saved:true,width,height};
  });
};
module.exports.decodeReceiptPng=decodeReceiptPng;
