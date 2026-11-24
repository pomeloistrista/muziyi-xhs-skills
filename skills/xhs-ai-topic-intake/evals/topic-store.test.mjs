import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {referenceKey,buildPlan,prepareCommit,createFields,appendReferenceText,saveNewJSON} from '../scripts/topic-store.mjs';

const a='https://www.xiaohongshu.com/discovery/item/000000000000000000000001?xsec_token=first&source=share';
const refreshed='https://www.xiaohongshu.com/explore/000000000000000000000001?xsec_token=changed';
const b='https://www.xiaohongshu.com/explore/000000000000000000000002';
const topic=(extra={})=>({direction:'【测试】用工具整理课程资料',tools:[],category:'',references:[{title:'参考 A',url:a,evidence_status:'user_text'}],...extra});
const row={record_id:'rec-test',选题名称:'【测试】用工具整理课程资料',参考笔记:`[参考 A](${a})`,制作时机:['待判断']};

test('笔记 ID 去重不受路径和签名刷新影响，同时保留原 URL',()=>{
  assert.equal(referenceKey(a),referenceKey(refreshed));
  const plan=buildPlan({topics:[topic()]},[]);
  assert.equal(plan.operations[0].topic.references[0].url,a);
});
test('同一方向追加未出现的参考，保留已有内容',()=>{
  const plan=buildPlan({topics:[topic({references:[{title:'新签名',url:refreshed,evidence_status:'read'},{title:'B',url:b,evidence_status:'user_text'}]})]},[row]);
  assert.equal(plan.operations[0].action,'append');
  assert.equal(plan.operations[0].additions.length,1);
  assert.equal(plan.operations[0].expected_references,row.参考笔记);
});
test('重复提交同一篇笔记不产生追加',()=>assert.equal(buildPlan({topics:[topic()]},[row]).operations[0].action,'skip'));
test('相同参考不同方向必须 review，不自动合并',()=>assert.equal(buildPlan({topics:[topic({direction:'给创作者讲清技能与智能体的区别'})]},[row]).operations[0].action,'review'));
test('默认允许标题归纳，但越界域名和擅自设置制作时机均拒绝',()=>{
  assert.equal(buildPlan({topics:[topic({references:[{title:'A',url:a,evidence_status:'title_only'}]})]},[]).operations[0].action,'create');
  assert.throws(()=>referenceKey('https://xiaohongshu.com.evil.test/explore/abc'),/仅接受/);
  assert.throws(()=>buildPlan({topics:[topic({timing:'现在可做'})]},[]),/制作时机/);
});
test('公开版不忽略真实记录',()=>{
  const plan=buildPlan({topics:[topic()]},[{...row,record_id:'rec-fixture'}]);
  assert.equal(plan.operations[0].action,'skip');
});
test('同批完全重复方向需先合并；不同方向共享参考进入 review',()=>{
  assert.throws(()=>buildPlan({topics:[topic(),topic()]},[]),/同批相同/);
  const plan=buildPlan({topics:[topic(),topic({direction:'另一个独立角度'})]},[]);
  assert.equal(plan.operations[1].action,'review');
});
test('显式选择合并时绑定真实记录，错误记录 ID 被拒绝',()=>{
  assert.equal(buildPlan({topics:[topic({direction:'换个标题的同一方向',merge_into:'rec-test'})]},[row]).operations[0].record_id,'rec-test');
  assert.throws(()=>buildPlan({topics:[topic({merge_into:'rec-missing'})]},[row]),/不存在/);
});
test('C、C#、C++不会自动并入同一个主题，显式独立也有效',()=>{
  const existing={...row,选题名称:'C 入门'};
  for(const direction of ['C# 入门','C++ 入门']) {
    const plan=buildPlan({topics:[topic({direction,references:[{title:direction,url:b,evidence_status:'title_only'}]})]},[existing]);
    assert.notEqual(plan.operations[0].action,'append');
  }
  assert.equal(buildPlan({topics:[topic({direction:'C 入门',force_new:true})]},[existing]).operations[0].action,'create');
});
test('确认后目标选题改变，即使旧参考不变也停止追加',()=>{
  const plan=buildPlan({topics:[topic({references:[{title:'B',url:b,evidence_status:'title_only'}]})]},[row]);
  assert.throws(()=>prepareCommit(plan,plan.digest,[{...row,选题名称:'另一个完全不同的主题'}]),/目标选题已改变/);
});
test('新增和追加的重试均可识别已完成，不新增重复链接',()=>{
  const create=buildPlan({topics:[topic()]},[]);
  assert.equal(prepareCommit(create,create.digest,[row])[0].skip_id,row.record_id);
  const append=buildPlan({topics:[topic({references:[{title:'B',url:b,evidence_status:'title_only'}]})]},[row]);
  const done={...row,参考笔记:appendReferenceText(row.参考笔记,[{url:b}])};
  assert.equal(prepareCommit(append,append.digest,[done])[0].skip_id,row.record_id);
});
test('已有分类可匹配，新分类必须显式记录用户确认',()=>{
  const existing={...row,选题名称:'其他历史方向',合集:'入门科普'};
  const input=topic({direction:'完全独立的写作技巧',category:'入门科普',force_new:true});
  assert.equal(buildPlan({topics:[input]},[existing]).operations[0].topic.category,'入门科普');
  assert.throws(()=>buildPlan({topics:[{...input,category:'新分类'}]},[existing]),/新分类需先/);
  const plan=buildPlan({topics:[{...input,category:'新分类'}],confirmed_new_categories:['新分类']},[existing]);
  assert.deepEqual(createFields(plan.operations[0].topic).合集,['新分类']);
});
test('制作时机默认待判断，用户明确四种选择可填写，AI不得自行填写',()=>{
  assert.deepEqual(createFields(topic()).制作时机,['待判断']);
  for(const timing of ['现在可做','需补知识','暂缓','待判断']) {
    assert.deepEqual(createFields(topic({timing,timing_source:'user'})).制作时机,[timing]);
  }
  assert.throws(()=>createFields(topic({timing:'现在可做'})),/来自用户/);
  assert.throws(()=>createFields(topic({timing:'自动判断',timing_source:'user'})),/四种值/);
});
test('新链接使用序号，追加保持旧文本完整并继续编号',()=>{
  assert.match(createFields(topic()).参考笔记,/^\[①\]/);
  const old='原有说明\n[原来标题]('+a+')';
  assert.equal(appendReferenceText(old,[{url:b}]),old+'\n[②]('+b+')');
});
test('已有记录追加不静默更改分类和制作时机',()=>{
  assert.throws(()=>buildPlan({topics:[topic({merge_into:row.record_id,timing:'现在可做',timing_source:'user'})]},[row]),/追加参考只更新/);
});
test('确认摘要错误或确认后参考被其他操作改变则拒绝提交准备',()=>{
  const plan=buildPlan({topics:[topic({references:[{title:'B',url:b,evidence_status:'title_only'}]})]},[row]);
  assert.throws(()=>prepareCommit(plan,'wrong',[row]),/确认摘要/);
  assert.throws(()=>prepareCommit(plan,plan.digest,[{...row,参考笔记:'被改动的内容'}]),/参考笔记.*已改变/);
});
test('已有输出不覆盖，越界输出不创建',()=>{
  const folder=path.join('work','output-safety-'+crypto.randomUUID()),file=path.join(folder,'existing.json');
  saveNewJSON(file,{keep:'original'});
  const before=fs.readFileSync(file,'utf8');
  assert.throws(()=>saveNewJSON(file,{keep:'overwritten'}),/拒绝覆盖/);
  assert.equal(fs.readFileSync(file,'utf8'),before);
  assert.throws(()=>saveNewJSON(path.join('outputs','unauthorized-audit-output.json'),{}),/work 目录/);
});
