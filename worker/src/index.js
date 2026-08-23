const scopes=[
  'openid','email','profile',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly'
]

const h={'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','referrer-policy':'no-referrer'}
const js=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
const go=u=>Response.redirect(u,302)
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const ck=r=>Object.fromEntries((r.headers.get('cookie')||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2))
const id=()=>crypto.randomUUID().replaceAll('-','')

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
  if(!s||!code||!await e.STATE.get(`oauth:${s}`))return page('Login failed','The sign-in request expired. Open the dashboard and try again.')
  await e.STATE.delete(`oauth:${s}`)
  let q=new URLSearchParams({client_id:e.GOOGLE_CLIENT_ID,client_secret:e.GOOGLE_CLIENT_SECRET,code,grant_type:'authorization_code',redirect_uri:`${u.origin}/oauth`})
  let tr=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:q})
  if(!tr.ok)return page('Login failed','Google did not return a usable session.')
  let t=await tr.json()
  let ur=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${t.access_token}`}})
  if(!ur.ok)return page('Login failed','Could not read the signed-in account.')
  let me=await ur.json()
  if(e.ADMIN_EMAIL&&me.email?.toLowerCase()!==e.ADMIN_EMAIL.toLowerCase())return page('Wrong account',`This dashboard is restricted to ${esc(e.ADMIN_EMAIL)}.`)
  if(t.refresh_token)await e.STATE.put('google:refresh',t.refresh_token)
  if(!t.refresh_token&&!await e.STATE.get('google:refresh'))return page('Login failed','Google did not issue offline access. Revoke the app once, then sign in again.')
  await e.STATE.put('google:email',me.email||'')
  let sid=id()
  await e.STATE.put(`sess:${sid}`,me.email||'ok',{expirationTtl:60*60*24*30})
  return new Response(null,{status:302,headers:{location:'/', 'set-cookie':`sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`}})
}

async function token(e){
  let rt=await e.STATE.get('google:refresh')
  if(!rt)throw Error('not connected')
  let q=new URLSearchParams({client_id:e.GOOGLE_CLIENT_ID,client_secret:e.GOOGLE_CLIENT_SECRET,refresh_token:rt,grant_type:'refresh_token'})
  let r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:q})
  if(!r.ok)throw Error('google token failed')
  let x=await r.json()
  return x.access_token
}

async function gget(e,path){
  let t=await token(e)
  let r=await fetch(`https://classroom.googleapis.com/v1/${path}`,{headers:{authorization:`Bearer ${t}`}})
  if(!r.ok)throw Error(`classroom ${r.status}`)
  return r.json()
}

async function all(e,path,key){
  let out=[],pt=''
  do{
    let x=await gget(e,`${path}${path.includes('?')?'&':'?'}pageSize=100${pt?`&pageToken=${encodeURIComponent(pt)}`:''}`)
    out.push(...(x[key]||[]));pt=x.nextPageToken||''
  }while(pt)
  return out
}

function mats(a=[]){
  let links=[],locked=[]
  for(let m of a){
    if(m.link?.url)links.push({label:m.link.title||'link',url:m.link.url,type:'link'})
    if(m.youtubeVideo?.alternateLink)links.push({label:m.youtubeVideo.title||'video',url:m.youtubeVideo.alternateLink,type:'video'})
    if(m.form?.formUrl)links.push({label:m.form.title||'form',url:m.form.formUrl,type:'form'})
    if(m.driveFile?.driveFile){let f=m.driveFile.driveFile;locked.push({label:f.title||'course file',id:f.id||'',url:f.alternateLink||''})}
  }
  return {links,locked}
}

function item(x,k){
  let m=mats(x.materials)
  return {
    id:`${k}:${x.id}`,
    kind:k==='announcement'?'post':'file',
    title:k==='announcement'?'':x.title||'',
    text:k==='announcement'?x.text||'':x.description||'',
    author:'Course',
    created:x.creationTime||x.updateTime||new Date().toISOString(),
    updated:x.updateTime||x.creationTime||'',
    links:m.links,
    locked:m.locked,
    source:x.alternateLink||''
  }
}

