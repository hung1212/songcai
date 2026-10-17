// Run these synchronously after obtaining the space's AI service. Deleting or
// clearing a ledger also invalidates in-flight results before returning to UI.
function writeLedger(store,ai,input){
  const ids=store.db.prepare('SELECT id FROM ledger_documents').all().map(r=>r.id);
  const saved=store.write(input),remaining=new Set(saved.documents.map(d=>d.id));
  const removed=ids.filter(id=>!remaining.has(id));
  if(removed.length)ai.clearDocuments(removed);
  return saved;
}
function clearLedger(store,ai,input){
  const result=store.clearContents(input);
  ai.clearDocuments(result.project.documents.map(d=>d.id));
  return result;
}
module.exports={writeLedger,clearLedger};
