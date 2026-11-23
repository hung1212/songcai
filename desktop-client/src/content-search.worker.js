import {searchLedgerText} from './core/content-search.js';
self.onmessage=({data})=>{
 try{self.postMessage({id:data.id,result:searchLedgerText(data.documents,data.query,data.options)});}
 catch(error){self.postMessage({id:data.id,error:error.message});}
};
