const q=s=>document.querySelector(s)
const qa=s=>[...document.querySelectorAll(s)]
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))
const okurl=u=>{try{return['http:','https:'].includes(new URL(u).protocol)}catch{return false}}

const VIEWS=['stream','classwork','files']
const TYPE={pdf:'PDF',image:'IMG',doc:'DOC',sheet:'XLS',slides:'PPT',video:'VID',audio:'AUD',archive:'ZIP',text:'TXT',file:'FILE'}

let course={},items=[],view='stream',term='',opened=null
let api='',slug=new URLSearchParams(location.search).get('c')||''

const fsize=n=>!n?'':n>=1048576?`${(n/1048576).toFixed(1)} MB`:n>=1024?`${Math.round(n/1024)} KB`:`${n} B`
const href=p=>`${api}/${String(p).split('/').map(encodeURIComponent).join('/')}`
const initial=s=>(String(s||'C').trim()[0]||'C').toUpperCase()
const clip=(s,n)=>{s=String(s||'').replace(/\s+/g,' ').trim();return s.length>n?`${s.slice(0,n).trimEnd()}…`:s}

function when(ts){
  if(!ts)return ''
  let d=new Date(ts)
  if(isNaN(d))return ''
  let now=new Date(),same=d.getFullYear()===now.getFullYear()
  return d.toLocaleDateString(undefined,{day:'numeric',month:'short',...(same?{}:{year:'numeric'})})
}

function ago(ts){
  let d=new Date(ts),gap=Math.max(0,Date.now()-d)
  let m=Math.floor(gap/6e4),h=Math.floor(gap/36e5),dy=Math.floor(gap/864e5)
  if(isNaN(d))return ''
  if(m<1)return 'just now'
  if(m<60)return `${m} min ago`
  if(h<24)return `${h} hour${h===1?'':'s'} ago`
  if(dy<30)return `${dy} day${dy===1?'':'s'} ago`
  return when(ts)
}

const files=()=>items.flatMap(x=>(x.files||[]).map(f=>({...f,from:x.title||x.text||'Course post',at:x.created})))

function hit(x){
  if(!term)return true
  let bag=[x.title,x.text,x.author,x.topic,...(x.files||[]).map(f=>f.name),...(x.links||[]).map(l=>l.label)].join(' ').toLowerCase()
  return bag.includes(term)
}

/* ---- pieces ---- */

function attach(f){
  return `<button class="att" type="button" data-file="${esc(f.path)}">
    <span class="ftype ${esc(f.type||'file')}">${esc(TYPE[f.type]||'FILE')}</span>
    <span class="attmeta"><b>${esc(f.name)}</b><small>${esc(fsize(f.size))}</small></span>
    <span class="attgo" aria-hidden="true">View</span>
  </button>`
}

function linkchip(l){
  let host=''
  try{host=new URL(l.url).hostname.replace(/^www\./,'')}catch{}
  return `<a class="link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(l.label||host||'link')}</b><small>${esc(host)}</small></a>`
}

function extras(x){
  let att=(x.files||[]).map(attach).join('')
  let links=(x.links||[]).filter(l=>okurl(l.url)).map(linkchip).join('')
  let wait=x.pending?`<p class="wait">${x.pending} attachment${x.pending===1?'':'s'} still being copied across.</p>`:''
  let held=x.blocked?`<p class="wait">${x.blocked} attachment${x.blocked===1?'':'s'} could not be copied here.</p>`:''
  return `${att?`<div class="atts">${att}</div>`:''}${links?`<div class="links">${links}</div>`:''}${wait}${held}`
}

function post(x){
  let tag=x.kind==='material'?'<span class="tag">Material</span>':''
  return `<article class="post">
    <span class="avatar" aria-hidden="true">${esc(initial(x.author||course.name))}</span>
    <div class="pbody">
      <div class="phead"><b>${esc(x.author||course.name||'Course')}</b><time datetime="${esc(x.created||'')}" title="${esc(ago(x.created))}">${esc(when(x.created))}</time></div>
      ${tag}
      ${x.title?`<h3>${esc(x.title)}</h3>`:''}
      ${x.text?`<p class="text">${esc(x.text)}</p>`:''}
      ${extras(x)}
    </div>
  </article>`
}

