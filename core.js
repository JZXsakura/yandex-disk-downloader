/* Common functions for the extension service worker. No data is sent anywhere except Yandex API. */
const API_BASE = 'https://cloud-api.yandex.net/v1/disk';
const DEFAULTS = Object.freeze({
  theme: 'system', mode: 'files', recursive: true, concurrent: 3,
  subfolder: 'Yandex_Disk_Downloader', conflict: 'ask',
  progressPage: true, progressPopup: true, progressDashboard: false,
  buttonPlace: 'float', offsetX: 0, offsetY: 0,
  accentColor: '#7765ed', backgroundColor: '#20202d', notifications: true
});
function sanitizedSegment(s) {
  const v = String(s || 'без имени').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
  return v && v !== '..' ? v.substring(0,180) : 'без имени';
}
function safeFolderPath(s) {
  return String(s || '').split(/[\\/]+/).map(x=>x.trim()).filter(x=>x && x!=='.' && x!=='..').map(sanitizedSegment).join('/');
}
function displayName(path) { return String(path || '').replace(/^.*\//, '') || 'Папка'; }
function id() { return 'yd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,9); }
function parseSource(url) {
  const u = new URL(url);
  if (!/^disk\.yandex\.(ru|com)$/.test(u.hostname)) throw new Error('Открой страницу disk.yandex.ru');
  const m = u.pathname.match(/^\/d\/([^/]+)(.*)$/);
  if (m) {
    const key = `${u.origin}/d/${m[1]}`;
    let path = u.searchParams.get('path') || '/';
    if (path === '/' && m[2] && m[2] !== '/') path = decodeURIComponent(m[2]);
    if (!path.startsWith('/')) path = '/' + path;
    return { kind: 'public', key, path, label: 'Публичная папка' };
  }
  const p = u.pathname.match(/^\/client\/disk(?:\/(.*))?$/);
  if (p) {
    const queryPath = u.searchParams.get('path');
    const suffix = decodeURIComponent(p[1] || '');
    const path = queryPath ? ('disk:' + (queryPath.startsWith('/') ? '' : '/') + queryPath) : `disk:/${suffix}`;
    return { kind: 'private', path, label: 'Мой Диск' };
  }
  throw new Error('Эта страница не имеет доступного пути API. Открой папку в «Мой Диск» или её ссылку /d/… . Общие папки по приглашению доступны после добавления в свой Диск.');
}
async function api(path, params = {}, source = {}) {
  const url = new URL(API_BASE + path);
  Object.entries(params).forEach(([k,v]) => { if (v !== undefined && v !== null) url.searchParams.set(k,String(v)); });
  const hdr = {};
  if (source.kind === 'private') {
    const { yandexToken = '' } = await chrome.storage.local.get('yandexToken');
    if (!yandexToken) throw new Error('Для личного Диска нужен OAuth-токен. Открой настройки расширения.');
    hdr.Authorization = 'OAuth ' + yandexToken.trim();
  }
  const res = await fetch(url, { headers: hdr, cache: 'no-store' });
  if (!res.ok) {
    let err = ''; try {const d=await res.json();err=d.description||d.message||'';} catch(_) {}
    throw new Error(`Яндекс API: HTTP ${res.status}${err?' — '+err:''}`);
  }
  return res.json();
}
function endpoint(source, suffix = '') {
  return source.kind === 'public' ? '/public/resources' + suffix : '/resources' + suffix;
}
function params(source, path, more={}) {
  return source.kind === 'public' ? {public_key: source.key, path, ...more} : {path,...more};
}
async function getItem(source, path) {
  return api(endpoint(source), params(source,path,{limit: 1}),source);
}
async function listFolder(source, path) {
  const out = []; let offset = 0; let name = displayName(path);
  while(true) {
    const data = await api(endpoint(source),params(source,path,{limit:100,offset}),source);
    name = data.name || name;
    if(data.type === 'file') return {name,items:[data],isFile:true};
    const emb = data._embedded || {};
    const batch = Array.isArray(emb.items) ? emb.items : [];
    out.push(...batch);
    offset += batch.length;
    if(!batch.length || offset >= (emb.total || 0)) break;
    if(offset > 100000) throw new Error('Слишком большая папка для одной операции (100 000 элементов).');
  }
  return {name,items:out,isFile:false};
}
async function getLink(source, path) {
  const answer=await api(endpoint(source, '/download'), params(source,path), source);
  if(!answer.href || !/^https:\/\//.test(answer.href)) throw new Error('API не вернул безопасную ссылку для загрузки');
  return answer.href;
}
function isFolder(item){ return item.type === 'dir'; }
