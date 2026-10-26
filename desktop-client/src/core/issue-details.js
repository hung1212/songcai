const guidance = [
  [/HEAD_PARITY_CONFLICT/, '头数单双条件冲突', '把同一头数的单数、双数分成两笔，并分别填写每号金额。'],
  [/INVALID_HEAD/, '头数超出范围', '号码只有01至49，头数应为0、1、2、3、4；0头不包含00。'],
  [/DAN_TUO/, '拖号分组需要明确', '支持“二中二30拖鼠各10”“特串45拖鸡各10”和“二连肖马拖（兔羊猪虎鸡）各20”；其他拖法或重复生肖请明确列出每组。'],
  [/PLAY_CONFLICT|BASIS_CONFLICT|EXPLICIT_PLAY_LOST|PLAY_AMBIGUOUS/, '玩法或计费冲突', '明确是特码、特肖还是组合玩法，以及每号、每肖或每组的金额；不同投注请拆开填写。'],
  [/MISSING_AMOUNT/, '缺少明确金额', '补写“各10元”等金额；不要把选号中的数字当作单价。'],
  [/MISSING_SELECTION|INSUFFICIENT_SELECTION|ZODIAC_COUNT|GROUP_SIZE/, '选号不完整', '按声明的玩法补齐号码或生肖，组合投注也可用括号明确分组。'],
  [/NUMBER_RANGE/, '号码超出范围', '普通球号应在01至49之间，请核对是否漏了分隔符或多写数字。'],
  [/INVALID_AMOUNT|DECIMAL_AMBIGUOUS/, '金额格式不明确', '请写非负金额，小数最多两位；例如“各5”或“各0.5”，不要只写“各.5”。'],
  [/TOTAL_MISMATCH|TOTAL_SCOPE|TOTAL_INVALID|COUNT_MISMATCH/, '合计或组数需要核对', '核对声明金额、组数与对应投注范围；声明本身不新增投注，不为凑合计自动改价或改组。'],
  [/TRAILING_MARKET|EXPLICIT_MARKET_LOST/, '市场归属需要明确', '把确定的新澳、旧澳或香港写在这笔投注前。市场标题只影响后续投注；已明确的其他投注正常计账。'],
  [/PACKAGE_/, '包号计费需要明确', '明确写出包号总额，或“每号金额”；不能平均到分的总额需要调整。'],
  [/BET_INSTRUCTION/, '含撤销或修改指令', '请保留最终应计入的投注和金额，再重新解析。'],
];

export function issueDetails(issue) {
  if(issue.members?.length>1){
    const details=issue.members.map(issueDetails),local=issue.members.findIndex(i=>i.code!=='AI_REVIEW'),primary=details[local<0?0:local];
    const ai=issue.members.find(i=>i.code==='AI_REVIEW');
    return {...primary,reason:[...new Set(details.map(d=>d.reason))].join('；'),
      suggestion:[...new Set(details.map(d=>d.suggestion))].join(' '),
      ...(ai?{aiStatus:ai.aiStatus==='pending'?'正在核验':ai.aiStatus==='failed'?'核验失败，可重试':'已有候选解释，待核对',localExplanation:ai.localExplanation||''}:{})};
  }
  const match=guidance.find(([code])=>code.test(issue.code||''));
  if(issue.code==='AI_REVIEW') {
    const failed=issue.aiStatus==='failed',pending=issue.aiStatus==='pending';
    return {
      title:failed?'AI核验未完成':pending?'正在核验投注含义':'AI解释需要核对',
      reason:issue.reviewReasons?.length?issue.reviewReasons.join('；'):issue.aiReason||'AI没有给出可直接采用的完整解释，请查看核验详情。',
      aiStatus:failed?(issue.aiReason||'未记录具体失败原因'):pending?(issue.aiReason||'等待AI返回'):null,
      suggestion:failed?'先按待处理原因核对原文；需要AI协助时，可到“AI核验”查看失败原因并重试。':pending?'可先按上面的原因核对原文，或等待核验结果。':'到“AI核验”查看原文依据和候选解释，再确定最终玩法与金额。',
      localExplanation:issue.localExplanation||'',
    };
  }
  return {title:match?.[1]||(issue.severity==='warning'?'金额核对提醒':'原文需要核对'),reason:issue.message,suggestion:match?.[2]||'按上面的原因核对这一行，修改原文后会自动重新解析。'};
}

// Presentation only: retain every underlying issue and affected bet. Never
// collapse equal text from different documents, players or source positions.
export function groupIssues(issues=[]) {
  const groups=new Map(),spans=new Map();
  const keyFor=(issue,line=issue.line)=>JSON.stringify([issue.fileId,line,issue.playerId||issue.player]);
  const local=issues.filter(i=>i.code!=='AI_REVIEW'),ai=issues.filter(i=>i.code==='AI_REVIEW');
  for(const issue of local){
    const key=keyFor(issue);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(issue);
  }
  for(const [key,members] of groups)for(const issue of members){
    for(let line=issue.line;line<=(issue.endLine||issue.line);line++){
      const span=keyFor(issue,line);
      // Only merge a continuation's AI note when its local entry is unique.
      spans.set(span,!spans.has(span)||spans.get(span)===key?key:null);
    }
  }
  for(const issue of ai){
    const exact=keyFor(issue),key=groups.has(exact)?exact:spans.get(exact)||exact;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(issue);
  }
  const order=new Map(issues.map((i,index)=>[i.id,index]));
  return [...groups.values()].sort((a,b)=>Math.min(...a.map(i=>order.get(i.id)))-Math.min(...b.map(i=>order.get(i.id)))).map(members=>{
    members.sort((a,b)=>order.get(a.id)-order.get(b.id));
    const primary=members.find(i=>i.severity!=='warning'&&i.code!=='AI_REVIEW')||members.find(i=>i.severity!=='warning')||members[0];
    return {...primary,endLine:Math.max(...members.map(i=>i.endLine||i.line)),
      raw:members.reduce((longest,i)=>(i.raw||'').length>longest.length?i.raw:longest,''),
      members,memberIds:members.map(i=>i.id),hasAIReview:members.some(i=>i.code==='AI_REVIEW')};
  });
}
