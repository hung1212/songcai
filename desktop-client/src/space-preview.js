import {spaceKey} from './space-context.js';
import {STORAGE_KEY} from './project.js';
import {validateProject,ledgerTitle} from './core/ledger.js';
import {PARSER_VERSION} from './core/business-syntax.js';
const KEY='songcai.spaces.v1';
export const emptySpaceProject=()=>({schemaVersion:1,activeId:'',documents:[]});
export function browserSpaces(){
  const read=()=>JSON.parse(localStorage.getItem(KEY)||'null')||{activeId:'default',spaces:[{id:'default',name:'默认空间',archived:false,createdAt:new Date().toISOString()}]};
  const save=s=>localStorage.setItem(KEY,JSON.stringify(s));
  const get=(s,id)=>{const space=s.spaces.find(p=>p.id===id);if(!space)throw new Error('空间不存在');return space;};
  const project=id=>validateProject(JSON.parse(localStorage.getItem(spaceKey(STORAGE_KEY,id))||'null')||emptySpaceProject());
  const name=(s,value,id)=>{value=String(value||'').trim();if(!value||value.length>60)throw new Error('空间名称请输入1至60个字');if(s.spaces.some(p=>p.id!==id&&p.name===value))throw new Error('空间名称已存在');return value;};
  const list=async()=>{const s=read();return {...s,spaces:s.spaces.map(p=>({...p,count:project(p.id).documents.length}))};};
  return {list,
    async activate({id}){const s=read();if(get(s,id).archived)throw new Error('请先恢复空间');s.activeId=id;save(s);return list();},
    async create(input){const s=read();if(s.spaces.length>=100)throw new Error('最多创建100个空间');const title=name(s,input.name),id=crypto.randomUUID();get(s,input.copyFrom);
      const docs=input.copyNames?project(input.copyFrom).documents.map(d=>({id:crypto.randomUUID(),name:ledgerTitle(d),text:'',businessDate:input.businessDate,defaultPlayer:d.defaultPlayer,autoTitle:false,parserVersion:PARSER_VERSION})):[];
      const p=validateProject({...emptySpaceProject(),documents:docs,activeId:docs[0]?.id||''});
      localStorage.setItem(spaceKey(STORAGE_KEY,id),JSON.stringify(p));
      const settings=JSON.parse(localStorage.getItem(spaceKey('songcai.settlement.preview.v1',input.copyFrom))||'null')?.settings;
      if(settings)localStorage.setItem(spaceKey('songcai.settlement.preview.v1',id),JSON.stringify({settings:{...settings,revision:0},draws:[],history:[]}));
      s.spaces.push({id,name:title,archived:false,createdAt:new Date().toISOString()});s.activeId=id;save(s);return list();
    },
    async rename({id,name:value}){const s=read();get(s,id).name=name(s,value,id);save(s);return list();},
    async archive({id,archived}){const s=read(),space=get(s,id);if(archived&&!s.spaces.some(p=>p.id!==id&&!p.archived))throw new Error('至少保留一个使用中的空间');space.archived=archived;if(archived&&s.activeId===id)s.activeId=s.spaces.find(p=>!p.archived).id;save(s);return list();},
  };
}
