const q=s=>document.querySelector(s)
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))

let courses=[],term=''

function ago(ts){
  let d=new Date(ts)
  if(!ts||isNaN(d))return ''
  let gap=Math.max(0,Date.now()-d)
  let h=Math.floor(gap/36e5),days=Math.floor(gap/864e5)
  if(h<1)return 'updated just now'
  if(h<24)return `updated ${h} hour${h===1?'':'s'} ago`
  if(days<30)return `updated ${days} day${days===1?'':'s'} ago`
  return `updated ${d.toLocaleDateString(undefined,{day:'numeric',month:'short'})}`
}

const initial=s=>(String(s||'C').trim()[0]||'C').toUpperCase()

function card(c){
  let counts=[`${c.posts||0} post${c.posts===1?'':'s'}`,`${c.files||0} file${c.files===1?'':'s'}`].join(' · ')
  let who=(c.teachers||[]).join(', ')
  return `<a class="course" href="./board.html?c=${encodeURIComponent(c.slug)}">
    <span class="badge" aria-hidden="true">${esc(c.short||initial(c.name))}</span>
    <span class="cmeta">
      <b>${esc(c.name)}</b>
      <small>${esc([c.section,who].filter(Boolean).join(' · ')||'Course material')}</small>
      <small class="dim">${esc(counts)}${c.updated?` · ${esc(ago(c.updated))}`:''}</small>
    </span>
  </a>`
}

const empty=(head,note)=>`<div class="empty"><strong>${esc(head)}</strong><span>${esc(note)}</span></div>`

function draw(){
  let shown=courses.filter(c=>!term||`${c.name} ${c.short||''} ${c.section||''} ${(c.teachers||[]).join(' ')}`.toLowerCase().includes(term))
  q('#list').innerHTML=shown.length
    ?shown.map(card).join('')
    :empty(term?'No course matches':'No courses yet',term?'Try the course name, its code, or who teaches it.':'The first course put up here will show in this spot.')
  q('#count').textContent=`${shown.length} course${shown.length===1?'':'s'}`
}

async function load(){
  try{
    let conf=await fetch('./data/site.json',{cache:'no-store'}).then(r=>r.json())
    let api=String(conf.api||'').replace(/\/+$/,'')
    if(!api)throw Error('nothing linked yet')
    let r=await fetch(`${api}/api/directory?v=${Date.now()}`,{cache:'no-store'})
    if(!r.ok)throw Error('directory unavailable')
    courses=await r.json()
    draw()
  }catch{
    q('#list').innerHTML=empty('No courses to show yet','Once someone signs in and puts a course up, it appears here for anyone to read.')
    q('#count').textContent=''
  }
}

q('#find').addEventListener('input',ev=>{term=ev.target.value.trim().toLowerCase();draw()})
load()
