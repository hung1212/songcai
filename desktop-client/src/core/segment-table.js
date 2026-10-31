import {segmentCopyText} from './ledger-segments.js';

// receiptPng renders at 2×. Keep even the longest sheet inside the native
// clipboard's 2560×16000 / 24-million-pixel limit; never silently drop rows.
export function segmentTableSvg(rows) {
 if(!rows?.length)throw new Error('当前账目没有可复制的段落');
 if(rows.length>480)throw new Error('段落超过480段，单张图片放不下，请使用“复制金额文字”复制全部金额');
 const values=rows.map(row=>segmentCopyText(row).split(':'));
 const columns=Math.ceil(rows.length/120),perColumn=Math.ceil(rows.length/columns);
 const pad=16,columnWidth=300,gap=12,header=38,rowHeight=30;
 const width=pad*2+columns*columnWidth+(columns-1)*gap,height=pad*2+header+perColumn*rowHeight;
 const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" fill="#273d32">`];
 for(let col=0;col<columns;col++){
  const x=pad+col*(columnWidth+gap),items=values.slice(col*perColumn,(col+1)*perColumn);
  parts.push(`<rect x="${x}" y="${pad}" width="${columnWidth}" height="${header}" rx="5" fill="#eaf1ec"/><text x="${x+36}" y="${pad+25}" text-anchor="middle" font-size="16">段号</text><text x="${x+columnWidth-16}" y="${pad+25}" text-anchor="end" font-size="16">投注金额</text>`);
  items.forEach(([index,amount],i)=>{
   const y=pad+header+i*rowHeight,fontSize=Math.min(21,Math.floor(198/(amount.length*0.65)));
   parts.push(`<rect x="${x}" y="${y}" width="${columnWidth}" height="${rowHeight}" fill="${i%2?'#f5f8f6':'#ffffff'}"/><text x="${x+36}" y="${y+21}" text-anchor="middle" font-size="17">${index}</text><text x="${x+columnWidth-16}" y="${y+22}" text-anchor="end" font-size="${fontSize}" font-weight="600">${amount}</text>`);
  });
 }
 parts.push('</g></svg>');return {svg:parts.join(''),width,height};
}
