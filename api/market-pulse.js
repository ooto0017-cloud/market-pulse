import {createHash,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createHandler} from '../worker/index.mjs';

const assets = {
  '/': readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),
  '/app.js': readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),
  '/uzum.js': readFileSync(new URL('../public/uzum.js',import.meta.url),'utf8'),
  '/style.css': readFileSync(new URL('../public/style.css',import.meta.url),'utf8')
};
const handler=createHandler(assets);
const digest=value=>createHash('sha256').update(value).digest();
const noCache={'Cache-Control':'private, no-store'};

export default {
  async fetch(request) {
    const password=process.env.MARKET_PULSE_PASSWORD;
    if (!password || password.length<24) {
      return new Response('Market Pulse is awaiting configuration.',{status:503,headers:noCache});
    }
    const auth=request.headers.get('Authorization') ?? '';
    const expected='Basic '+Buffer.from('owner:'+password,'utf8').toString('base64');
    if (!timingSafeEqual(digest(auth),digest(expected))) {
      return new Response('Sign in to Market Pulse.',{status:401,headers:{
        ...noCache,'WWW-Authenticate':'Basic realm="Market Pulse", charset="UTF-8"'
      }});
    }
    const url=new URL(request.url);
    if (url.pathname==='/api/market-pulse') {
      url.pathname='/'+(url.searchParams.get('_mp_route') ?? '');
      url.searchParams.delete('_mp_route');
    }
    const headers=new Headers(request.headers);
    headers.delete('Authorization');
    headers.set('oai-authenticated-user-id','vercel-owner');
    const options={method:request.method,headers};
    if (request.body) Object.assign(options,{body:request.body,duplex:'half'});
    const result=await handler.fetch(new Request(url,options),process.env);
    const outgoing=new Headers(result.headers);
    outgoing.set('Cache-Control',noCache['Cache-Control']);
    return new Response(result.body,{status:result.status,headers:outgoing});
  }
};
