import test from 'node:test';
import assert from 'node:assert/strict';
import {createParseWorker} from '../src/parse-worker-client.js';

test('worker accepts only its current response, rejects overlap, and can restart after failure',async()=>{
  const original=globalThis.Worker,instances=[];
  globalThis.Worker=class {
    constructor(){instances.push(this);}
    postMessage(message){this.message=message;}
    terminate(){this.terminated=true;}
  };
  const client=createParseWorker();
  try{
    const first=client.run([{id:'a'}]),worker=instances[0];
    assert.throws(()=>client.run([]),/正在运行/);
    worker.onmessage({data:{id:999,results:['obsolete']}});
    worker.onmessage({data:{id:worker.message.id,results:['first']}});
    assert.deepEqual(await first,['first']);
    const second=client.run([]),rejected=assert.rejects(second,/不可用/);
    worker.onerror();await rejected;assert.equal(worker.terminated,true);
    const third=client.review({text:'01各10'},'doubt'),fresh=instances[1];
    assert.equal(fresh.message.operation,'review');assert.equal(fresh.message.document.text,'01各10');assert.equal(fresh.message.mode,'doubt');
    fresh.onmessage({data:{id:fresh.message.id,results:[]}});assert.deepEqual(await third,[]);
    const fourth=client.run([]),cancelled=assert.rejects(fourth,/已结束/);
    client.dispose();await cancelled;assert.equal(fresh.terminated,true);
  }finally{client.dispose();globalThis.Worker=original;}
});
