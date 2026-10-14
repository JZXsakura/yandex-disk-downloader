/* The on-page controls use the browser's normal selection; no private Yandex state or cookies. */
(()=>{
  if(window.__yddV1)return;window.__yddV1=true;
  const host=document.createElement('div');host.id='ydd-v1-host';
  host.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483600';
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>
  :host{--ydd-accent:#7765ed;--ydd-surface:#fff;--ydd-text:#212132;--ydd-border:#ddd9e7;--ydd-muted:#77738a}
  *{box-sizing:border-box}
  button{cursor:pointer;font:600 13px system-ui,-apple-system,sans-serif;transition:background-color .28s ease,color .28s ease,border-color .28s ease,box-shadow .28s ease,opacity .2s ease}
  @media(prefers-reduced-motion:reduce){button,#panel,#conflictCard{transition:none!important}}
  #near{position:fixed;display:none;pointer-events:auto;align-items:center;gap:6px;white-space:nowrap}
  .btn{padding:9px 11px;border-radius:10px;background:var(--ydd-accent);color:#fff;border:none;box-shadow:0 4px 12px #0002}
  .btn:hover{filter:brightness(.92)}.btn:disabled{opacity:.5}.minor{background:var(--ydd-surface);color:var(--ydd-accent);border:1px solid var(--ydd-border)}
  #floatWrap{position:fixed;bottom:22px;right:22px;display:none;pointer-events:auto;align-items:center;gap:8px}
  #floatSelected{display:none}
  #floatWrap .btn{min-height:36px}
  #float{display:block}
  #panel{display:none;pointer-events:auto;position:fixed;right:18px;bottom:74px;width:340px;max-width:calc(100vw - 30px);padding:15px;border:1px solid #ddd9e7;
  border-radius:17px;background:var(--ydd-surface);color:var(--ydd-text);box-shadow:0 12px 38px #0004;font:13px system-ui,-apple-system,sans-serif;transition:background-color .35s ease,color .35s ease,border-color .35s ease}
  #panel.visible{display:block}
  #conflict{display:none;pointer-events:auto;position:fixed;inset:0;background:#0007;align-items:center;justify-content:center}
  #conflict.visible{display:flex}#conflictCard{background:var(--ydd-surface);color:var(--ydd-text);border-radius:18px;padding:22px;width:min(440px,90vw);font:14px system-ui;box-shadow:0 20px 90px #0005}
  #conflictCard p{line-height:1.5}.choice-buttons{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px}
  #conflictCard .choice-buttons button{padding:10px 13px;border-radius:9px;border:1px solid #bcb6df;background:#f5f3ff;color:#34256e}
  #conflictCard #replace{background:var(--ydd-accent);color:#fff}
  .top{display:flex;align-items:center;justify-content:space-between;gap:8px}.top strong{font-size:16px}
  .actions{display:flex;gap:7px;flex-wrap:wrap}.small{padding:5px 8px;border:1px solid #ddd9e7;border-radius:8px;color:#43359e;background:#f3f1fc;font-size:11px}
  #stats{font-size:12px;color:var(--ydd-muted);margin:11px 0}.item{border-top:1px solid var(--ydd-border);padding:8px 0}
  .line{display:flex;align-items:center;justify-content:space-between;gap:8px}.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px;font-weight:600}
  .track{background:#ece9f7;height:6px;border-radius:10px;margin:7px 0;overflow:hidden}.track i{background:var(--ydd-accent);display:block;height:100%}
  .desc{font-size:11px;color:var(--ydd-muted)}#message{color:#b04b4b;font-size:12px;padding:5px 0;white-space:pre-wrap}
  .small{background:var(--ydd-surface)!important;color:var(--ydd-text)!important;border-color:var(--ydd-border)!important}
  #conflictCard .choice-buttons button{background:var(--ydd-surface);color:var(--ydd-text);border-color:var(--ydd-border)}
  </style>
  <div id="conflict"><div id="conflictCard" role="dialog" aria-label="Повторная загрузка"><strong>Файлы уже скачивались</strong><p id="conflictText"></p><div class="choice-buttons"><button id="replace">Заменить</button><button id="rename">Переименовать новые</button><button id="abort">Отмена</button></div></div></div>
  <div id="near"><button id="all" class="btn">⇩ Скачать всё</button><button id="selected" class="btn minor">⇩ Выбранное</button></div>
  <div id="floatWrap"><button id="floatSelected" class="btn minor">⇩ Выбранное</button><button id="float" class="btn">⇩ Скачать всё</button></div>
  <section id="panel"><div class="top"><strong>Загрузки · by sakura</strong><div class="actions"><button id="manager" class="small">Менеджер</button><button id="hide" class="small">×</button></div></div>
  <div id="stats"></div><div class="actions"><button id="stop" class="small">■ Остановить всё</button><button id="clearCompleted" class="small">Очистить готовые</button><button id="clearFailed" class="small">Очистить ошибки</button></div>
  <div id="message"></div><div id="items"></div></section>`;
  const $=s=>root.querySelector(s),bar=$('#near'),float=$('#float'),floatWrap=$('#floatWrap'),floatSelected=$('#floatSelected'),panel=$('#panel');
  let setting={buttonPlace:'float',offsetX:0,offsetY:0,progressPage:true,accentColor:'#7765ed'};
  let busy=false;const rate=new Map();
  // The user's HTML shows row tiles with aria-selected and a file name in
  // .listing-item__title[aria-label]. Read from those real nodes first. No
  // reliance on an async API list: the worker validates every name anyway.
  let selectionSnapshot=[];
  const selectedRows='[role="row"][aria-selected="true"], .listing-item[aria-selected="true"], .listing-item_selected, .listing-item_selected-true, [role="row"][data-selected="true"], [role="row"][data-state="selected"]';
  function rowName(row) {
    const title=row.querySelector('.listing-item__title[aria-label], [data-name], [data-filename], .listing-item__title, [class*="file-name"]');
    return (title?.getAttribute('aria-label') || title?.getAttribute('data-name') || title?.getAttribute('data-filename') || title?.getAttribute('title') || title?.textContent || '').trim();
  }
  function readSelectedRows(){
    const names=new Set();
    for (const row of document.querySelectorAll(selectedRows)) {
      if(host.contains(row) || !row.getClientRects().length) continue;
      const name=rowName(row);
      if(name) names.add(name);
    }
    // Alternate row layouts used in personal or shared Disk.
    for (const marker of document.querySelectorAll('[aria-selected="true"], [data-selected="true"]')) {
      if(host.contains(marker) || marker.matches('[role="row"], .listing-item')) continue;
      const row=marker.closest('.listing-item, [role="row"], [data-testid*="resource"]');
      if(row && row.getClientRects().length){const name=rowName(row);if(name) names.add(name);}
    }
    return [...names];
  }
  function nativeSelection(){
    const actual=readSelectedRows();
    if(actual.length)selectionSnapshot=actual;
    return {names:actual.length?actual:selectionSnapshot};
  }
  function refreshNativeSelection(){
    // Run after React's mouse/keyboard selection handling has applied.
    selectionSnapshot=readSelectedRows();
    updateLabels();
  }
  function parsed(){return /^\/d\/[^/]+/.test(location.pathname)||/^\/client\/disk(?:\/|$)/.test(location.pathname);}
  async function msg(m){const r=await chrome.runtime.sendMessage(m);if(!r?.ok)throw Error(r?.error||'Ошибка расширения');return r.data;}
  function findSaveAnchor(){
    // Exact classes provided by the user from the current public page.
    const selectors=[
      '.action-buttons > .action-buttons__button_save',
      '.action-buttons .save-button_save',
      '.TopToolbar__Buttons .save-button',
      'button.save-button',
      'button[class*="save-button_save"]'
    ];
    for(const selector of selectors){
      const button=document.querySelector(selector);
      if(!button)continue;
      const r=button.getBoundingClientRect();
      if(r.width>=40 && r.height>=15)return r;
    }
    // Fallback for other Yandex front-end revisions; NBSP is normalized.
    for(const button of document.querySelectorAll('button,[role="button"]')){
      if(host.contains(button))continue;
      const label=(button.textContent||'').replace(/\s+/g,' ').trim();
      if(!/^сохранить на яндекс диск$/i.test(label))continue;
      const r=button.getBoundingClientRect();
      if(r.width>=40 && r.height>=15)return r;
    }
    return null;
  }
  function position(){
    const place=setting.buttonPlace||'float';
    const pageAvailable=parsed();
    const nearEnabled=pageAvailable && ['near','both'].includes(place);
    const floatEnabled=pageAvailable && ['float','both'].includes(place);
    floatWrap.style.display=floatEnabled?'flex':'none';
    bar.style.display=nearEnabled?'flex':'none';
    if(!nearEnabled)return;
    const anchor=findSaveAnchor();
    const width=bar.offsetWidth||300;
    const height=bar.offsetHeight||38;
    const x=Number(setting.offsetX)||0;
    const y=Number(setting.offsetY)||0;
    let left,top;
    if(anchor){
      left=anchor.left-width-10+x;
      top=anchor.top+(anchor.height-height)/2+y;
      if(left<8){
        left=anchor.left+x;
        top=anchor.bottom+8+y;
      }
    }else{
      // A missing Yandex button never silently hides our top controls.
      const toolbar=document.querySelector('.TopToolbar__Buttons, .TopToolbar, .action-buttons');
      const r=toolbar?.getBoundingClientRect();
      left=(r?r.right:innerWidth-20)-width+x;
      top=(r?r.bottom+8:132)+y;
    }
    bar.style.left=Math.round(Math.max(8,Math.min(Math.max(8,innerWidth-width-8),left)))+'px';
    bar.style.top=Math.round(Math.max(8,Math.min(Math.max(8,innerHeight-height-8),top)))+'px';
  }
  function updateLabels(){
    const s=nativeSelection();$('#selected').textContent=s.names.length?`⇩ Выбранное (${s.names.length})`:'⇩ Выбранное';
    float.textContent='⇩ Скачать всё';
    floatSelected.textContent=`⇩ Выбранное (${s.names.length})`;
    floatSelected.style.display=s.names.length?'block':'none';
    $('#all').style.background=setting.accentColor||'#7765ed';float.style.background=setting.accentColor||'#7765ed';
    root.querySelectorAll('.track i').forEach(n=>n.style.background=setting.accentColor||'#7765ed');
  }
  function applyPageTheme(){
    const theme=setting.theme==='system'
      ?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')
      :setting.theme;
    const custom=theme==='custom';
    const surface=custom?(setting.backgroundColor||'#20202d'):(theme==='dark'?'#23232f':'#ffffff');
    const hex=surface.replace('#','');
    const luminance=parseInt(hex.slice(0,2),16)*0.2126+parseInt(hex.slice(2,4),16)*0.7152+parseInt(hex.slice(4,6),16)*0.0722;
    const dark=luminance<155;
    host.style.setProperty('--ydd-accent',setting.accentColor||'#7765ed');
    host.style.setProperty('--ydd-surface',surface);
    host.style.setProperty('--ydd-text',dark?'#f5f2ff':'#212132');
    host.style.setProperty('--ydd-border',dark?'#4c4a60':'#ddd9e7');
    host.style.setProperty('--ydd-muted',dark?'#bdb7cd':'#77738a');
  }
  matchMedia('(prefers-color-scheme:dark)').addEventListener('change',applyPageTheme);
  function chooseConflict(count){return new Promise(resolve=>{
    $('#conflictText').textContent=`Обнаружено ${count} совпадений среди ранее скачанных файлов. Как поступить с ними? Выбор будет применён сразу ко всей операции.`;
    const modal=$('#conflict');modal.classList.add('visible');
    const end=which=>{modal.classList.remove('visible');$('#replace').onclick=null;$('#rename').onclick=null;$('#abort').onclick=null;resolve(which);};
    $('#replace').onclick=()=>end('overwrite');$('#rename').onclick=()=>end('uniquify');$('#abort').onclick=()=>end('cancel');
  });}
  async function launch(onlySelected){
    if(busy)return;busy=true;$('#all').disabled=true;$('#selected').disabled=true;float.disabled=true;floatSelected.disabled=true;
    try{
      const sel=nativeSelection();
      if(onlySelected && !sel.names.length)throw new Error('Выделенные элементы не распознаны. Ничего не скачано. Проверь, что файлы выделены штатным Ctrl/Shift, или пришли скриншот выделения.');
      const payload={type:'QUEUE',url:location.href,all:!onlySelected,selected:onlySelected?sel.names:[]};
      let answer=await msg(payload);
      if(answer.requiresConfirm){
        const action=await chooseConflict(answer.repeated);
        if(action==='cancel')return;
        answer=await msg({...payload,conflictChoice:action});
      }
      $('#message').textContent=`Добавлено в очередь: ${answer.added||0}`;
      if(setting.progressPage)panel.classList.add('visible');
      if(setting.progressDashboard)await msg({type:'OPEN_DASHBOARD'});
    }catch(e){$('#message').textContent=e.message;panel.classList.add('visible');}
    finally{busy=false;$('#all').disabled=false;$('#selected').disabled=false;float.disabled=false;floatSelected.disabled=false;updateLabels();}
  }
  $('#all').addEventListener('click',()=>launch(false));$('#selected').addEventListener('click',()=>launch(true));
  float.addEventListener('click',()=>launch(false));
  floatSelected.addEventListener('click',()=>launch(true));
  $('#hide').addEventListener('click',()=>panel.classList.remove('visible'));
  $('#manager').addEventListener('click',()=>msg({type:'OPEN_DASHBOARD'}));
  $('#stop').addEventListener('click',async()=>{if(confirm('Остановить все загрузки?')){await msg({type:'STOP_ALL'});await refresh();}});
  $('#clearCompleted').addEventListener('click',async()=>{await msg({type:'CLEAR_COMPLETE'});await refresh();});
  $('#clearFailed').addEventListener('click',async()=>{await msg({type:'CLEAR_FAILED'});await refresh();});
  function fsize(n){if(!n)return '0 Б';const a=Math.min(4,Math.floor(Math.log(n)/Math.log(1024)));return (n/1024**a).toFixed(a?1:0)+' '+['Б','КБ','МБ','ГБ','ТБ'][a];}
  function render(jobs){
    const work=jobs.filter(x=>['queued','resolving','downloading','paused','preparing'].includes(x.status));
    $('#stats').textContent=`В работе: ${work.length} · Готово: ${jobs.filter(x=>x.status==='complete').length} · Ошибки: ${jobs.filter(x=>x.status==='failed').length} · Отменено: ${jobs.filter(x=>x.status==='canceled').length}`;
    const box=$('#items');box.replaceChildren();
    for(const j of [...work].reverse().slice(0,4)){
      const e=document.createElement('div');e.className='item';
      const top=document.createElement('div');top.className='line';const name=document.createElement('span');name.className='name';name.textContent=j.name;
      const status=document.createElement('span');status.className='desc';status.textContent=j.status==='downloading'?'Загружается':j.status==='paused'?'Пауза':'Очередь';top.append(name,status);
      const track=document.createElement('div');track.className='track';const fill=document.createElement('i');fill.style.width=(j.total?Math.min(100,j.bytes/j.total*100):0)+'%';fill.style.background=setting.accentColor;track.append(fill);
      const desc=document.createElement('div');desc.className='desc';const prev=rate.get(j.id),now=Date.now();let speed=0;
      if(prev && now-prev.t>0 && now-prev.t<12000 && j.bytes>=prev.b)speed=(j.bytes-prev.b)/((now-prev.t)/1000);
      if(!prev||now-prev.t>=1000)rate.set(j.id,{b:j.bytes||0,t:now});
      const eta=speed>1&&j.total>j.bytes?Math.ceil((j.total-j.bytes)/speed):null;
      desc.textContent=`${fsize(j.bytes)} / ${fsize(j.total)} · ${fsize(speed)}/с${eta===null?'':' · ~'+eta+' с'}`;
      e.append(top,track,desc);box.append(e);
    }
  }
  async function refresh(){try{const st=await msg({type:'STATE'});setting=st.settings||setting;
    if(!setting.progressPage)panel.classList.remove('visible');render(st.jobs||[]);applyPageTheme();updateLabels();position();
  }catch{}}
  document.documentElement.append(host);
  let previousUrl=location.href;
  const obs=new MutationObserver(()=>{if(previousUrl!==location.href){previousUrl=location.href;selectionSnapshot=[];}position();});
  obs.observe(document.body||document.documentElement,{childList:true,subtree:true});
  // Keep selected file names even if the site clears the selection when the
  // user clicks the extension (React's document-level outside-click handler).
  document.addEventListener('pointerup',e=>{
    if(e.composedPath().includes(host))return;
    setTimeout(refreshNativeSelection,70);
    setTimeout(refreshNativeSelection,230);
  },true);
  document.addEventListener('keyup',e=>{
    if(e.composedPath().includes(host))return;
    setTimeout(refreshNativeSelection,70);
  },true);
  void refresh();setInterval(refresh,1800);
})();
