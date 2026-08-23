const scopes=[
  'openid','email','profile',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  'https://www.googleapis.com/auth/classroom.topics.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/drive.readonly'
]

const h={'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','referrer-policy':'no-referrer'}
const js=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const go=u=>Response.redirect(u,302)
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const ck=r=>Object.fromEntries((r.headers.get('cookie')||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2))
const id=()=>crypto.randomUUID().replaceAll('-','')
const safe=async(p,d)=>{try{return await p}catch{return d}}
const num=(v,d)=>{let n=Number(v);return Number.isFinite(n)&&n>0?n:d}

async function body(r){
  let t=await r.text()
  return Object.fromEntries(new URLSearchParams(t))
}

async function sess(r,e){
  let s=ck(r).sid
  if(!s)return null
  return await e.STATE.get(`sess:${s}`)
}

async function auth(r,e){
  let u=new URL(r.url),s=id()
  await e.STATE.put(`oauth:${s}`,'1',{expirationTtl:600})
  let q=new URLSearchParams({client_id:e.GOOGLE_CLIENT_ID,redirect_uri:`${u.origin}/oauth`,response_type:'code',scope:scopes.join(' '),access_type:'offline',prompt:'consent',include_granted_scopes:'true',state:s})
  return go(`https://accounts.google.com/o/oauth2/v2/auth?${q}`)
}

async function oauth(r,e){
  let u=new URL(r.url),s=u.searchParams.get('state')||'',code=u.searchParams.get('code')||''
  if(!s||!code||!await e.STATE.get(`oauth:${s}`))return page('Sign-in expired','Open the dashboard and start the sign-in again.')
  await e.STATE.delete(`oauth:${s}`)
  let q=new URLSearchParams({client_id:e.GOOGLE_CLIENT_ID,client_secret:e.GOOGLE_CLIENT_SECRET,code,grant_type:'authorization_code',redirect_uri:`${u.origin}/oauth`})
  let tr=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:q})
  if(!tr.ok)return page('Sign-in failed','Google did not return a usable session.')
  let t=await tr.json()
  let ur=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${t.access_token}`}})
  if(!ur.ok)return page('Sign-in failed','Could not read the signed-in account.')
  let me=await ur.json()
  if(e.ADMIN_EMAIL&&me.email?.toLowerCase()!==e.ADMIN_EMAIL.toLowerCase())return page('Wrong account',`This dashboard is limited to ${esc(e.ADMIN_EMAIL)}.`)
  if(t.refresh_token)await e.STATE.put('google:refresh',t.refresh_token)
  if(!t.refresh_token&&!await e.STATE.get('google:refresh'))return page('Sign-in incomplete','Google did not issue offline access. Remove the app from your account permissions once, then sign in again.')
  await e.STATE.put('google:email',me.email||'')
  await e.STATE.put('google:at',new Date().toISOString())
  let sid=id()
  await e.STATE.put(`sess:${sid}`,me.email||'ok',{expirationTtl:60*60*24*30})
  return new Response(null,{status:302,headers:{location:'/','set-cookie':`sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`}})
}

let held={tok:'',exp:0}

async function token(e){
  if(held.tok&&Date.now()<held.exp-30000)return held.tok
  let rt=await e.STATE.get('google:refresh')
  if(!rt)throw Error('not connected to Google yet')
  let q=new URLSearchParams({client_id:e.GOOGLE_CLIENT_ID,client_secret:e.GOOGLE_CLIENT_SECRET,refresh_token:rt,grant_type:'refresh_token'})
  let r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:q})
  if(!r.ok){
    await e.STATE.put('google:stale','1')
    throw Error('Google access expired, sign in again')
  }
  let x=await r.json()
  await e.STATE.delete('google:stale')
  held={tok:x.access_token,exp:Date.now()+num(x.expires_in,3600)*1000}
  return held.tok
}

async function api(e,url){
  let t=await token(e)
  let r=await fetch(url,{headers:{authorization:`Bearer ${t}`}})
  if(!r.ok)throw Error(`${new URL(url).hostname} ${r.status}`)
  return r
}

const gget=async(e,path)=>(await api(e,`https://classroom.googleapis.com/v1/${path}`)).json()

