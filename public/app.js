const byId = id => document.getElementById(id);
const page = ['my-store','my-store-wb'].includes(location.pathname.split('/')[1]) ? location.pathname.split('/')[1] : 'dashboard';
const market = page === 'dashboard';
const wb = page === 'my-store-wb';
const name = market ? 'Обзор рынка' : wb ? 'Магазин Wildberries' : 'Магазин Uzum';
const scope = market || !wb ? 'Uzum Market' : 'Wildberries';
const currencyUnit = wb ? '₽' : 'сум';
const numbers = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 1});
const compact = new Intl.NumberFormat('ru-RU', {notation:'compact', maximumFractionDigits: 1});
const dates = new Intl.DateTimeFormat('ru-RU', {day:'numeric', month:'short', timeZone:'UTC'});
const fmtDate = date => dates.format(new Date(date + 'T00:00:00Z'));
const amount = value => numbers.format(value) + ' ' + currencyUnit;
const shiftDate = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0,10);
const metrics = {revenue:'Выручка', orders:'Заказы', average:'Средний чек', profit:'Чистая прибыль', stock:'Остаток'};
const supported = market ? ['revenue','orders','average','stock'] : ['revenue','orders','profit','average'];
const symbols = {revenue:'◉',orders:'▤',average:'◌',profit:'◇',stock:'▦'};
const periods = [7,14,30,60,90];
const params = new URLSearchParams(location.search);
const isMetric = metric => supported.includes(metric);
const state = {
  period: periods.includes(+params.get('period')) ? +params.get('period') : 30,
  metric: isMetric(params.get('metric')) ? params.get('metric') : 'revenue',
  end:'', selected:null, sort:'revenue', desc:true
};
const storageKey = 'market-pulse-data:' + page;
const columns = ['date','sku','name','category','revenue','orders','stock','cost','fees','returns'];
const products = [
  ['A110','Беспроводные наушники Aero','Электроника',189000],
  ['A245','Колонка Mini Sound','Электроника',249000],
  ['H032','Органайзер Loft','Дом и быт',89000],
  ['H120','Лампа Orbit','Дом и быт',139000],
  ['S210','Термобутылка Trail','Спорт',109000],
  ['S225','Коврик для йоги Balance','Спорт',125000]
];
const demoEnd = '2026-11-23';
const wave = [0.79,0.66,0.86,0.72,0.61,0.95,0.81,1.03,0.77,0.94,0.87,1.13,0.74,1.08,0.93,1.16,0.85,1.24,0.93,1.14,1.05,1.21,0.91,1.15,1.32,1.05,1.29,1.48,1.18,1.42];
const demo = Array.from({length:180},(_,day) => products.map(([sku,name,category,price], index) => {
  const date = shiftDate(demoEnd, day-179);
  const orders = Math.max(1,Math.round((39-index*5) * wave[day%30] * (.65+day/300) + (day*(index+3)%11)-5)) * (market ? 135 : 1);
  const revenue = Math.round(price * (wb ? .0078 : 1))*orders;
  return {date,sku,name,category,orders,revenue,stock:(index === 1 ? 6+day%3 : 44+((day*3+index*29)%180))*(market?85:1),cost:Math.round(revenue*(.43+index*.012)), fees:Math.round(revenue*.145), returns:Math.round(revenue*(.01+(day%7)*.004))};
})).flat();
let imported = readStorage(storageKey);
let data = imported ?? demo;
const sum = (rows,key) => rows.reduce((total,row)=>total+row[key],0);
function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key)); }
  catch { return null; }
}
function aggregate(rows) {
  const result = Object.fromEntries(['revenue','orders','cost','fees','returns'].map(key=>[key,sum(rows,key)]));
  result.average = result.orders ? result.revenue/result.orders : 0;
  result.profit = result.revenue-result.cost-result.fees-result.returns;
  result.stock = sum(latestBySku(rows),'stock');
  return result;
}
function latestBySku(rows) {
  const latest = new Map();
  for (const row of rows) {
    if (!latest.has(row.sku) || latest.get(row.sku).date <= row.date) latest.set(row.sku,row);
  }
  return [...latest.values()];
}
function setEnd(value) {
  const dateList = data.map(row=>row.date).sort();
  byId('end').min = dateList[0];
  byId('end').max = dateList.at(-1);
  state.end = value >= dateList[0] && value <= dateList.at(-1) ? value : dateList.at(-1);
  byId('end').value = state.end;
  state.selected = null;
}
function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content != null) element.textContent = content;
  if (className) element.className = className;
  return element;
}
function fillSelect(id, options) {
  const select = byId(id);
  const previous = select.value;
  select.replaceChildren(...options.map(([key,label])=>new Option(label,key)));
  if (options.some(([key])=>key===previous)) select.value=previous;
}
function showValue(key,value) {
  return ['orders','stock'].includes(key) ? numbers.format(value) : amount(value);
}
function syncUrl() {
  const url = new URL(location.href);
  url.searchParams.set('period',state.period);
  url.searchParams.set('metric',state.metric);
  url.searchParams.set('end',state.end);
  history.replaceState(null,'',url);
}
function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.sku)) groups.set(row.sku,[]);
    groups.get(row.sku).push(row);
  }
  return [...groups.values()].map(group => ({...latestBySku(group)[0], ...aggregate(group)}));
}
let currentRows = [];
let daily = [];
function render() {
  const first = shiftDate(state.end,1-state.period);
  const previous = shiftDate(first,-state.period);
  currentRows = data.filter(row=>row.date>=first && row.date<=state.end);
  const pastRows = data.filter(row=>row.date>=previous && row.date<first);
  const totals = aggregate(currentRows);
  const baseline = aggregate(pastRows);
  byId('mode').textContent = imported ? 'Данные из CSV' : 'Демонстрационные данные';
  byId('range').textContent = fmtDate(first) + ' — ' + fmtDate(state.end);
  byId('metric').value = state.metric;
  for (const button of byId('periods').children) button.setAttribute('aria-pressed',Number(button.dataset.period)===state.period);
  for (const button of byId('kpis').children) {
    const key = button.dataset.metric;
    const before = baseline[key];
    const change = before ? (totals[key]-before)/Math.abs(before)*100 : null;
    button.setAttribute('aria-pressed',key===state.metric);
    button.querySelector('strong').textContent=showValue(key,totals[key]);
    const changeLabel=button.querySelector('.change');
    changeLabel.textContent=change===null ? '—' : (change>0?'+':'')+numbers.format(change)+'%';
    changeLabel.classList.toggle('negative',change<0);
    button.querySelector('.compare').textContent = change===null ? 'нет базы сравнения' : 'к прошлому периоду';
  }
  const groups = new Map();
  for (const row of currentRows) {
    if (!groups.has(row.date)) groups.set(row.date,[]);
    groups.get(row.date).push(row);
  }
  daily = Array.from({length:state.period},(_,i)=>{
    const date=shiftDate(first,i);
    return {date,value:groups.has(date) ? aggregate(groups.get(date))[state.metric] : null};
  });
  if (!state.selected || state.selected<first || state.selected>state.end) state.selected=state.end;
  renderChart();
  renderSummary(totals);
  fillSelect('category',[['','Все категории'],...Array.from(new Set(currentRows.map(row=>row.category))).sort().map(value=>[value,value])]);
  renderTable();
}
function renderChart() {
  const key = state.metric;
  byId('chartTitle').textContent=metrics[key]+' по дням';
  byId('chartDesc').textContent=scope+' · '+state.period+' дн.';
  byId('legend').textContent=metrics[key];
  const high = Math.max(1,...daily.map(item=>item.value ?? 0));
  const low = Math.min(0,...daily.map(item=>item.value ?? 0));
  const span = high-low;
  byId('scale').replaceChildren(...[1,2/3,1/3,0].map(factor=>node('span',compact.format(low+span*factor))));
  byId('bars').replaceChildren(...daily.map(item=>{
    const button=node('button');
    button.type='button';
    button.style.setProperty('--height',Math.abs(item.value??0)/span*100+'%');
    const base = (Math.min(0,item.value ?? 0)-low)/span*100;
    button.style.bottom=base+'%';
    button.title=fmtDate(item.date)+' · '+(item.value===null?'нет данных':showValue(key,item.value));
    button.setAttribute('aria-label',button.title);
    button.setAttribute('aria-pressed',item.date===state.selected);
    button.onclick=()=>{
      state.selected=item.date;
      for(const bar of byId('bars').querySelectorAll('button')) bar.setAttribute('aria-pressed',bar===button);
      updateDay();
    };
    const slot=node('div',null,'bar-slot');
    slot.append(button);
    return slot;
  }));
  byId('ticks').replaceChildren(...[0,.25,.5,.75,1].map(fraction=>node('span',fmtDate(daily[Math.round((daily.length-1)*fraction)].date))));
  updateDay();
}
function updateDay() {
  const selected=daily.find(item=>item.date===state.selected);
  byId('dayValue').replaceChildren(document.createTextNode(selected.value===null?'Нет данных':showValue(state.metric,selected.value)),node('small',fmtDate(selected.date)));
}
function renderSummary(totals) {
  byId('summaryTitle').textContent=market?'Срез рынка':'Прибыли и убытки';
  byId('summaryDesc').textContent=market?'Итоги выбранного периода':'Выручка за вычетом расходов';
  const fields = market
    ? [['Выручка',amount(totals.revenue)],['Заказы',numbers.format(totals.orders)],['Средний чек',amount(totals.average)],['Товары с данными',numbers.format(latestBySku(currentRows).length)],['Остаток, шт.',numbers.format(totals.stock)]]
    : [['Выручка',amount(totals.revenue)],['Себестоимость',amount(-totals.cost)],['Комиссии и прочие расходы',amount(-totals.fees)],['Возвраты',amount(-totals.returns)],['Маржа',totals.revenue ? numbers.format(totals.profit/totals.revenue*100)+'%' : '—']];
  const elements=fields.map(([label,value])=>{
    const row=node('div',null,'summary-row');
    row.append(node('span',label),node('b',value));
    return row;
  });
  if (!market) {
    const total=node('div',null,'summary-total');
    total.append(node('b','Чистая прибыль'),node('b',amount(totals.profit)));
    elements.push(total);
  }
  byId('summary').replaceChildren(...elements);
}
function visibleProducts() {
  const query=byId('search').value.trim().toLocaleLowerCase('ru');
  const category=byId('category').value;
  return groupRows(currentRows)
    .filter(item=>(!category || item.category===category) && (item.name+' '+item.sku).toLocaleLowerCase('ru').includes(query))
    .sort((a,b)=>(a[state.sort]-b[state.sort])*(state.desc?-1:1) || a.sku.localeCompare(b.sku));
}
function renderTable() {
  const products=visibleProducts();
  byId('count').textContent='Позиций: '+products.length;
  for (const button of document.querySelectorAll('[data-sort]')) {
    button.closest('th').setAttribute('aria-sort',button.dataset.sort===state.sort ? (state.desc?'descending':'ascending') : 'none');
    button.textContent=metrics[button.dataset.sort]+(button.dataset.sort===state.sort?(state.desc?' ↓':' ↑'):'');
  }
  const entries=products.map(item=>{
    const row=node('tr');
    const info=node('div',null,'product');
    const labels=node('div');
    labels.append(node('b',item.name),node('small','SKU '+item.sku));
    info.append(node('span',item.name.slice(0,1),'product-mark'),labels);
    const first=node('td');
    first.append(info);
    row.append(first,node('td',item.category),node('td',amount(item.revenue)),node('td',numbers.format(item.orders)),node('td',numbers.format(item.stock),item.stock<10?'low':''));
    return row;
  });
  if (!entries.length) {
    const row=node('tr');
    const cell=node('td','По выбранным условиям товаров нет.');
    cell.colSpan=5;
    row.append(cell);
    entries.push(row);
  }
  byId('rows').replaceChildren(...entries);
}
let toastTimeout;
function toast(message) {
  byId('toast').textContent=message;
  byId('toast').hidden=false;
  clearTimeout(toastTimeout);
  toastTimeout=setTimeout(()=>byId('toast').hidden=true,3500);
}
function download(filename, records) {
  const escapeCell=value=>{
    const text=String(value);
    const safe=typeof value==='string' && /^[\s]*[=+@-]/.test(text) ? "'"+text : text;
    return '"'+safe.replaceAll('"','""')+'"';
  };
  const csv=records.map(row=>row.map(escapeCell).join(';')).join('\r\n');
  const uri=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'}));
  const link=node('a');
  link.href=uri;
  link.download=filename;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(uri),1000);
}
function parseCSV(text) {
  text=text.replace(/^\uFEFF/,'');
  const delimiter=text.split(/\r?\n/,1)[0].includes(';')?';':',';
  text=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const lines=[];
  let row=[],field='',quoted=false,closed=false;
  for (let index=0;index<=text.length;index++) {
    const char=text[index]??'\n';
    if (quoted) {
      if (char==='"' && text[index+1]==='"') {field+='"';index++;}
      else if (char==='"') {quoted=false;closed=true;}
      else field+=char;
    } else if (char===delimiter || char==='\n') {
      row.push(field.trim());
      field='';
      closed=false;
      if (char==='\n') {
        if (row.some(Boolean)) lines.push(row);
        row=[];
      }
    } else if (char==='"' && !field && !closed) {
      quoted=true;
    } else if (closed || char==='"') {
      throw new Error('Проверьте кавычки в CSV.');
    } else field+=char;
  }
  if (quoted) throw new Error('В CSV есть незакрытая кавычка.');
  const header=lines.shift()??[];
  if (header.length!==columns.length || columns.some(key=>!header.includes(key))) throw new Error('Заголовки должны совпадать с образцом CSV.');
  if (!lines.length) throw new Error('В файле нет строк с данными.');
  const seen=new Set();
  return lines.map((cells,index)=>{
    const row=Object.fromEntries(header.map((key,i)=>[key,cells[i]]));
    const error=message=>new Error('Строка '+(index+2)+'. '+message);
    if(cells.length!==header.length || cells.some(cell=>!cell)) throw error('Заполните все столбцы.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date)) || shiftDate(row.date,0)!==row.date) throw error('Дата должна быть в формате ГГГГ-ММ-ДД.');
    const keys=columns.slice(4);
    for(const key of keys){
      const value=Number(row[key].replace(',','.'));
      if(!/^\d+(?:[.,]\d+)?$/.test(row[key]) || !Number.isFinite(value) || value>1e12 || (['orders','stock'].includes(key) && !Number.isInteger(value))) throw error('Некорректное число в поле '+key+'.');
      row[key]=value;
    }
    const id=JSON.stringify([row.date,row.sku]);
    if(seen.has(id)) throw error('Для даты и SKU допустима одна запись.');
    seen.add(id);
    return row;
  });
}
byId('title').textContent=name;
byId('crumb').textContent=name;
byId('context').textContent=market?'АНАЛИТИКА РЫНКА · UZUM':'АНАЛИТИКА ПРОДАВЦА · '+scope.toUpperCase();
byId('subtitle').textContent=market?'Динамика продаж и популярные товары Uzum Market.':'Продажи, прибыль и остатки товаров в одном отчёте.';
document.querySelector('[data-page="'+page+'"]').setAttribute('aria-current','page');
document.documentElement.dataset.theme=readStorage('market-pulse-theme')==='dark'?'dark':'light';
byId('theme').onclick=()=>{
  const next=document.documentElement.dataset.theme==='dark'?'light':'dark';
  document.documentElement.dataset.theme=next;
  try { localStorage.setItem('market-pulse-theme',JSON.stringify(next)); } catch {}
};
for(const period of periods){
  const button=node('button',period+' дн.');
  button.dataset.period=period;
  button.onclick=()=>{state.period=period;syncUrl();render();};
  byId('periods').append(button);
}
function selectMetric(key){state.metric=key;syncUrl();render();}
fillSelect('metric',supported.map(key=>[key,metrics[key]]));
byId('metric').onchange=event=>selectMetric(event.target.value);
for(const key of supported){
  const button=node('button',null,'kpi');
  button.dataset.metric=key;
  const label=node('span',null,'kpi-label');
  label.append(node('i',symbols[key]),node('span',metrics[key]));
  button.append(label,node('strong'),node('span',null,'change'),node('span',null,'compare'));
  button.onclick=()=>selectMetric(key);
  byId('kpis').append(button);
}
byId('end').onchange=event=>{setEnd(event.target.value);syncUrl();render();};
byId('search').oninput=renderTable;
byId('category').onchange=renderTable;
for (const button of document.querySelectorAll('[data-sort]')) button.onclick=()=>{
  state.desc=state.sort===button.dataset.sort?!state.desc:true;
  state.sort=button.dataset.sort;
  renderTable();
};
byId('export').onclick=()=>{
  const rows=visibleProducts();
  if (!rows.length) {toast('Нет товаров для экспорта.');return;}
  download('market-pulse-'+page+'-'+state.end+'.csv',[
    ['SKU','Товар','Категория','Валюта','Выручка','Заказы','Остаток','Себестоимость','Расходы','Возвраты','Прибыль','Начало','Конец'],
    ...rows.map(r=>[r.sku,r.name,r.category,currencyUnit,r.revenue,r.orders,r.stock,r.cost,r.fees,r.returns,r.profit,shiftDate(state.end,1-state.period),state.end])
  ]);
  toast('Отчёт сформирован.');
};
const dialog=byId('importDialog');
byId('import').onclick=()=>{
  byId('importForm').reset();
  byId('importError').textContent='';
  byId('restoreDemo').disabled=!imported;
  dialog.showModal();
};
byId('dismiss').onclick=()=>dialog.close();
byId('template').onclick=()=>download('market-pulse-template.csv',[columns,...demo.slice(-12).map(row=>columns.map(key=>row[key]))]);
byId('restoreDemo').onclick=()=>{
  try {
    localStorage.removeItem(storageKey);
    imported=null;
    data=demo;
    setEnd();
    syncUrl();
    render();
    dialog.close();
    toast('Данные демо восстановлены.');
  } catch {byId('importError').textContent='Браузер запретил доступ к локальным данным.';}
};
byId('importForm').onsubmit=async event=>{
  event.preventDefault();
  const submit=event.submitter;
  submit.disabled=true;
  try {
    const file=byId('csv').files[0];
    if(!file || file.size>2000000) throw new Error('Выберите CSV размером до 2 МБ.');
    const rows=parseCSV(await file.text());
    try { localStorage.setItem(storageKey,JSON.stringify(rows)); }
    catch { throw new Error('Недостаточно места или браузер запретил сохранение данных.'); }
    imported=rows;
    data=rows;
    setEnd();
    syncUrl();
    render();
    dialog.close();
    toast('Импортировано строк: '+rows.length);
  } catch(error) {byId('importError').textContent=error.message;}
  finally {submit.disabled=false;}
};
setEnd(params.get('end'));
render();
