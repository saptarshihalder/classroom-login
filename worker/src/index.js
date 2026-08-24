import {cookies,id,num,safe} from './util.js'
import * as db from './store.js'
import * as g from './google.js'
import * as sync from './sync.js'
import {landing,home,manage,notice} from './pages.js'

const open={'access-control-allow-origin':'*'}
const json=(x,seconds=30)=>new Response(JSON.stringify(x),
  {headers:{'content-type':'application/json; charset=utf-8','cache-control':`public, max-age=${seconds}`,...open}})
const gone=(text,status)=>new Response(text,{status,headers:{...open,'content-type':'text/plain; charset=utf-8'}})
const site=e=>String(e.SITE_URL||'').replace(/\/*$/,'/')

async function me(r,e){
  let sid=cookies(r).sid
  if(!sid)return null
  let sub=await e.STATE.get(`sess:${sid}`)
  return sub?await db.account(e,sub):null
}

async function body(r){
  let form=await r.formData()
  return {form,slug:String(form.get('slug')||''),ids:form.getAll('id').map(String)}
}

/* Only someone who connected the course may change its board. */
async function ownedBy(e,acct,slug){
  let c=await db.course(e,slug)
  if(!c||!c.publishers.includes(acct.sub))return null
  return c
}

async function serveFile(r,e,key){
  let [slug,fid]=key.split('/')
  let course=await db.course(e,slug),file=await db.fileRec(e,slug,fid)
  if(!course?.live||file?.status!=='ok')return gone('not found',404)

  /* Stream from Drive as one of the connected publishers. This keeps the
     service on Cloudflare's free tier: no paid object-storage subscription. */
  for(let sub of course.publishers||[]){
    let acct=await db.account(e,sub)
    if(!acct?.refresh)continue
    try{
      let source=await g.driveBody(e,acct,fid,file.exportAs||'')
      let h=new Headers(open)
      h.set('content-type',file.mime||source.headers.get('content-type')||'application/octet-stream')
      h.set('cache-control','public, max-age=300')
      h.set('content-disposition',`inline; filename*=UTF-8''${encodeURIComponent(file.name||'course-file')}`)
      return new Response(r.method==='HEAD'?null:source.body,{status:200,headers:h})
    }catch{}
  }
  return gone('file is temporarily unavailable',503)
}

async function dashboard(e,acct,message=''){
  let slugs=await db.mine(e,acct.sub)
  let boards=(await Promise.all(slugs.map(s=>db.course(e,s)))).filter(Boolean)
  let courses=await safe(g.myCourses(e,acct),[])
  let fresh=await db.account(e,acct.sub)
  return home({email:acct.email,boards,courses,site:site(e),message,stale:fresh?.stale})
}

async function managePage(e,acct,slug,message=''){
  let course=await ownedBy(e,acct,slug)
  if(!course)return notice('Not your board','That board belongs to someone else, or it no longer exists.',404)
  let items=await db.items(e,slug)
  let chosen=await db.published(e,slug)
  let queued=0
  for(let x of items){
    if(!chosen.has(x.id))continue
    for(let d of x.drive||[])if(!await db.fileRec(e,slug,d.id))queued++
  }
  return manage({course,items,chosen,site:site(e),message,queued})
}

async function route(r,e){
  let url=new URL(r.url),path=url.pathname

  if(r.method==='OPTIONS')return new Response(null,{headers:{...open,'access-control-allow-methods':'GET,HEAD,OPTIONS'}})

  /* what readers and the public site use */
  if(path==='/api/directory')return json(await db.directory(e),60)
  if(path.startsWith('/api/board/')){
    let made=await sync.board(e,decodeURIComponent(path.slice(11)))
    return made?json(made):json({error:'no such board'},10)
  }
  if(path.startsWith('/f/'))return serveFile(r,e,decodeURIComponent(path.slice(3)))
  if(path==='/health')return json({ok:true,boards:(await db.directory(e)).length},0)

  /* signing in */
  if(path==='/login'){
    let state=id()
    await e.STATE.put(`oauth:${state}`,'1',{expirationTtl:600})
    return Response.redirect(g.authUrl(e,url.origin,state),302)
  }
  if(path==='/oauth'){
    let state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||''
    if(!state||!code||!await e.STATE.get(`oauth:${state}`))
      return notice('Sign-in expired','Start the sign-in again from the front page.')
    await e.STATE.delete(`oauth:${state}`)
    let tokens=await g.exchange(e,url.origin,code)
    let who=await g.whoIs(tokens.access_token)
    let existing=await db.account(e,who.sub)
    if(!tokens.refresh_token&&!existing?.refresh)
      return notice('Sign-in incomplete','Google did not grant offline access. Remove this app from your Google account permissions, then sign in again.')
    if(e.ALLOWED_DOMAIN&&!String(who.email||'').toLowerCase().endsWith(`@${e.ALLOWED_DOMAIN.toLowerCase()}`))
      return notice('Not this account',`Boards here are limited to ${e.ALLOWED_DOMAIN} accounts.`,403)
    await db.saveAccount(e,{
      sub:who.sub,email:who.email||'',name:who.name||'',
      refresh:tokens.refresh_token||existing.refresh,stale:false,
      at:existing?.at||new Date().toISOString()
    })
    let sid=id()
    await e.STATE.put(`sess:${sid}`,who.sub,{expirationTtl:60*60*24*30})
    return new Response(null,{status:302,headers:{location:'/','set-cookie':`sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`}})
  }
  if(path==='/logout'){
    let sid=cookies(r).sid
    if(sid)await e.STATE.delete(`sess:${sid}`)
    return new Response(null,{status:302,headers:{location:'/','set-cookie':'sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}})
  }

  let acct=await me(r,e)
  if(!acct)return path==='/'?landing(site(e)):notice('Signed out','Sign in again to manage your boards.',401)

  if(r.method==='GET'&&path==='/')return dashboard(e,acct)
  if(r.method==='GET'&&path.startsWith('/b/'))return managePage(e,acct,decodeURIComponent(path.slice(3)))

  if(r.method!=='POST')return notice('Not found','That page does not exist.',404)

  if(path==='/connect'){
    let {form}=await body(r)
    let courseId=String(form.get('course')||'')
    let picked=(await safe(g.myCourses(e,acct),[])).find(c=>c.id===courseId)
    if(!picked)return notice('Course not found','That course is not one this account is enrolled in.',404)
    let slug=await sync.connect(e,acct,courseId,picked.name||'course')
    await sync.settle(e,slug)
    return managePage(e,acct,slug,'Course connected. Choose what readers can see, then put the board up.')
  }

  let {slug,ids}=await body(r)
  let course=await ownedBy(e,acct,slug)
  if(!course)return notice('Not your board','That board belongs to someone else, or it no longer exists.',404)

  if(path==='/sync'){
    await sync.syncCourse(e,acct,slug)
    await sync.settle(e,slug)
    return managePage(e,acct,slug,'Synced with the course.')
  }
  if(path==='/files'){
    let got=await sync.mirror(e,slug,acct,num(e.MIRROR_BATCH,6)*2)
    await sync.settle(e,slug)
    return managePage(e,acct,slug,got.left?`Prepared ${got.done}. ${got.left} still queued.`:'Attachments are ready.')
  }
  if(path==='/live'){
    let changed={...course,live:!course.live}
    await db.saveCourse(e,changed)
    await sync.settle(e,slug,changed)
    return managePage(e,acct,slug,course.live?'The board is down. Readers see nothing now.':'The board is up. Anyone with the link can read it.')
  }
  if(path==='/remove'){
    await db.forget(e,slug)
    await db.rebuildDirectory(e)
    return dashboard(e,acct,`Deleted ${course.name} and its prepared file links.`)
  }
  if(path==='/publish'||path==='/unpublish'||path==='/publish-all'){
    let chosen=await db.published(e,slug)
    if(path==='/publish-all')(await db.items(e,slug)).forEach(x=>chosen.add(x.id))
    else ids.forEach(x=>path==='/publish'?chosen.add(x):chosen.delete(x))
    await db.savePublished(e,slug,chosen)
    await sync.mirror(e,slug,acct,num(e.MIRROR_BATCH,6))
    await sync.settle(e,slug)
    let word=path==='/unpublish'?'Removed from the board.':'Published.'
    return managePage(e,acct,slug,word)
  }

  return notice('Not found','That page does not exist.',404)
}

/* The scheduled run works through the accounts a few at a time, so one
   busy course cannot starve the rest. */
async function rotate(e){
  let subs=await db.accounts(e)
  if(!subs.length)return
  let per=num(e.ACCOUNTS_PER_RUN,3)
  let start=Number(await e.STATE.get('turn'))||0
  if(start>=subs.length)start=0
  await e.STATE.put('turn',String(start+per>=subs.length?0:start+per))

  for(let sub of subs.slice(start,start+per)){
    let acct=await db.account(e,sub)
    if(!acct?.refresh)continue
    for(let slug of await db.mine(e,sub)){
      try{
        let course=await db.course(e,slug)
        if(!course?.live)continue
        await sync.syncCourse(e,acct,slug)
        await sync.mirror(e,slug,acct,num(e.MIRROR_BATCH,6))
        await sync.settle(e,slug)
      }catch{}
    }
  }
}

export default {
  async fetch(r,e){
    try{return await route(r,e)}
    catch(err){return notice('Something went wrong',err.message||'Unknown error',500)}
  },
  async scheduled(c,e,ctx){ctx.waitUntil(rotate(e).catch(()=>{}))}
}