function work(x){
  return `<details class="work">
    <summary>
      <span class="wico" aria-hidden="true">${esc((x.files||[]).length?TYPE[(x.files[0]||{}).type]||'FILE':'∂')}</span>
      <span class="wtitle">${esc(x.title||clip(x.text,64)||'Course material')}</span>
      <time datetime="${esc(x.created||'')}">${esc(when(x.created))}</time>
    </summary>
    <div class="wbody">${x.text&&x.title?`<p class="text">${esc(x.text)}</p>`:''}${extras(x)}</div>
  </details>`
}

function filerow(f){
  return `<div class="filerow">
    <span class="ftype ${esc(f.type||'file')}">${esc(TYPE[f.type]||'FILE')}</span>
    <div class="fmeta">
      <b>${esc(f.name)}</b>
      <small>${[fsize(f.size),when(f.at),f.from?`from ${clip(f.from,46)}`:''].filter(Boolean).map(esc).join(' · ')}</small>
    </div>
    <div class="frow">
      <button class="btn ghost" type="button" data-file="${esc(f.path)}">View</button>
      <a class="btn ghost" href="${esc(href(f.path))}" download>Save</a>
    </div>
  </div>`
}

const empty=(head,note)=>`<div class="empty"><strong>${esc(head)}</strong><span>${esc(note)}</span></div>`

/* ---- views ---- */

function draw(){
  let shown=items.filter(hit),n=0
  if(view==='stream'){
    n=shown.length
    q('#stream').innerHTML=n?shown.map(post).join(''):empty(term?'No matches':'Nothing posted yet',term?'Try another word from a post or a file name.':'Announcements and notes appear here as soon as they are published.')
  }
  if(view==='classwork'){
    let mat=shown.filter(x=>x.kind==='material'||(x.files||[]).length)
    n=mat.length
    let groups=new Map()
    for(let x of mat){
      let key=x.topic||'Course material'
      groups.set(key,[...(groups.get(key)||[]),x])
    }
    q('#classwork').innerHTML=n?[...groups].map(([name,list])=>`<section class="topic"><h3>${esc(name)}</h3>${list.map(work).join('')}</section>`).join(''):empty(term?'No matches':'No material yet',term?'Nothing here matches that search.':'Notes and handouts show up here, grouped the way the course groups them.')
  }
  if(view==='files'){
    let all=files().filter(f=>!term||`${f.name} ${f.from}`.toLowerCase().includes(term))
    n=all.length
    q('#files').innerHTML=n?all.map(filerow).join(''):empty(term?'No matches':'No files yet',term?'No file name matches that search.':'Every PDF and handout published to the course lands here.')
  }
  let label={stream:'post',classwork:'item',files:'file'}[view]
  q('#count').textContent=`${n} ${label}${n===1?'':'s'}`
}

function show(next,push=true){
  if(!VIEWS.includes(next))next='stream'
  view=next
  VIEWS.forEach(v=>{q(`#${v}`).hidden=v!==view})
  qa('.tab').forEach(t=>{
    let on=t.dataset.view===view
    t.classList.toggle('on',on)
    t.setAttribute('aria-selected',on?'true':'false')
  })
  draw()
  if(push&&location.hash.slice(1)!==view)history.replaceState(null,'',`#${view}`)
}

/* ---- file viewer ---- */

function preview(f){
  let url=href(f.path)
  if(f.type==='image')return `<img src="${esc(url)}" alt="${esc(f.name)}">`
  if(f.type==='pdf')return `<object data="${esc(url)}" type="application/pdf" aria-label="${esc(f.name)}"><div class="noview"><p>This browser will not show the file inline.</p><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Open the file</a></div></object>`
  if(f.type==='text')return `<iframe src="${esc(url)}" title="${esc(f.name)}"></iframe>`
  return `<div class="noview"><p>Preview is not available for this kind of file.</p><a class="btn" href="${esc(url)}" download>Download it</a></div>`
}

