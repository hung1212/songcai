export async function receiptPng(rendered) {
  await document.fonts.ready;
  const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(rendered.svg);await image.decode();
  const canvas=document.createElement('canvas');canvas.width=rendered.width*2;canvas.height=rendered.height*2;
  const context=canvas.getContext('2d');if(!context)throw new Error('无法生成结算图片');
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/png');
}
export async function exportReceiptImage({dataUrl,name,action}) {
  if(window.songcai?.receiptImage)return window.songcai.receiptImage({dataUrl,name,action});
  if(action==='copy'&&navigator.clipboard?.write&&window.ClipboardItem){
    const bytes=Uint8Array.from(atob(dataUrl.split(',')[1]),c=>c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([bytes],{type:'image/png'})})]);return {copied:true};
  }
  const link=document.createElement('a');link.href=dataUrl;link.download=name;link.click();return {saved:true};
}
