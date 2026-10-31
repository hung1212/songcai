import {spaceKey} from './space-context.js';
import {validateTransferRecord} from './core/transfer-journal.js';
export function browserTransfers(spaceId) {
  const key=spaceKey('songcai.transfer.preview.v1',spaceId);
  const read=()=>JSON.parse(localStorage.getItem(key)||'[]');
  return {
    transferList:async({date,market})=>read().filter(r=>r.date===date&&r.market===market),
    transferAdd:async input=>{const record=validateTransferRecord(input),rows=read(),old=rows.find(r=>r.id===record.id);if(old){if(JSON.stringify(validateTransferRecord(old))!==JSON.stringify(record))throw new Error('批次编号已存在');return old;}const saved={...record,createdAt:new Date().toISOString()};rows.unshift(saved);localStorage.setItem(key,JSON.stringify(rows));return saved;},
    transferVoid:async({id,reason})=>{if(!reason?.trim())throw new Error('请填写作废原因');const rows=read(),r=rows.find(r=>r.id===id);if(!r)throw new Error('记录不存在');if(!r.voidedAt){r.voidedAt=new Date().toISOString();r.voidReason=reason.trim();localStorage.setItem(key,JSON.stringify(rows));}return r;},
    transferDelete:async({id,date,market})=>{
      if(typeof id!=='string'||!id||typeof date!=='string'||!['新','旧','港'].includes(market))throw new Error('请选择要删除的转出记录');
      const rows=read(),r=rows.find(r=>r.id===id);
      if(r&&(r.date!==date||r.market!==market))throw new Error('记录日期或市场不匹配，请重新加载');
      localStorage.setItem(key,JSON.stringify(rows.filter(r=>r.id!==id)));return {deleted:!!r};
    },
  };
}
