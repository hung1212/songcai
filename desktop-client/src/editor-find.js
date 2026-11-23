// Measure the exact character range in the textarea's own font/wrap geometry.
// A visual wrap is not a source line, so lineNumber * lineHeight is insufficient.
export function revealEditorMatch(field,start,end){
 const style=getComputedStyle(field),mirror=document.createElement('div'),mark=document.createElement('span');
 for(const key of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','whiteSpace','overflowWrap','wordBreak'])mirror.style[key]=style[key];
 Object.assign(mirror.style,{position:'fixed',left:'-100000px',top:'0',width:field.clientWidth+'px',boxSizing:'border-box',border:'0',visibility:'hidden'});
 mirror.append(document.createTextNode(field.value.slice(0,start)));mark.textContent=field.value.slice(start,end)||'\u200b';mirror.append(mark,document.createTextNode(field.value.slice(end)));document.body.append(mirror);
 try{
  const rect=mark.getClientRects()[0]||mark.getBoundingClientRect(),base=mirror.getBoundingClientRect();
  field.focus({preventScroll:true});field.setSelectionRange(start,end);
  field.scrollTop=Math.max(0,rect.top-base.top-field.clientHeight/3);
  field.scrollLeft=Math.max(0,rect.left-base.left-field.clientWidth/3);
 }finally{mirror.remove();}
}
