const go=document.querySelector('#go')
const note=document.querySelector('#note')

const say=msg=>{note.textContent=msg;note.hidden=false}

fetch('./data/site.json',{cache:'no-store'})
  .then(r=>r.ok?r.json():Promise.reject())
  .then(site=>{
    let base=String(site.admin||'').trim().replace(/\/+$/,'')
    if(!/^https:\/\//.test(base))return say('The course workspace has not been linked yet. Deploy the sync worker, sign in there once, and this button starts working.')
    go.href=`${base}/login`
    go.hidden=false
  })
  .catch(()=>say('The workspace address could not be read. Open the sync worker directly to sign in.'))
