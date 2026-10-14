(()=>{
  const page=document.body.dataset.view==='dashboard';
  const $=s=>document.querySelector(s),rate=new Map();let currentSettings={},busy=false,formInitialized=false;
  async function send(body){const reply=await chrome.runtime.sendMessage(body);if(!reply?.ok)throw Error(reply?.error||'Ошибка');return reply.data;}
  function notify(text){const e=$('#toast');if(!e)return;e.textContent=text;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2700);}
  function readable(n){if(!n||n<0)return '0 Б';const p=Math.min(4,Math.floor(Math.log(n)/Math.log(1024)));return (n/1024**p).toFixed(p?1:0)+' '+['Б','КБ','МБ','ГБ','ТБ'][p];}
  function date(n){return n?new Date(n).toLocaleString('ru-RU'):'—';}
  const captions={queued:'В очереди',resolving:'Получение ссылки',preparing:'Сборка ZIP',downloading:'Загружается',paused:'Пауза',complete:'Готово',failed:'Ошибка',canceled:'Отменено'};
  function applyTheme(o){let name=o.theme||'system';if(name==='system')name=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
    document.body.dataset.theme=name;
    if(name==='custom'){
      document.body.style.setProperty('--accent',o.accentColor||'#7765ed');
      document.body.style.setProperty('--bg',o.backgroundColor||'#20202d');
    }else{document.body.style.removeProperty('--accent');document.body.style.removeProperty('--bg');}
  }
  async function updateSettings(patch){
    const merged={...currentSettings,...patch};const st=await send({type:'SETTINGS',settings:merged});
    currentSettings=merged;applyTheme(merged);return st;
  }
  function makeButton(title,id,cmd,cls=''){
    const b=document.createElement('button');b.className=cls;b.textContent=title;
    b.addEventListener('click',async()=>{b.disabled=true;try{await send({type:'CONTROL',id,cmd});await refresh();}catch(e){notify(e.message);}finally{b.disabled=false;}});
    return b;
  }
  function renderJob(j){
    const card=document.createElement('div');card.className='job';
    const top=document.createElement('div');top.className='job-top';
    const name=document.createElement('strong');name.textContent=j.name;name.title=j.filename||j.name;
    const pill=document.createElement('span');pill.className='pill';pill.textContent=captions[j.status]||j.status;top.append(name,pill);
    const track=document.createElement('div');track.className='progress';const fill=document.createElement('div');
    fill.style.width=j.total>0?Math.max(0,Math.min(100,j.bytes/j.total*100))+'%':'0%';track.append(fill);
    const meta=document.createElement('div');meta.className='details';const left=document.createElement('span');
    left.textContent=j.total>0?`${readable(j.bytes)} / ${readable(j.total)} · ${Math.floor(j.bytes/j.total*100)}%`:readable(j.bytes);
    const right=document.createElement('span');let speed=0;const now=Date.now(),last=rate.get(j.id);
    if(last&&now>last.t&&now-last.t<15000&&j.bytes>=last.n)speed=(j.bytes-last.n)/((now-last.t)/1000);
    if(!last||now-last.t>900)rate.set(j.id,{t:now,n:j.bytes||0});
    const eta=speed>1&&j.total>j.bytes?Math.ceil((j.total-j.bytes)/speed):null;
    right.textContent=j.status==='downloading'?(speed>1?`${readable(speed)}/с · ~${eta} с`:'Скорость определяется…'):date(j.updatedAt);
    meta.append(left,right);card.append(top,track,meta);
    const actions=document.createElement('div');actions.className='controls';
    if(j.type!=='clientzip'&&['downloading','queued','resolving'].includes(j.status))actions.append(makeButton('Ⅱ Пауза',j.id,'pause'));
    if(j.status==='paused')actions.append(makeButton('▶ Продолжить',j.id,'resume'));
    if(['canceled','failed'].includes(j.status))actions.append(makeButton('↻ Повторить',j.id,'retry'));
    if(['downloading','queued','resolving','paused','preparing'].includes(j.status))actions.append(makeButton('× Отменить',j.id,'cancel','danger'));
    if(j.status==='complete'&&j.downloadId!=null)actions.append(makeButton('Показать файл',j.id,'show'));
    if(actions.childElementCount)card.append(actions);
    if(j.error){const err=document.createElement('div');err.className='error';err.textContent=j.error;card.append(err);}
    return card;
  }
  function renderCollection(selector,jobs,empty,max){const node=$(selector);if(!node)return;node.replaceChildren();
    if(!jobs.length){const text=document.createElement('div');text.className='empty';text.textContent=empty;node.append(text);return;}
    for(const j of jobs.slice(-max).reverse())node.append(renderJob(j));
  }
  async function refresh(){if(busy)return;busy=true;
    try{const st=await send({type:'STATE'});currentSettings=st.settings||currentSettings;applyTheme(currentSettings);
      const jobs=st.jobs||[];
      const ongoing=jobs.filter(x=>['queued','resolving','preparing','downloading','paused'].includes(x.status));
      const by=s=>jobs.filter(x=>x.status===s).length;
      $('#countQueue').textContent=jobs.filter(x=>['queued','resolving','preparing','paused'].includes(x.status)).length;
      $('#countActive').textContent=by('downloading');$('#countComplete').textContent=by('complete');
      $('#countFailed').textContent=by('failed');$('#countCanceled').textContent=by('canceled');
      if(!page&&!currentSettings.progressPopup){$('#jobs').replaceChildren();const t=document.createElement('div');t.className='empty';t.textContent='Отображение прогресса в popup отключено в настройках';$('#jobs').append(t);}
      else renderCollection('#jobs',ongoing,'Нет активных загрузок. Открой Яндекс Диск и нажми «Скачать всё».',page?200:8);
      if(page){const history=jobs.filter(x=>['complete','failed','canceled'].includes(x.status));renderCollection('#historyJobs',history,'История пуста',500);
        $('#tokenStatus').textContent=st.tokenConfigured?'Токен установлен локально':'OAuth-токен не указан';
        if(!formInitialized){fillForm(currentSettings);formInitialized=true;}
      }
    }catch(e){notify(e.message);}finally{busy=false;}
  }
  function on(id,event,fn){$(id)?.addEventListener(event,fn);}
  async function clear(type){try{await send({type});await refresh();}catch(e){notify(e.message);}}
  on('#refresh','click',refresh);
  on('#clearCompleted','click',()=>clear('CLEAR_COMPLETE'));
  on('#clearFailed','click',()=>clear('CLEAR_FAILED'));
  on('#stopAll','click',async()=>{if(!confirm('Отменить ВСЕ текущие загрузки и очередь?'))return;await clear('STOP_ALL');});
  function openManager(tab='downloads'){chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')+(tab==='settings'?'#settings':'')});}
  on('#openDash','click',()=>openManager());on('#openManager','click',()=>openManager());
  on('#openDisk','click',()=>chrome.tabs.create({url:'https://disk.yandex.ru/client/disk'}));
  if(!page){
    on('#openSettings','click',()=>{$('#quickSettings').classList.toggle('hide');
      document.querySelectorAll('[name="quickMode"]').forEach(x=>x.checked=x.value===currentSettings.mode);
      $('#qConcurrent').value=currentSettings.concurrent||3;
      $('#qRecursive').checked=Boolean(currentSettings.recursive);
      $('#qWarning').classList.toggle('hide',Number(currentSettings.concurrent)<=5);
    });
    on('#qAllSettings','click',()=>openManager('settings'));
    for(const r of document.querySelectorAll('[name="quickMode"]'))r.addEventListener('change',()=>updateSettings({mode:r.value}).catch(e=>notify(e.message)));
    on('#qConcurrent','change',async()=>{const n=Number($('#qConcurrent').value);if(!Number.isInteger(n)||n<1||n>10){notify('Нужно число от 1 до 10');return;}
      $('#qWarning').classList.toggle('hide',n<=5);await updateSettings({concurrent:n});});
    on('#qRecursive','change',()=>updateSettings({recursive:$('#qRecursive').checked}).catch(e=>notify(e.message)));
  }
  function fillForm(settings){const form=$('#settingsForm');
    for(const [key,v] of Object.entries(settings)){
      const elements=form.querySelectorAll(`[name="${key}"]`);
      for(const c of elements){if(c.type==='radio')c.checked=c.value===String(v);
        else if(c.type==='checkbox')c.checked=Boolean(v);
        else if(c.type==='text'||c.type==='number'||c.type==='color')c.value=String(v);}
    }
    updateFormUI();
  }
  function updateFormUI(){const form=$('#settingsForm');
    if(!form)return;
    $('#customColors').classList.toggle('hide',form.querySelector('[name="theme"]:checked')?.value!=='custom');
    const concurrent=Number(form.elements.concurrent.value||3);
    $('#concurrentWarning').classList.toggle('hide',concurrent<=5);
  }
  let saveTimer=null;
  async function saveForm(){const form=$('#settingsForm'),data=new FormData(form),patch={
    theme:data.get('theme')||'system',mode:data.get('mode')||'files',buttonPlace:data.get('buttonPlace')||'near',
    concurrent:Number(data.get('concurrent')||3),subfolder:data.get('subfolder')||'',
    offsetX:Number(data.get('offsetX')||0),offsetY:Number(data.get('offsetY')||0),
    progressPage:data.has('progressPage'),progressPopup:data.has('progressPopup'),progressDashboard:data.has('progressDashboard'),
    recursive:data.has('recursive'),notifications:data.has('notifications'),
    accentColor:data.get('accentColor')||'#7765ed',backgroundColor:data.get('backgroundColor')||'#20202d'};
    if(patch.concurrent<1||patch.concurrent>10||!Number.isInteger(patch.concurrent)){notify('Параллельно можно от 1 до 10 файлов');return;}
    try{await updateSettings(patch);}catch(e){notify(e.message);}
  }
  if(page){
    const tabs=[...document.querySelectorAll('[data-tab]')];
    function selectTab(which){tabs.forEach(x=>x.classList.toggle('active',x.dataset.tab===which));
      for(const sec of document.querySelectorAll('.page'))sec.classList.toggle('hide',sec.id!==which);
      location.hash=which==='downloads'?'':which;
    }
    tabs.forEach(b=>b.addEventListener('click',()=>selectTab(b.dataset.tab)));
    if(['#settings','#history'].includes(location.hash))selectTab(location.hash.slice(1));
    const form=$('#settingsForm');
    form.addEventListener('submit',e=>e.preventDefault());
    form.addEventListener('input',e=>{updateFormUI();clearTimeout(saveTimer);
      if(e.target.type==='radio'||e.target.type==='checkbox'||e.target.type==='color')void saveForm();
      else saveTimer=setTimeout(saveForm,450);
    });
    form.addEventListener('change',()=>{updateFormUI();clearTimeout(saveTimer);void saveForm();});
    on('#saveToken','click',async()=>{const input=$('#token');if(!input.value.trim()){notify('Введи OAuth-токен');return;}
      if(!confirm('Токен будет храниться локально и даст расширению доступ к чтению твоего Яндекс Диска. Продолжить?'))return;
      try{await send({type:'SET_TOKEN',token:input.value.trim()});input.value='';await refresh();notify('Токен сохранён');}catch(e){notify(e.message);}
    });
    on('#clearToken','click',async()=>{if(!confirm('Удалить OAuth-токен?'))return;
      try{await send({type:'SET_TOKEN',token:''});$('#token').value='';await refresh();notify('Токен удалён');}catch(e){notify(e.message);}
    });
  }
  void refresh();setInterval(refresh,1350);
})();
