<script setup>
import {computed,onMounted,onUnmounted,ref} from 'vue';
import {navigationGroups,featuredSites,navigationUrl} from './core/launch-navigation.js';
defineProps({loading:Boolean,loadError:String});
defineEmits(['retry']);
const query=ref(''),error=ref(''),today=ref(new Date());
const dateLabel=computed(()=>new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(today.value));
let timer;
onMounted(()=>{timer=setInterval(()=>{today.value=new Date();},60000);});
onUnmounted(()=>clearInterval(timer));
async function open(input){
  error.value='';
  try{
    const url=navigationUrl(input);
    if(window.songcai?.openNavigation)await window.songcai.openNavigation(input);
    else window.open(url,'_blank','noopener,noreferrer');
  }catch{error.value='暂时无法打开网站，请稍后重试';}
}
function search(){if(query.value.trim())open({query:query.value});}
</script>
<template>
  <div class="navigation-home" data-navigation-home>
    <div class="navigation-top"><div class="navigation-width"><span>生活，从这里开始</span><div><a href="https://www.weather.com.cn/" @click.prevent="open({siteId:'weather'})">天气查询</a><span class="navigation-divider">|</span><a href="https://mail.163.com/" @click.prevent="open({siteId:'mail163'})">邮箱</a></div></div></div>
    <main class="navigation-width">
      <header class="navigation-heading"><div class="navigation-brand"><span class="navigation-symbol">好</span><div><h1>上网导航</h1><p>常用网站 · 轻松上网</p></div></div><div class="navigation-date"><span class="navigation-calendar">日历</span><span>{{dateLabel}}</span></div></header>
      <section class="navigation-search" aria-label="百度搜索">
        <a class="navigation-baidu" href="https://www.baidu.com/" @click.prevent="open({siteId:'baidu'})"><span>百</span><span>度</span><small>baidu</small></a>
        <div class="navigation-search-body"><div class="navigation-search-labels"><b>网页</b><a href="https://www.baidu.com/" @click.prevent="open({siteId:'baidu'})">百度首页</a><a href="https://map.baidu.com/" @click.prevent="open({siteId:'map'})">地图</a><a href="https://fanyi.baidu.com/" @click.prevent="open({siteId:'fanyi'})">翻译</a></div>
          <form @submit.prevent="search"><input v-model="query" type="search" maxlength="200" aria-label="百度搜索内容" placeholder="搜一搜，你就知道" autocomplete="off" /><button type="submit">百度一下</button></form>
          <p class="navigation-search-hint">发现世界，也发现生活里的小美好</p>
        </div>
      </section>
      <nav class="navigation-tabs" aria-label="网站分类"><a class="navigation-tab-active" href="#navigation-featured">推荐网站</a><a v-for="(group,index) in navigationGroups.slice(1)" :key="group.name" :href="`#navigation-group-${index+1}`">{{group.name}}</a></nav>
      <section id="navigation-featured" class="navigation-featured" aria-label="推荐网站"><a v-for="(site,index) in featuredSites" :key="site.id" :href="site.url" @click.prevent="open({siteId:site.id})"><i :class="`navigation-color-${index%4}`">{{site.name.slice(0,1)}}</i>{{site.name}}</a></section>
      <section class="navigation-directory" aria-label="网站大全"><div class="navigation-section-heading"><h2>网站大全</h2><span>常用好站，一键直达</span></div><div v-for="(group,index) in navigationGroups" :id="`navigation-group-${index}`" :key="group.name" class="navigation-site-row"><h3>{{group.name}}</h3><a v-for="[id,name,url] in group.sites" :key="id" :href="url" @click.prevent="open({siteId:id})">{{name}}</a></div></section>
      <div v-if="error || loadError || loading" class="navigation-message" role="status"><span>{{error || loadError || '正在打开…'}}</span><button v-if="loadError" @click="$emit('retry')">重试</button></div>
      <footer class="navigation-footer"><span>上网导航</span><span>简单一点，方便每一天</span></footer>
    </main>
  </div>
