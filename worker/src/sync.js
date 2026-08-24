import {num,safe,slug as toSlug} from './util.js'
import * as db from './store.js'
import {classroom,listAll,driveMeta,driveBody} from './google.js'

const EXPORT={
  'application/vnd.google-apps.document':'application/pdf',
  'application/vnd.google-apps.presentation':'application/pdf',
  'application/vnd.google-apps.spreadsheet':'application/pdf',
  'application/vnd.google-apps.drawing':'application/pdf'
}

const EXT={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/svg+xml':'svg',
  'text/plain':'txt','text/markdown':'md','text/csv':'csv','application/zip':'zip',
  'application/msword':'doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
  'application/vnd.ms-excel':'xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
  'application/vnd.ms-powerpoint':'ppt','application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx'}

export function kindOf(mime='',name=''){
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

export function materials(list=[]){
  let links=[],drive=[]
  for(let m of list){
    if(m.link?.url)links.push({label:m.link.title||m.link.url,url:m.link.url,type:'link'})
    if(m.youtubeVideo?.alternateLink)links.push({label:m.youtubeVideo.title||'video',url:m.youtubeVideo.alternateLink,type:'video'})
    if(m.form?.formUrl)links.push({label:m.form.title||'form',url:m.form.formUrl,type:'form'})
    if(m.driveFile?.driveFile?.id){
      let f=m.driveFile.driveFile
      drive.push({id:f.id,name:f.title||'course file'})
    }
  }
  return {links,drive}
}

export function toItem(x,kind,who){
  let m=materials(x.materials)
  return {
    id:`${kind}:${x.id}`,
    kind:kind==='announcement'?'post':'material',
    title:kind==='announcement'?'':x.title||'',
    text:kind==='announcement'?x.text||'':x.description||'',
    author:who.get(x.creatorUserId)||'',
    topic:x.topicId||'',
    created:x.creationTime||x.updateTime||new Date().toISOString(),
    links:m.links,
    drive:m.drive
  }
}

/* Pull the course as this account sees it. Students see the same stream
   their class sees, which is exactly what gets published. */
export async function syncCourse(e,acct,slug){
  let rec=await db.course(e,slug)
  if(!rec)throw Error('that course is not connected')
  let c=encodeURIComponent(rec.courseId)
  let [meta,notes,material,topics,teachers]=await Promise.all([
    classroom(e,acct,`courses/${c}`),
    listAll(e,acct,`courses/${c}/announcements?announcementStates=PUBLISHED`,'announcements'),
    listAll(e,acct,`courses/${c}/courseWorkMaterials?courseWorkMaterialStates=PUBLISHED`,'courseWorkMaterial'),
    safe(listAll(e,acct,`courses/${c}/topics`,'topic'),[]),
    safe(listAll(e,acct,`courses/${c}/teachers`,'teachers'),[])
  ])
  let who=new Map(teachers.map(t=>[t.userId,t.profile?.name?.fullName||'']))
  let list=[...notes.map(x=>toItem(x,'announcement',who)),...material.map(x=>toItem(x,'material',who))]
  list.sort((a,b)=>new Date(b.created)-new Date(a.created))
  await db.saveItems(e,slug,list)
  await db.saveCourse(e,{
    ...rec,
    name:meta.name||rec.name,
    short:rec.short||toSlug(meta.name||'').split('-').map(w=>w[0]||'').join('').toUpperCase().slice(0,5),
    section:meta.section||'',
    room:meta.room||'',
    about:meta.descriptionHeading||meta.description||'',
    teachers:teachers.map(t=>t.profile?.name?.fullName).filter(Boolean),
    topics:topics.map(t=>({id:t.topicId,name:t.name})).filter(t=>t.id),
    syncedAt:new Date().toISOString()
  })
  return list
}

export async function connect(e,acct,courseId,name){
  let slug=await db.slugFor(e,courseId,name)
  let rec=await db.course(e,slug)
  if(!rec){
    rec={slug,courseId,name,short:'',publishers:[acct.sub],live:false,posts:0,files:0,bytes:0,created:new Date().toISOString()}
    await db.saveCourse(e,rec)
  }else if(!rec.publishers.includes(acct.sub)){
    await db.saveCourse(e,{...rec,publishers:[...rec.publishers,acct.sub]})
  }
  await db.claim(e,acct.sub,slug)
  await syncCourse(e,acct,slug)
  return slug
}

/* Attachments wanted by whatever is public right now. */
async function queue(e,slug){
  let list=await db.items(e,slug),chosen=await db.published(e,slug),want=new Map()
  for(let x of list){
    if(!chosen.has(x.id))continue
    for(let d of x.drive||[])if(!want.has(d.id))want.set(d.id,d)
  }
  return want
}

export async function mirror(e,slug,acct,budget){
  let rec=await db.course(e,slug)
  if(!rec)return {done:0,left:0}
  let want=await queue(e,slug)
  let cap=num(e.MAX_FILE_MB,20)*1048576
  let room=num(e.COURSE_LIMIT_MB,300)*1048576
  let used=rec.bytes||0,done=0

  for(let [fid,d] of want){
    if(done>=budget)break
    if(await db.fileRec(e,slug,fid))continue
    done++
    try{
      let meta=await driveMeta(e,acct,fid)
      let native=EXPORT[meta.mimeType]
      let mime=native||meta.mimeType||'application/octet-stream'
      if(!native&&String(meta.mimeType||'').startsWith('application/vnd.google-apps.'))
        throw Error('this Google file type cannot be exported')
      if(!native&&num(meta.size,0)>cap)
        throw Error(`larger than ${Math.round(cap/1048576)} MB`)
      if(used>=room)
        throw Error('this course has used all its space')

      let body=new Uint8Array(await(await driveBody(e,acct,fid,native)).arrayBuffer())
      if(body.length>cap)throw Error(`larger than ${Math.round(cap/1048576)} MB`)

      let base=(meta.name||'file').replace(/\.[^.]{1,5}$/,'')
      let ext=EXT[mime]||((meta.name||'').includes('.')?meta.name.split('.').pop().toLowerCase().slice(0,5):'bin')
      let key=`${slug}/${fid}/${toSlug(base,'file')}.${ext}`
      await e.FILES.put(key,body,{httpMetadata:{contentType:mime,cacheControl:'public, max-age=31536000, immutable'}})
      used+=body.length
      await db.saveFile(e,slug,fid,{
        status:'ok',name:native&&!/\.pdf$/i.test(meta.name||'')?`${base}.pdf`:meta.name||`${base}.${ext}`,
        key,path:`f/${key}`,type:kindOf(mime,meta.name||''),size:body.length,at:new Date().toISOString()
      })
    }catch(err){
      await db.saveFile(e,slug,fid,{status:'held',reason:err.message,name:d.name||'course file'},{expirationTtl:60*60*6})
    }
  }

  let left=0
  for(let fid of want.keys())if(!await db.fileRec(e,slug,fid))left++
  if(used!==(rec.bytes||0))await db.saveCourse(e,{...await db.course(e,slug),bytes:used})
  return {done,left}
}

/* What the public board reads. */
export async function board(e,slug){
  let rec=await db.course(e,slug)
  if(!rec||!rec.live)return null
  let list=await db.items(e,slug),chosen=await db.published(e,slug)
  let topics=new Map((rec.topics||[]).map(t=>[t.id,t.name]))
  let out=[],fileCount=0
  for(let x of list){
    if(!chosen.has(x.id))continue
    let files=[],pending=0,blocked=0
    for(let d of x.drive||[]){
      let f=await db.fileRec(e,slug,d.id)
      if(f?.status==='ok'){files.push({name:f.name,path:f.path,size:f.size,type:f.type});fileCount++}
      else if(f?.status==='held')blocked++
      else pending++
    }
    out.push({
      id:x.id,kind:x.kind,title:x.title,text:x.text,
      author:x.author||(rec.teachers||[])[0]||rec.name,
      topic:topics.get(x.topic)||'',
      created:x.created,links:x.links||[],files,pending,blocked
    })
  }
  return {
    course:{
      slug:rec.slug,name:rec.name,short:rec.short||'',section:rec.section||'',room:rec.room||'',
      about:rec.about||'Announcements and shared course material',teachers:rec.teachers||[]
    },
    updated:rec.updated||rec.syncedAt||null,
    items:out,
    counts:{posts:out.length,files:fileCount}
  }
}

/* Keep the numbers on the course record and the directory in step. */
export async function settle(e,slug){
  let made=await board(e,slug)
  let rec=await db.course(e,slug)
  if(!rec)return null
  await db.saveCourse(e,{
    ...rec,
    posts:made?made.counts.posts:0,
    files:made?made.counts.files:0,
    updated:new Date().toISOString()
  })
  await db.rebuildDirectory(e)
  return made
}