async function all(e,path,key){
  let out=[],pt=''
  do{
    let x=await gget(e,`${path}${path.includes('?')?'&':'?'}pageSize=100${pt?`&pageToken=${encodeURIComponent(pt)}`:''}`)
    out.push(...(x[key]||[]));pt=x.nextPageToken||''
  }while(pt)
  return out
}

/* ---- classroom -> local model ---------------------------------------- */

function mats(a=[]){
  let links=[],drive=[]
  for(let m of a){
    if(m.link?.url)links.push({label:m.link.title||m.link.url,url:m.link.url,type:'link'})
    if(m.youtubeVideo?.alternateLink)links.push({label:m.youtubeVideo.title||'video',url:m.youtubeVideo.alternateLink,type:'video'})
    if(m.form?.formUrl)links.push({label:m.form.title||'form',url:m.form.formUrl,type:'form'})
    if(m.driveFile?.driveFile){
      let f=m.driveFile.driveFile
      if(f.id)drive.push({id:f.id,name:f.title||'course file',url:f.alternateLink||''})
    }
  }
  return {links,drive}
}

function item(x,k,who){
  let m=mats(x.materials)
  return {
    id:`${k}:${x.id}`,
    kind:k==='announcement'?'post':'material',
    title:k==='announcement'?'':x.title||'',
    text:k==='announcement'?x.text||'':x.description||'',
    author:who.get(x.creatorUserId)||'',
    topic:x.topicId||'',
    created:x.creationTime||x.updateTime||new Date().toISOString(),
    updated:x.updateTime||x.creationTime||'',
    links:m.links,
    drive:m.drive,
    source:x.alternateLink||''
  }
}

async function sync(e){
  let cid=await e.STATE.get('course:id')
  if(!cid)throw Error('choose a course first')
  let c=encodeURIComponent(cid)
  let [course,aa,mm,topics,teachers]=await Promise.all([
    gget(e,`courses/${c}`),
    all(e,`courses/${c}/announcements?announcementStates=PUBLISHED`,'announcements'),
    all(e,`courses/${c}/courseWorkMaterials?courseWorkMaterialStates=PUBLISHED`,'courseWorkMaterial'),
    safe(all(e,`courses/${c}/topics`,'topic'),[]),
    safe(all(e,`courses/${c}/teachers`,'teachers'),[])
  ])
  let who=new Map(teachers.map(t=>[t.userId,t.profile?.name?.fullName||'']))
  let items=[...aa.map(x=>item(x,'announcement',who)),...mm.map(x=>item(x,'material',who))]
  items.sort((a,b)=>new Date(b.created)-new Date(a.created))
  let meta={
    name:course.name||'Course',
    short:(e.COURSE_SHORT||course.name||'Course').trim(),
    section:course.section||'',
    room:course.room||'',
    about:course.descriptionHeading||course.description||'Announcements and shared course material',
    teachers:teachers.map(t=>t.profile?.name?.fullName).filter(Boolean),
    topics:topics.map(t=>({id:t.topicId,name:t.name})).filter(t=>t.id)
  }
  await e.STATE.put('course:meta',JSON.stringify(meta))
  await e.STATE.put('course:name',meta.name)
  await e.STATE.put('inbox',JSON.stringify(items))
  await e.STATE.put('synced:at',new Date().toISOString())
  if(await e.STATE.get('auto')==='1'){
    let pub=new Set(JSON.parse(await e.STATE.get('published')||'[]'))
    items.forEach(x=>pub.add(x.id))
    await e.STATE.put('published',JSON.stringify([...pub]))
  }
  return items
}

/* ---- drive attachments ------------------------------------------------ */

