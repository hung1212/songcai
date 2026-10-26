// A single in-flight job keeps typing from building an obsolete work queue.
export function createParseWorker() {
  let worker,sequence=0,pending;
  const stop=error=>{
    worker?.terminate();worker=undefined;
    if(pending){pending.reject(error);pending=undefined;}
  };
  function request(payload) {
      if(pending)throw new Error('解析任务正在运行');
      if(!worker){
        worker=new Worker(new URL('./parse.worker.js',import.meta.url),{type:'module'});
        worker.onmessage=({data})=>{
          if(data.id!==pending?.id)return;
          const job=pending;pending=undefined;
          if(data.error)job.reject(new Error(data.error));else job.resolve(data.results);
        };
        worker.onerror=()=>stop(new Error('后台解析不可用'));
        worker.onmessageerror=()=>stop(new Error('后台解析结果读取失败'));
      }
      return new Promise((resolve,reject)=>{
        pending={id:++sequence,resolve,reject};
        try{worker.postMessage({id:sequence,...payload});}catch(error){stop(error);}
      });
    }
  return {
    run(documents){return request({documents});},
    review(document,mode){return request({operation:'review',document,mode});},
    dispose(){stop(new Error('解析任务已结束'));},
  };
}
