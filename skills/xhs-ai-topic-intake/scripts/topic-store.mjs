import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configPath = process.env.XHS_TOPIC_CONFIG || path.join(root, 'references', 'target.local.json');
const config = JSON.parse(fs.readFileSync(fs.existsSync(configPath) ? configPath : path.join(root, 'references', 'target.example.json'), 'utf8'));
const f = config.fields;
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Symbols in technology names are significant: C, C#, C++ must stay distinct.
const norm = s => s.normalize('NFKC').toLowerCase().replace(/[\p{Z}\s]+/gu, ' ').trim();
export function safeOutputPath(file) {
  const work=path.resolve('work'), destination=path.resolve(file);
  const relative=path.relative(work,destination);
  if(!relative || relative==='..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) fail('输出仅可保存到当前任务的 work 目录。');
  let cursor=work;
  for(const segment of [null,...relative.split(path.sep).slice(0,-1)]) {
    if(segment!==null) cursor=path.join(cursor,segment);
    if(fs.existsSync(cursor)) {if(fs.lstatSync(cursor).isSymbolicLink() || !fs.statSync(cursor).isDirectory()) fail('输出目录不可使用链接或非目录路径。');}
    else fs.mkdirSync(cursor);
  }
  if(fs.existsSync(destination)) fail('输出已存在，拒绝覆盖；请使用新的文件名。');
  return destination;
}
export function saveNewJSON(file,data) {
  const destination=safeOutputPath(file);
  fs.writeFileSync(destination,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
}
const load = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/,''));
const fail = message => {throw new Error(message);};
const target = {base_token:config.base_token, table_id:config.topic_table_id};

