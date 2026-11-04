const $ = selector => document.querySelector(selector);
let csrf = '', licenses = [];
const message = text => { $('#message').textContent = text; };
async function api(path, method = 'GET', body) {
  const response = await fetch(`/admin/${path}`, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (response.status === 401) showLogin();
  if (!response.ok) throw new Error(value.error || '操作失败');
  return value;
}
function showLogin() { $('#workspace').hidden = true; $('#logout').hidden = true; $('#login').hidden = false; }
function showWorkspace() { $('#workspace').hidden = false; $('#logout').hidden = false; $('#login').hidden = true; }
async function run(task) {
  const buttons = [...document.querySelectorAll('button')]; buttons.forEach(b => { b.disabled = true; });
  try { await task(); } catch (e) { message(e.message); } finally { buttons.forEach(b => { b.disabled = false; }); }
}
const cell = (row, text) => { const td = document.createElement('td'); td.textContent = text; row.append(td); return td; };
const button = (parent, text, action, danger = false) => { const b = document.createElement('button'); b.textContent = text; if (danger) b.className = 'danger'; b.onclick = () => run(action); parent.append(b); };
function showCode(code) { $('#activation-code').value = code; $('#code-dialog').showModal(); }
function render() {
  const filter = $('#search').value.toLowerCase(); $('#licenses').replaceChildren();
  for (const license of licenses.filter(l => `${l.username ?? ''} ${l.userId ?? ''} ${l.name} ${l.id} ${l.key}`.toLowerCase().includes(filter))) {
    const row = document.createElement('tr');
    const identity = cell(row, [license.username, license.userId, license.name].filter(Boolean).join(' · ') || '未填写备注'); const id = document.createElement('code'); id.textContent = license.id; identity.append(document.createElement('br'), id);
    cell(row, license.suspended ? '已停用' : license.expiry && new Date(license.expiry) < new Date() ? '已到期' : '有效'); cell(row, license.mapped ? `已关联 · 指纹 ${license.keyRef??''}` : '未关联，无法调用');
    cell(row, license.expiry ? new Date(license.expiry).toLocaleString() : '长期');
    const actions = cell(row, ''); actions.className = 'actions';
    button(actions, '激活码', () => showCode(license.key));
    button(actions, '编辑映射', () => { const form = $('#mapping-form'); form.elements.id.value = license.id; form.elements.name.value = license.name; form.elements.apiKey.value = ''; $('#mapping-dialog').showModal(); });
    button(actions, '设备', () => showDevices(license.id));
    button(actions, license.suspended ? '恢复授权' : '停用授权', async () => {
      if (!confirm(`确认${license.suspended ? '恢复' : '停用'}此授权？`)) return;
      await api(`licenses/${license.id}/${license.suspended ? 'reinstate' : 'suspend'}`, 'POST', {}); await reload(); message('授权状态已更新');
    }, !license.suspended);
    if (license.mapped) button(actions, '移除映射', async () => { if (!confirm('移除后该授权立即无法调用模型，确认移除？')) return; await api(`licenses/${license.id}/mapping`, 'DELETE', {}); await reload(); message('已移除映射'); }, true);
    $('#licenses').append(row);
  }
}
async function reload() { await loadPage(); }
async function reloadState() {
  const state = await api('state'); licenses = state.licenses;
  const selected = $('#policy').value; $('#policy').replaceChildren();
  for (const policy of state.policies) { const option = document.createElement('option'); option.value = policy.id; option.textContent = `${policy.name}（设备上限 ${policy.maxMachines ?? '未设置'}）`; $('#policy').append(option); }
  if (state.policies.some(p => p.id === selected)) $('#policy').value = selected;
  renderLicenseOptions();
  render();
}
async function showDevices(id) {
  const result = await api(`licenses/${id}/devices`); $('#devices').replaceChildren();
  if (!result.devices.length) $('#devices').textContent = '尚未绑定设备';
  for (const device of result.devices) {
    const box = document.createElement('p'); const code = document.createElement('code'); code.textContent = device.fingerprint; box.append(code, document.createElement('br'));
    button(box, '解绑此设备', async () => { if (!confirm('确认解绑？旧设备将立即失去访问权限。')) return; await api(`licenses/${id}/devices`, 'DELETE', { deviceId: device.id }); await showDevices(id); message('设备已解绑，可以在新电脑激活'); }, true); $('#devices').append(box);
  }
  if (!$('#devices-dialog').open) $('#devices-dialog').showModal();
}
$('#issue-form').onsubmit = event => { event.preventDefault(); run(async () => { const result = await api('issue', 'POST', Object.fromEntries(new FormData(event.target))); event.target.elements.apiKey.value = ''; await reload(); showCode(result.activationCode); message('授权已创建并关联用户 Key'); }); };
$('#mapping-form').onsubmit = event => { event.preventDefault(); run(async () => { const data = Object.fromEntries(new FormData(event.target)); await api(`licenses/${data.id}/mapping`, 'POST', data); event.target.reset(); $('#mapping-dialog').close(); await reload(); message('映射已保存'); }); };
$('#refresh').onclick = () => run(reload);
$('#search').oninput = render;
$('#logout').onclick = () => run(async () => { await api('logout', 'POST', {}); csrf = ''; licenses = []; $('#licenses').replaceChildren(); showLogin(); message('已退出'); });
$('#copy-code').onclick = () => run(async () => { await navigator.clipboard.writeText($('#activation-code').value); message('激活码已复制'); });
document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });

