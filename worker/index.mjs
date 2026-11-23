const BASE = 'https://api-seller.uzum.uz/api/seller-openapi/';
const COOKIE = '__Host-mp-uzum';
const LIFETIME = 30 * 86400;
const DAY = 86400000;
const UZ_OFFSET = 5 * 3600000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const encode = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), char => char.charCodeAt(0));
const cookie = (value, seconds) => COOKIE+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+seconds;

class RequestError extends Error {
  constructor(status,message) { super(message); this.status=status; }
}
function json(body,status=200,headers={}) {
  return Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...headers}});
}
async function encryptionKey(env) {
  if (!env.UZUM_COOKIE_KEY) throw new RequestError(503,'Подключение Uzum ещё не настроено.');
  return crypto.subtle.importKey('raw',decode(env.UZUM_COOKIE_KEY),'AES-GCM',false,['encrypt','decrypt']);
}
async function saveToken(token,user,key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const value = encoder.encode(JSON.stringify({token, expires:Date.now()+LIFETIME*1000}));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(user)},key,value);
  return encode(iv)+'.'+encode(new Uint8Array(encrypted));
}
async function getToken(request,user,key) {
  const raw = (request.headers.get('cookie') ?? '').split(';').map(item=>item.trim()).find(item=>item.startsWith(COOKIE+'='));
  if (!raw) return null;
  try {
    const [nonce,value] = raw.slice(COOKIE.length+1).split('.');
    const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(nonce),additionalData:encoder.encode(user)},key,decode(value));
    const result = JSON.parse(decoder.decode(plain));
    return result.expires>Date.now() ? result.token : null;
  } catch { return null; }
}
async function uzum(token,path,query={}) {
  const endpoint = new URL(path,BASE);
  endpoint.search = new URLSearchParams(query);
  const requestId=crypto.randomUUID();
  let result;
  try {
    result = await fetch(endpoint,{headers:{Authorization:token,Accept:'application/json','X-Request-Id':requestId},redirect:'error',signal:AbortSignal.timeout(12000)});
  } catch { throw new RequestError(502,'Uzum не ответил. Повторите запрос позже.'); }
  if (result.status===401 || result.status===403) {
    throw new RequestError(422,`Uzum вернул HTTP ${result.status}. Запрос ${requestId}.`);
  }
  if (result.status===429) throw new RequestError(429,'Uzum временно ограничил запросы. Подождите и обновите отчёт.');
  if (!result.ok) throw new RequestError(502,'Uzum вернул ошибку при загрузке отчёта.');
  try { return await result.json(); }
  catch { throw new RequestError(502,'Uzum вернул ответ в неизвестном формате.'); }
}
async function shops(token) {
  const items=await uzum(token,'v1/shops');
  if (!Array.isArray(items)) throw new RequestError(502,'Не удалось прочитать список магазинов Uzum.');
  return items.filter(row=>Number.isSafeInteger(row.id) && row.id>0).map(row=>({id:row.id,name:String(row.name || row.id)}));
}
async function pages(token,path,query,itemsKey,totalKey) {
  const all=[];
  const size=100;
  for(let page=0;page<20;page++) {
    const result=await uzum(token,path,{...query,page,size});
    const items=result?.[itemsKey];
    if(!Array.isArray(items)) throw new RequestError(502,'Uzum вернул список в неизвестном формате.');
    all.push(...items);
    const total=result[totalKey];
    if (Number.isSafeInteger(total) ? all.length>=total : items.length<size) return all;
    if (!items.length) throw new RequestError(502,'Uzum вернул неполный список. Обновите отчёт.');
  }
  throw new RequestError(422,'Отчёт превышает 2 000 записей одного типа. Выберите более короткий период. Если лимит сохраняется, обратитесь за расширением отчёта.');
}
function dayKey(timestamp) {
  return new Date(timestamp+UZ_OFFSET).toISOString().slice(0,10);
}
function normalize(orders,products,from,to) {
  const byDay=new Map();
  for(let day=from;day<=to;day+=DAY) byDay.set(dayKey(day),{date:dayKey(day),revenue:0,orders:new Set()});
  const seen=new Set();
  for (const item of orders) {
    if (!Number.isSafeInteger(item.id) || !Number.isSafeInteger(item.orderId) || !Number.isSafeInteger(item.date) ||
      !Number.isFinite(item.sellerPrice) || item.sellerPrice<0 || !Number.isSafeInteger(item.amount) || item.amount<0) {
      throw new RequestError(502,'В отчёте Uzum отсутствуют данные для расчёта продаж.');
    }
    if(seen.has(item.id)) continue;
    seen.add(item.id);
    const bucket=byDay.get(dayKey(item.date));
    if (!bucket || item.status==='CANCELED') continue;
    const adjusted=Math.max(0,item.amount-Math.max(0,item.amountReturns??0)-Math.max(0,item.cancelled??0));
    if(!adjusted) continue;
    bucket.revenue+=adjusted*item.sellerPrice;
    bucket.orders.add(item.orderId);
  }
  const stock=[];
  for (const product of products) {
    if (!Array.isArray(product.skuList)) throw new RequestError(502,'Uzum не вернул список SKU товара.');
    for (const sku of product.skuList) {
      stock.push({
        code:String(sku.skuTitle ?? sku.skuId ?? ''),
        name:String(product.title ?? sku.skuFullTitle ?? ''),
        fbo:Number.isSafeInteger(sku.quantityActive) ? sku.quantityActive : null,
        fbs:Number.isSafeInteger(sku.quantityFbs) ? sku.quantityFbs : null
      });
    }
  }
  const uniqueOrders=new Set();
  for (const item of byDay.values()) for(const order of item.orders) uniqueOrders.add(order);
  return {orderCount:uniqueOrders.size,days:[...byDay.values()].map(day=>({...day,orders:day.orders.size})),stock,updatedAt:new Date().toISOString()};
}
async function api(request,env,url) {
  const user=request.headers.get('oai-authenticated-user-id');
  if (!user) return json({error:'Войдите в Market Pulse, чтобы открыть подключение Uzum.'},401);
  if (request.method!=='GET' && request.headers.get('origin')!==url.origin) return json({error:'Недопустимый источник запроса.'},403);
  try {
    const key=await encryptionKey(env);
    if (url.pathname==='/api/uzum/connection') {
      if(request.method==='DELETE') return json({connected:false},200,{'Set-Cookie':cookie('',0)});
      if(request.method==='POST') {
        if(!request.headers.get('content-type')?.startsWith('application/json')) throw new RequestError(415,'Ожидается JSON.');
        let body;
        try { body=JSON.parse(await new Response(request.body?.pipeThrough(new TransformStream({
          transform(chunk,controller){this.size=(this.size??0)+chunk.length;if(this.size>4096) throw new Error();controller.enqueue(chunk);}
        }))).text()); }
        catch { throw new RequestError(400,'Некорректный запрос.'); }
        const token=typeof body?.token==='string' ? body.token.trim() : '';
        if(!/^[\x21-\x7E]{8,2000}$/.test(token)) throw new RequestError(400,'Вставьте API-ключ из кабинета продавца.');
        const list=await shops(token);
        if (!list.length) throw new RequestError(422,'Ключ не даёт доступа ни к одному магазину.');
        return json({connected:true,shops:list},200,{'Set-Cookie':cookie(await saveToken(token,user,key),LIFETIME)});
      }
      if(request.method==='GET') {
        const token=await getToken(request,user,key);
        return token ? json({connected:true,shops:await shops(token)}) : json({connected:false,shops:[]});
      }
    }
    if (url.pathname==='/api/uzum/report' && request.method==='GET') {
      const token=await getToken(request,user,key);
      if(!token) throw new RequestError(401,'Подключите ключ Uzum.');
      const shop=url.searchParams.get('shop') ?? '';
      const period=Number(url.searchParams.get('period'));
      if(!/^[1-9]\d{0,15}$/.test(shop) || !Number.isSafeInteger(Number(shop)) || ![7,14,30,60,90].includes(period)) throw new RequestError(400,'Выберите магазин и период.');
      const today=Date.parse(dayKey(Date.now())+'T00:00:00+05:00');
      const from=today-(period-1)*DAY;
      const [sales,inventory]=await Promise.allSettled([
        pages(token,'v1/finance/orders',{shopIds:shop,group:false,dateFrom:from,dateTo:Date.now()},'orderItems','totalElements')
          .then(rows=>normalize(rows,[],from,today)),
        pages(token,'v1/product/shop/'+shop,{},'productList','totalProductsAmount')
          .then(rows=>normalize([],rows,from,today).stock)
      ]);
      const describe=(result,label,path)=>result.status==='rejected'
        ? `${label} (GET /${path}): ${result.reason instanceof RequestError ? result.reason.message : 'Не удалось загрузить данные.'}`
        : null;
      const errors=[
        describe(sales,'Продажи','v1/finance/orders'),
        describe(inventory,'Остатки','v1/product/shop/'+shop)
      ].filter(Boolean);
      return json({
        days:sales.value?.days ?? null,
        orderCount:sales.value?.orderCount ?? null,
        stock:inventory.value ?? null,
        errors,
        updatedAt:new Date().toISOString()
      });
    }
    return json({error:'Метод не найден.'},404);
  } catch (error) {
    return json({error:error instanceof RequestError ? error.message : 'Не удалось загрузить данные Uzum.'},error instanceof RequestError ? error.status : 500);
  }
}
export function createHandler(assets) {
return {
  async fetch(request,env) {
    const url=new URL(request.url);
    if (url.pathname.startsWith('/api/uzum/')) return api(request,env,url);
    const path=url.pathname.replace(/\/$/,'') || '/';
    const routes=['/','/dashboard','/my-store','/my-store-wb'];
    const key=routes.includes(path)?'/':path;
    if(!['GET','HEAD'].includes(request.method) || !Object.hasOwn(assets,key)) return new Response('Not found',{status:404});
    const type=key==='/'?'text/html':key.endsWith('.css')?'text/css':'text/javascript';
    return new Response(request.method==='HEAD'?null:assets[key],{headers:{'Content-Type':type+'; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'"}});
  }
};
}
