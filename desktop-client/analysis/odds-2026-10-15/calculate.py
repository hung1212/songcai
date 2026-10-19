"""Exact expectation from the saved odds, using fair draws without replacement.
No changes to application settings or settlement data.
"""
from fractions import Fraction as F
from math import comb
from itertools import combinations
from pathlib import Path
import json

ROOT=Path(__file__).parent
settings_file=ROOT/'settings.json'
if not settings_file.exists(): settings_file=ROOT/'settings.example.json'
settings=json.loads(settings_file.read_text())
rules=json.loads((ROOT/'rules.json').read_text())
space=next(s for s in settings['spaces'] if s['id']==settings['activeSpaceId'])
odds=space['odds']['新']
assert odds==space['odds']['旧']==space['odds']['港']
assert odds['includePrincipal'] and rules['rule']['animal']=='马'
assert all(v=='seven' for k,v in odds['scopes'].items() if k!='flat-number')
assert odds['scopes']['flat-number']=='six'
assert len(space['rebateUniqueSettings'])==1
rebates=space['rebateUniqueSettings'][0]
rates=odds['rates']; rows=[]; seen=set()
def C(n,k):return comb(n,k) if n>=k>=0 else 0
def hit_any(n,k=7):return 1-F(C(49-n,k),C(49,k))
def all_categories(sizes,k=7):
    value=F(sum((-1)**len(s)*C(49-sum(s),k) for n in range(len(sizes)+1) for s in combinations(sizes,n)),C(49,k))
    # Independent polynomial occupancy calculation: pick >=1 from each category.
    dp=[1]+[0]*k
    for size in sizes:
        dp=[sum(dp[j-a]*C(size,a) for a in range(1,min(size,j)+1)) for j in range(k+1)]
    numerator=sum(dp[j]*C(49-sum(sizes),k-j) for j in range(k+1))
    assert value==F(numerator,C(49,k))
    return value
def add(group,label,key,p,rebate_key,special=False,refund=F(0),condition='已保存',notes='',rate=None):
    rate=rates[key]['specialRate' if special else 'rate'] if rate is None else str(rate)
    assert rate
    seen.add(key)
    rtp=p*F(rate)+refund
    rebate=F(rebates.get('playRates',{}).get(rebate_key,rebates['perTenThousandCents']),1_000_000)
    row={'group':group,'label':label,'rateKey':key,'rate':rate,'probability':p,'refundProbability':refund,
         'rtp':rtp,'lossRate':1-rtp,'rebateRate':rebate,'rebateEffectiveRate':rebate*(1-refund),
         'lossAfterRebate':1-rtp-rebate*(1-refund),'condition':condition,'notes':notes}
    rows.append(row);return row

add('特码','特码逐号','special-number',F(1,49),'special-number')
add('特肖 / 多肖中特','特肖：非马','special-zodiac',F(4,49),'special-zodiac')
add('特肖 / 多肖中特','特肖：马','special-zodiac',F(5,49),'special-zodiac',True)
for n in range(2,6):
    for horse in [False,True]:
        add('特肖 / 多肖中特',f'{n}肖中特：'+('含马' if horse else '不含马'),f'any-{n}',F(4*n+horse,49),f'special-zodiac-any-{n}',horse)
for wave,numbers in rules['waves'].items():
    add('波色',wave+'波','wave-'+wave+'波',F(len(numbers),49),'wave',notes=f'{len(numbers)}个号码')
