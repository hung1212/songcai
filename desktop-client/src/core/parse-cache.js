import {parseDocument} from './parser.js';
import {ledgerParseKey} from './ledger.js';

export function parseLedger(doc) {
  try { return parseDocument(doc.text, doc); }
  catch (error) { return {id:doc.id,name:doc.name,bets:[],metadata:[],coverage:[],issues:[{
    id:`${doc.id}:fatal`,fileId:doc.id,fileName:doc.name,line:1,endLine:1,raw:'',player:'',
    severity:'error',code:'DOCUMENT',message:error.message,
  }]}; }
}

// Cache complete documents: market/player/amount inheritance can cross lines.
// Never reuse a single line independently of its surrounding text.
export function createParseCache(parse = parseLedger) {
  let entries = new Map();
  return {
    missing(documents) { return documents.filter(doc=>entries.get(doc.id)?.key!==ledgerParseKey([doc])); },
    accept(documents, results) {
      documents.forEach((doc,i)=>entries.set(doc.id,{key:ledgerParseKey([doc]),result:results[i]}));
    },
    read(documents) {
      const next=new Map(),results=[];
      for(const doc of documents) {
        const key=ledgerParseKey([doc]),cached=entries.get(doc.id);
        const entry=cached?.key===key?cached:{key,result:parse(doc)};
        next.set(doc.id,entry);results.push(entry.result);
      }
      entries=next;
      return {results,keys:Object.fromEntries([...entries].map(([id,entry])=>[id,entry.key]))};
    },
  };
}
