(async()=>{
  const $=s=>document.querySelector(s), batchId=location.hash.slice(1);
  async function send(x){const r=await chrome.runtime.sendMessage(x);if(!r?.ok)throw new Error(r?.error||'Неизвестная ошибка');return r.data;}
  function status(s,bytes=0,total=0,error=null){return send({type:'ZIP_PROGRESS',id:batchId,status:s,bytes,total,error});}
  function set(text,pct=0){$('#line').textContent=text;$('#percent').textContent=pct.toFixed(1)+'%';$('#fill').style.width=Math.min(100,pct)+'%';}
  $('#manager').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('dashboard.html')}));
  let job;
  try {
    job=await send({type:'ZIP_GET',id:batchId});
    if(job.status==='canceled')throw new Error('Загрузка отменена');
    const zip=new JSZip();let received=0;const total=job.total||job.entries.reduce((a,e)=>a+e.size,0);
    for(let idx=0;idx<job.entries.length;idx++){
      const e=job.entries[idx],filename=e.relative.split('/').map(x=>x.replace(/[\\:*?"<>|\x00-\x1f]/g,'_')).join('/');
      set(`Файл ${idx+1}/${job.entries.length}: ${e.name}`,(received/Math.max(total,1))*85);
      const {url}=await send({type:'ZIP_LINK',id:batchId,path:e.path});
      // Works for signed Yandex CDN URLs with extension host permission.
      const response=await fetch(url);
      if(!response.ok)throw new Error(`Не удалось скачать ${e.name}: HTTP ${response.status}`);
      const kind=(response.headers.get('content-type')||'').toLowerCase();
      const length=Number(response.headers.get('content-length')||0);
      if(e.size>1048576 && length>0 && length<1024)
        throw new Error(`Вместо файла ${e.name} сервер вернул ${length} байт`);
      if(/^(text\/plain|text\/html|application\/json)/.test(kind) && !/\.(txt|json|html?)$/i.test(e.name))
        throw new Error(`Вместо файла ${e.name} сервер вернул текстовый ответ`);
      const rd=response.body?.getReader();let chunks=[];let size=0;let lastTick=0;
      if(!rd)throw new Error('Браузер не поддерживает потоковое чтение');
      while(true){
        const {done,value}=await rd.read();if(done)break;
        chunks.push(value);size+=value.length;received+=value.length;
        const now=Date.now();if(now-lastTick>800){lastTick=now;const p=(received/Math.max(total,1))*85;set(`Получаем ${e.name}`,p);await status('preparing',received,total);}
      }
      const contents=new Uint8Array(size);let ofs=0;for(const chunk of chunks){contents.set(chunk,ofs);ofs+=chunk.length;}
      chunks=[];zip.file(filename,contents,{binary:true,compression:'STORE'});
    }
    set('Упаковываем архив…',85);
    const blob=await zip.generateAsync({type:'blob',compression:'STORE',streamFiles:true},meta=>{set('Упаковываем архив…',85+meta.percent*.14);});
    // Blob URLs are created by a visible extension page (not the service worker).
    const objectUrl=URL.createObjectURL(blob);
    set('Передаём архив загрузчику браузера…',99);
    const downloadId=await chrome.downloads.download({url:objectUrl,filename:job.filename,conflictAction:job.conflictAction||'uniquify',saveAs:false});
    await send({type:'ZIP_STARTED',id:batchId,downloadId});
    set('Архив создан. Браузер сохраняет файл…',99.5);
    const timer=setInterval(async()=>{
      try{const [d]=await chrome.downloads.search({id:downloadId});
        if(d?.state==='complete'){clearInterval(timer);set('Готово. Архив сохранён!',100);setTimeout(()=>URL.revokeObjectURL(objectUrl),120000);}
        else if(d?.state==='interrupted'){clearInterval(timer);set('Ошибка при сохранении ZIP');await status('failed',0,total,d.error||'Загрузка прервана');}
      }catch{}
    },1000);
  } catch(e){set('Ошибка: '+e.message,0);if(job)await status('failed',0,job.total,e.message).catch(()=>{});}
})();