def attribute(name,n):
    return {'大':n>=25,'小':n<25,'单':n%2==1,'双':n%2==0,'合单':(n//10+n%10)%2==1,'合双':(n//10+n%10)%2==0}[name]
for wave,numbers in rules['waves'].items():
    for name in ['单','双','大','小']:
        picked=[n for n in numbers if attribute(name,n)]
        add('半波',wave+name,'half-'+wave+name,F(len(picked),49),'half-wave',notes=f'{len(picked)}个号码；'+','.join(f'{n:02}' for n in picked))
for n,key in [(3,'linked-number-3-3'),(2,'linked-number-2-2')]:
    add('连码',{2:'二中二',3:'三中三'}[n],key,F(C(6,n),C(49,n)),key,notes='仅六个正码')
add('连码','特串','special-pair',F(6,C(49,2)),'special-pair',notes='一个正码＋一个特码，两个号码无顺序要求')
for n in range(2,6):
    for horse in [False,True]:
        add('连肖',f'{n}连肖：'+('含马' if horse else '不含马'),f'zodiac-{n}',all_categories([4]*n if not horse else [5]+[4]*(n-1)),f'linked-zodiac-{n}',horse,notes='七码中每个所选生肖至少出现一次')
for n in range(2,5):
    for zero in [False,True]:
        add('连尾',f'{n}连尾：'+('含0尾' if zero else '不含0尾'),f'tail-{n}',all_categories([5]*n if not zero else [4]+[5]*(n-1)),f'linked-tail-{n}',notes='七码中每个所选尾数至少出现一次')
add('平码 / 平特','平码（六个正码）','flat-number',F(6,49),'flat-number')
add('平码 / 平特','平特号码（正码＋特码）','flat-number',F(7,49),'flat-seven-number',notes='与平码共用7倍赔率，但判断范围不同')
for horse in [False,True]:
    add('平码 / 平特','平特肖：'+('马' if horse else '非马'),'flat-zodiac',hit_any(5 if horse else 4),'flat-zodiac',horse)
add('平码 / 平特','平特尾：非0尾','flat-tail',hit_any(5),'flat-tail')
add('平码 / 平特','平特尾：0尾','zero-tail',hit_any(4),'flat-tail')
for n in range(1,6):add('平特任中',f'{n}粒任中',f'flat-any-{n}',hit_any(n),f'flat-any-{n}',notes='一组中任意一个即中奖，多中也只赔一组')
for n in range(5,11):add('不中',f'{n}不中',f'not-hit-{n}',F(C(49-n,7),C(49,7)),f'not-hit-{n}')

# NULL means unresolved in the live app, not false. Show both cases explicitly.
assert odds['refund49']['attribute'] is None and odds['refund49']['sixZodiac'] is None
for refund in [True,False]:
    for name in ['大','小','单','双','合单','合双']:
        count=sum(attribute(name,n) for n in range(1,49 if refund else 50))
        add('49和局待确认',name+'：'+('49退本' if refund else '49正常判输赢'),'attribute',F(count,49),'attribute',refund=F(1,49) if refund else F(0),condition='条件测算：49和局未保存')
    for horse in [False,True]:
        add('49和局待确认','六肖中特：'+('含马' if horse else '不含马')+'，'+('49退本' if refund else '49正常判输赢'),'any-6',F(24 if refund else 24+horse,49),'special-zodiac-any-6',horse,refund=F(1,49) if refund else F(0),condition='条件测算：49和局未保存')

def tiers(label,parts,rebate_key,notes):
    for key,p,rate in parts:
        assert not rates[key]['rate'];seen.add(key)
    rtp=sum(p*F(rate) for _,p,rate in parts);rebate=F(rebates['playRates'][rebate_key],1_000_000)
    rows.append({'group':'分档赔率未配置','label':label,'rateKey':','.join(k for k,_,_ in parts),'rate':' / '.join(str(rate) for _,_,rate in parts),
                 'probability':sum(p for _,p,_ in parts),'refundProbability':F(0),'rtp':rtp,'lossRate':1-rtp,
                 'rebateRate':rebate,'rebateEffectiveRate':rebate,'lossAfterRebate':1-rtp-rebate,
                 'condition':'仅原图两档假设，非当前已配置赔率','notes':notes,
                 'tiers':[{'key':key,'probability':p,'rate':rate} for key,p,rate in parts]})
p2=F(C(6,2)*43,C(49,3));p3=F(C(6,3),C(49,3));pn=F(C(6,2),C(49,2));ps=F(6,C(49,2))
tiers('三中二：中2赔20，中3赔90',[('three-two',p2,20),('three-three',p3,90)],'linked-number-3-2','两档互斥；中三仅赔90，不另叠加中二')
tiers('三中二：中2赔90，中3赔20',[('three-two',p2,90),('three-three',p3,20)],'linked-number-3-2','反向分档用于说明歧义，不能当已确认规则')
tiers('二中特：双正码25，正特50',[('two-normal',pn,25),('two-special',ps,50)],'linked-number-2-special','两档互斥')
tiers('二中特：双正码50，正特25',[('two-normal',pn,50),('two-special',ps,25)],'linked-number-2-special','反向分档用于说明歧义，不能当已确认规则')
assert seen==set(rates),(set(rates)-seen)
assert rows[0]['lossRate']==F(2,49)
assert next(r for r in rows if r['label']=='平特号码（正码＋特码）')['rtp']==1

def convert(x):
    if isinstance(x,F):return {'fraction':str(x),'value':float(x)}
    raise TypeError(type(x))
(ROOT/'results.json').write_text(json.dumps({'date':settings['date'],'principal':1000000,'rows':rows},ensure_ascii=False,indent=2,default=convert))
def pct(x):return f'{float(x)*100:.4f}%'
def money(x):return f'{float(x):,.2f}'
def loss(x):return ('亏 ' if x>0 else '赢 ' if x<0 else '持平 ')+money(abs(x)*1000000)

header='''# 当前赔率的理论返奖率与盈亏（2026-10-15）

已读取本地“默认空间”实际保存的设置（revision 3）。新澳、旧澳、香港赔率与中奖范围相同，因此共用这份表。金额单位为元，每一行分别假设该玩法投注流水为 **1,000,000元**；不是每种玩法分摊同一笔100万元。

这里将“同等胜率”解释为公平开奖：49个号码等概率，7个开奖号码不重复，前6个为正码、第7个为特码；不把每种投注都当成50%中奖率。日期按2026马年，马有5个号码，其余生肖各4个号码。各行是长期理论平均，不保证单期结果；49个特码全部均额覆盖的例子在忽略分位舍入时每期结果相同。

当前赔率全部含本金：投注1元，中特码按47倍共返47元。**理论返奖率 = 各中奖档概率×对应含本赔率之和＋退本概率；玩家净亏损率 = 1－返奖率－有效退水率。** 对应庄家毛收益率是同一个亏损率，未减经营成本、上级结算或其他费用。

基础表先不计退水；退水后列仅适用于数据库里目前那一套已配置玩家方案，不能应用到所有玩家。不设置退水的玩家使用“不退水”列。该方案默认退3%，特码3%，连码10%，连肖/连尾/平类/任中/不中/大小单双1%；波色、半波、特肖、多肖中特未单独覆盖，继承默认3%。开49退本的订单不计有效退水流水，因此退水期望乘48/49。

设置中的“赔率已确认”目前为false，本报告读取数值进行数学测算，并不代表业务规则已确认。三中二、二中特四个赔率档为空；大小单双与六肖中特的49和局设置为null，另列表展示条件计算，不擅自补成最终赔率。

**特码例子：** 每号投注1,000,000÷49≈20,408.16元；中奖后共返1,000,000×47÷49≈959,183.67元；玩家亏40,816.33元，亏损率4.0816%。若该玩家特码退3%，再返30,000元，最终亏10,816.33元，亏损率1.0816%。100万元无法以分为单位在49号绝对均分，本报告忽略这种极小的分位差异。

下列“玩家亏/赢”均从玩家视角表示；玩家赢即庄家同额亏。
'''
parts=[header]
for group in dict.fromkeys(r['group'] for r in rows):
    parts+=['\n## '+group+'\n']
    if group=='49和局待确认':parts+=['当前尚未确定49和局规则，以下两种情形不能混合当作已配置结果。参考图注明“开49和”，如采用该规则，请看“49退本”行。\n']
    if group=='分档赔率未配置':parts+=['软件实际四个分档为空，下列仅根据参考图20/90、25/50进行假设。反向档位也列出，以免误认。\n']
    parts+=['|玩法|含本赔率|中奖概率|返奖率|不退水亏损率|100万元不退水结果|该方案退水率|退水后亏损率|100万元退水后结果|\n|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for r in rows:
        if r['group']!=group:continue
        parts+=[f"|{r['label']}|{r['rate']}|{pct(r['probability'])}|{pct(r['rtp'])}|{pct(r['lossRate'])}|{loss(r['lossRate'])}|{pct(r['rebateRate'])}|{pct(r['lossAfterRebate'])}|{loss(r['lossAfterRebate'])}|"]
    notes=[r['label']+'：'+r['notes'] for r in rows if r['group']==group and r['notes']]
    if notes:parts+=['\n'+ '\n'.join('- '+n for n in notes)]
parts+=['''
## 如何算整体流水

各玩法的总体亏损率不能直接平均，要按各玩法投注流水加权：

`总预期亏损 = Σ（该玩法流水 × 对应玩家的净亏损率）`。

同一玩法里的“含马/不含马”“含0尾/不含0尾”也要分开。未提供流水分布，不能推出100万元混合流水的唯一亏损金额。表中的每一行均为100万元全投该行玩法的独立情景。如果“100百万”指1亿元，则表中金额乘100，百分比不变。

负的亏损率表示玩家理论盈利。例如绿单、绿大均有9个号码，9/49×5.5=101.0204%，在当前不退49的半波规则下，未退水已对玩家有利；同一个号码同时符合绿单与绿大不代表同一注赔两次，这里为两种独立投注。现有默认3%退水会进一步提高这两项玩家的期望收益。

“平码”7倍只算6个正码；“平特号码”7倍算全部7个号码，两者公平概率不同。后者返奖率恰为100%，再退1%就会让玩家理论盈利1%。如果原本想让它与“一粒任中”相同，需要另行确认赔率，本次没有修改任何设置。

## 计算与核对方法

使用整数分数精确计算，只在展示阶段四舍五入。C(n,k)为组合数：

- 特码/波色/半波/特肖：覆盖m个号码，中奖概率m/49。
- 一组k粒任中：1－C(49－k,7)/C(49,7)。即使同组命中多个号码，也只赔一组。
- k不中：C(49－k,7)/C(49,7)。
- 二中二、三中三：分别C(6,2)/C(49,2)、C(6,3)/C(49,3)。
- 特串：6/C(49,2)=1/196。
- 三中二：恰中2正码概率C(6,2)×43/C(49,3)，中3正码概率C(6,3)/C(49,3)。
- 二中特：双正码概率C(6,2)/C(49,2)，一正一特概率6/C(49,2)。
- 平特肖/尾：所选分类有m个号码，概率1－C(49－m,7)/C(49,7)。同类出现多次仍只赔一次。
- 连肖/连尾：使用容斥原理计算所有所选类别均至少出现一次；另用独立的分类取号动态规划交叉核对。不能把每肖/尾中奖率直接相乘，因为开奖不放回。
- 所有52个赔率键均已覆盖，包括待配置档；号码、生肖与尾数中奖规则对照当前settleBet实现。

80种情景另外通过当前客户端真实赔付函数核对，以完整组合覆盖和按分类取号概率加权的方式计算；不是随机模拟。核对详情见同目录verification.json。

本报告仅分析已有赔率，没有修改客户端代码、任何空间账目、赔率、退水或开奖设置。
''']
(ROOT/'赔率盈亏分析.md').write_text('\n'.join(parts))
print(f'已覆盖{len(seen)}个赔率键，{len(rows)}个情景')
for r in rows:
    print(f"{r['label']:26} 赔率 {r['rate']:7} 中奖 {pct(r['probability']):10} 返奖 {pct(r['rtp']):10} 不退水 {loss(r['lossRate']):16} 退水后 {loss(r['lossAfterRebate'])}")
