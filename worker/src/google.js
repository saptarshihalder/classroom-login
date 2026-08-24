import {num} from './util.js'
import {saveAccount} from './store.js'

export const scopes=[
  'openid','email','profile',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  'https://www.googleapis.com/auth/classroom.topics.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/drive.readonly'
]

export function authUrl(e,origin,state){
  let q=new URLSearchParams({
    client_id:e.GOOGLE_CLIENT_ID,redirect_uri:`${origin}/oauth`,response_type:'code',
    scope:scopes.join(' '),access_type:'offline',prompt:'consent',
    include_granted_scopes:'true',state
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

async function form(url,body){
  let r=await fetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)})
  if(!r.ok)throw Error(`google ${r.status}`)
  return r.json()
}

export const exchange=(e,origin,code)=>form('https://oauth2.googleapis.com/token',{
  client_id:e.GOOGLE_CLIENT_ID,client_secret:e.GOOGLE_CLIENT_SECRET,
  code,grant_type:'authorization_code',redirect_uri:`${origin}/oauth`
})

export async function whoIs(token){
  let r=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${token}`}})
  if(!r.ok)throw Error('could not read the account')
  return r.json()
}

/* One access token per account, reused while it is still good. */
const live=new Map()

export async function accessToken(e,acct){
  let held=live.get(acct.sub)
  if(held&&Date.now()<held.exp-30000)return held.tok
  if(!acct.refresh)throw Error('not connected')
  let got
  try{
    got=await form('https://oauth2.googleapis.com/token',{
      client_id:e.GOOGLE_CLIENT_ID,client_secret:e.GOOGLE_CLIENT_SECRET,
      refresh_token:acct.refresh,grant_type:'refresh_token'
    })
  }catch(err){
    if(!acct.stale)await saveAccount(e,{...acct,stale:true})
    throw Error('Google access expired, sign in again')
  }
  if(acct.stale)await saveAccount(e,{...acct,stale:false})
  live.set(acct.sub,{tok:got.access_token,exp:Date.now()+num(got.expires_in,3600)*1000})
  return got.access_token
}

export async function call(e,acct,url){
  let r=await fetch(url,{headers:{authorization:`Bearer ${await accessToken(e,acct)}`}})
  if(!r.ok)throw Error(`${new URL(url).hostname} ${r.status}`)
  return r
}

export const classroom=async(e,acct,path)=>(await call(e,acct,`https://classroom.googleapis.com/v1/${path}`)).json()

export async function listAll(e,acct,path,key){
  let out=[],token=''
  do{
    let page=await classroom(e,acct,`${path}${path.includes('?')?'&':'?'}pageSize=100${token?`&pageToken=${encodeURIComponent(token)}`:''}`)
    out.push(...(page[key]||[]))
    token=page.nextPageToken||''
  }while(token)
  return out
}

export const myCourses=async(e,acct)=>(await listAll(e,acct,'courses?courseStates=ACTIVE','courses'))
  .sort((a,b)=>(a.name||'').localeCompare(b.name||''))

export const driveMeta=(e,acct,fid)=>call(e,acct,
  `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fid)}?fields=id,name,mimeType,size,md5Checksum,modifiedTime&supportsAllDrives=true`
).then(r=>r.json())

export const driveBody=(e,acct,fid,exportAs)=>call(e,acct,exportAs
  ?`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fid)}/export?mimeType=${encodeURIComponent(exportAs)}`
  :`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fid)}?alt=media&supportsAllDrives=true`)
