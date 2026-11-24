import test from 'node:test';
import assert from 'node:assert/strict';
import {createFields,buildPlan} from '../scripts/topic-store.mjs';
import {parseShares} from '../scripts/parse-shares.mjs';
const topic={direction:'Skill 选择方法',category:'Skill',references:[{title:'虚构参考',url:'https://www.xiaohongshu.com/explore/000000000000000000000001',evidence_status:'title_only'}]};
test('公开版使用新版字段与单选值结构',()=>{
 const fields=createFields(topic);
 assert.equal(fields.选题名称,topic.direction);
 assert.deepEqual(fields.合集,['Skill']);assert.deepEqual(fields.选题方向,['干货合集']);
 assert.equal(Object.hasOwn(fields,'旧版工具列'),false);
 assert.equal(buildPlan({topics:[topic]},[]).operations[0].action,'create');
 assert.deepEqual(createFields({...topic,content_type:'成长记录'}).选题方向,['成长记录']);
 assert.throws(()=>createFields({...topic,content_type:'其他'}));
});
test('追加不允许静默修改选题方向',()=>{
 const row={record_id:'rec-fiction',选题名称:topic.direction,参考笔记:''};
 assert.throws(()=>buildPlan({topics:[{...topic,category:'',content_type:'成长记录'}]},[row]),/追加参考只更新/);
});
test('还原签名中的 Markdown 下划线转义',()=>{
 const input='【示例 - 作者 | 小红书】 https://www.xiaohongshu.com/explore/000000000000000000000001?xsec_token=fake\\_token';
 assert.match(parseShares(input).groups[0].references[0].url,/fake_token$/);
});
