import {inject} from 'vue';
export const SPACE_CONTEXT='songcai-space';
export const spaceKey=(key,id='default')=>id==='default'?key:`${key}:space:${id}`;
export function useSpace(){return inject(SPACE_CONTEXT,{id:'default',name:'默认空间',api:window.songcai});}
export function useSongcai(){return useSpace().api;}
const sessions=new Map();
export function spaceSession(id){if(!sessions.has(id))sessions.set(id,{editors:new Map()});return sessions.get(id);}
// Save local UI choices under the owning space; stale requests cannot rename the key.
export function readSpaceChoice(key,id='default'){
  try{return JSON.parse(localStorage.getItem(spaceKey(key,id))||'null')||{};}catch{return {};}
}
export function writeSpaceChoice(key,id,value){
  try{localStorage.setItem(spaceKey(key,id),JSON.stringify(value));}catch{/* UI preferences must not prevent saving original bets. */}
}