const EXPORT={
  'application/vnd.google-apps.document':'application/pdf',
  'application/vnd.google-apps.presentation':'application/pdf',
  'application/vnd.google-apps.spreadsheet':'application/pdf',
  'application/vnd.google-apps.drawing':'application/pdf'
}

const EXT={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/svg+xml':'svg','text/plain':'txt','text/markdown':'md','text/csv':'csv','application/zip':'zip',
  'application/msword':'doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
  'application/vnd.ms-excel':'xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
  'application/vnd.ms-powerpoint':'ppt','application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx'}

function kindOf(mime='',name=''){
  let n=name.toLowerCase()
  if(mime==='application/pdf'||n.endsWith('.pdf'))return 'pdf'
  if(mime.startsWith('image/'))return 'image'
  if(mime.startsWith('video/'))return 'video'
  if(mime.startsWith('audio/'))return 'audio'
  if(/word|\.docx?$/.test(mime+n))return 'doc'
  if(/sheet|excel|csv|\.xlsx?$/.test(mime+n))return 'sheet'
  if(/presentation|powerpoint|\.pptx?$/.test(mime+n))return 'slides'
  if(/zip|rar|compressed/.test(mime))return 'archive'
  if(mime.startsWith('text/'))return 'text'
  return 'file'
}

function slug(s){
  return String(s||'file').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,58)||'file'
}

function b64(u){
  let out=''
  for(let i=0;i<u.length;i+=0x8000)out+=String.fromCharCode(...u.subarray(i,i+0x8000))
  return btoa(out)
}

const rec=(e,fid)=>e.STATE.get(`file:${fid}`,'json')

async function grab(e,fid,cap){
  let meta=await(await api(e,`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fid)}?fields=id,name,mimeType,size,md5Checksum,modifiedTime&supportsAllDrives=true`)).json()
  let native=EXPORT[meta.mimeType],mime=native||meta.mimeType||'application/octet-stream'
  if(!native&&String(meta.mimeType||'').startsWith('application/vnd.google-apps.'))
    return {status:'skipped',reason:'Google file type that cannot be exported',name:meta.name||'file',stamp:meta.md5Checksum||meta.modifiedTime||''}
  if(!native&&num(meta.size,0)>cap)
    return {status:'skipped',reason:`larger than ${Math.round(cap/1048576)} MB`,name:meta.name||'file',stamp:meta.md5Checksum||meta.modifiedTime||''}
  let url=native
    ?`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fid)}/export?mimeType=${encodeURIComponent(native)}`
    :`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fid)}?alt=media&supportsAllDrives=true`
  let bytes=new Uint8Array(await(await api(e,url)).arrayBuffer())
  if(bytes.length>cap)return {status:'skipped',reason:`larger than ${Math.round(cap/1048576)} MB`,name:meta.name||'file',stamp:meta.md5Checksum||meta.modifiedTime||''}
  let base=meta.name||'file',ext=EXT[mime]||(base.includes('.')?base.split('.').pop().toLowerCase().slice(0,5):'bin')
  let clean=base.replace(/\.[^.]{1,5}$/,'')
  return {
    status:'ok',
    name:native&&!/\.pdf$/i.test(base)?`${clean}.pdf`:base,
    path:`files/${slug(clean)}-${fid.slice(-6).toLowerCase()}.${ext}`,
    type:kindOf(mime,base),
    size:bytes.length,
    stamp:meta.md5Checksum||meta.modifiedTime||'',
    at:new Date().toISOString(),
    bytes
  }
}

/* ---- repository writes ------------------------------------------------ */

function repo(e){
  return {
    owner:e.GITHUB_OWNER||'saptarshihalder',
    repo:e.GITHUB_REPO||'classroom-login',
    branch:e.GITHUB_BRANCH||'main',
    headers:{authorization:`Bearer ${e.GITHUB_TOKEN}`,accept:'application/vnd.github+json','user-agent':'course-board-sync','x-github-api-version':'2022-11-28'}
  }
}

