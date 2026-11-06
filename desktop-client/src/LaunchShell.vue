<script setup>
import {onMounted,onUnmounted,ref,shallowRef} from 'vue';
import NavigationHome from './NavigationHome.vue';
import {createLaunchShortcut} from './core/launch-navigation.js';
const workspace=shallowRef(),loading=ref(false),error=ref('');
async function enter(){
  if(loading.value || workspace.value)return;
  loading.value=true;error.value='';
  try{
    const module=await import('./App.vue');
    workspace.value=module.default;
    document.title='松财 · 玩家算账';
  }catch{error.value='页面加载失败，请重试';}
  finally{loading.value=false;}
}
const shortcut=createLaunchShortcut({onUnlock:enter});
function keydown(event){if(shortcut.handle(event))event.preventDefault();}
onMounted(()=>{
  document.title='上网导航';
  window.addEventListener('keydown',keydown);
  window.addEventListener('blur',shortcut.reset);
});
onUnmounted(()=>{window.removeEventListener('keydown',keydown);window.removeEventListener('blur',shortcut.reset);});
</script>
<template>
  <component :is="workspace" v-if="workspace" />
  <NavigationHome v-else :loading="loading" :load-error="error" @retry="enter" />
</template>
