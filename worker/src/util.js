export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export const id=()=>crypto.randomUUID().replaceAll('-','')
export const safe=async(p,d)=>{try{return await p}catch{return d}}
export const num=(v,d)=>{let n=Number(v);return Number.isFinite(n)&&n>0?n:d}
export const bytes=n=>n>=1073741824?`${(n/1073741824).toFixed(1)} GB`:n>=1048576?`${(n/1048576).toFixed(1)} MB`:n>=1024?`${Math.round(n/1024)} KB`:`${n||0} B`

export const cookies=r=>Object.fromEntries((r.headers.get('cookie')||'').split(';')
  .map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2))

export function slug(s,fallback='course'){
  let out=String(s||'').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,54)
  return out||fallback
}

export function b64(u){
  let out=''
  for(let i=0;i<u.length;i+=0x8000)out+=String.fromCharCode(...u.subarray(i,i+0x8000))
  return btoa(out)
}

export async function digest(s){
  let d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')
}
