import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Execute the real module in memory with *all* filesystem and CLI operations replaced.
// No CLI process is started, no remote endpoint is called, and no files are created.
function simulatedRuntime(rows=[]) {
  const script=fileURLToPath(new URL('../scripts/topic-store.mjs',import.meta.url));
  const config=fs.readFileSync(new URL('../references/target.example.json',import.meta.url),'utf8').replace('YOUR_BASE_TOKEN','base-simulated').replace('YOUR_TABLE_ID','tbl-simulated');
  const source=fs.readFileSync(script,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export function /g,'function ').replaceAll('import.meta.url',JSON.stringify('file:///simulation.mjs'));
  const state={rows:structuredClone(rows),files:new Map(),dirs:new Set([path.resolve('work')]),handles:new Map(),requests:[],counter:0,failAfterApplied:false};
  const full=p=>path.resolve(p);
  const mockFs={
    existsSync:p=>state.dirs.has(full(p))||state.files.has(full(p))||String(p).endsWith('scripts'+path.sep+'run.js'),
    readFileSync:p=>String(p).endsWith('target.example.json')?config:state.files.get(full(p))??state.rows.map(r=>JSON.stringify(r)).join('\n'),
    mkdirSync:p=>state.dirs.add(full(p)),lstatSync:()=>({isSymbolicLink:()=>false}),statSync:p=>({isDirectory:()=>state.dirs.has(full(p))}),
    openSync:(p,flags)=>{p=full(p);if(flags==='wx'&&state.files.has(p))throw new Error('EEXIST');state.files.set(p,'');const fd=state.handles.size+10;state.handles.set(fd,p);return fd;},
    closeSync:fd=>state.handles.delete(fd),unlinkSync:p=>state.files.delete(full(p)),
    ftruncateSync:fd=>state.files.set(state.handles.get(fd),''),writeSync:(fd,text)=>state.files.set(state.handles.get(fd),text),
    writeFileSync:(p,text,opts)=>{p=full(p);if(opts?.flag==='wx'&&state.files.has(p))throw new Error('EEXIST');state.files.set(p,text);},
  };
  const spawn=(program,args)=>{
    state.requests.push(args);
    if(args.includes('+record-list'))return {status:0,stdout:JSON.stringify({has_more:false,records_count:state.rows.length}),stderr:''};
    const payload=JSON.parse(args[args.indexOf('--json')+1]);
    if(args.includes('+record-batch-create')) {
      const id='rec-simulated-'+(++state.counter);state.rows.push({record_id:id,...payload.create_records[0]});
      if(state.failAfterApplied){state.failAfterApplied=false;return {status:1,stdout:'',stderr:'simulated response lost after create'};}
      return {status:0,stdout:JSON.stringify({ok:true,data:{record_id_list:[id]}}),stderr:''};
    }
    if(args.includes('+record-batch-update')) {
      for(const [id,fields] of Object.entries(payload.update_records))Object.assign(state.rows.find(r=>r.record_id===id),fields);
      return {status:0,stdout:JSON.stringify({ok:true,data:{}}),stderr:''};
    }
    throw new Error('模拟器不允许其他命令');
  };
  const api=new Function('fs','os','path','crypto','spawnSync','fileURLToPath','process',source+'\nreturn {buildPlan,commit};')(mockFs,os,path,crypto,spawn,()=>script,{argv:['node'],env:{},execPath:process.execPath});
  return {...api,state};
}
const url=n=>'https://www.xiaohongshu.com/explore/'+n.toString(16).padStart(24,'0')+'?xsec_token=keep&source=share';
const ref=n=>({title:'参考'+n,url:url(n),evidence_status:'title_only'});
const topic=(more={})=>({direction:'技能复用入门',tools:[],category:'',references:[ref(1)],...more});

test('完整模拟新增、重复提交跳过、追加和重复追加跳过',()=>{
  const r=simulatedRuntime();
  const create=r.buildPlan({topics:[topic()]},[]);
  assert.equal(r.commit(create,create.digest).results[0].action,'create');
  assert.equal(r.commit(create,create.digest).results[0].action,'skip');
  const row=r.state.rows[0];
  row.制作时机=['暂缓'];row['旧版工具列']='用户原有工具';row.合集='用户已有分类';
  const append=r.buildPlan({topics:[topic({merge_into:row.record_id,references:[ref(1),ref(2)]})]},r.state.rows);
  assert.equal(r.commit(append,append.digest).results[0].action,'append');
  assert.equal(r.commit(append,append.digest).results[0].action,'skip');
  assert.equal(r.state.rows.length,1);assert.match(row.参考笔记,/\[①\]/);assert.match(row.参考笔记,/\[②\]/);
  assert.deepEqual(row.制作时机,['暂缓']);assert.equal(row['旧版工具列'],'用户原有工具');assert.equal(row.合集,'用户已有分类');
  const mutation=r.state.requests.filter(a=>a.includes('+record-batch-update'))[0];
  const fields=Object.values(JSON.parse(mutation[mutation.indexOf('--json')+1]).update_records)[0];
  assert.deepEqual(Object.keys(fields),['参考笔记']);
  const receipts=[...r.state.files.keys()].filter(p=>path.basename(p).startsWith('receipt-'));
  assert.equal(receipts.length,4);
});
test('模拟目标改题与错误摘要均不发出任何写入命令',()=>{
  const row={record_id:'rec-old',选题名称:'技能复用入门',参考笔记:'[旧参考]('+url(1)+')'};
  const r=simulatedRuntime([row]);
  const plan=r.buildPlan({topics:[topic({references:[ref(2)]})]},[row]);
  assert.throws(()=>r.commit(plan,'wrong'),/摘要/);
  r.state.rows[0].选题名称='已换成其他题目';
  assert.throws(()=>r.commit(plan,plan.digest),/目标选题已改变/);
  assert.equal(r.state.requests.filter(a=>a.includes('+record-batch-update')||a.includes('+record-batch-create')).length,0);
});
test('创建成功但响应丢失时停止；核对重试不会重复创建',()=>{
  const r=simulatedRuntime(),plan=r.buildPlan({topics:[topic()]},[]);
  r.state.failAfterApplied=true;
  assert.throws(()=>r.commit(plan,plan.digest),/禁止盲目重试/);
  assert.equal(r.state.rows.length,1);
  assert.equal(r.commit(plan,plan.digest).results[0].action,'skip');
  assert.equal(r.state.rows.length,1);
});
test('三组选题的用户制作时机与分类一起通过模拟填写',()=>{
  const historical={record_id:'rec-other',选题名称:'无关历史选题',参考笔记:'',合集:'入门科普'};
  const r=simulatedRuntime([historical]);
  const topics=[topic({direction:'技能复用入门',references:[1,2,3,4].map(ref),timing:'现在可做',timing_source:'user',category:'入门科普'}),topic({direction:'桌面代码助手',references:[5,6].map(ref)}),topic({direction:'提示词表达',references:[ref(7)]})];
  const plan=r.buildPlan({topics},[historical]),receipt=r.commit(plan,plan.digest);
  assert.equal(receipt.results.length,3);
  const added=r.state.rows.slice(1);
  assert.deepEqual(added.map(x=>(x.参考笔记.match(/https:\/\//g)||[]).length),[4,2,1]);
  assert.deepEqual(added.map(x=>x.制作时机[0]),['现在可做','待判断','待判断']);
  assert.deepEqual(added[0].合集,['入门科普']);
});