async function sync(e){
  let cid=await e.STATE.get('course:id')
  if(!cid)throw Error('choose a course first')
  let [course,aa,mm]=await Promise.all([
    gget(e,`courses/${encodeURIComponent(cid)}`),
    all(e,`courses/${encodeURIComponent(cid)}/announcements?announcementStates=PUBLISHED`,'announcements'),
    all(e,`courses/${encodeURIComponent(cid)}/courseWorkMaterials?courseWorkMaterialStates=PUBLISHED`,'courseWorkMaterial')
  ])
  let items=[...aa.map(x=>item(x,'announcement')),...mm.map(x=>item(x,'material'))]
  items.sort((a,b)=>new Date(b.created)-new Date(a.created))
  await e.STATE.put('course:name',course.name||'Course')
  await e.STATE.put('inbox',JSON.stringify(items))
  let auto=await e.STATE.get('auto')==='1'
  if(auto){
    let pub=new Set(JSON.parse(await e.STATE.get('published')||'[]'))
    items.forEach(x=>pub.add(x.id))
    await e.STATE.put('published',JSON.stringify([...pub]))
  }
  return {course,items}
}

function feed(inbox,pub,course){
  let set=new Set(pub)
  return {
    course:{name:course||'Partial Differential Equations',short:'PDE',about:'Announcements and shared course material'},
    updated:new Date().toISOString(),
    items:inbox.filter(x=>set.has(x.id)).map(x=>({
      id:x.id,kind:x.kind,author:x.author,title:x.title,text:x.text,created:x.created,links:x.links,lockedCount:x.locked?.length||0
    }))
  }
}

function b64(s){
  let u=new TextEncoder().encode(s),x=''
  for(let i=0;i<u.length;i+=0x8000)x+=String.fromCharCode(...u.subarray(i,i+0x8000))
  return btoa(x)
}

async function push(e){
  let inbox=JSON.parse(await e.STATE.get('inbox')||'[]')
  let pub=JSON.parse(await e.STATE.get('published')||'[]')
  let course=await e.STATE.get('course:name')||'Partial Differential Equations'
  let owner=e.GITHUB_OWNER||'saptarshihalder',repo=e.GITHUB_REPO||'classroom-login',branch=e.GITHUB_BRANCH||'main'
  let api=`https://api.github.com/repos/${owner}/${repo}/contents/data/feed.json`
  let headers={authorization:`Bearer ${e.GITHUB_TOKEN}`,accept:'application/vnd.github+json','user-agent':'pde-board','x-github-api-version':'2022-11-28'}
  let old=await fetch(`${api}?ref=${encodeURIComponent(branch)}`,{headers})
  if(!old.ok)throw Error(`github read ${old.status}`)
  let meta=await old.json(),content=JSON.stringify(feed(inbox,pub,course),null,2)+'\n'
  let wr=await fetch(api,{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({message:'update course feed',content:b64(content),sha:meta.sha,branch})})
  if(!wr.ok)throw Error(`github write ${wr.status}`)
  return wr.json()
}

async function courses(e){
  let x=await all(e,'courses?courseStates=ACTIVE','courses')
  return x.sort((a,b)=>(a.name||'').localeCompare(b.name||''))
}

function page(title,body,status=200){
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f7f8f8"><title>${esc(title)}</title><style>${css}</style></head><body><main class="solo"><section class="panel"><div class="brand">∂ <span>PDE board</span></div><h1>${esc(title)}</h1><p>${body}</p><a class="btn" href="/">back</a></section></main></body></html>`,{status,headers:h})
}

