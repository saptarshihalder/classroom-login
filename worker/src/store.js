/*
  Everything the board remembers.

  u:<sub>           one signed-in account, holding its Google refresh token
  mine:<sub>        the course slugs that account has connected
  c:<slug>          a course: who publishes it, and what Classroom says about it
  items:<slug>      everything synced for that course, public or not
  pub:<slug>        the item ids chosen for the public board
  cid:<courseId>    which slug a Classroom course already became
  file:<slug>:<id>  one mirrored attachment
  dir               the public directory, rebuilt whenever a board changes
  turn              how far the last scheduled run got through the accounts

  Attachment bytes live in R2 under <slug>/<driveId>/<name>, never in KV.
*/
import {slug as toSlug} from './util.js'

const read=(e,key)=>e.STATE.get(key,'json')
const write=(e,key,value)=>e.STATE.put(key,JSON.stringify(value))

export const account=(e,sub)=>read(e,`u:${sub}`)
export const saveAccount=(e,a)=>write(e,`u:${a.sub}`,a)

export async function accounts(e){
  let out=[],cursor
  do{
    let page=await e.STATE.list({prefix:'u:',cursor})
    out.push(...page.keys.map(k=>k.name.slice(2)))
    cursor=page.list_complete?null:page.cursor
  }while(cursor)
  return out
}

export const course=(e,slug)=>read(e,`c:${slug}`)
export const saveCourse=(e,c)=>write(e,`c:${c.slug}`,c)
export const items=async(e,slug)=>await read(e,`items:${slug}`)||[]
export const saveItems=(e,slug,list)=>write(e,`items:${slug}`,list)
export const published=async(e,slug)=>new Set(await read(e,`pub:${slug}`)||[])
export const savePublished=(e,slug,set)=>write(e,`pub:${slug}`,[...set])

export const fileRec=(e,slug,driveId)=>read(e,`file:${slug}:${driveId}`)
export const saveFile=(e,slug,driveId,rec,opts)=>e.STATE.put(`file:${slug}:${driveId}`,JSON.stringify(rec),opts)

export async function mine(e,sub){
  return await read(e,`mine:${sub}`)||[]
}

export async function claim(e,sub,slug){
  let list=await mine(e,sub)
  if(!list.includes(slug))await write(e,`mine:${sub}`,[...list,slug])
}

export async function release(e,sub,slug){
  await write(e,`mine:${sub}`,(await mine(e,sub)).filter(x=>x!==slug))
}

/* One Classroom course becomes one board, whoever connects it first.
   Anyone else enrolled who connects it joins as another publisher. */
export async function slugFor(e,courseId,name){
  let known=await e.STATE.get(`cid:${courseId}`)
  if(known)return known
  let base=toSlug(name),tag=base,n=1
  while(await e.STATE.get(`c:${tag}`))tag=`${base}-${++n}`
  await e.STATE.put(`cid:${courseId}`,tag)
  return tag
}

export async function forget(e,slug){
  let c=await course(e,slug)
  let list=await e.STATE.list({prefix:`file:${slug}:`})
  for(let k of list.keys){
    let rec=await e.STATE.get(k.name,'json')
    if(rec?.key)await e.FILES.delete(rec.key)
    await e.STATE.delete(k.name)
  }
  await e.STATE.delete(`items:${slug}`)
  await e.STATE.delete(`pub:${slug}`)
  await e.STATE.delete(`c:${slug}`)
  if(c?.courseId)await e.STATE.delete(`cid:${c.courseId}`)
  for(let sub of c?.publishers||[])await release(e,sub,slug)
}

/* The directory is small and read on every visit, so it is kept built. */
export async function rebuildDirectory(e){
  let out=[],cursor
  do{
    let page=await e.STATE.list({prefix:'c:',cursor})
    for(let k of page.keys){
      let c=await e.STATE.get(k.name,'json')
      if(!c?.live)continue
      out.push({
        slug:c.slug,name:c.name,short:c.short,section:c.section||'',
        teachers:c.teachers||[],posts:c.posts||0,files:c.files||0,
        updated:c.updated||null
      })
    }
    cursor=page.list_complete?null:page.cursor
  }while(cursor)
  out.sort((a,b)=>new Date(b.updated||0)-new Date(a.updated||0))
  await write(e,'dir',out)
  return out
}

export const directory=async e=>await read(e,'dir')||[]