function showFile(path){
  let f=files().find(x=>x.path===path)
  if(!f)return hideFile()
  opened=document.activeElement
  q('#vTitle').textContent=f.name
  q('#vMeta').textContent=[TYPE[f.type]||'File',fsize(f.size)].filter(Boolean).join(' · ')
  q('#vOpen').href=href(f.path)
  q('#vDown').href=href(f.path)
  q('#vDown').setAttribute('download',f.name)
  q('#vBody').innerHTML=preview(f)
  q('#viewer').hidden=false
  document.body.classList.add('locked')
  q('#vClose').focus()
  if(location.hash!==`#file=${encodeURIComponent(path)}`)history.pushState(null,'',`#file=${encodeURIComponent(path)}`)
}

function hideFile(){
  if(q('#viewer').hidden)return
  q('#viewer').hidden=true
  q('#vBody').innerHTML=''
  document.body.classList.remove('locked')
  history.replaceState(null,'',`#${view}`)
  if(opened&&opened.isConnected)opened.focus()
  opened=null
}

function route(){
  let hash=decodeURIComponent(location.hash.slice(1))
  if(hash.startsWith('file=')){
    let path=hash.slice(5)
    if(view!=='files'&&!files().some(f=>f.path===path))show('files',false)
    return showFile(path)
  }
  hideFile()
  show(hash||'stream',false)
}

/* ---- data ---- */

async function load(){
  try{
    if(!api){
      let conf=await fetch('./data/site.json',{cache:'no-store'}).then(r=>r.json())
      api=String(conf.api||'').replace(/\/+$/,'')
      if(!api)throw Error('nothing linked yet')
    }
    if(!slug)throw Error('no course asked for')

    let r=await fetch(`${api}/api/board/${encodeURIComponent(slug)}?v=${Date.now()}`,{cache:'no-store'})
    if(!r.ok)throw Error('board unavailable')
    let data=await r.json()
    if(data.error)throw Error(data.error)

    course=data.course||{}
    items=(Array.isArray(data.items)?data.items:[]).sort((a,b)=>new Date(b.created||0)-new Date(a.created||0))

    let name=course.name||'Course board'
    let sub=[course.section,course.room?`Room ${course.room}`:''].filter(Boolean).join(' · ')
    q('#courseName').textContent=name
    q('#barTitle').textContent=name
    q('#barSub').textContent=course.short||'Course material'
    q('#courseSection').textContent=sub||course.about||'Announcements and shared course material'
    q('#about').textContent=course.about||'Announcements and shared course material in one place.'
    document.title=name

    q('#facts').innerHTML=[
      (course.teachers||[]).length?['Taught by',course.teachers.join(', ')]:null,
      ['Posts',String(items.length)],
      ['Files',String(files().length)]
    ].filter(Boolean).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')

    q('#dot').className='ok'
    q('#syncText').textContent=data.updated?`updated ${ago(data.updated)}`:'up to date'
    route()
  }catch{
    q('#dot').className='bad'
    q('#syncText').textContent='could not load'
    q('#stream').innerHTML=empty(
      slug?'This board is not available':'No course chosen',
      slug?'It may have been taken down by whoever shared it, or the address is wrong.':'Pick a course from the list of boards.')
    q('#count').textContent=''
  }
}

/* ---- wiring ---- */

qa('.tab').forEach(t=>t.addEventListener('click',()=>show(t.dataset.view)))
q('.tabs').addEventListener('keydown',ev=>{
  let i=VIEWS.indexOf(view)
  if(ev.key!=='ArrowRight'&&ev.key!=='ArrowLeft')return
  show(VIEWS[(i+(ev.key==='ArrowRight'?1:VIEWS.length-1))%VIEWS.length])
  q('.tab.on').focus()
})
document.addEventListener('click',ev=>{
  let el=ev.target.closest('[data-file]')
  if(el)showFile(el.dataset.file)
})
document.addEventListener('keydown',ev=>{if(ev.key==='Escape')hideFile()})
q('#vClose').addEventListener('click',hideFile)
q('#viewer').addEventListener('click',ev=>{if(ev.target===q('#viewer'))hideFile()})
q('#find').addEventListener('input',ev=>{term=ev.target.value.trim().toLowerCase();draw()})
q('#copy').addEventListener('click',async()=>{
  let btn=q('#copy')
  try{
    await navigator.clipboard.writeText(location.href.split('#')[0])
    btn.textContent='Link copied'
  }catch{
    btn.textContent='Copy from the address bar'
  }
  setTimeout(()=>{btn.textContent='Copy link'},2200)
})
addEventListener('hashchange',route)
load()