const sourceNames={gateway:'网关',monitor:'链路监测',tunnel:'外部软件',admin:'管理'};
const eventNames={'auth.activate':'激活','request.start':'请求开始','request.complete':'请求结束','request.error':'请求错误','upstream.keygen':'授权校验','upstream.keygen_error':'授权服务错误','upstream.response':'上游响应','upstream.error':'上游错误','link.probe':'连通性探测','link.summary':'连接诊断','external.line':'外部软件日志','monitor.started':'监测启动'};
const diagnoses={local_gateway_unavailable:'本机网关不可达：优先检查网关、宿主机或容器网络',public_not_configured:'尚未配置公网监测地址',public_path_unavailable:'本机正常，公网不可达：检查穿透、代理、DNS、证书或服务器网络',both_reachable:'本机和公网入口当前均可达'};
let currentPage='licenses';
const logViews={logs:{cursor:null,query:null,version:0},diag:{cursor:null,query:null,version:0}};
function renderLicenseOptions(){const input=$('#logs-license'),previous=input.value;input.replaceChildren(new Option('全部用户',''));for(const license of licenses)input.append(new Option(`${license.name||license.id} · ${license.keyRef||'未关联 Key'}`,license.id));if(licenses.some(l=>l.id===previous))input.value=previous;}
function localDate(value){return new Date(value-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16);}
function logQuery(prefix){
 const params=new URLSearchParams({limit:'100',scope:prefix==='logs'?'calls':'diagnostics'});
 for(const [suffix,key] of [['from','from'],['to','to']])if($('#'+prefix+'-'+suffix).value)params.set(key,new Date($('#'+prefix+'-'+suffix).value).toISOString());
 for(const [suffix,key] of [['source','source'],['search','q']])if($('#'+prefix+'-'+suffix).value)params.set(key,$('#'+prefix+'-'+suffix).value);
 if(prefix==='logs'&&$('#logs-license').value)params.set('license',$('#logs-license').value);
 if($('#'+prefix+'-errors').checked)params.set('errors','true');return params;
}
async function loadLogs(prefix='logs',append=false){
 const view=logViews[prefix],version=++view.version;
 try{
  const query=append&&view.query?new URLSearchParams(view.query):logQuery(prefix);if(append&&view.cursor)query.set('cursor',view.cursor);if(!append)view.query=query.toString();
  const result=await api('logs?'+query);if(version!==view.version)return;
  $('#'+prefix+'-error').textContent='';if(!append)$('#'+prefix+'-rows').replaceChildren();
  for(const event of result.events){
   const row=document.createElement('tr');cell(row,new Date(event.time).toLocaleString());
   cell(row,`${sourceNames[event.source]||event.source} · ${eventNames[event.event]||event.event}`);
   cell(row,prefix==='logs'?(event.licenseId?`${event.userName||event.licenseId}\nKey 指纹 ${event.keyRef||'未知'}`:'—'):(event.target||event.file||'—'));
   cell(row,`${event.level} · ${event.outcome||''} ${event.status??event.upstreamStatus??''}\n${event.durationMs??event.firstByteMs??'—'} ms`);
   cell(row,[event.stage&&`阶段 ${event.stage}`,event.path,event.requestId&&`请求 ${event.requestId}`,event.errorCode,event.reason,event.keygenCode,event.diagnosis&&diagnoses[event.diagnosis],event.streamOutcome&&`流 ${event.streamOutcome}`,event.bytes!==undefined&&`${event.bytes} bytes`,event.activationRef&&`激活码指纹 ${event.activationRef}`,event.fingerprint&&`设备 ${event.fingerprint}`,event.peer&&`连接来源 ${event.peer}`,event.sourceTime&&`原始时间 ${event.sourceTime}`,event.message].filter(Boolean).join(' · '));
   if(event.level!=='info')row.style.background=event.level==='error'?'#fff0f0':'#fff9e8';$('#'+prefix+'-rows').append(row);
  }
  view.cursor=result.nextCursor;$('#'+prefix+'-more').hidden=!view.cursor;$('#'+prefix+'-summary').textContent=`${$('#'+prefix+'-rows').children.length} 条记录 · PostgreSQL`;
 }catch(error){if(version===view.version)$('#'+prefix+'-error').textContent='日志读取失败：'+error.message;}
}
async function loadDiagnostics(){
 try{const result=await api('diagnostics'),latest=result.latest;
  $('#diagnostics').textContent=latest?`${diagnoses[latest.diagnosis]||latest.diagnosis}\n探测时间：${new Date(latest.time).toLocaleString()}${Date.now()-Date.parse(latest.time)>120000?'（数据已过期，请检查监测服务）':''}\n${result.probes.map(p=>`${p.target==='local'?'本机':'公网'}：${p.status??p.errorCode??p.outcome} · ${p.durationMs} ms`).join('；')}`:'尚无链路监测记录，请确认监测服务已启动。';
  $('#storage-status').textContent=`日志存储：${result.storage.engine} · 共 ${result.storage.eventCount} 条`;
 }catch(error){$('#diagnostics').textContent='诊断读取失败：'+error.message;}
}
async function loadPage(){
 if(currentPage==='licenses')await reloadState();
 else if(currentPage==='logs')await Promise.all([loadLogs('logs'),api('state').then(state=>{licenses=state.licenses;renderLicenseOptions();}).catch(()=>{})]);
 else await Promise.all([loadDiagnostics(),loadLogs('diag')]);
}
async function navigate(path,replace=false){
 const next=path==='/logs'?'logs':path==='/diagnostics'?'diagnostics':'licenses';currentPage=next;
 const canonical='/'+next;if(location.pathname!==canonical){history[replace?'replaceState':'pushState']({},'',canonical);}
 document.querySelectorAll('[data-page]').forEach(panel=>panel.hidden=panel.dataset.page!==next);
 document.querySelectorAll('[data-route]').forEach(link=>{if(link.dataset.route===next)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
 document.title=({licenses:'授权管理',logs:'调用日志',diagnostics:'连接诊断'}[next])+' · OpenFilm';message('');
 if(!$('#workspace').hidden)await loadPage();
}
for(const prefix of ['logs','diag']){
 $('#'+prefix+'-from').value=localDate(Date.now()-86400000);
 $('#'+prefix+'-filter').onsubmit=event=>{event.preventDefault();void loadLogs(prefix);};
 $('#'+prefix+'-refresh').onclick=()=>{void loadLogs(prefix);if(prefix==='diag')void loadDiagnostics();};
 $('#'+prefix+'-more').onclick=()=>loadLogs(prefix,true);
}
document.querySelectorAll('[data-route]').forEach(link=>link.onclick=event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();void run(()=>navigate(link.pathname));});
window.addEventListener('popstate',()=>void run(()=>navigate(location.pathname,true)));
setInterval(()=>{if($('#workspace').hidden||document.hidden||currentPage==='licenses')return;const prefix=currentPage==='logs'?'logs':'diag';if($('#'+prefix+'-auto').checked){void loadLogs(prefix);if(prefix==='diag')void loadDiagnostics();}},10000);
// Keep the requested URL across login and browser refresh.
const showReady=async()=>{showWorkspace();await navigate(location.pathname,true);};
$('#login-form').onsubmit=event=>{event.preventDefault();run(async()=>{const result=await api('login','POST',Object.fromEntries(new FormData(event.target)));csrf=result.csrf;event.target.reset();await showReady();message('登录成功');});};
run(async()=>{try{csrf=(await api('session')).csrf;}catch{showLogin();return;}await showReady();});
