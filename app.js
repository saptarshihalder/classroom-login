const q=s=>document.querySelector(s)
const qa=s=>[...document.querySelectorAll(s)]
let dat=[],tab='all',term=''

const esc=s=>String(s??'').replace(/[&<>'"]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[x]))
const tm=s=>{if(!s)return'';let d=new Date(s),n=new Date(),z=Math.max(0,n-d),m=Math.floor(z/6e4),h=Math.floor(z/36e5),dy=Math.floor(z/864e5);if(m<1)return'now';if(m<60)return`${m}m`;if(h<24)return`${h}h`;if(dy<7)return`${dy}d`;return d.toLocaleDateString(undefined,{day:'numeric',month:'short'})}
const okurl=u=>{try{return['http:','https:'].includes(new URL(u).protocol)}catch{return false}}
const ico=k=>k==='file'?'□':'◌'
const typ=k=>k==='file'?'material':'announcement'
const lic=t=>t==='video'?'video':t==='form'?'form':'open'

function card(x){
  let ls=(x.links||[]).filter(a=>okurl(a.url)).map(a=>`<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(a.label||lic(a.type))}</span><b>↗</b></a>`).join('')
  let lock=x.lockedCount?`<div class="locked">${x.lockedCount} course-restricted file${x.lockedCount===1?'':'s'} not mirrored publicly</div>`:''
  return `<article class="card" data-kind="${esc(x.kind||'post')}"><div class="ava">${ico(x.kind)}</div><div class="body"><div class="meta"><b>${esc(x.author||'Course')}</b><span>posted ${typ(x.kind)}</span><time title="${esc(x.created||'')}">${tm(x.created)}</time></div>${x.title?`<h3>${esc(x.title)}</h3>`:''}${x.text?`<p>${esc(x.text)}</p>`:''}${ls?`<div class="links">${ls}</div>`:''}${lock}</div></article>`
}

function draw(){
  let a=dat.filter(x=>(tab==='all'||x.kind===tab)&&(!term||`${x.title||''} ${x.text||''} ${x.author||''}`.toLowerCase().includes(term)))
  q('#list').innerHTML=a.length?a.map(card).join(''):`<div class="empty"><strong>nothing here</strong><span>${term?'No post matches that search.':'The published stream is empty for now.'}</span></div>`
  q('#count').textContent=`${a.length} post${a.length===1?'':'s'}`
}

function settab(x){tab=x;qa('[data-tab]').forEach(b=>b.classList.toggle('on',b.dataset.tab===x));draw()}

async function pull(){
  q('#rf').disabled=true;q('#rf').textContent='checking'
  try{
    let r=await fetch(`./data/feed.json?v=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw Error('bad feed')
    let x=await r.json(),c=x.course||{}
    dat=Array.isArray(x.items)?x.items:[];dat.sort((a,b)=>new Date(b.created||0)-new Date(a.created||0))
    q('#courseName').textContent=c.name||'Partial Differential Equations';q('#short').textContent=c.short||'PDE';q('#about').textContent=c.about||'Announcements and shared course material in one place.'
    document.title=`${c.short||'PDE'} board`
    q('#sync').textContent=x.updated?`updated ${tm(x.updated)} ago`:'feed loaded';q('#dot').className='ok';draw()
  }catch{
    q('#dot').className='bad';q('#sync').textContent='feed unavailable';q('#list').innerHTML='<div class="badmsg">The public feed could not be loaded. Try refreshing in a moment.</div>';q('#count').textContent='0 posts'
  }finally{q('#rf').disabled=false;q('#rf').textContent='refresh'}
}

qa('[data-tab]').forEach(b=>b.addEventListener('click',()=>settab(b.dataset.tab)))
q('#find').addEventListener('input',e=>{term=e.target.value.trim().toLowerCase();draw()})
q('#rf').addEventListener('click',pull)
pull()
