import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Offline extraction only. Titles are data, never instructions to execute.
function captionSpans(text) {
  const spans=[];let depth=0,start=0;
  for(let i=0;i<text.length;i++) {
    if(text[i]==='【'){if(depth===0)start=i;depth++;}
    else if(text[i]==='】' && depth>0){depth--;if(depth===0)spans.push({start,end:i+1,closed:true});}
  }
  if(depth>0)spans.push({start,end:text.length,closed:false});
  return spans;
}
function normalizeShareText(text) {
  // Remove Markdown transport escapes, not percent-encoding or URL parameters.
  text=text.replace(/\\([:./&_])/g,'$1');
  return text.replace(/\[([^\]\n]*)\]\((https:\/\/[^\s)]+)\)/g,(wrapper,label,url)=>{
    let parsed;
    try {parsed=new URL(url);} catch {return wrapper;}
    if(!(parsed.hostname==='xiaohongshu.com'||parsed.hostname.endsWith('.xiaohongshu.com')||parsed.hostname==='xhslink.com'||parsed.hostname.endsWith('.xhslink.com'))) return wrapper;
    return /^https?:\/\//.test(label.trim())?url:`【${label}】 ${url}`;
  });
}
export function extractShares(text) {
  if(typeof text!=='string') throw new Error('分享内容必须是文字。');
  text=normalizeShareText(text);
  const references=[];
  const captions=captionSpans(text);
  let previousEnd=0;
  const pattern=/https:\/\/(?:[\w-]+\.)*(?:xiaohongshu\.com|xhslink\.com)(?=[:/\s]|$)(?::\d+)?[^\s<>"【】\[\]()（）、，。；]*/g;
  for(const match of text.matchAll(pattern)) {
    if(captions.some(span=>span.closed && match.index>=span.start && match.index<span.end))continue;
    const url=match[0],prefix=text.slice(previousEnd,match.index);
    previousEnd=match.index+url.length;
    const lastCaption=captionSpans(prefix).filter(span=>span.closed).at(-1);
    let caption=lastCaption?prefix.slice(lastCaption.start+1,lastCaption.end-1).trim():'';
    if(!caption) caption=prefix.match(/(?:^|\n)\s*标题[：:]\s*([^\n]+)\s*$/)?.[1]?.trim() || '';
    const platformSuffix=/\s*\|\s*小红书(?:\s*[-—].*)?$/;
    const hasPlatformSuffix=platformSuffix.test(caption);
    caption=caption.replace(platformSuffix,'').trim();
    // A spaced separator belongs to the share format; bare hyphens in names stay.
    const separator=hasPlatformSuffix?caption.lastIndexOf(' - '):-1;
    const title=(separator>=0?caption.slice(0,separator):caption).trim();
    const author=separator>=0?caption.slice(separator+3).trim():'';
    references.push({title: title||null,author:author||null,url,evidence_status:'title_only',needs_title:!title});
  }
  return references;
}

export function parseShares(text) {
  if(typeof text!=='string') throw new Error('分享内容必须是文字。');
  text=normalizeShareText(text);
  // Group instructions must be outside copied titles, including multiline captions.
  let groupingText=text;
  for(const span of captionSpans(text))groupingText=groupingText.slice(0,span.start)+text.slice(span.start,span.end).replace(/[^\r\n]/g,' ')+groupingText.slice(span.end);
  groupingText=groupingText.replace(/(?:^|\n)[ \t]*标题[：:][^\n]*/g,caption=>caption.replace(/[^\r\n]/g,' '));
  // Only explicit group headings establish group membership; never infer it from URL count.
  const headings=[...groupingText.matchAll(/(?:^|\s)(?:#{1,6}\s*)?((?:选题|组)\s*(?:[A-Za-zＡ-Ｚａ-ｚ]|[0-9一二三四五六七八九十]+)|第\s*[0-9一二三四五六七八九十]+\s*组)([^\n\r:：/<>]{0,60})[：:]/g)];
  if(headings.length) {
    const groups=headings.map((heading,i)=>({
      label:heading[1].trim(),description:heading[2].trim(),
      references:extractShares(text.slice(heading.index+heading[0].length,headings[i+1]?.index ?? text.length)),
    }));
    const unassigned=extractShares(text.slice(0,headings[0].index));
    return {grouping:'explicit',groups,unassigned,needs_grouping_confirmation:false};
  }
  const references=extractShares(text);
  const oneGroup=groupingText.split(/\r?\n/).some(line=>/^(?:以下|下面|这些|这)(?:[一二三四五六七八九十两\d]+)?(?:篇|条|个)?(?:参考)?(?:笔记|链接)?(?:都)?(?:是|属于|归为)?(?:同一个|同一|一个)(?:创作)?选题[。.!！]?$/.test(line.trim()));
  if(oneGroup || references.length===1) return {grouping:'explicit',groups:[{label:'选题1',description:'',references}],unassigned:[],needs_grouping_confirmation:false};
  return {grouping:'unconfirmed',groups:[],unassigned:references,needs_grouping_confirmation:references.length>1};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(process.argv[2]!=='--input'||!process.argv[3]||process.argv.length!==4) throw new Error('用法：node scripts/parse-shares.mjs --input 已授权的分享文字文件');
    console.log(JSON.stringify(parseShares(fs.readFileSync(process.argv[3],'utf8').replace(/^\uFEFF/,'')),null,2));
  } catch(error) {console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
}