const contents=(g,path)=>`https://api.github.com/repos/${g.owner}/${g.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`

async function head(g,path){
  let r=await fetch(`${contents(g,path)}?ref=${encodeURIComponent(g.branch)}`,{headers:g.headers})
  if(r.status===404)return ''
  if(!r.ok)throw Error(`github read ${r.status}`)
  return (await r.json()).sha||''
}

async function write(e,path,content64,message){
  let g=repo(e),key=`sha:${path}`
  let send=sha=>fetch(contents(g,path),{
    method:'PUT',
    headers:{...g.headers,'content-type':'application/json'},
    body:JSON.stringify({message,content:content64,branch:g.branch,...(sha?{sha}:{})})
  })
  let r=await send(await e.STATE.get(key)||'')
  if(r.status===409||r.status===422)r=await send(await head(g,path))
  if(!r.ok)throw Error(`github write ${r.status} on ${path}`)
  let out=await r.json()
  await e.STATE.put(key,out.content?.sha||'')
  return out
}

async function drop(e,path,message){
  let g=repo(e),sha=await e.STATE.get(`sha:${path}`)||await head(g,path)
  if(!sha)return
  await fetch(contents(g,path),{
    method:'DELETE',
    headers:{...g.headers,'content-type':'application/json'},
    body:JSON.stringify({message,sha,branch:g.branch})
  })
  await e.STATE.delete(`sha:${path}`)
}

const text64=s=>b64(new TextEncoder().encode(s))

/* ---- mirror queue ----------------------------------------------------- */

async function wanted(e){
  let inbox=JSON.parse(await e.STATE.get('inbox')||'[]')
  let pub=new Set(JSON.parse(await e.STATE.get('published')||'[]'))
  let out=new Map()
  for(let x of inbox){
    if(!pub.has(x.id))continue
    for(let d of x.drive||[])if(!out.has(d.id))out.set(d.id,d)
  }
  return out
}

async function mirror(e,budget){
  let cap=num(e.MAX_FILE_MB,20)*1048576,queue=await wanted(e),done=0,failed=0
  for(let [fid,d] of queue){
    if(done>=budget)break
    if(await rec(e,fid))continue
    done++
    try{
      let got=await grab(e,fid,cap)
      if(got.status==='ok'){
        let {bytes,...keep}=got
        await write(e,keep.path,b64(bytes),`add ${keep.name}`)
        await e.STATE.put(`file:${fid}`,JSON.stringify(keep))
      }else{
        await e.STATE.put(`file:${fid}`,JSON.stringify(got))
      }
    }catch(err){
      failed++
      await e.STATE.put(`file:${fid}`,JSON.stringify({status:'skipped',reason:err.message.includes('403')?'no access to this file':`could not be fetched (${err.message})`,name:d.name||'course file',stamp:''}),{expirationTtl:60*60*6})
    }
  }
  let left=0
  for(let fid of queue.keys())if(!await rec(e,fid))left++
  return {done,failed,left}
}

async function sweep(e){
  let keep=await wanted(e),list=await e.STATE.list({prefix:'file:'})
  for(let k of list.keys){
    let fid=k.name.slice(5)
    if(keep.has(fid))continue
    let r=await e.STATE.get(k.name,'json')
    if(r?.status==='ok'&&r.path)await drop(e,r.path,`remove ${r.name}`)
    await e.STATE.delete(k.name)
  }
}

/* ---- public feed ------------------------------------------------------ */

