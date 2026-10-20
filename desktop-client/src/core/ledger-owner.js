// Financial identity comes only from the ledger title. Sender markers remain
// available for parsing scopes and source tracing, but never select rates.
export function ledgerOwner(document) {
  const name=String(document.name||'').trim();
  return {id:name||`document:${document.id}:player`,name:name||'未命名账目'};
}

export function ledgerOwnedDocument(document) {
  const owner=ledgerOwner(document);
  const assign=item=>({...item,sourcePlayer:item.sourcePlayer??item.player,
    sourcePlayerId:item.sourcePlayerId??item.playerId,player:owner.name,playerId:owner.id});
  return {...document,bets:(document.bets||[]).map(assign),issues:(document.issues||[]).map(assign)};
}

// Older unsigned ledgers used their document ID as the settings key. Only
// migrate that exact ledger's config; never borrow a sender's rates. An
// explicitly configured title takes precedence over its old document key.
export function ledgerOwnerRates(documents,rates={}) {
  const result={...rates};
  for(const doc of documents) {
    const {id,name}=ledgerOwner(doc),legacy=`document:${doc.id}:player`;
    if(id===legacy||!Object.hasOwn(result,legacy))continue;
    const config=result[legacy];
    if(config.name&&config.name!==name&&config.name!==`本单玩家（${name}）`)continue;
    if(!Object.hasOwn(result,id))Object.defineProperty(result,id,{value:{...config,name},enumerable:true,writable:true,configurable:true});
    delete result[legacy];
  }
  return result;
}

export function ledgerOwnerSettings(documents,settings) {
  return {...settings,rebates:ledgerOwnerRates(documents,settings.rebates),playerOdds:ledgerOwnerRates(documents,settings.playerOdds)};
}
