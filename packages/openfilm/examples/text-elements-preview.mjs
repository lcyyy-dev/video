import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { readTextElementLibrary as getTextElementLibrary } from '../src/text-elements-node.mjs';
import { weightedElementIndex, textColorContrast, contrastingTextPairs } from '../src/text-element-weights.mjs';
import { bundledTextFonts } from '../studio/server/text-fonts.mjs';
const output = resolve(process.argv[2] ?? 'packages/openfilm/examples/text-elements-preview.html');
export function renderTextElementsPreview(library = getTextElementLibrary()) {
const fontCss = bundledTextFonts().filter(f => library.elements.fonts.some(item => item.family === f.family)).map(f => `@font-face{font-family:${JSON.stringify(f.family)};src:url(${JSON.stringify(relative(dirname(output), f.path).split('\\').join('/'))}) format(${JSON.stringify(f.format)});font-display:swap}`).join('\n');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenFilm 文字元素与权重</title>
<style>${fontCss}
*{box-sizing:border-box}body{margin:0;background:#10131b;color:#eef2fa;font:15px/1.6 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:40px 24px}h1{font-size:32px;margin:0}h2{margin:32px 0 12px}p,.muted{color:#a9b4c8}button,input{font:inherit}button{background:#b8cdfc;color:#10203d;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}input[type=number]{width:90px;background:#10131b;color:white;border:1px solid #52627d;border-radius:6px;padding:6px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}.card{padding:18px;background:#1b2230;border:1px solid #344155;border-radius:12px}.sample{height:100px;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#667084 0 25%,#8390a4 0 50%) 0/24px 24px;border-radius:8px;margin-bottom:12px;font-size:32px;font-weight:bold}.meta{font-size:13px;color:#a9b4c8}.controls{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}.prob{float:right;color:#b8cdfc}#preview{min-height:180px;display:flex;align-items:center;justify-content:center;border:1px solid #52627d;border-radius:12px;background:#39465c;font-size:52px;font-weight:bold;padding:24px;text-align:center;overflow-wrap:anywhere}#message{color:#ffb9a9;min-height:24px}#copy{width:100%;padding:12px;border-radius:8px;border:1px solid #52627d;background:#1b2230;color:white}code{color:#bfd4ff}label{display:block;margin-top:10px}
</style><main><h1>文字元素 · 抽取权重</h1><p>${library.elements.fonts.length} 种字体 × ${library.elements.colors.length} 种填充色 × ${library.elements.strokes.length} 种描边，共 ${library.elements.fonts.length * library.elements.colors.length * library.elements.strokes.length} 种原始组合。自动抽取过滤文字与描边对比度低于 3:1 的组合，避免相近颜色；有效颜色组合按两项权重乘积重新归一化。样式预设的明确选择不受随机权重影响。</p><p>卡片显示库内基础权重占比；文字颜色和描边的实际概率受对比度过滤影响。权重 0 表示禁用，每库至少保留一个正权重。默认均为 1。字号默认 88、加粗开启；字号和位置由实际排版决定。</p><p id="save-status" role="status"></p><div id="pools"></div><h2>空元素库</h2><p>阴影（shadows）：0 项；类型（types）：0 项。当前不参与抽取。</p><h2>试抽组合</h2><input id="copy" aria-label="预览文字" value="每天进步一点点"><div class="controls"><button id="sample">按当前权重试抽</button><button id="export">导出完整元素配置</button><button id="reset">恢复等概率</button></div><p class="muted">通过本地服务打开时，权重调整后自动保存到真实元素库，并用于后续自动抽取。双击本文件将跳转到本地编辑器。</p><div id="message" role="status"></div><div id="preview"></div><p id="result" class="muted"></p></main>
<script type="module">
let library = ${JSON.stringify(library).replaceAll('<', '\\u003c')};
const live = location.protocol === 'http:' && Boolean(window.elementSaveToken);
if(!live){location.replace('http://127.0.0.1:8793/examples/text-elements-preview.html');throw new Error('正在打开真实元素库编辑器');}
const saveStatus=document.getElementById('save-status');
let revision=null, saving=false, changed=0, saved=0;
if(live){try{const response=await fetch('/api/elements',{cache:'no-store'});if(!response.ok)throw new Error('读取失败');const data=await response.json();library=data.library;revision=data.revision;saveStatus.textContent='已连接真实元素库 · 修改后自动保存';}catch(error){saveStatus.textContent='读取失败：'+error.message;throw error;}}
else {saveStatus.innerHTML='未连接真实元素库，已禁止编辑。<a href="http://127.0.0.1:8793/examples/text-elements-preview.html">打开可自动保存的编辑器</a>';}
function scheduleSave(){changed++;if(!live)return;saveStatus.textContent='有未保存的修改';void saveWeights();}
async function saveWeights(){
 if(!live||saving||changed===saved)return;
 if(document.getElementById('sample').disabled){saveStatus.textContent='配置无效，尚未保存';return;}
 saving=true;const current=changed;saveStatus.textContent='正在保存…';
 try{const response=await fetch('/api/elements',{method:'PUT',keepalive:true,headers:{'content-type':'application/json','x-element-token':window.elementSaveToken},body:JSON.stringify({weights:library.weights,revision})});const data=await response.json();if(!response.ok)throw new Error(data.error||'保存失败');revision=data.revision;saved=current;saveStatus.textContent=changed===saved?'已保存到真实元素库 · '+new Date().toLocaleTimeString():'有未保存的修改';}
 catch(error){saveStatus.textContent='未保存：'+error.message;saving=false;return;}
 saving=false;if(changed!==saved)void saveWeights();
}
document.getElementById('reset').disabled=!live;
window.addEventListener('beforeunload',event=>{if(live&&changed!==saved){event.preventDefault();event.returnValue='';}});
const weightedElementIndex = ${weightedElementIndex.toString()};
const textColorContrast = ${textColorContrast.toString()};
const contrastingTextPairs = ${contrastingTextPairs.toString()};
const getPairs = () => contrastingTextPairs(library.elements.colors,library.elements.strokes,library.weights.colors,library.weights.strokes);
const titles = { fonts:'字体 · '+library.elements.fonts.length+' 项', colors:'文字颜色 · '+library.elements.colors.length+' 项', strokes:'描边 · '+library.elements.strokes.length+' 项' };
const key = (pool,item) => pool==='fonts'?item.id:pool==='colors'?item:item.color+':'+item.width;
const pools=document.getElementById('pools');
let selected=null;
for(const pool of Object.keys(titles)){
 const section=document.createElement('section');const title=document.createElement('h2');title.textContent=titles[pool];section.append(title);const grid=document.createElement('div');grid.className='grid';section.append(grid);pools.append(section);
 library.elements[pool].forEach(item=>{
  const id=key(pool,item), card=document.createElement('article');card.className='card';
  const sample=document.createElement('div');sample.className='sample';sample.textContent=pool==='fonts'?'文字样本':'文字';
  if(pool==='fonts')sample.style.fontFamily=item.family;
  if(pool==='colors')sample.style.color=item;
  if(pool==='strokes'){sample.style.color='#fff';sample.style.webkitTextStroke=(item.width/4)+'px '+item.color;sample.style.paintOrder='stroke fill';}
  const name=document.createElement('strong');name.textContent=pool==='fonts'?item.name:pool==='colors'?item:item.color+' · '+item.width+' px';
  const meta=document.createElement('div');meta.className='meta';meta.textContent=id;
  const label=document.createElement('label');label.append('权重 ');const input=document.createElement('input');input.type='number';input.disabled=!live;input.min='0';input.step='any';input.value=library.weights[pool][id];input.setAttribute('aria-label',name.textContent+' 权重');
  const prob=document.createElement('span');prob.className='prob';prob.dataset.pool=pool;prob.dataset.key=id;
  input.oninput=()=>{library.weights[pool][id]=input.value.trim()===''?NaN:Number(input.value);refresh();scheduleSave();};label.append(input,prob);card.append(sample,name,meta,label);grid.append(card);
 });
}
function refresh(){
 let error='';for(const pool of Object.keys(titles)){
  const values=Object.values(library.weights[pool]),total=values.reduce((a,b)=>a+b,0),valid=values.every(w=>Number.isFinite(w)&&w>=0)&&Number.isFinite(total)&&total>0;
  if(!valid)error='请检查'+titles[pool]+'：权重须为非负有限数，且总和大于 0。';
  document.querySelectorAll('.prob').forEach(el=>{if(el.dataset.pool===pool)el.textContent=valid?(library.weights[pool][el.dataset.key]/total*100).toFixed(2)+'%':'无效';});
 }if(!error){try{getPairs();}catch(e){error=e.message;}}document.getElementById('message').textContent=error;document.getElementById('sample').disabled=!!error;document.getElementById('export').disabled=!!error;
 if(selected&&!error){const pairs=getPairs(),pair=pairs.find(p=>p.color===selected.colors&&p.stroke.color===selected.strokes.color),fontTotal=Object.values(library.weights.fonts).reduce((a,b)=>a+b,0);const probability=library.weights.fonts[selected.fonts.id]/fontTotal*(pair?.weight??0)/pairs.reduce((a,p)=>a+p.weight,0);document.getElementById('result').textContent=selected.fonts.name+' / '+selected.colors+' / 描边 '+selected.strokes.color+' · 对比度 '+textColorContrast(selected.colors,selected.strokes.color).toFixed(2)+':1 · 当前组合概率 '+(probability*100).toFixed(4)+'%';}
}
function draw(){const seed=Date.now()+'-'+Math.random();const fonts=library.elements.fonts,pairs=getPairs(),pair=pairs[weightedElementIndex(pairs.map(p=>p.weight),seed+':pair')];selected={fonts:fonts[weightedElementIndex(fonts.map(f=>library.weights.fonts[f.id]),seed+':font')],colors:pair.color,strokes:pair.stroke};const preview=document.getElementById('preview');preview.style.fontFamily=selected.fonts.family;preview.style.color=selected.colors;preview.style.webkitTextStroke=(selected.strokes.width*52/88)+'px '+selected.strokes.color;preview.style.paintOrder='stroke fill';preview.textContent=document.getElementById('copy').value;refresh();}
document.getElementById('sample').onclick=draw;document.getElementById('copy').oninput=()=>{document.getElementById('preview').textContent=document.getElementById('copy').value;};
document.getElementById('reset').onclick=()=>{for(const weights of Object.values(library.weights))for(const id of Object.keys(weights))weights[id]=1;document.querySelectorAll('input[type=number]').forEach(el=>el.value=1);refresh();scheduleSave();};
document.getElementById('export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(library,null,2)+'\\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='text-elements.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};refresh();if(!document.getElementById('sample').disabled)draw();
</script></html>`;
return html;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  writeFileSync(output, renderTextElementsPreview());
  console.log(output);
}