async function build(e){
  let inbox=JSON.parse(await e.STATE.get('inbox')||'[]')
  let pub=new Set(JSON.parse(await e.STATE.get('published')||'[]'))
  let meta=await e.STATE.get('course:meta','json')||{}
  let topics=new Map((meta.topics||[]).map(t=>[t.id,t.name]))
  let items=[]
  for(let x of inbox){
    if(!pub.has(x.id))continue
    let files=[],pending=0,blocked=0
    for(let d of x.drive||[]){
      let r=await rec(e,d.id)
      if(r?.status==='ok')files.push({name:r.name,path:r.path,size:r.size,type:r.type})
      else if(r?.status==='skipped')blocked++
      else pending++
    }
    items.push({
      id:x.id,kind:x.kind,title:x.title,text:x.text,
      author:x.author||(meta.teachers||[])[0]||meta.name||'Course',
      topic:topics.get(x.topic)||'',
      created:x.created,links:x.links||[],files,pending,blocked
    })
  }
  return {
    course:{
      name:meta.name||'Partial Differential Equations',
      short:meta.short||'PDE',
      section:meta.section||'',
      room:meta.room||'',
      about:meta.about||'Announcements and shared course material',
      teachers:meta.teachers||[]
    },
    updated:new Date().toISOString(),
    items
  }
}

async function sig(s){
  let d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')
}

async function push(e){
  let feed=await build(e)
  let mark=await sig(JSON.stringify({course:feed.course,items:feed.items}))
  if(await e.STATE.get('feed:sig')!==mark){
    await write(e,'data/feed.json',text64(JSON.stringify(feed,null,2)+'\n'),'update course feed')
    await e.STATE.put('feed:sig',mark)
  }
  let origin=await e.STATE.get('site:origin')||''
  if(origin&&await e.STATE.get('site:written')!==origin){
    await write(e,'data/site.json',text64(JSON.stringify({admin:origin,course:feed.course.short,updated:feed.updated},null,2)+'\n'),'point the sign-in page at the workspace')
    await e.STATE.put('site:written',origin)
  }
  return feed
}

async function publish(e,budget){
  await mirror(e,num(budget,num(e.MIRROR_BATCH,6)))
  await sweep(e)
  return push(e)
}

/* ---- pages ------------------------------------------------------------ */

const shell=(title,inner)=>new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f7f8f8"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${css}</style></head><body>${inner}</body></html>`,{headers:h})

const page=(title,msg,status=200)=>new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f7f8f8"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${css}</style></head><body><main class="solo"><section class="panel"><div class="brand">∂ <span>course workspace</span></div><h1>${esc(title)}</h1><p>${esc(msg)}</p><a class="btn" href="/">back</a></section></main></body></html>`,{status,headers:h})

const landing=()=>shell('Course workspace',`<main class="solo"><section class="panel"><div class="brand">∂ <span>course workspace</span></div><h1>Sign in to publish</h1><p>Use the Google account that can see the course. Announcements and material stay private here until you choose what the public board shows.</p><a class="btn wide" href="/login">continue with Google</a><p class="small">Students and visitors do not sign in — they read the public board.</p></section></main>`)

const bytes=n=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:n>=1024?`${Math.round(n/1024)} KB`:`${n||0} B`

function attline(x,files){
  let ok=0,pending=0,blocked=0,names=[]
  for(let d of x.drive||[]){
    let r=files.get(d.id)
    if(r?.status==='ok'){ok++;names.push(r)}
    else if(r?.status==='skipped')blocked++
    else pending++
  }
  if(!(x.drive||[]).length)return ''
  let tags=[ok?`<span class="chip good">${ok} on the board</span>`:'',pending?`<span class="chip">${pending} queued</span>`:'',blocked?`<span class="chip bad">${blocked} unavailable</span>`:''].join('')
  return `<div class="att">${tags}${names.map(r=>`<span class="fname">${esc(r.name)} <i>${bytes(r.size)}</i></span>`).join('')}</div>`
}

