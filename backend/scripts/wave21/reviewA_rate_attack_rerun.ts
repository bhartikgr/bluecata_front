import { trustedProxyHopCount, resolveRateLimitClientIp } from '../../server/lib/rateLimit';
const req=(xff:string|undefined,socket='10.0.0.9')=>({headers: xff?{'x-forwarded-for':xff}:{},socket:{remoteAddress:socket},ip:socket} as any);
for(const v of [undefined,'0','-1','abc','9999']){ if(v===undefined)delete process.env.TRUSTED_PROXY_HOPS; else process.env.TRUSTED_PROXY_HOPS=v; console.log(JSON.stringify({config:v??'<unset>',parsed:trustedProxyHopCount(),key:resolveRateLimitClientIp(req('198.51.100.1, 203.0.113.5'))})); }
process.env.TRUSTED_PROXY_HOPS='1';
console.log('hops1-rotated-prefix',resolveRateLimitClientIp(req('evil-A, 203.0.113.5')),resolveRateLimitClientIp(req('evil-B, 203.0.113.5')));
process.env.TRUSTED_PROXY_HOPS='9999';
const long=(selected:string)=>['prefix',selected,'a3','a4','a5','a6','a7','a8','trusted-client'].join(', ');
console.log('huge-crafted-rotation',resolveRateLimitClientIp(req(long('bucket-A'))),resolveRateLimitClientIp(req(long('bucket-B'))));
