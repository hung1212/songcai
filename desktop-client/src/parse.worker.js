import {parseLedger} from './core/parse-cache.js';
import {reviewInput} from './core/ai-review.js';

self.onmessage=({data})=>{
  try { self.postMessage({id:data.id,results:data.operation==='review'?reviewInput(data.document,data.mode):data.documents.map(parseLedger)}); }
  catch(error) { self.postMessage({id:data.id,error:error.message}); }
};
