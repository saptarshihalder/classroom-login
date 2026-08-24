import {esc} from './util.js'

const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','referrer-policy':'no-referrer'}

export const shell=(title,inner,status=200)=>new Response(
`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f7f8f8"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>${css}</style></head><body>${inner}</body></html>`,{status,headers})

export const notice=(title,text,status=200)=>shell(title,
`<main class="solo"><section class="panel"><div class="brand">∂ <span>course boards</span></div>
<h1>${esc(title)}</h1><p>${esc(text)}</p><a class="btn" href="/">back</a></section></main>`,status)

export const landing=site=>shell('Share your course',
`<main class="solo"><section class="panel">
<div class="brand">∂ <span>course boards</span></div>
<h1>Share your course notes</h1>
<p>Sign in with the Google account you use for class. You will see the courses you are enrolled in, and you choose which announcements and notes become a public page that anyone can read.</p>
<a class="btn wide" href="/login">continue with Google</a>
<p class="small">Readers never sign in. ${site?`The published boards live at <a href="${esc(site)}">${esc(site)}</a>.`:''}</p>
</section></main>`)

const row=(c,site)=>`<div class="board">
  <div class="bmeta">
    <div class="topline"><span class="pill${c.live?' live':''}">${c.live?'public':'private'}</span><b>${esc(c.name)}</b></div>
    <div class="small">${c.posts||0} post${c.posts===1?'':'s'} · ${c.files||0} file${c.files===1?'':'s'}</div>
  </div>
  <div class="bacts">
    ${c.live&&site?`<a class="btn ghost tiny" href="${esc(site)}board.html?c=${encodeURIComponent(c.slug)}" target="_blank" rel="noreferrer">view</a>`:''}
    <a class="btn tiny" href="/b/${encodeURIComponent(c.slug)}">manage</a>
  </div>
</div>`

export const home=({email,boards,courses,site,message,stale})=>shell('Your course boards',
`<main>
<header><div class="brand">∂ <span>course boards</span></div>
<div class="who"><span class="small">${esc(email)}</span><a class="btn ghost tiny" href="/logout">sign out</a></div></header>
${stale?'<div class="note warn">Google access needs renewing. Sign out and back in to restart the scheduled sync.</div>':''}
${message?`<div class="note">${esc(message)}</div>`:''}

<section class="panel">
<div class="eyebrow">your boards</div>
<h1>${boards.length?`${boards.length} course${boards.length===1?'':'s'} connected`:'Nothing shared yet'}</h1>
${boards.length?boards.map(c=>row(c,site)).join(''):'<p>Pick one of your courses below to start a public board for it.</p>'}
</section>

<section class="panel">
<div class="eyebrow">your classroom</div>
<h2>Courses you are in</h2>
<p class="small">Anyone enrolled can share a course. If someone from your class already made a board for it, you join them as a publisher.</p>
<form method="post" action="/connect" class="pick">
<select name="course" required><option value="">choose a course</option>
${courses.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
</select><button>share this course</button></form>
</section>
</main>`)

export const manage=({course,items,chosen,site,message,queued})=>shell(`Manage ${course.name}`,
`<main>
<header><div class="brand">∂ <span>course boards</span></div>
<div class="who"><a class="btn ghost tiny" href="/">all boards</a></div></header>
${message?`<div class="note">${esc(message)}</div>`:''}

<section class="panel">
<div class="eyebrow">${esc(course.live?'public board':'not public yet')}</div>
<h1>${esc(course.name)}</h1>
${course.live&&site?`<p class="small">Anyone can read it at <a href="${esc(site)}board.html?c=${encodeURIComponent(course.slug)}">${esc(site)}board.html?c=${esc(course.slug)}</a></p>`:'<p class="small">Choose what to show, then turn the board on.</p>'}
<div class="acts">
<form method="post" action="/sync"><input type="hidden" name="slug" value="${esc(course.slug)}"><button class="ghost">sync now</button></form>
<form method="post" action="/files"><input type="hidden" name="slug" value="${esc(course.slug)}"><button class="ghost">prepare attachments</button></form>
<form method="post" action="/live"><input type="hidden" name="slug" value="${esc(course.slug)}"><button>${course.live?'take the board down':'put the board up'}</button></form>
</div>
<div class="stats">
<div class="stat"><b>${items.length}</b><span>synced</span></div>
<div class="stat"><b>${chosen.size}</b><span>on the board</span></div>
<div class="stat"><b>${course.files||0}</b><span>files linked</span></div>
</div>
${queued?`<p class="small">${queued} attachment${queued===1?'':'s'} still to prepare. Press prepare attachments again, or wait for the next scheduled run.</p>`:''}
</section>

<section class="panel">
<div class="eyebrow">what readers see</div>
<form id="batch" method="post"><input form="batch" type="hidden" name="slug" value="${esc(course.slug)}">
<div class="rows">${items.map(x=>`<label class="row">
<input form="batch" type="checkbox" name="id" value="${esc(x.id)}">
<div><div class="topline"><span class="pill${chosen.has(x.id)?' live':''}">${chosen.has(x.id)?'public':'private'}</span><b>${esc(x.title||x.text.slice(0,72)||'Untitled post')}</b></div>
${x.text&&x.title?`<p>${esc(x.text.slice(0,200))}</p>`:''}
<div class="small">${new Date(x.created).toLocaleString()}${x.links.length?` · ${x.links.length} link${x.links.length===1?'':'s'}`:''}${x.drive.length?` · ${x.drive.length} attachment${x.drive.length===1?'':'s'}`:''}</div>
</div></label>`).join('')||'<div class="empty">Sync to load this course.</div>'}</div>
<div class="sticky">
<button formaction="/publish"${items.length?'':' disabled'}>publish selected</button>
<button class="ghost" formaction="/unpublish"${items.length?'':' disabled'}>remove selected</button>
<button class="ghost" formaction="/publish-all"${items.length?'':' disabled'}>publish everything</button>
</div></form>
</section>

<section class="panel danger">
<div class="eyebrow">leaving</div>
<p class="small">Taking the board down hides it at once. Deleting also removes its saved file links and cannot be undone.</p>
<form method="post" action="/remove" onsubmit="return confirm('Delete this board and its saved file links?')">
<input type="hidden" name="slug" value="${esc(course.slug)}">
<button class="ghost warn">delete this board</button></form>
</section>
</main>`)

