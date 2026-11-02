import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { renderTextElementsPreview } from './text-elements-preview.mjs';
import { weightedElementIndex, contrastingTextPairs } from '../src/text-element-weights.mjs';
import { bundledTextFonts } from '../studio/server/text-fonts.mjs';

export function createTextElementsServer({ file = fileURLToPath(new URL('../src/text-elements.json', import.meta.url)) } = {}) {
  const token = randomBytes(32).toString('hex');
  const revision = raw => createHash('sha256').update(raw).digest('hex');
  const fonts = new Map(bundledTextFonts().map(font => [new URL('../fonts/' + font.file, 'http://local/examples/').pathname, font.path]));
  return createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, {'content-type':'application/json', 'cache-control':'no-store'});res.end(JSON.stringify(data)); };
    try {
      const expectedHost = req.headers.host;
      if(![`127.0.0.1:${serverPort(req)}`, `localhost:${serverPort(req)}`].includes(expectedHost)) return send(403,{error:'仅允许本机访问'});
      if(req.url === '/api/elements' && req.method === 'GET') {
        const raw = readFileSync(file,'utf8');return send(200,{library:JSON.parse(raw),revision:revision(raw)});
      }
      if(req.url === '/api/elements' && req.method === 'PUT') {
        if(req.headers['x-element-token'] !== token || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) return send(403,{error:'保存请求来源无效，请刷新页面'});
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16000)return send(413,{error:'配置过大'});}
        const input=JSON.parse(raw), previous=readFileSync(file,'utf8'), library=JSON.parse(previous);
        if(input.revision!==revision(previous))return send(409,{error:'元素库已被其他页面修改，请刷新后重试'});
        const weights=input.weights;
        if(!weights || Object.keys(weights).sort().join()!=='colors,fonts,strokes')return send(400,{error:'权重库无效'});
        const keys={fonts:library.elements.fonts.map(f=>f.id),colors:library.elements.colors,strokes:library.elements.strokes.map(s=>`${s.color}:${s.width}`)};
        for(const [pool, ids] of Object.entries(keys)) {
          if(!weights[pool] || Object.keys(weights[pool]).sort().join()!==[...ids].sort().join())return send(400,{error:'权重元素与真实库不一致，请刷新'});
          weightedElementIndex(ids.map(id=>weights[pool][id]),'validate');
        }
        contrastingTextPairs(library.elements.colors,library.elements.strokes,weights.colors,weights.strokes);
        library.weights=weights;const next=JSON.stringify(library,null,2)+'\n';
        writeFileSync(file+'.tmp',next);renameSync(file+'.tmp',file);
        return send(200,{revision:revision(next)});
      }
      if((req.url==='/'||req.url==='/examples/text-elements-preview.html')&&req.method==='GET'){
        const html=renderTextElementsPreview(JSON.parse(readFileSync(file,'utf8'))).replace('<script type="module">',`<script>window.elementSaveToken=${JSON.stringify(token)}</script><script type="module">`);
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(html);
      }
      if(req.method==='GET'&&fonts.has(req.url)){res.writeHead(200,{'content-type':'application/octet-stream'});return res.end(readFileSync(fonts.get(req.url)));}
      send(404,{error:'页面不存在'});
    }catch(error){send(400,{error:error.message});}
  });
}
function serverPort(req){return req.socket.localPort;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const port=Number(process.env.OPENFILM_ELEMENTS_PORT??8793);
 const server=createTextElementsServer();server.listen(port,'127.0.0.1',()=>console.log(`元素库编辑器：http://127.0.0.1:${port}/examples/text-elements-preview.html`));
}
