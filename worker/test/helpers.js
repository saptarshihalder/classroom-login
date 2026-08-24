/* Just enough KV to run the worker's logic off Cloudflare. */
export function fakeKV(seed={}){
  let m=new Map(Object.entries(seed))
  return {
    dump:()=>m,
    get:async(k,t)=>{let v=m.get(k);return v===undefined?null:t==='json'?JSON.parse(v):v},
    put:async(k,v)=>void m.set(k,typeof v==='string'?v:JSON.stringify(v)),
    delete:async k=>void m.delete(k),
    list:async({prefix='',cursor}={})=>({
      keys:[...m.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),
      list_complete:true,cursor:undefined
    })
  }
}

export const env=kv=>({STATE:kv})