</template>
<style scoped>
.navigation-home{min-height:100vh;background:#f6f7f8;color:#333;font-family:"Microsoft YaHei","PingFang SC",sans-serif;font-size:14px}
.navigation-width{width:calc(100% - 64px);max-width:1160px;margin:auto}
.navigation-top{height:34px;border-bottom:1px solid #e5e7e9;background:#fcfcfc;font-size:12px;color:#888}
.navigation-top>.navigation-width,.navigation-top .navigation-width>div{display:flex;align-items:center;justify-content:space-between;height:100%;gap:18px}
.navigation-divider{color:#ddd}.navigation-home a:hover{color:#14835d;text-decoration:underline}
.navigation-heading{height:88px;display:flex;align-items:center;justify-content:space-between}
.navigation-brand{display:flex;align-items:center;gap:11px}.navigation-symbol{display:grid;place-items:center;width:46px;height:46px;background:#179a6b;border-radius:13px 13px 13px 3px;color:white;font-size:30px;font-weight:700}
.navigation-brand h1{font-size:27px;font-weight:700;color:#218b64;letter-spacing:2px;line-height:1.25}.navigation-brand p{font-size:11px;color:#8f9894;margin-top:4px;letter-spacing:1px}
.navigation-date{display:flex;gap:12px;align-items:center;color:#777;font-size:13px}.navigation-calendar{border:1px solid #d4ded9;background:white;border-radius:4px;padding:5px 7px;color:#388b6b;font-size:11px}
.navigation-search{display:flex;align-items:center;justify-content:center;gap:28px;padding:3px 20px 27px}
.navigation-baidu{font-size:36px;font-weight:700;color:#2932d5;display:block;white-space:nowrap;position:relative;padding-bottom:12px;letter-spacing:1px}.navigation-baidu span:nth-child(2){color:#e44440}.navigation-baidu small{font-size:12px;letter-spacing:7px;position:absolute;bottom:0;left:11px;color:#2932d5}
.navigation-search-body{width:650px;max-width:75%}.navigation-search-labels{display:flex;gap:23px;font-size:13px;margin-bottom:9px;color:#6b6d70}.navigation-search-labels b{color:#15875c}
.navigation-search form{display:flex;height:44px}.navigation-search input{flex:1;width:0;border:1px solid #b8bfc5;border-right:0;border-radius:4px 0 0 4px;padding:0 14px;font-size:15px;color:#333}.navigation-search input:focus{outline:none;border-color:#3385ff;box-shadow:inset 0 0 0 1px #3385ff}
.navigation-search button{width:112px;border-radius:0 4px 4px 0;background:#327af0;color:#fff;font-size:15px}.navigation-search button:hover{background:#2269dd}.navigation-search-hint{font-size:11px;color:#9a9da2;margin-top:9px}
.navigation-tabs{display:flex;border-top:2px solid #21996c;border-bottom:1px solid #dce5df;background:#fff;height:44px}.navigation-tabs a{flex:1;display:grid;place-items:center;font-size:14px;border-right:1px solid #f1f3f2}.navigation-tabs .navigation-tab-active{color:white;background:#21996c;font-weight:600}.navigation-tabs .navigation-tab-active:hover{color:white}
.navigation-featured{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));background:#fff;border:1px solid #dce5df;border-top:0;padding:12px 22px;gap:0 12px;margin-bottom:17px}.navigation-featured a{display:flex;align-items:center;gap:10px;height:44px;font-size:15px}.navigation-featured i{display:grid;place-items:center;width:23px;height:23px;border-radius:6px;font-size:12px;font-weight:700;font-style:normal}.navigation-color-0{background:#eaf1ff;color:#436cbd}.navigation-color-1{background:#fff0ec;color:#d65f43}.navigation-color-2{background:#eaf5ee;color:#389768}.navigation-color-3{background:#fff5e4;color:#ba8d35}
.navigation-directory{background:white;border:1px solid #e1e5e3}.navigation-section-heading{height:40px;display:flex;align-items:center;gap:18px;padding:0 20px;background:#fcfdfc;border-bottom:1px solid #edf0ed}.navigation-section-heading h2{font-size:14px;font-weight:600;color:#298562}.navigation-section-heading span{font-size:11px;color:#9a9f9c}
.navigation-site-row{display:grid;grid-template-columns:100px repeat(6,minmax(0,1fr));align-items:center;min-height:43px;padding:0 20px;border-bottom:1px dotted #e8ece9;gap:10px}.navigation-site-row:last-child{border:0}.navigation-site-row:hover{background:#f9fcfa}.navigation-site-row h3{font-size:13px;color:#248e66;font-weight:400;margin:0}.navigation-site-row a{font-size:13px;white-space:nowrap}
.navigation-footer{display:flex;justify-content:center;gap:20px;padding:23px 0 19px;color:#9b9f9d;font-size:11px}.navigation-footer span+span{border-left:1px solid #d9ddda;padding-left:20px}.navigation-message{padding:12px 0 0;color:#777;font-size:12px;text-align:center}.navigation-message button{color:#16825a;margin-left:12px;text-decoration:underline}
@media(max-height:780px){.navigation-heading{height:72px}.navigation-search{padding-bottom:18px}.navigation-featured{padding-top:7px;padding-bottom:7px;margin-bottom:12px}.navigation-featured a{height:37px}.navigation-site-row{min-height:38px}.navigation-footer{padding:17px 0}}
@media(max-height:700px){.navigation-heading{height:64px}.navigation-search-hint{display:none}.navigation-footer{padding:12px 0}}
@media(max-width:900px){.navigation-width{width:calc(100% - 32px)}.navigation-site-row{grid-template-columns:86px repeat(3,minmax(0,1fr));row-gap:14px;padding:14px}.navigation-site-row h3{grid-row:span 2}.navigation-featured{grid-template-columns:repeat(4,minmax(0,1fr))}.navigation-tabs a{font-size:12px}.navigation-search-body{max-width:80%}.navigation-date{font-size:11px}}
</style>
