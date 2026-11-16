const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const root = path.join(repo, 'hr-system-manual');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const baseline = execFileSync('git', ['show', 'd614813:hr-system-manual/index.html'], {cwd: repo, encoding:'utf8', maxBuffer:4e6}).replace(/\r\n/g,'\n');

function panels(source) {
  return [...source.matchAll(/<div class="panel gif-panel"[^>]*>/g)].map(match => {
    let depth=0;
    for (const tag of source.slice(match.index).matchAll(/<div\b[^>]*>|<\/div>/g)) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      if (!depth) return source.slice(match.index,match.index+tag.index+tag[0].length);
    }
    throw Error('Unclosed GIF panel');
  });
}
assert.deepEqual(panels(html), panels(baseline), 'GIF panels or their captions changed');
const playerProgram = source => source.slice(source.indexOf('  function formatGifTime(ms)'), source.indexOf('  const detailedGuideOperationTitles'));
assert(playerProgram(html).length > 1000, 'GIF player program not found');
assert.equal(playerProgram(html),playerProgram(baseline),'GIF playback or step navigation logic changed');
for (const [start,end] of [
  ['<div class="panel"><div class="panel-title" data-nav-item data-nav-label="结果处理：录用审批、Offer邮件与结果登记">','<div class="panel field-panel"><div class="panel-title">终止投递需要理解的字段与按钮'],
  ['<div class="panel"><div class="panel-title" data-nav-item data-nav-label="Offer">','<div class="panel field-panel"><div class="panel-title">终止投递需要理解的字段与按钮'],
  ['<section class="module" id="function-email-templates"','</section>'],
]) {
  const extract = source => { const a=source.indexOf(start); assert(a>=0); const b=source.indexOf(end,a); assert(b>a); return source.slice(a,b); };
  const normalize = value => value.replace(/<span class="module-num">功能 \/ \d+<\/span>/, '<span class="module-num">CHAPTER</span>');
  assert.equal(normalize(extract(html)),normalize(extract(baseline)),'Published Offer lesson changed');
}
const changed=execFileSync('git',['diff','--name-only','d614813'],{cwd:repo,encoding:'utf8'}).trim().split('\n');
assert(!changed.some(f=>/\.gif$|\/gif-player\/|\/offer-assets\//.test(f)), 'Protected media files changed');
// Inline programs must compile and embedded data must remain valid JSON.
for(const [,attrs,code] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if(attrs.includes('application/json')) JSON.parse(code);
  else if(code.trim()) new vm.Script(code);
}
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'Duplicate HTML ids');
for(const [,id] of html.matchAll(/href="#([^"]+)"/g)) assert(ids.includes(id),'Broken anchor: '+id);
for(const [,src] of html.matchAll(/(?:src|data-zoom)="([^"]+)"/g)) {
  if(!/^(https?:|data:|#)/.test(src)) assert(fs.existsSync(path.join(root,src)), 'Missing asset: '+src);
}
const data=JSON.parse(html.match(/<script id="manualUpdatesData" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const reader=html.match(/  function readManualUpdateData\(\) \{[\s\S]*?(?=\n  function validManualUpdateTarget)/)[0];
const version=JSON.parse(fs.readFileSync(path.join(root,'version.json'),'utf8'));
assert.equal(version.status,'published');
assert.equal(version.latestUpdateId,'2026-11-12-simplified-recruitment-workspace');
assert.equal(data.latestUpdateId,version.latestUpdateId);
assert(!data.previewUpdateId);
assert.equal(data.updates.find(u=>u.id===data.latestUpdateId).status,'published');
for(const [protocol,hostname,preview] of [['file:','',true],['http:','127.0.0.1',true],['http:','localhost',true],['https:','c666shiwo.github.io',false]]) {
  const sandbox={window:{location:{protocol,hostname}}, document:{getElementById:()=>({textContent:JSON.stringify(data)})}, updateTypeLabels:{'new-feature':1,'feature-change':1,'rule-change':1,'bug-fix':1},updateImportanceLabels:{info:1,action:1,critical:1},updateScopeLabels:{'new-data':1,'existing-data':1,all:1}};
  const result=vm.runInNewContext(reader+';readManualUpdateData()',sandbox);
  assert(result, 'Update reader returned no data');
  assert.equal(result.latest.id,data.latestUpdateId,'Incorrect update visible on '+hostname);
  if(!preview) assert(!result.allUpdates.some(u=>u.status==='draft'),'Draft leaked into published notices');
}
for(const entry of data.updates) for(const t of entry.targets) {
  const start=html.indexOf('id="'+t.moduleId+'"'); assert(start>=0,'Missing update module: '+t.moduleId);
  const section=html.slice(start,html.indexOf('</section>',start));
  assert(section.includes('data-nav-label="'+t.detailLabel+'"'),'Invalid update target: '+t.detailLabel);
}
const screenshots=[...html.matchAll(/src="(simplified-assets\/[^\"]+\.png)"/g)].map(m=>m[1]);
const provenance=JSON.parse(fs.readFileSync(path.join(root,'simplified-assets/capture-provenance.json'),'utf8'));
for(const src of screenshots) {
  const evidence=provenance.captures.find(c=>'simplified-assets/'+c.file===src);
  assert(evidence&&evidence.sourceSha256&&evidence.url.startsWith('https://dev-hr.91jzx.cn/'),'Missing true-system provenance: '+src);
}
assert(!html.includes('@@PRESERVE_'),'Temporary content marker remains');
console.log(JSON.stringify({result:'PASS',gifPanels:panels(html).length,preservedOfferLessons:3,realScreenshots:new Set(screenshots).size,updateTargets:data.updates.reduce((n,u)=>n+u.targets.length,0),publishedNoticeVisibleOnAllHosts:true},null,2));
