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
  for (const license of licenses.filter(l => `${l.name} ${l.id} ${l.key}`.toLowerCase().includes(filter))) {
    const row = document.createElement('tr');
    const identity = cell(row, license.name || '未填写备注'); const id = document.createElement('code'); id.textContent = license.id; identity.append(document.createElement('br'), id);
    cell(row, license.suspended ? '已停用' : license.expiry && new Date(license.expiry) < new Date() ? '已到期' : '有效'); cell(row, license.mapped ? '已关联（Key 隐藏）' : '未关联，无法调用');
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
async function reload() {
  const state = await api('state'); licenses = state.licenses;
  const selected = $('#policy').value; $('#policy').replaceChildren();
  for (const policy of state.policies) { const option = document.createElement('option'); option.value = policy.id; option.textContent = `${policy.name}（设备上限 ${policy.maxMachines ?? '未设置'}）`; $('#policy').append(option); }
  if (state.policies.some(p => p.id === selected)) $('#policy').value = selected;
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
$('#login-form').onsubmit = event => { event.preventDefault(); run(async () => { const result = await api('login', 'POST', Object.fromEntries(new FormData(event.target))); csrf = result.csrf; event.target.reset(); showWorkspace(); await reload(); message('登录成功'); }); };
$('#issue-form').onsubmit = event => { event.preventDefault(); run(async () => { const result = await api('issue', 'POST', Object.fromEntries(new FormData(event.target))); event.target.elements.apiKey.value = ''; await reload(); showCode(result.activationCode); message('授权已创建并关联用户 Key'); }); };
$('#mapping-form').onsubmit = event => { event.preventDefault(); run(async () => { const data = Object.fromEntries(new FormData(event.target)); await api(`licenses/${data.id}/mapping`, 'POST', data); event.target.reset(); $('#mapping-dialog').close(); await reload(); message('映射已保存'); }); };
$('#refresh').onclick = () => run(reload);
$('#search').oninput = render;
$('#logout').onclick = () => run(async () => { await api('logout', 'POST', {}); csrf = ''; licenses = []; $('#licenses').replaceChildren(); showLogin(); message('已退出'); });
$('#copy-code').onclick = () => run(async () => { await navigator.clipboard.writeText($('#activation-code').value); message('激活码已复制'); });
document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });
run(async () => { try { csrf = (await api('session')).csrf; showWorkspace(); await reload(); } catch { showLogin(); } });
