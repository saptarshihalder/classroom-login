import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fakeKV,env} from './helpers.js'
import {slug} from '../src/util.js'
import * as db from '../src/store.js'
import {kindOf,materials,toItem,board,settle} from '../src/sync.js'

test('slugs stay short and url safe', () => {
  assert.equal(slug('Partial Differential Equations'),'partial-differential-equations')
  assert.equal(slug('  ??  '),'course')
  assert.ok(slug('x'.repeat(200)).length<=54)
})

test('file kinds come from mime type or extension', () => {
  assert.equal(kindOf('application/pdf','notes'),'pdf')
  assert.equal(kindOf('application/octet-stream','notes.pdf'),'pdf')
  assert.equal(kindOf('image/png','fig'),'image')
  assert.equal(kindOf('application/x-thing','blob'),'file')
})

test('materials split into links and drive files', () => {
  let m=materials([
    {link:{url:'https://example.org/a',title:'reading'}},
    {driveFile:{driveFile:{id:'abc','title':'Notes.pdf'}}},
    {driveFile:{driveFile:{title:'no id'}}}
  ])
  assert.deepEqual(m.links.map(l=>l.type),['link'])
  assert.equal(m.drive.length,1)
  assert.equal(m.drive[0].id,'abc')
})

test('one classroom course keeps one slug, and clashes get a suffix', async () => {
  let e=env(fakeKV())
  let first=await db.slugFor(e,'C1','Partial Differential Equations')
  assert.equal(first,'partial-differential-equations')
  assert.equal(await db.slugFor(e,'C1','Partial Differential Equations'),first,'same course must not fork')
  await db.saveCourse(e,{slug:first,courseId:'C1',publishers:[]})
  assert.equal(await db.slugFor(e,'C2','Partial Differential Equations'),'partial-differential-equations-2')
})

test('a board shows only published posts, and only prepared files', async () => {
  let e=env(fakeKV())
  await db.saveCourse(e,{slug:'pde',courseId:'C1',name:'Partial Differential Equations',short:'PDE',
    publishers:['u1'],live:true,teachers:['R. Mukherjee'],topics:[{id:'t1',name:'Week 1'}]})
  await db.saveItems(e,'pde',[
    {id:'announcement:1',kind:'post',title:'',text:'room moved',created:'2026-08-02T10:00:00Z',links:[],drive:[],author:''},
    {id:'material:2',kind:'material',title:'Week 1',text:'',created:'2026-08-01T10:00:00Z',links:[],topic:'t1',author:'',
     drive:[{id:'f1'},{id:'f2'},{id:'f3'}]},
    {id:'material:9',kind:'material',title:'Draft',text:'',created:'2026-07-01T10:00:00Z',links:[],drive:[],author:''}
  ])
  await db.savePublished(e,'pde',new Set(['announcement:1','material:2']))
  await db.saveFile(e,'pde','f1',{status:'ok',name:'a.pdf',path:'f/pde/f1/a.pdf',size:120,type:'pdf'})
  await db.saveFile(e,'pde','f2',{status:'held',reason:'larger than 20 MB'})

  let made=await board(e,'pde')
  assert.equal(made.items.length,2,'an unpublished post must never appear')
  let week=made.items.find(x=>x.id==='material:2')
  assert.equal(week.topic,'Week 1')
  assert.deepEqual(week.files,[{name:'a.pdf',path:'f/pde/f1/a.pdf',size:120,type:'pdf'}])
  assert.equal(week.blocked,1)
  assert.equal(week.pending,1)
  assert.equal(made.items[0].author,'R. Mukherjee','posts fall back to the course teacher')
})

test('a board that is not up returns nothing at all', async () => {
  let e=env(fakeKV())
  await db.saveCourse(e,{slug:'pde',courseId:'C1',name:'PDE',publishers:['u1'],live:false})
  await db.saveItems(e,'pde',[{id:'a:1',kind:'post',title:'',text:'hi',created:'2026-08-02T10:00:00Z',links:[],drive:[]}])
  await db.savePublished(e,'pde',new Set(['a:1']))
  assert.equal(await board(e,'pde'),null)
})

test('the directory lists only boards that are up, newest first', async () => {
  let e=env(fakeKV())
  for(let [slug,live,when] of [['a',true,'2026-08-01'],['b',false,'2026-08-02'],['c',true,'2026-08-03']]){
    await db.saveCourse(e,{slug,courseId:slug,name:slug.toUpperCase(),publishers:['u1'],live,updated:`${when}T00:00:00Z`})
  }
  let dir=await db.rebuildDirectory(e)
  assert.deepEqual(dir.map(x=>x.slug),['c','a'])
})

test('deleting a board clears its file metadata, items and course lookup', async () => {
  let kv=fakeKV(),e=env(kv)
  await db.saveCourse(e,{slug:'pde',courseId:'C1',name:'PDE',publishers:['u1'],live:true})
  await db.claim(e,'u1','pde')
  await db.saveItems(e,'pde',[{id:'a:1',kind:'post',title:'',text:'x',created:'2026-08-01T00:00:00Z',links:[],drive:[]}])
  await db.savePublished(e,'pde',new Set(['a:1']))
  await db.saveFile(e,'pde','f1',{status:'ok',name:'a.pdf',path:'f/pde/f1/a.pdf',size:1,type:'pdf'})

  await db.forget(e,'pde')
  assert.equal(await db.course(e,'pde'),null)
  assert.equal(await kv.get('cid:C1'),null,'the classroom id must be free to reconnect')
  assert.equal(await db.fileRec(e,'pde','f1'),null,'linked file metadata must go too')
  assert.deepEqual(await db.mine(e,'u1'),[])
  assert.deepEqual(await db.items(e,'pde'),[])
})

test('settle keeps the counts and directory in step', async () => {
  let e=env(fakeKV())
  await db.saveCourse(e,{slug:'pde',courseId:'C1',name:'PDE',publishers:['u1'],live:true})
  await db.saveItems(e,'pde',[
    {id:'a:1',kind:'post',title:'',text:'x',created:'2026-08-01T00:00:00Z',links:[],drive:[{id:'f1'}]}
  ])
  await db.savePublished(e,'pde',new Set(['a:1']))
  await db.saveFile(e,'pde','f1',{status:'ok',name:'a.pdf',path:'f/pde/f1/a.pdf',size:9,type:'pdf'})
  await settle(e,'pde')
  let rec=await db.course(e,'pde')
  assert.equal(rec.posts,1)
  assert.equal(rec.files,1)
  assert.equal((await db.directory(e))[0].slug,'pde')
})