function cli(args) {
  const entry = process.env.LARK_CLI_ENTRY || path.join(os.homedir(),'AppData','Roaming','npm','node_modules','@larksuite','cli','scripts','run.js');
  const program = fs.existsSync(entry) ? process.execPath : 'lark-cli';
  const argv = fs.existsSync(entry) ? [entry,...args] : args;
  const r = spawnSync(program, argv, {encoding:'utf8',shell:false,timeout:60000,maxBuffer:8*1024*1024,
    env:{...process.env,LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'}});
  if (r.error || r.status !== 0) fail('CLI 失败或结果不明，先核对远端，禁止盲目重试：'+(r.error?.message || r.stderr || r.stdout).slice(0,1600));
  let result;
  try {result=JSON.parse(r.stdout);} catch {fail('CLI 返回非 JSON，停止并核对远端。');}
  if (result.ok === false) fail(JSON.stringify(result.error));
  return result;
}
const coords = () => ['--base-token',config.base_token,'--table-id',config.topic_table_id,'--as','user'];
function snapshot() {
  if (!config.base_token || !config.topic_table_id || /YOUR_/.test(config.base_token + config.topic_table_id)) fail('请先填写 target.local.json 的目标坐标。');
  const relative = path.join('work',`topics-${crypto.randomUUID()}.ndjson`);
  safeOutputPath(relative);
  const args=['base','+record-list',...coords(),'--format','ndjson','--output',relative];
  for (const field of Object.values(f)) args.push('--field-id',field);
  const manifest=cli(args);
  if (manifest.has_more !== false) fail('查重快照不完整：当前最小版本只处理单页最多 2000 条，请先扩展分页后再写入。');
  const rows=fs.readFileSync(relative,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (manifest.records_count !== rows.length) fail('记录数与快照不一致。');
  return rows;
}

export function referenceKey(value) {
  const url=new URL(value);
  if (url.protocol !== 'https:' || !(url.hostname === 'xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com') || url.hostname === 'xhslink.com' || url.hostname.endsWith('.xhslink.com'))) fail('仅接受 HTTPS 小红书参考链接。');
  const id=url.pathname.match(/\/(?:explore|discovery\/item)\/([a-zA-Z0-9]+)/)?.[1];
  return id ? 'note:'+id.toLowerCase() : 'url:'+url.origin.toLowerCase()+url.pathname.replace(/\/$/,'');
}
function existingKeys(text) {
  const keys=new Set();
  for (const match of String(text || '').matchAll(/https:\/\/[^\s<>"\)]+/g)) {
    try {keys.add(referenceKey(match[0]));} catch { /* Preserve unrelated existing text. */ }
  }
  return keys;
}
function similar(a,b) {
  a=norm(a);b=norm(b); if (!a||!b) return false;
  const grams=s=>new Set(Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)));
  const x=grams(a),y=grams(b),common=[...x].filter(t=>y.has(t)).length;
  return common/Math.max(1,new Set([...x,...y]).size)>=0.38;
}
function cleanTopic(input) {
  if (!input || typeof input.direction!=='string' || !input.direction.trim()) fail('选题方向不能为空。');
  if ('制作时机' in input) fail('制作时机请使用 timing 字段，并标记用户明确选择。');
  const timing=input.timing ?? '待判断',timing_source=input.timing_source ?? 'default';
  if(!['现在可做','需补知识','暂缓','待判断'].includes(timing)) fail('制作时机不是允许的四种值。');
  if(!['default','user'].includes(timing_source) || (timing!=='待判断' && timing_source!=='user')) fail('非默认制作时机必须来自用户明确选择，timing_source 需为 user。');
  if(input.category!==undefined && typeof input.category!=='string') fail('分类必须是字符串。');
  if (input.tools?.length) fail('新版不再支持关联工具字段，请移除 tools。');
  const content_type=input.content_type ?? '干货合集';
  if (!['干货合集','成长记录'].includes(content_type)) fail('选题方向只能是干货合集或成长记录。');
  if (!Array.isArray(input.references) || !input.references.length) fail('每个选题至少包含一篇参考。');
  const seen=new Set();
  const references=input.references.filter(ref=>{
    if (!ref || typeof ref.title!=='string' || !ref.title.trim()) fail('参考笔记需有短标题。');
    if (!['read','user_text','title_only'].includes(ref.evidence_status)) fail('每篇参考须标记读取证据状态。');
    const key=referenceKey(ref.url);if(seen.has(key))return false;seen.add(key);return true;
  }).map(ref=>({title:ref.title.trim(),url:ref.url,evidence_status:ref.evidence_status}));
  return {direction:input.direction.trim(),content_type,category:(input.category||'').trim(),timing,timing_source,references,
    ...(input.merge_into?{merge_into:input.merge_into}:{}),...(input.force_new===true?{force_new:true}:{}),
    ...(input.allow_title_only===true?{allow_title_only:true}:{})};
}

export function buildPlan(proposal,rows) {
  if (!Array.isArray(proposal.topics)||!proposal.topics.length||proposal.topics.length>30) fail('每次需要 1–30 个已整理选题，不做大规模采集。');
  const topics=proposal.topics.map(cleanTopic),operations=[];
  const knownCategories=categoryValues(rows);
  const confirmed=proposal.confirmed_new_categories ?? [];
  if(!Array.isArray(confirmed) || confirmed.some(c=>typeof c!=='string'||!c.trim())) fail('confirmed_new_categories 必须是用户已明确确认的新分类名称数组。');
  const confirmedCategories=[...new Set(confirmed.map(c=>c.trim()))];
  const seenTitles=new Set(),usedTargets=new Set();
  for(const topic of topics) {
    if(topic.category && !knownCategories.has(topic.category) && !confirmedCategories.includes(topic.category)) fail('没有匹配到已有分类；新分类需先让用户确认。');
    const title=norm(topic.direction);
    if(seenTitles.has(title)) fail('同批相同方向请先合并参考，再生成计划。');seenTitles.add(title);
    const keys=new Set(topic.references.map(r=>referenceKey(r.url)));
    const exact=rows.filter(r=>norm(String(r[f.direction]||''))===title);
    const candidates=rows.filter(r=>similar(topic.direction,String(r[f.direction]||'')) || [...existingKeys(r[f.references])].some(k=>keys.has(k)));
    let row;
    if(topic.merge_into) {row=rows.find(r=>r.record_id===topic.merge_into);if(!row)fail('merge_into 不存在于目标库快照。');}
    else if(!topic.force_new && exact.length===1) row=exact[0];
    else if(!topic.force_new && (exact.length>1 || candidates.length)) {
      operations.push({action:'review',topic,candidates:(exact.length?exact:candidates).map(r=>({record_id:r.record_id,direction:r[f.direction]}))});continue;
    }
    if(row) {
      if(topic.timing_source==='user' || topic.category || Object.hasOwn(proposal.topics.find(t=>t.direction.trim()===topic.direction),'content_type')) fail('追加参考只更新参考链接；如需改已有记录的分类或制作时机，须单独列明修改范围并获批准。');
      if(usedTargets.has(row.record_id)) fail('同批多个方向指向同一记录，请先合并。');usedTargets.add(row.record_id);
      const prior=String(row[f.references]||''),oldKeys=existingKeys(prior);
      const additions=topic.references.filter(r=>!oldKeys.has(referenceKey(r.url)));
      operations.push({action:additions.length?'append':'skip',record_id:row.record_id,direction:row[f.direction],expected_references:prior,topic,additions});
    } else {
      // Same-batch semantic/ref overlap must also be reviewed before any write.
      const conflict=operations.find(op=>op.action==='create' && (similar(topic.direction,op.topic.direction) || op.topic.references.some(r=>keys.has(referenceKey(r.url)))));
      if(conflict && !topic.force_new) {operations.push({action:'review',topic,candidates:[{pending_direction:conflict.topic.direction}]});continue;}
      operations.push({action:'create',topic});
    }
  }
  const data={version:3,target,confirmed_new_categories:confirmedCategories,operations};
  return {...data,digest:hash(data)};
}

function categoryValues(rows) {
  return new Set([...(config.categories || []), ...rows.flatMap(row=>Array.isArray(row[f.category])?row[f.category]:[row[f.category]]).filter(c=>typeof c==='string'&&c.trim()).map(c=>c.trim())]);
}
const badge=i=>i<=20?String.fromCodePoint(0x2460+i-1):String(i);
export function markdown(refs,offset=0) {return refs.map((r,i)=>`[${badge(offset+i+1)}](${r.url.replace(/\(/g,'%28').replace(/\)/g,'%29')})`).join('\n');}
export function appendReferenceText(current,additions) {
  const count=[...String(current).matchAll(/https:\/\/[^\s<>"\)]+/g)].length;
  return current+(current?'\n':'')+markdown(additions,count);
}
function validatePlan(plan,approval) {
  const {digest,...data}=plan;
  if(plan.version!==3) fail('这是旧版计划，请重新生成并确认。');
  if(digest!==hash(data)||digest!==approval) fail('确认摘要不匹配或计划被改动，请重新生成并确认。');
  if(JSON.stringify(plan.target)!==JSON.stringify(target)) fail('计划目标与绑定库不一致。');
  if(plan.operations.some(op=>op.action==='review')) fail('还有未解决的查重候选，禁止写入。');
  if(plan.operations.some(op=>!['create','append','skip'].includes(op.action))) fail('不支持的写入操作。');
  for(const op of plan.operations) cleanTopic(op.topic);
}
export function prepareCommit(plan,approval,rows) {
  validatePlan(plan,approval);
  const ready=[],knownCategories=categoryValues(rows);
  for(const op of plan.operations) {
    const topic=op.topic;
    if(topic.category && !knownCategories.has(topic.category) && !plan.confirmed_new_categories.includes(topic.category)) fail('已有分类已变化，请重新确认分类。');
    if(op.action==='create') {
      const exact=rows.filter(r=>norm(String(r[f.direction]||''))===norm(topic.direction));
      const keys=topic.references.map(r=>referenceKey(r.url));
      const completed=exact.filter(row=>keys.every(k=>existingKeys(row[f.references]).has(k)));
      if(completed.length===1) {
        ready.push({op,skip_id:completed[0].record_id});continue;
      }
      if(completed.length>1) fail('多条记录已含相同方向和参考，请先人工确定归属。');
      if(exact.length && !topic.force_new) fail('确认后出现同名选题，先重新查重确认。');
      if(!topic.force_new && rows.some(r=>similar(topic.direction,String(r[f.direction]||'')) || keys.some(k=>existingKeys(r[f.references]).has(k)))) fail('确认后出现新的重复候选，请重新生成计划。');
      ready.push({op});
    } else {
      const row=rows.find(r=>r.record_id===op.record_id);if(!row)fail('确认后的目标记录已不存在。');
      if(String(row[f.direction]||'')!==op.direction) fail('确认后目标选题已改变，停止追加，请重新确认归属。');
      const current=String(row[f.references]||'');
      const additions=topic.references.filter(r=>!existingKeys(current).has(referenceKey(r.url)));
      if(current!==op.expected_references && additions.length) fail('参考笔记在确认后已改变，停止以避免覆盖并发更新。');
      ready.push({op,additions,current,...(!additions.length?{skip_id:row.record_id}:{})});
    }
  }
  return ready;
}
export function createFields(topic) {
  const clean=cleanTopic(topic);
  return {[f.direction]:clean.direction,[f.references]:markdown(clean.references),[f.timing]:[clean.timing],[f.content_type]:[clean.content_type],...(clean.category?{[f.category]:[clean.category]}:{})};
}
function commit(plan,approval) {
  validatePlan(plan,approval);
  const work=path.resolve('work');fs.mkdirSync(work,{recursive:true});
  const lock=path.join(work,`topic-intake-${config.base_token}.lock`);
  safeOutputPath(lock);
  const handle=fs.openSync(lock,'wx');
  let receiptHandle;
  const receiptFile=path.join('work',`receipt-${crypto.randomUUID()}.json`);
  const receipt={digest:plan.digest,target,results:[],complete:false,receipt_file:receiptFile};
  const writeReceipt=()=>{fs.ftruncateSync(receiptHandle,0);fs.writeSync(receiptHandle,JSON.stringify(receipt,null,2)+'\n',0,'utf8');};
  try {
    receiptHandle=fs.openSync(safeOutputPath(receiptFile),'wx',0o600);
    writeReceipt();
    const rows=snapshot();
    // Validate the whole batch against a fresh snapshot before the first mutation.
    const ready=prepareCommit(plan,approval,rows);
    for(const item of ready) {
      const {op}=item;
      if(item.skip_id) receipt.results.push({action:'skip',record_id:item.skip_id,direction:op.topic.direction});
      else if(op.action==='create') {
        const fields=createFields(op.topic);
        const response=cli(['base','+record-batch-create',...coords(),'--json',JSON.stringify({create_records:[fields]})]);
        const ids=response.data?.record_id_list;
        if(!Array.isArray(ids)||ids.length!==1)fail('新增结果缺少记录 ID，请核对远端，勿直接重试。');
        receipt.results.push({action:'create',record_id:ids[0],direction:op.topic.direction});
      } else {
        const appended=appendReferenceText(item.current,item.additions);
        cli(['base','+record-batch-update',...coords(),'--json',JSON.stringify({update_records:{[op.record_id]:{[f.references]:appended}}})]);
        receipt.results.push({action:'append',record_id:op.record_id,added:item.additions.length,direction:op.topic.direction});
      }
      writeReceipt();
    }
    receipt.complete=true;writeReceipt();return receipt;
  } catch(error) {receipt.error=error.message;if(receiptHandle!==undefined)writeReceipt();throw error;}
  finally {if(receiptHandle!==undefined)fs.closeSync(receiptHandle);fs.closeSync(handle);fs.unlinkSync(lock);}
}

function main() {
  const [command,...rest]=process.argv.slice(2),opts={};
  for(let i=0;i<rest.length;i+=2) {if(!rest[i]?.startsWith('--')||!rest[i+1])fail('参数需成对传入。');opts[rest[i].slice(2)]=rest[i+1];}
  if(command==='inspect') {if(!opts.out)fail('需要 --out');safeOutputPath(opts.out);const rows=snapshot();saveNewJSON(opts.out,{target,rows,categories:[...categoryValues(rows)]});console.log(JSON.stringify({ok:true,count:rows.length,file:opts.out}));}
  else if(command==='plan') {if(!opts.input||!opts.out)fail('需要 --input 和 --out');safeOutputPath(opts.out);const plan=buildPlan(load(opts.input),snapshot());saveNewJSON(opts.out,plan);console.log(JSON.stringify({ok:true,file:opts.out,...plan},null,2));}
  else if(command==='commit') {if(!opts.plan||!opts.approve)fail('需要 --plan 和 --approve');console.log(JSON.stringify({ok:true,...commit(load(opts.plan),opts.approve)},null,2));}
  else fail('用法：inspect --out FILE | plan --input FILE --out FILE | commit --plan FILE --approve DIGEST');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {main();} catch(error) {console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