async function dash(e,msg=''){
  let cs=await courses(e),cid=await e.STATE.get('course:id')||'',name=await e.STATE.get('course:name')||'',inbox=JSON.parse(await e.STATE.get('inbox')||'[]'),pub=new Set(JSON.parse(await e.STATE.get('published')||'[]')),auto=await e.STATE.get('auto')==='1',email=await e.STATE.get('google:email')||''
  let options=cs.map(c=>`<option value="${esc(c.id)}" ${c.id===cid?'selected':''}>${esc(c.name)}</option>`).join('')
  let rows=inbox.map(x=>`<label class="row"><input form="batch" type="checkbox" name="id" value="${esc(x.id)}"><div><div class="topline"><span class="pill ${pub.has(x.id)?'live':''}">${pub.has(x.id)?'public':'private'}</span><b>${esc(x.title||x.text.slice(0,72)||'Untitled')}</b></div>${x.text&&x.title?`<p>${esc(x.text.slice(0,220))}</p>`:''}<div class="small">${new Date(x.created).toLocaleString()} · ${x.links.length} public link${x.links.length===1?'':'s'}${x.locked.length?` · ${x.locked.length} restricted Drive file${x.locked.length===1?'':'s'} withheld`:''}</div></div></label>`).join('')
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f7f8f8"><title>Manage PDE board</title><style>${css}</style></head><body><main><header><div class="brand">∂ <span>PDE board</span></div><div class="small">${esc(email)}</div></header>${msg?`<div class="note">${esc(msg)}</div>`:''}<section class="panel"><div class="eyebrow">source</div><h1>${esc(name||'Choose the Classroom course')}</h1><form method="post" action="/pick" class="pick"><select name="course" required><option value="">choose course</option>${options}</select><button>use course</button></form><div class="acts"><form method="post" action="/sync"><button ${cid?'':'disabled'}>sync now</button></form><form method="post" action="/auto"><button ${cid?'':'disabled'}>${auto?'turn auto-publish off':'turn auto-publish on'}</button></form><a class="btn ghost" href="${esc(e.PUBLIC_SITE_URL||'https://saptarshihalder.github.io/classroom-login/')}" target="_blank" rel="noreferrer">open public board</a></div><p class="small">Drive attachments from Classroom are kept out of the public feed unless they are separately made public by someone allowed to share them. Links, forms and videos can be mirrored.</p></section><section class="panel"><div class="eyebrow">publish queue</div><div class="bar"><b>${inbox.length} synced</b><span>${pub.size} selected for public feed</span></div><form id="batch" method="post"><div class="rows">${rows||'<div class="empty">Sync the course to load announcements and materials.</div>'}</div><div class="sticky"><button formaction="/publish" ${inbox.length?'':'disabled'}>publish selected</button><button class="ghost" formaction="/unpublish" ${inbox.length?'':'disabled'}>unpublish selected</button><button class="ghost" formaction="/publish-all" ${inbox.length?'':'disabled'}>publish all synced</button></div></form></section></main></body></html>`,{headers:h})
}

async function ids(r){
  let f=await r.formData()
  return f.getAll('id').map(String)
}

async function change(r,e,on){
  let a=await ids(r),pub=new Set(JSON.parse(await e.STATE.get('published')||'[]'))
  a.forEach(x=>on?pub.add(x):pub.delete(x))
  await e.STATE.put('published',JSON.stringify([...pub]));await push(e)
  return dash(e,on?'Published selection.':'Removed selection from public feed.')
}

async function route(r,e){
  let u=new URL(r.url),p=u.pathname
  if(p==='/login')return auth(r,e)
  if(p==='/oauth')return oauth(r,e)
  if(!await sess(r,e))return p==='/'?new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f7f8f8"><title>PDE board</title><style>${css}</style></head><body><main class="solo"><section class="panel"><div class="brand">∂ <span>PDE board</span></div><h1>Course mirror</h1><p>Sign in with the Google account that can see the PDE Classroom. Nothing is published until you choose it here.</p><a class="btn" href="/login">sign in with Google</a></section></main></body></html>`,{headers:h}):page('Signed out','Open the dashboard and sign in again.',401)
  if(r.method==='GET'&&p==='/')return dash(e)
  if(r.method==='POST'&&p==='/pick'){let x=await body(r);await e.STATE.put('course:id',x.course||'');await sync(e);return dash(e,'Course connected and synced.')}
  if(r.method==='POST'&&p==='/sync'){await sync(e);if(await e.STATE.get('auto')==='1')await push(e);return dash(e,'Classroom synced.')}
  if(r.method==='POST'&&p==='/auto'){let on=await e.STATE.get('auto')==='1';await e.STATE.put('auto',on?'0':'1');if(!on){await sync(e);await push(e)}return dash(e,on?'Auto-publish is off.':'Auto-publish is on.')}
  if(r.method==='POST'&&p==='/publish')return change(r,e,true)
  if(r.method==='POST'&&p==='/unpublish')return change(r,e,false)
  if(r.method==='POST'&&p==='/publish-all'){let inbox=JSON.parse(await e.STATE.get('inbox')||'[]');await e.STATE.put('published',JSON.stringify(inbox.map(x=>x.id)));await push(e);return dash(e,'All synced items are selected for the public feed.')}
  if(p==='/health')return js({ok:true,connected:!!await e.STATE.get('google:refresh'),course:await e.STATE.get('course:name')||null})
  return page('Not found','That page does not exist.',404)
}

