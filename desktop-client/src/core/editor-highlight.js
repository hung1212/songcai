import {highlightText} from './highlight.js';
import {highlightRows} from './workspace.js';

// Reuse token arrays as well as tokens so Vue can skip unchanged source rows.
// Only retain the current text's vocabulary; deleted content is not accumulated.
export function createEditorHighlighter(tokenize=highlightText) {
  let cache=new Map(),player;
  return (text,defaultPlayer='',selectionLines=[])=>{
    if(player!==defaultPlayer){cache.clear();player=defaultPlayer;}
    const numbers=new Set(selectionLines),next=new Map();
    const rows=text.split('\n').map((line,i)=>{
      const selection=numbers.has(i+1),key=JSON.stringify([line,selection]);
      const row=next.get(key)||cache.get(key)||highlightRows(tokenize(line,defaultPlayer,selection?[1]:[]))[0];
      next.set(key,row);return row;
    });
    cache=next;return rows;
  };
}
