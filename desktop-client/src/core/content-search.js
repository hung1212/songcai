// Search original text without parsing or normalizing it. Offsets must remain
// exact for the editor, including CRLF, emoji and repeated matches on a line.
export function searchLedgerText(documents,query,{caseSensitive=false,limit=10000}={}){
 const result={total:0,documentCount:0,matches:[],truncated:false};
 if(!query)return result;
 const escaped=String(query).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const pattern=new RegExp(escaped,caseSensitive?'gu':'giu');
 for(const doc of documents){
  const text=String(doc.text||''),starts=[0];let local=0;
  for(const m of text.matchAll(/\r\n|\r|\n/g))starts.push(m.index+m[0].length);
  const lineAt=offset=>{let low=0,high=starts.length;while(low+1<high){const mid=(low+high)>>1;if(starts[mid]<=offset)low=mid;else high=mid;}return low;};
  for(const m of text.matchAll(pattern)){
   result.total++;local++;
   if(result.matches.length>=limit)continue;
   const start=m.index,end=start+m[0].length,line=lineAt(start),endLine=lineAt(end-1);
   const from=Math.max(starts[line],start-45),lineEnd=(starts[endLine+1]??text.length),to=Math.min(lineEnd,end+70);
   result.matches.push({fileId:doc.id,name:doc.name||'未命名账目',index:result.total,documentIndex:local,start,end,line:line+1,endLine:endLine+1,column:start-starts[line]+1,quote:m[0],before:text.slice(from,start),after:text.slice(end,to).replace(/[\r\n]+$/,''),leading:from>starts[line],trailing:to<lineEnd});
  }
  if(local)result.documentCount++;
 }
 result.truncated=result.total>result.matches.length;return result;
}
