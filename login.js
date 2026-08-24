const go=document.querySelector('#go')
const note=document.querySelector('#note')

const say=msg=>{note.textContent=msg;note.hidden=false}

fetch('./data/site.json',{cache:'no-store'})
  .then(r=>r.ok?r.json():Promise.reject())
  .then(site=>{
    let base=String(site.api||'').trim().replace(/\/+$/,'')
    if(!/^https:\/\//.test(base))return say('Sign-in is not linked yet. Once the workspace is deployed and its address is in data/site.json, this button starts working.')
    go.href=`${base}/login`
    go.hidden=false
  })
  .catch(()=>say('The sign-in address could not be read. Open the workspace directly to sign in.'))
