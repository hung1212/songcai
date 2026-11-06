// Shared by the local navigation page and the main-process URL allowlist.
export const navigationGroups = [
  {name:'常用网站', sites:[['baidu','百度','https://www.baidu.com/'],['sina','新浪','https://www.sina.com.cn/'],['sohu','搜狐','https://www.sohu.com/'],['netease','网易','https://www.163.com/'],['qq','腾讯网','https://www.qq.com/'],['zhihu','知乎','https://www.zhihu.com/']]},
  {name:'视频娱乐', sites:[['bilibili','哔哩哔哩','https://www.bilibili.com/'],['iqiyi','爱奇艺','https://www.iqiyi.com/'],['youku','优酷','https://www.youku.com/'],['qqvideo','腾讯视频','https://v.qq.com/'],['mango','芒果TV','https://www.mgtv.com/'],['douban','豆瓣','https://www.douban.com/']]},
  {name:'购物生活', sites:[['taobao','淘宝','https://www.taobao.com/'],['jd','京东','https://www.jd.com/'],['tmall','天猫','https://www.tmall.com/'],['suning','苏宁易购','https://www.suning.com/'],['meituan','美团','https://www.meituan.com/'],['dianping','大众点评','https://www.dianping.com/']]},
  {name:'新闻资讯', sites:[['people','人民网','https://www.people.com.cn/'],['xinhuanet','新华网','https://www.xinhuanet.com/'],['cctv','央视网','https://www.cctv.com/'],['ifeng','凤凰网','https://www.ifeng.com/'],['thepaper','澎湃新闻','https://www.thepaper.cn/'],['chinanews','中国新闻网','https://www.chinanews.com.cn/']]},
  {name:'出行服务', sites:[['rail','铁路12306','https://www.12306.cn/'],['ctrip','携程旅行','https://www.ctrip.com/'],['qunar','去哪儿','https://www.qunar.com/'],['amap','高德地图','https://www.amap.com/'],['map','百度地图','https://map.baidu.com/'],['weather','中国天气网','https://www.weather.com.cn/']]},
  {name:'邮箱办公', sites:[['mail163','网易邮箱','https://mail.163.com/'],['mailqq','QQ邮箱','https://mail.qq.com/'],['outlook','Outlook','https://outlook.live.com/'],['wps','WPS','https://www.wps.cn/'],['docsqq','腾讯文档','https://docs.qq.com/'],['fanyi','百度翻译','https://fanyi.baidu.com/']]},
];
export const featuredSiteIds = ['baidu','sina','netease','qq','taobao','jd','bilibili','iqiyi','zhihu','rail','mail163','map'];
const sites = new Map(navigationGroups.flatMap(group=>group.sites.map(([id,name,url])=>[id,{id,name,url}])));
export const featuredSites = featuredSiteIds.map(id=>sites.get(id));

export function navigationUrl(input) {
  if(!input || typeof input!=='object')throw new Error('无效的网址');
  if(typeof input.siteId==='string' && sites.has(input.siteId))return sites.get(input.siteId).url;
  if(typeof input.query==='string'){
    const query=input.query.trim();
    if(!query || query.length>200)throw new Error('请输入 1 至 200 个字的搜索内容');
    return `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
  }
  throw new Error('无效的网址');
}

export function createLaunchShortcut({onUnlock,now=()=>Date.now(),gapMs=2000}) {
  let count=0,last=0,unlocked=false;
  const reset=()=>{count=0;last=0;};
  return {
    reset,
    handle(event){
      if(unlocked)return false;
      const target=event.target;
      const editable=target?.isContentEditable || target?.closest?.('input,textarea,select,[role="textbox"]');
      if(event.isComposing || event.ctrlKey || event.altKey || event.metaKey || editable){reset();return false;}
      if(event.repeat || event.key==='Shift')return false;
      if(String(event.key).toLowerCase()!=='o'){reset();return false;}
      const time=now();
      count=time-last>gapMs?1:count+1;last=time;
      if(count===5){unlocked=true;onUnlock();}
      return true;
    },
  };
}
