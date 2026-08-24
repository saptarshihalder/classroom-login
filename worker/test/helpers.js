/* Just enough KV and R2 to run the worker's logic off Cloudflare. */
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

export function fakeR2(){
  let m=new Map()
  return {
    dump:()=>m,
    put:async(k,body,opts)=>void m.set(k,{body,opts}),
    get:async k=>m.get(k)||null,
    delete:async k=>void m.delete(k)
  }
}

export const env=(kv,r2)=>({STATE:kv,FILES:r2||fakeR2()})