async function dash(e,msg=''){
  let cs=await safe(courses(e),[]),cid=await e.STATE.get('course:id')||''
  let meta=await e.STATE.get('course:meta','json')||{}
  let inbox=JSON.parse(await e.STATE.get('inbox')||'[]')
  let pub=new Set(JSON.parse(await e.STATE.get('published')||'[]'))
  let auto=await e.STATE.get('auto')==='1',email=await e.STATE.get('google:email')||''
  let stale=await e.STATE.get('google:stale')==='1',at=await e.STATE.get('synced:at')||''
  let ids=[...new Set(inbox.flatMap(x=>(x.drive||[]).map(d=>d.id)))]
  let files=new Map(await Promise.all(ids.map(async i=>[i,await rec(e,i)])))
  let live=[...files.values()].filter(r=>r?.status==='ok')
  let queued=[...files.entries()].filter(([i,r])=>!r&&inbox.some(x=>pub.has(x.id)&&(x.drive||[]).some(d=>d.id===i))).length
  let opts=cs.map(c=>`<option value="${esc(c.id)}"${c.id===cid?' selected':''}>${esc(c.name)}</option>`).join('')
  let rows=inbox.map(x=>`<label class="row"><input form="batch" type="checkbox" name="id" value="${esc(x.id)}"><div><div class="topline"><span class="pill${pub.has(x.id)?' live':''}">${pub.has(x.id)?'public':'private'}</span><b>${esc(x.title||x.text.slice(0,72)||'Untitled post')}</b></div>${x.text&&x.title?`<p>${esc(x.text.slice(0,200))}</p>`:''}<div class="small">${new Date(x.created).toLocaleString()}${x.links.length?` · ${x.links.length} link${x.links.length===1?'':'s'}`:''}</div>${attline(x,files)}</div></label>`).join('')
  return shell('Course workspace',`<main>
<header><div class="brand">∂ <span>course workspace</span></div><div class="who"><span class="small">${esc(email)}</span><a class="btn ghost tiny" href="/logout">sign out</a></div></header>
${stale?'<div class="note warn">Google access needs renewing. Sign out and sign in again to restore the scheduled sync.</div>':''}
${msg?`<div class="note">${esc(msg)}</div>`:''}
<section class="panel">
<div class="eyebrow">course</div>
<h1>${esc(meta.name||'Pick the course to mirror')}</h1>
<form method="post" action="/pick" class="pick"><select name="course" required><option value="">choose a course</option>${opts}</select><button>use this course</button></form>
<div class="acts">
<form method="post" action="/sync"><button${cid?'':' disabled'}>sync now</button></form>
<form method="post" action="/files"><button class="ghost"${cid?'':' disabled'}>fetch attachments</button></form>
<form method="post" action="/auto"><button class="ghost"${cid?'':' disabled'}>${auto?'auto-publish is on':'auto-publish is off'}</button></form>
<a class="btn ghost" href="${esc(e.PUBLIC_SITE_URL||'https://saptarshihalder.github.io/classroom-login/')}" target="_blank" rel="noreferrer">open the board</a>
</div>
<div class="stats"><div class="stat"><b>${inbox.length}</b><span>posts synced</span></div><div class="stat"><b>${pub.size}</b><span>on the board</span></div><div class="stat"><b>${live.length}</b><span>files hosted</span></div><div class="stat"><b>${bytes(live.reduce((n,r)=>n+(r.size||0),0))}</b><span>storage used</span></div></div>
${queued?`<p class="small">${queued} attachment${queued===1?'':'s'} still to fetch. Press <b>fetch attachments</b> again, or wait for the next scheduled run.</p>`:''}
<p class="small">${at?`last sync ${new Date(at).toLocaleString()}`:'not synced yet'} · only what you mark public leaves this workspace</p>
</section>
<section class="panel">
<div class="eyebrow">what the board shows</div>
<div class="bar"><b>${inbox.length} synced</b><span>select posts, then publish</span></div>
<form id="batch" method="post"><div class="rows">${rows||'<div class="empty">Choose a course and sync to load its announcements and material.</div>'}</div>
<div class="sticky"><button formaction="/publish"${inbox.length?'':' disabled'}>publish selected</button><button class="ghost" formaction="/unpublish"${inbox.length?'':' disabled'}>remove selected</button><button class="ghost" formaction="/publish-all"${inbox.length?'':' disabled'}>publish everything</button></div></form>
</section></main>`)
}