const css=`:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202124;background:#f7f8f8}*{box-sizing:border-box}body{margin:0}main{width:min(900px,calc(100% - 24px));margin:0 auto;padding:26px 0 90px}main.solo{min-height:100vh;display:grid;place-items:center;padding:24px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}.brand{display:flex;align-items:center;gap:10px;font-weight:700}.brand:first-letter{font-family:Georgia,serif}.brand span{font-size:14px}.panel{background:white;border:1px solid #e1e5e3;border-radius:18px;padding:24px;margin-bottom:16px;box-shadow:0 8px 28px rgba(25,35,30,.045)}.solo .panel{max-width:520px}h1{font-size:clamp(26px,5vw,40px);letter-spacing:-.03em;margin:6px 0 18px}p{color:#5f6368;line-height:1.55}.eyebrow{text-transform:uppercase;font-size:10px;letter-spacing:.15em;color:#7b817e}.small{font-size:12px;color:#737975}.pick{display:flex;gap:9px}select,button,.btn{font:inherit;border:1px solid #d7dcd9;background:#fff;border-radius:10px;padding:10px 12px;color:#26302b}select{min-width:0;flex:1}button,.btn{cursor:pointer;text-decoration:none;display:inline-flex;justify-content:center;align-items:center;background:#1f5d46;color:#fff;border-color:#1f5d46;font-size:13px}button.ghost,.btn.ghost{background:#fff;color:#26302b;border-color:#d7dcd9}button:disabled{opacity:.45;cursor:not-allowed}.acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.note{background:#eaf4ef;color:#285e49;border:1px solid #cfe3d9;border-radius:12px;padding:11px 13px;margin-bottom:16px;font-size:13px}.bar{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:8px 0 14px}.bar span{font-size:12px;color:#737975}.rows{display:grid;gap:8px}.row{display:grid;grid-template-columns:20px 1fr;gap:11px;padding:14px;border:1px solid #e5e8e6;border-radius:12px;cursor:pointer}.row:hover{border-color:#bdc7c2}.row input{margin-top:4px}.topline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.topline b{font-size:14px}.row p{font-size:13px;margin:8px 0}.pill{font-size:9px;text-transform:uppercase;letter-spacing:.08em;padding:4px 6px;border-radius:999px;background:#ecefed;color:#6f7572}.pill.live{background:#e1f0e8;color:#276247}.empty{padding:38px 14px;text-align:center;color:#777;border:1px dashed #d8ddda;border-radius:12px}.sticky{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);width:min(876px,calc(100% - 48px));display:flex;gap:8px;padding:10px;background:rgba(255,255,255,.94);border:1px solid #dfe4e1;border-radius:14px;backdrop-filter:blur(12px);box-shadow:0 14px 38px rgba(20,30,25,.12)}@media(max-width:620px){main{padding-top:16px}.panel{padding:18px;border-radius:15px}.pick{display:grid}.bar{display:block}.bar span{display:block;margin-top:4px}.sticky{width:calc(100% - 20px);overflow:auto}.sticky button{white-space:nowrap}.acts>*{flex:1}.acts button,.acts .btn{width:100%}}`

export default {
  async fetch(r,e){try{return await route(r,e)}catch(err){return page('Something broke',esc(err.message||'Unknown error'),500)}},
  async scheduled(c,e,ctx){ctx.waitUntil((async()=>{try{await sync(e);if(await e.STATE.get('auto')==='1')await push(e)}catch{}})())}
}
