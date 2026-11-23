(() => {
  if (location.pathname.replace(/\/$/,'')!=='/my-store') return;
  const el=id=>document.getElementById(id);
  const dialog=el('uzumDialog');
  const form=el('uzumForm');
  const status=el('uzumStatus');
  const shop=el('uzumShop');
  const period=el('uzumPeriod');
  const report=el('uzumReport');
  const format=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
  const dateFormat=new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeZone:'Asia/Tashkent'});
  let connected=false;
  let activeRequest;
  el('uzumPanel').hidden=false;

  async function api(path,options) {
    const response=await fetch('/api/uzum/'+path,{cache:'no-store',...options});
    let data;
    try { data=await response.json(); }
    catch { throw new Error('Не удалось прочитать ответ. При необходимости войдите в ChatGPT заново.'); }
    if(!response.ok) throw new Error(data.error || 'Не удалось загрузить данные Uzum.');
    return data;
  }
  function setConnection(connection) {
    activeRequest?.abort();
    connected=connection.connected;
    el('uzumLive').hidden=!connected;
    el('csvDashboard').hidden=connected;
    el('import').hidden=connected;
    el('export').hidden=connected;
    el('uzumConnect').hidden=connected;
    report.hidden=true;
    shop.closest('label').hidden=!connected;
    period.closest('label').hidden=!connected;
    el('uzumRefresh').hidden=!connected;
    if (connected) {
      el('mode').textContent='Кабинет Uzum';
      shop.replaceChildren(...connection.shops.map(item=>new Option(item.name,item.id)));
      refresh();
    } else {
      el('mode').textContent=imported?'Данные из CSV':'Демонстрационные данные';
      status.textContent='Подключите кабинет, чтобы автоматически загружать продажи и остатки.';
    }
  }
  function renderRows(target,rows,empty) {
    const elements=rows.map(values=>{
      const tr=document.createElement('tr');
      for(const value of values) {
        const cell=tr.insertCell();
        cell.textContent=value;
      }
      return tr;
    });
    if (!elements.length) {
      const row=document.createElement('tr');
      const cell=row.insertCell();
      cell.colSpan=target==='uzumDays'?3:4;
      cell.textContent=empty;
      elements.push(row);
    }
    el(target).replaceChildren(...elements);
  }
  const stockAmount=value=>value===null?'—':format.format(value);
  function showReport(data) {
    const revenue=data.days.reduce((sum,day)=>sum+day.revenue,0);
    const cards=[['Расчётная выручка',format.format(revenue)+' сум'],['Заказы с продажами',format.format(data.orderCount)],['SKU в каталоге',format.format(data.stock.length)]];
    el('uzumKpis').replaceChildren(...cards.map(([title,value])=>{
      const card=document.createElement('div');
      card.className='kpi';
      const label=document.createElement('span');
      label.className='kpi-label';
      label.textContent=title;
      const metric=document.createElement('strong');
      metric.textContent=value;
      card.append(label,metric);
      return card;
    }));
    renderRows('uzumDays',[...data.days].reverse().map(day=>[dateFormat.format(new Date(day.date+'T00:00:00+05:00')),format.format(day.revenue)+' сум',format.format(day.orders)]),'Продаж за период нет.');
    renderRows('uzumStock',data.stock.map(row=>[row.code,row.name,stockAmount(row.fbo),stockAmount(row.fbs)]),'Uzum не вернул SKU.');
    report.hidden=false;
    const time=new Intl.DateTimeFormat('ru-RU',{timeStyle:'short',timeZone:'Asia/Tashkent'}).format(new Date(data.updatedAt));
    status.textContent='Обновлено в '+time+' по Ташкенту · автообновление каждые 10 минут, пока открыт кабинет.';
  }
  async function refresh() {
    if(!connected) return;
    activeRequest?.abort();
    const request=new AbortController();
    activeRequest=request;
    el('uzumRefresh').disabled=true;
    status.textContent='Загружаем продажи и остатки из Uzum…';
    try {
      const query=new URLSearchParams({shop:shop.value,period:period.value});
      const data=await api('report?'+query,{signal:request.signal});
      if (!request.signal.aborted) showReport(data);
    } catch(error) {
      if (!request.signal.aborted) status.textContent=error.message+(report.hidden?'':' Показан предыдущий отчёт.');
    } finally {
      if (activeRequest===request) {
        activeRequest=null;
        el('uzumRefresh').disabled=false;
      }
    }
  }
  el('uzumConnect').onclick=()=>{form.reset();el('uzumError').textContent='';dialog.showModal();};
  el('uzumClose').onclick=()=>dialog.close();
  dialog.onclose=()=>{el('uzumToken').value='';};
  form.onsubmit=async event=>{
    event.preventDefault();
    const submit=event.submitter;
    submit.disabled=true;
    el('uzumError').textContent='Проверяем доступ к магазину…';
    try {
      const result=await api('connection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:el('uzumToken').value})});
      dialog.close();
      setConnection(result);
    } catch(error) { el('uzumError').textContent=error.message; }
    finally { submit.disabled=false; }
  };
  el('uzumDisconnect').onclick=async event=>{
    const button=event.currentTarget;
    button.disabled=true;
    try { setConnection(await api('connection',{method:'DELETE'})); }
    catch(error) { status.textContent=error.message; }
    finally { button.disabled=false; }
  };
  el('uzumRefresh').onclick=refresh;
  shop.onchange=period.onchange=()=>{report.hidden=true;refresh();};
  setInterval(()=>{if(document.visibilityState==='visible' && !activeRequest) refresh();},600000);
  api('connection').then(setConnection).catch(error=>{
    status.textContent=error.message;
    el('uzumLive').hidden=false;
    shop.closest('label').hidden=true;
    period.closest('label').hidden=true;
    el('uzumRefresh').hidden=true;
  });
})();
