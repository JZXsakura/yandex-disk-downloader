importScripts('core.js');

// Persisted jobs + browser downloads, not a long-lived JS download manager.
let mutex = Promise.resolve();
let pumping = false;
function transaction(fn) {
  const next = mutex.catch(()=>{}).then(async()=>{
    const { jobs = [] } = await chrome.storage.local.get('jobs');
    const result = await fn(jobs);
    await chrome.storage.local.set({jobs: jobs.slice(-1500)});
    return result;
  });
  mutex = next.catch(()=>{});
  return next;
}
async function settings() {
  const d=await chrome.storage.local.get('settings');
  const values={...DEFAULTS,...(d.settings||{})};
  // v1.0.2: migrate the old default near-button position to floating.
  // Existing users can explicitly select near or both again in Settings.
  if (!values.buttonPlacementV102) {
    values.buttonPlace='float';
    values.buttonPlacementV102=true;
    await chrome.storage.local.set({settings:values});
  }
  return values;
}
async function notify(title,message) {
  if(!(await settings()).notifications) return;
  try {await chrome.notifications.create({type:'basic',iconUrl:'icons/128.png',title,message});}catch(e){}
}
function keyFor(source,path) {return `${source.kind}|${source.key||'private'}|${path}`;}
async function walk(source, path, relative='', recursive=true, cap=10000) {
  const current=await listFolder(source,path), result=[];
  if(current.isFile) return [{path,name:current.items[0].name,relative: relative || current.items[0].name,size:current.items[0].size||0}];
  for(const entry of current.items) {
    const rel = [relative,entry.name].filter(Boolean).join('/');
    if(isFolder(entry)) {
      if(recursive) {
        const children = await walk(source,entry.path,rel,true,cap-result.length);
        result.push(...children);
      }
    } else result.push({path:entry.path,name:entry.name,relative:rel,size:entry.size||0});
    if(result.length>cap) throw new Error(`Лимит ${cap} файлов за одну операцию. Выбери меньше.`);
  }
  return result;
}
function createEntry(source, row, root, group, type='file') {
  const rel = String(row.relative||row.name);
  const suffix = rel.split('/').map(sanitizedSegment).join('/');
  const name = type==='serverzip' ? sanitizedSegment(row.name)+'.zip' : suffix;
  return {
    id:id(), source, remotePath:row.path, sourceKey:keyFor(source,row.path),
    name: type==='serverzip'? name : row.name,
    filename:[root,group,name].filter(Boolean).join('/'),
    type,status:'queued', bytes:0,total:row.size||0,downloadId:null,
    createdAt:Date.now(),updatedAt:Date.now(),error:null
  };
}
async function plan(payload) {
  const { url, selected = [], all = false, conflictChoice = null }=payload;
  if(typeof url!=='string' || url.length>2048) throw new Error('Ссылка слишком длинная или отсутствует');
  const source = parseSource(url), s=await settings();
  // Ensure folder is accessible and fetch the real API names; do not trust DOM filenames as remote paths.
  const root = await listFolder(source,source.path);
  const lookup = new Map(root.items.map(i=>[i.name,i]));
  let chosen;
  if(all) chosen=root.isFile?root.items:root.items;
  else {
    const unique=[...new Set(selected.filter(x=>typeof x==='string'))];
    if(!unique.length) throw new Error('Не удалось определить штатное выделение на странице. Выдели файлы в Яндекс Диске и повтори.');
    chosen=unique.map(n=>lookup.get(n));
    const missing=unique.filter(n=>!lookup.has(n));
    if(missing.length) throw new Error('Не удалось сопоставить выделение с файлами API: '+missing.slice(0,4).join(', '));
  }
  if(!chosen.length) throw new Error('В папке не найдено файлов.');
  const directory = root.name && root.name!=='/' ? sanitizedSegment(root.name) : 'Yandex_Disk';
  const folder = safeFolderPath(s.subfolder), group=directory;
  let planned = [];
  if(s.mode==='zip' && (all || (chosen.length===1 && isFolder(chosen[0])))) {
    const target = all ? {path:source.path,name:directory} : chosen[0];
    const row={path:target.path,name:target.name||directory,size:0};
    planned=[createEntry(source,row,folder,all?'':group,'serverzip')];
  } else {
    let entries=[];
    for(const node of chosen) {
      if(isFolder(node)) {
        if(!s.recursive) continue;
        const rows=await walk(source,node.path,node.name,true);
        entries.push(...rows);
      } else entries.push({path:node.path,name:node.name,relative:node.name,size:node.size||0});
      if(entries.length>10000) throw new Error('Лимит 10000 файлов на операцию.');
    }
    if(!entries.length) throw new Error('Нет файлов для загрузки. Включи «Вложенные папки» в настройках.');
    if(s.mode==='zip') {
      const sum=entries.reduce((a,x)=>a+x.size,0);
      if(sum>350*1024*1024) throw new Error('ZIP из произвольного выделения ограничен 350 МБ (сборка в памяти браузера). Для больших видео выбери «Отдельные файлы».');
      const zip = createEntry(source,{path:source.path,name:directory+'_выбранное',size:sum},folder,'','clientzip');
      zip.filename=[folder,directory+'_выбранное.zip'].filter(Boolean).join('/');
      zip.entries=entries;zip.total=sum;zip.status='queued';
      planned=[zip];
    } else planned=entries.map(x=>createEntry(source,x,folder,group));
  }
  const {jobs=[]}=await chrome.storage.local.get('jobs');
  // Only completed jobs with the same target path indicate a known duplicate.
  // Extensions cannot inspect arbitrary pre-existing files on the hard drive.
  const old=new Set(jobs.filter(j=>j.status==='complete').map(j=>j.filename));
  const repeated=planned.filter(j=>old.has(j.filename));
  if(repeated.length && !['overwrite','uniquify','cancel'].includes(conflictChoice))
    return {requiresConfirm:true,repeated:repeated.length,count:planned.length};
  if(conflictChoice==='cancel') return {added:0,canceled:true};
  const action=['overwrite','uniquify'].includes(conflictChoice) ? conflictChoice : 'uniquify';
  for(const row of planned) row.conflictAction=action;
  await transaction(jobs => jobs.push(...planned));
  await pump();
  return {added:planned.length,mode:s.mode,limit:350};
}
async function pump() {
  if(pumping) return;
  pumping=true;
  try {
    const s=await settings();
    while(true) {
      const candidate=await transaction(jobs=>{
        const active=jobs.filter(j=>['resolving','downloading'].includes(j.status)&&j.type!=='clientzip').length;
        if(active>=s.concurrent) return null;
        const job=jobs.find(j=>j.status==='queued' && j.type!=='clientzip');
        if(!job) return null;
        job.status='resolving'; job.updatedAt=Date.now();
        return {...job};
      });
      if(!candidate) break;
      // Async, so active resolving jobs count towards concurrency.
      void startOne(candidate);
    }
    const toZip=await transaction(jobs=>{
      const j=jobs.find(x=>x.type==='clientzip'&&x.status==='queued');
      if(!j) return null;
      j.status='preparing';j.updatedAt=Date.now();return {...j};
    });
    if(toZip) {
      const opened=await chrome.tabs.create({url:chrome.runtime.getURL('zip.html')+'#'+toZip.id,active:true});
      await transaction(jobs=>{const j=jobs.find(x=>x.id===toZip.id);if(j)j.zipTab=opened.id;});
    }
  } finally {pumping=false;}
}
async function startOne(j) {
  try {
    const href=await getLink(j.source,j.remotePath);
    const stillValid=await transaction(jobs=>{
      const job=jobs.find(x=>x.id===j.id);return Boolean(job&&job.status==='resolving');
    });
    if(!stillValid) {void pump();return;}
    // Reject tiny text/error responses masquerading as multi-GB videos.
    // HEAD may not be supported by every Yandex CDN, so it is best-effort.
    try {
      const probe=await fetch(href,{method:'HEAD',cache:'no-store'});
      if(!probe.ok && ![405,501].includes(probe.status))throw new Error(`Сервер отклонил загрузку: HTTP ${probe.status}`);
      const mime=(probe.headers.get('content-type')||'').toLowerCase();
      const advertised=Number(probe.headers.get('content-length')||0);
      if(j.type==='file' && j.total>1048576 && advertised>0 && advertised<1024)
        throw new Error(`Сервер вернул только ${advertised} байт вместо файла. Отменено, чтобы не создавать .txt`);
      if(j.type==='file' && /^(text\/plain|application\/json|text\/html)/.test(mime) && !/\.(txt|json|html?)$/i.test(j.name))
        throw new Error(`Сервер вернул ${mime} вместо файла ${j.name}`);
    } catch(error) {
      if(/^(Сервер)/.test(error.message))throw error;
      // CORS / unsupported HEAD: rely on downloads error reporting.
    }
    await transaction(jobs=>{const job=jobs.find(x=>x.id===j.id);if(job)job.directUrl=href;});
    const did=await chrome.downloads.download({url:href,filename:j.filename,conflictAction:j.conflictAction||'uniquify',saveAs:false});
    const canceled=await transaction(jobs=>jobs.find(x=>x.id===j.id)?.status==='canceled');
    if(canceled)await chrome.downloads.cancel(did).catch(()=>{});
    await transaction(jobs=>{const job=jobs.find(x=>x.id===j.id);if(job && job.status!=='canceled') {job.downloadId=did;job.status='downloading';job.updatedAt=Date.now();}});
  } catch(err) {
    await transaction(jobs=>{const job=jobs.find(x=>x.id===j.id);if(job) {job.status='failed';job.error=String(err.message||err);job.updatedAt=Date.now();}});
  } finally {void pump();}
}
async function reconcile() {
  const {jobs=[]}=await chrome.storage.local.get('jobs');
  for(const job of jobs) {
    if(job.type==='clientzip' && ['preparing','downloading'].includes(job.status)) {
      const t=job.zipTab ? await chrome.tabs.get(job.zipTab).catch(()=>null):null;
      if(!t) await transaction(jobs=>{const j=jobs.find(x=>x.id===job.id);if(j){j.status='failed';j.error='Окно создания ZIP было закрыто. Нажми «Повторить».';}});
    }
    if(job.status==='resolving') await transaction(jobs=>{const j=jobs.find(x=>x.id===job.id);if(j) j.status='queued';});
    if(job.downloadId!=null && ['downloading','paused'].includes(job.status)) {
      const [file]=await chrome.downloads.search({id:job.downloadId});
      await transaction(jobs=>{
        const j=jobs.find(x=>x.id===job.id); if(!j)return;
        if(!file){j.status='failed';j.error='Загрузка не найдена в браузере';return;}
        j.bytes=file.bytesReceived||0;j.total=Math.max(j.total||0,file.totalBytes||0);
        if(file.state==='complete') j.status='complete';
        else if(file.state==='interrupted') {j.status='failed';j.error=file.error||'Загрузка прервана';}
        else j.status=file.paused?'paused':'downloading';
      });
    }
  }
  void pump();
}
async function state() {
  const {jobs=[]}=await chrome.storage.local.get('jobs');
  const current=jobs.slice(-1000).map(j=>({...j,entries:undefined,source:undefined}));
  const running=current.filter(j=>j.downloadId!=null && ['downloading','paused'].includes(j.status));
  const detail=await Promise.all(running.map(async j=>{
    try {const [d]=await chrome.downloads.search({id:j.downloadId});return d?{id:j.id,bytes:d.bytesReceived||0,total:d.totalBytes||j.total||0,paused:d.paused,canResume:d.canResume}:null;}
    catch{return null;}
  }));
  for(const d of detail.filter(Boolean)) {
    const j=current.find(x=>x.id===d.id);Object.assign(j,d);
  }
  return {jobs:current,settings:await settings(),tokenConfigured:Boolean((await chrome.storage.local.get('yandexToken')).yandexToken)};
}
async function control(jobId,cmd) {
  let job;
  await transaction(jobs=>{job=jobs.find(j=>j.id===jobId);if(job)job={...job};});
  if(!job) throw new Error('Загрузка не найдена');
  if(cmd==='retry') {
    if(!['failed','canceled','paused'].includes(job.status))return;
    if(job.status==='paused'&&job.downloadId!==null) return control(jobId,'resume');
    await transaction(jobs=>{const j=jobs.find(x=>x.id===jobId);j.status='queued';j.error=null;j.bytes=0;j.downloadId=null;j.updatedAt=Date.now();});
    await pump();return;
  }
  if(cmd==='pause') {
    if(job.type==='clientzip') throw new Error('ZIP, собранный в отдельной вкладке, нельзя поставить на паузу.');
    if(job.status==='queued'||job.status==='resolving') {await transaction(jobs=>{const j=jobs.find(x=>x.id===jobId);if(j)j.status='paused';});return;}
    if(job.downloadId!==null && job.status==='downloading') await chrome.downloads.pause(job.downloadId);
    await transaction(jobs=>{const j=jobs.find(x=>x.id===jobId);if(j)j.status='paused';});return;
  }
  if(cmd==='resume') {
    if(job.downloadId!==null && job.status==='paused') await chrome.downloads.resume(job.downloadId);
    else if(job.status==='paused') {await transaction(jobs=>{const j=jobs.find(x=>x.id===jobId);if(j)j.status='queued';});await pump();return;}
    await transaction(jobs=>{const j=jobs.find(x=>x.id===jobId);if(j)j.status='downloading';});return;
  }
  if(cmd==='cancel') {
    if(job.type==='clientzip'&&job.zipTab) await chrome.tabs.remove(job.zipTab).catch(()=>{});
    if(job.downloadId!==null && ['downloading','paused'].includes(job.status)) await chrome.downloads.cancel(job.downloadId).catch(()=>{});
    await transaction(jobs=>{const j=jobs.find(x=>x.id===jobId);if(j){j.status='canceled';j.updatedAt=Date.now();}});
    await pump();return;
  }
  if(cmd==='show') {if(job.downloadId!==null) await chrome.downloads.show(job.downloadId);return;}
}

chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  (async()=>{
    if(!msg||typeof msg.type!=='string')throw new Error('Неизвестный запрос');
    switch(msg.type) {
      case 'QUEUE':return plan(msg);
      case 'FILE_NAMES': {
        const source=parseSource(msg.url);
        const folder=await listFolder(source,source.path);
        return folder.items.map(it=>it.name);
      }
      case 'STATE':return state();
      case 'CONTROL': await control(msg.id,msg.cmd);return {ok:true};
      case 'SETTINGS': {
        const s={...DEFAULTS,...msg.settings};
        s.concurrent=Math.max(1,Math.min(10,Math.round(Number(s.concurrent)||3)));
        s.subfolder=safeFolderPath(s.subfolder);
        if(!['light','dark','system','custom'].includes(s.theme))s.theme='system';
        s.offsetX=Math.max(-500,Math.min(500,Math.round(Number(s.offsetX)||0)));
        s.offsetY=Math.max(-500,Math.min(500,Math.round(Number(s.offsetY)||0)));
        if(!['near','float','both'].includes(s.buttonPlace))s.buttonPlace='near';
        for(const field of ['progressPage','progressPopup','progressDashboard','recursive','notifications'])s[field]=Boolean(s[field]);
        for(const [field,fallback] of [['accentColor','#7765ed'],['backgroundColor','#20202d']]){
          if(!/^#[0-9a-f]{6}$/i.test(s[field]))s[field]=fallback;
        }
        if(!['files','zip'].includes(s.mode))s.mode='files';
                await chrome.storage.local.set({settings:s});void pump();return {ok:true};
      }
      case 'SET_TOKEN': {const token=String(msg.token||'').trim();
        // Never log or include token in UI responses.
        if(token.length>2048)throw new Error('Токен слишком длинный');
        await chrome.storage.local.set({yandexToken:token});return {ok:true};}
      case 'CLEAR_FINISHED':
      case 'CLEAR_COMPLETE':
      case 'CLEAR_FAILED': {
        const allowed=msg.type==='CLEAR_FINISHED'?['complete','failed','canceled']:
          msg.type==='CLEAR_COMPLETE'?['complete']:['failed','canceled'];
        await transaction(jobs=>{for(let i=jobs.length-1;i>=0;i--)if(allowed.includes(jobs[i].status))jobs.splice(i,1);});return {ok:true};
      }
      case 'STOP_ALL': {
        const {jobs=[]}=await chrome.storage.local.get('jobs');
        // Cancel the whole queue first: otherwise the pump would start more files.
        await transaction(current=>{for(const j of current)if(['queued','resolving','preparing','downloading','paused'].includes(j.status)){
          j.status='canceled';j.updatedAt=Date.now();
        }});
        for(const j of jobs){
          if(j.downloadId!=null && ['downloading','paused'].includes(j.status))await chrome.downloads.cancel(j.downloadId).catch(()=>{});
          if(j.type==='clientzip' && j.zipTab)await chrome.tabs.remove(j.zipTab).catch(()=>{});
        }
        return {ok:true};
      }
      case 'OPEN_DASHBOARD': await chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')});return {ok:true};
      case 'ZIP_GET': {
        const {jobs=[]}=await chrome.storage.local.get('jobs');
        const j=jobs.find(x=>x.id===msg.id&&x.type==='clientzip');
        if(!j)throw new Error('Задача ZIP не найдена');return j;
      }
      case 'ZIP_LINK': {
        const {jobs=[]}=await chrome.storage.local.get('jobs');
        const j=jobs.find(x=>x.id===msg.id&&x.type==='clientzip');
        if(!j|| !j.entries.some(e=>e.path===msg.path))throw new Error('Путь не входит в архив');
        return {url:await getLink(j.source,msg.path)};
      }
      case 'ZIP_STARTED': {
        const did=Number(msg.downloadId);
        if(!Number.isInteger(did) || did<0)throw new Error('Некорректный идентификатор загрузки');
        await transaction(jobs=>{const j=jobs.find(x=>x.id===msg.id&&x.type==='clientzip');if(!j)throw new Error('ZIP не найден');j.downloadId=did;j.status='downloading';j.updatedAt=Date.now();});
        return {ok:true};
      }
      case 'ZIP_PROGRESS': await transaction(jobs=>{const j=jobs.find(x=>x.id===msg.id);if(j){j.status=msg.status||j.status;j.bytes=msg.bytes||0;j.total=msg.total||j.total;j.error=msg.error||null;j.updatedAt=Date.now();}});return {ok:true};
      default:throw new Error('Неизвестная команда');
    }
  })().then(data=>respond({ok:true,data})).catch(e=>respond({ok:false,error:String(e.message||e)}));
  return true;
});
chrome.downloads.onChanged.addListener(async change=>{
  if(!change.state && !change.paused && !change.error)return;
  let completed=null, failed=false;
  let finalBytes=null;
  if(change.state?.current==='complete'){
    try{const [d]=await chrome.downloads.search({id:change.id});if(d)finalBytes=d.bytesReceived;}catch{}
  }
  await transaction(jobs=>{
    const j=jobs.find(x=>x.downloadId===change.id);if(!j)return;
    if(change.state?.current==='complete' && j.status!=='canceled'){
      if(j.type==='file' && j.total>1024 && finalBytes!==null && finalBytes<j.total*0.98){
        j.status='failed';j.error=`Размер файла не совпал: ${finalBytes} байт вместо ${j.total}. Возможно, Яндекс вернул текстовый ответ.`;failed=true;
      }else{j.status='complete';completed=j.name;}
    }
    if(change.state?.current==='interrupted' && j.status!=='canceled'){j.status='failed';j.error=change.error?.current||'Загрузка прервана';failed=true;}
    if(change.paused && j.status!=='canceled')j.status=change.paused.current?'paused':'downloading';
    j.updatedAt=Date.now();
  });
  if(completed||failed){
    const {jobs=[]}=await chrome.storage.local.get('jobs');
    const remaining=jobs.filter(j=>['queued','resolving','preparing','downloading','paused'].includes(j.status)).length;
    if(!remaining){
      const failedCount=jobs.filter(j=>j.status==='failed').length;
      void notify(failedCount?'Очередь завершена с ошибками':'Все загрузки завершены',
        failedCount?`Ошибок в истории: ${failedCount}. Проверь менеджер.`:'Все файлы из очереди обработаны.');
    }
  }
  void pump();
});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='yd_reconcile')void reconcile();});
chrome.runtime.onInstalled.addListener(()=>{void chrome.alarms.create('yd_reconcile',{periodInMinutes:0.5});void reconcile();});
chrome.runtime.onStartup.addListener(()=>{void chrome.alarms.create('yd_reconcile',{periodInMinutes:0.5});void reconcile();});
void chrome.alarms.get('yd_reconcile').then(a=>{if(!a)chrome.alarms.create('yd_reconcile',{periodInMinutes:0.5});});

// Ensure Yandex CDN / MIME cannot silently rename IMG_6179.mov into IMG_6179.txt.
chrome.downloads.onDeterminingFilename.addListener((item,suggest)=>{
  (async()=>{
    const {jobs=[]}=await chrome.storage.local.get('jobs');
    const j=[...jobs].reverse().find(x=>
      x.downloadId===item.id || (x.directUrl && (x.directUrl===item.url || x.directUrl===item.finalUrl) &&
      ['resolving','downloading','paused'].includes(x.status)));
    if(j) suggest({filename:j.filename,conflictAction:j.conflictAction||'uniquify'});
    else suggest();
  })().catch(()=>suggest());
  return true;
});