async function courses(e){
  let x=await all(e,'courses?courseStates=ACTIVE','courses')
  return x.sort((a,b)=>(a.name||'').localeCompare(b.name||''))
}

async function change(r,e,on){
  let f=await r.formData(),a=f.getAll('id').map(String)
  let pub=new Set(JSON.parse(await e.STATE.get('published')||'[]'))
  a.forEach(x=>on?pub.add(x):pub.delete(x))
  await e.STATE.put('published',JSON.stringify([...pub]))
  await publish(e)
  return dash(e,on?`Published ${a.length} post${a.length===1?'':'s'}.`:`Removed ${a.length} post${a.length===1?'':'s'} from the board.`)
}

async function route(r,e){
  let u=new URL(r.url),p=u.pathname
  await e.STATE.put('site:origin',u.origin)
  if(p==='/login')return auth(r,e)
  if(p==='/oauth')return oauth(r,e)
  if(p==='/health')return js({ok:true,connected:!!await e.STATE.get('google:refresh'),stale:await e.STATE.get('google:stale')==='1',course:await e.STATE.get('course:name')||null,synced:await e.STATE.get('synced:at')||null})
  if(p==='/logout'){
    let s=ck(r).sid
    if(s)await e.STATE.delete(`sess:${s}`)
    return new Response(null,{status:302,headers:{location:'/','set-cookie':'sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}})
  }
  if(!await sess(r,e))return p==='/'?landing():page('Signed out','Open the workspace and sign in again.',401)
  if(r.method==='GET'&&p==='/')return dash(e)
  if(r.method==='POST')switch(p){
    case'/pick':{
      let x=await body(r)
      await e.STATE.put('course:id',x.course||'')
      await sync(e)
      return dash(e,'Course connected and synced.')
    }
    case'/sync':{
      await sync(e)
      if(await e.STATE.get('auto')==='1')await publish(e)
      return dash(e,'Synced with the course.')
    }
    case'/auto':{
      let on=await e.STATE.get('auto')==='1'
      await e.STATE.put('auto',on?'0':'1')
      if(!on){await sync(e);await publish(e)}
      return dash(e,on?'Auto-publish is off. New posts stay private until you pick them.':'Auto-publish is on. New posts go straight to the board.')
    }
    case'/files':{
      let m=await mirror(e,num(e.MIRROR_BATCH,6)*2)
      await push(e)
      return dash(e,m.left?`Fetched ${m.done}. ${m.left} still queued.`:`Attachments are up to date.`)
    }
    case'/publish':return change(r,e,true)
    case'/unpublish':return change(r,e,false)
    case'/publish-all':{
      let inbox=JSON.parse(await e.STATE.get('inbox')||'[]')
      await e.STATE.put('published',JSON.stringify(inbox.map(x=>x.id)))
      await publish(e)
      return dash(e,'Everything synced is on the board.')
    }
  }
  return page('Not found','That page does not exist.',404)
}

const css=`:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202124;background:#f7f8f8}
*{box-sizing:border-box}
body{margin:0}
main{width:min(900px,calc(100% - 24px));margin:0 auto;padding:26px 0 96px}
main.solo{min-height:100vh;display:grid;place-items:center;padding:24px}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px}
.who{display:flex;align-items:center;gap:10px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700}
.brand:first-letter{font-family:Georgia,serif}
.brand span{font-size:14px;font-weight:600}
.panel{background:#fff;border:1px solid #e1e5e3;border-radius:18px;padding:24px;margin-bottom:16px;box-shadow:0 8px 28px rgba(25,35,30,.045)}
.solo .panel{max-width:520px}
h1{font-size:clamp(24px,5vw,38px);letter-spacing:-.03em;margin:6px 0 18px;line-height:1.1}
p{color:#5f6368;line-height:1.55}
.eyebrow{text-transform:uppercase;font-size:10px;letter-spacing:.15em;color:#7b817e}
.small{font-size:12px;color:#737975}
.pick{display:flex;gap:9px}
select,button,.btn{font:inherit;border:1px solid #d7dcd9;background:#fff;border-radius:10px;padding:10px 12px;color:#26302b}
select{min-width:0;flex:1}
button,.btn{cursor:pointer;text-decoration:none;display:inline-flex;justify-content:center;align-items:center;background:#1f5d46;color:#fff;border-color:#1f5d46;font-size:13px}
button.ghost,.btn.ghost{background:#fff;color:#26302b;border-color:#d7dcd9}
.btn.wide{width:100%;padding:13px;margin:4px 0 14px}
.btn.tiny{padding:6px 10px;font-size:12px}
button:disabled{opacity:.45;cursor:not-allowed}
.acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.note{background:#eaf4ef;color:#285e49;border:1px solid #cfe3d9;border-radius:12px;padding:11px 13px;margin-bottom:16px;font-size:13px}
.note.warn{background:#fdf1e7;color:#8a5624;border-color:#f0dcc6}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0 10px}
.stat{border:1px solid #e8ebe9;border-radius:12px;padding:12px}
.stat b{display:block;font-size:19px;letter-spacing:-.02em}
.stat span{font-size:11px;color:#737975}
.bar{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:8px 0 14px}
.bar span{font-size:12px;color:#737975}
.rows{display:grid;gap:8px}
.row{display:grid;grid-template-columns:20px 1fr;gap:11px;padding:14px;border:1px solid #e5e8e6;border-radius:12px;cursor:pointer}
.row:hover{border-color:#bdc7c2}
.row input{margin-top:4px}
.topline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.topline b{font-size:14px}
.row p{font-size:13px;margin:8px 0}
.pill{font-size:9px;text-transform:uppercase;letter-spacing:.08em;padding:4px 6px;border-radius:999px;background:#ecefed;color:#6f7572}
.pill.live{background:#e1f0e8;color:#276247}
.att{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;align-items:center}
.chip{font-size:11px;padding:3px 8px;border-radius:999px;background:#eef1ef;color:#5f6368}
.chip.good{background:#e1f0e8;color:#276247}
.chip.bad{background:#f7eae6;color:#8b473d}
.fname{font-size:11px;color:#737975;border:1px solid #e8ebe9;border-radius:8px;padding:3px 8px}
.fname i{font-style:normal;opacity:.7}
.empty{padding:38px 14px;text-align:center;color:#777;border:1px dashed #d8ddda;border-radius:12px}
.sticky{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);width:min(876px,calc(100% - 48px));display:flex;gap:8px;padding:10px;background:rgba(255,255,255,.94);border:1px solid #dfe4e1;border-radius:14px;backdrop-filter:blur(12px);box-shadow:0 14px 38px rgba(20,30,25,.12)}
@media(max-width:620px){
main{padding-top:16px}
.panel{padding:18px;border-radius:15px}
.pick{display:grid}
.bar{display:block}
.bar span{display:block;margin-top:4px}
.stats{grid-template-columns:repeat(2,1fr)}
.sticky{width:calc(100% - 20px);overflow:auto}
.sticky button{white-space:nowrap}
.acts>*{flex:1}
.acts button,.acts .btn{width:100%}
}`

export default {
  async fetch(r,e){
    try{return await route(r,e)}
    catch(err){return page('Something went wrong',err.message||'Unknown error',500)}
  },
  async scheduled(c,e,ctx){
    ctx.waitUntil((async()=>{
      try{
        await sync(e)
        if(await e.STATE.get('auto')==='1')return void await publish(e)
        for(let fid of (await wanted(e)).keys())if(!await rec(e,fid))return void await publish(e)
      }catch{}
    })())
  }
}

export {slug,kindOf,mats,item,build,bytes}