export const css=`:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202124;background:#f7f8f8}
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
.panel.danger{border-color:#ecdcd7}
.solo .panel{max-width:520px}
h1{font-size:clamp(24px,5vw,36px);letter-spacing:-.03em;margin:6px 0 16px;line-height:1.12}
h2{font-size:17px;margin:6px 0 8px}
p{color:#5f6368;line-height:1.55}
a{color:#1f5d46}
.eyebrow{text-transform:uppercase;font-size:10px;letter-spacing:.15em;color:#7b817e}
.small{font-size:12px;color:#737975}
.pick{display:flex;gap:9px;margin-top:12px}
select,button,.btn{font:inherit;border:1px solid #d7dcd9;background:#fff;border-radius:10px;padding:10px 12px;color:#26302b}
select{min-width:0;flex:1}
button,.btn{cursor:pointer;text-decoration:none;display:inline-flex;justify-content:center;align-items:center;background:#1f5d46;color:#fff;border-color:#1f5d46;font-size:13px}
button.ghost,.btn.ghost{background:#fff;color:#26302b;border-color:#d7dcd9}
button.warn{color:#8b473d;border-color:#e2c6bf}
.btn.wide{width:100%;padding:13px;margin:4px 0 14px}
.btn.tiny,button.tiny{padding:7px 11px;font-size:12px}
button:disabled{opacity:.45;cursor:not-allowed}
.acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.note{background:#eaf4ef;color:#285e49;border:1px solid #cfe3d9;border-radius:12px;padding:11px 13px;margin-bottom:16px;font-size:13px}
.note.warn{background:#fdf1e7;color:#8a5624;border-color:#f0dcc6}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0 10px}
.stat{border:1px solid #e8ebe9;border-radius:12px;padding:12px}
.stat b{display:block;font-size:19px;letter-spacing:-.02em}
.stat span{font-size:11px;color:#737975}
.board{display:flex;align-items:center;gap:12px;border:1px solid #e5e8e6;border-radius:12px;padding:13px 14px;margin-top:9px}
.bmeta{flex:1;min-width:0}
.bacts{display:flex;gap:7px}
.rows{display:grid;gap:8px;margin-top:12px}
.row{display:grid;grid-template-columns:20px 1fr;gap:11px;padding:14px;border:1px solid #e5e8e6;border-radius:12px;cursor:pointer}
.row:hover{border-color:#bdc7c2}
.row input{margin-top:4px}
.topline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.topline b{font-size:14px}
.row p{font-size:13px;margin:8px 0}
.pill{font-size:9px;text-transform:uppercase;letter-spacing:.08em;padding:4px 6px;border-radius:999px;background:#ecefed;color:#6f7572}
.pill.live{background:#e1f0e8;color:#276247}
.empty{padding:38px 14px;text-align:center;color:#777;border:1px dashed #d8ddda;border-radius:12px}
.sticky{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);width:min(876px,calc(100% - 48px));display:flex;gap:8px;padding:10px;background:rgba(255,255,255,.94);border:1px solid #dfe4e1;border-radius:14px;backdrop-filter:blur(12px);box-shadow:0 14px 38px rgba(20,30,25,.12)}
@media(max-width:620px){
main{padding-top:16px}
.panel{padding:18px;border-radius:15px}
.pick{display:grid}
.stats{grid-template-columns:repeat(2,1fr)}
.board{flex-wrap:wrap}
.bacts{width:100%}
.bacts .btn{flex:1}
.sticky{width:calc(100% - 20px);overflow:auto}
.sticky button{white-space:nowrap}
.acts>*{flex:1}
.acts button,.acts .btn{width:100%}
}`
