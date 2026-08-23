import {test} from 'node:test'
import assert from 'node:assert/strict'
import {slug,kindOf,mats,item,build} from '../src/index.js'

const store=seed=>{
  let m=new Map(Object.entries(seed))
  return {
    get:async(k,t)=>{let v=m.get(k);return v===undefined?null:t==='json'?JSON.parse(v):v},
    put:async(k,v)=>void m.set(k,v),
    delete:async k=>void m.delete(k),
    list:async({prefix})=>({keys:[...m.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))})
  }
}

test('slug keeps file names url safe', () => {
  assert.equal(slug('Lecture 3 — Heat Equation.pdf'),'lecture-3-heat-equation-pdf')
  assert.equal(slug('   '),'file')
  assert.ok(slug('x'.repeat(200)).length<=58)
})

test('file kinds come from mime type or extension', () => {
  assert.equal(kindOf('application/pdf','notes'),'pdf')
  assert.equal(kindOf('application/octet-stream','notes.pdf'),'pdf')
  assert.equal(kindOf('image/png','fig'),'image')
  assert.equal(kindOf('application/vnd.openxmlformats-officedocument.presentationml.presentation','wk1'),'slides')
  assert.equal(kindOf('application/x-thing','blob'),'file')
})

test('materials split into links and drive files', () => {
  let m=mats([
    {link:{url:'https://example.org/a',title:'reading'}},
    {youtubeVideo:{alternateLink:'https://youtu.be/x',title:'lecture'}},
    {driveFile:{driveFile:{id:'abc123',title:'Notes.pdf'}}},
    {driveFile:{driveFile:{title:'no id'}}}
  ])
  assert.deepEqual(m.links.map(l=>l.type),['link','video'])
  assert.deepEqual(m.drive,[{id:'abc123',name:'Notes.pdf',url:''}])
})

test('announcements and material map to the two post kinds', () => {
  let who=new Map([['u1','A Teacher']])
  let a=item({id:'1',text:'room moved',creationTime:'2026-08-01T10:00:00Z',creatorUserId:'u1'},'announcement',who)
  let b=item({id:'2',title:'Week 1',description:'intro',creationTime:'2026-08-02T10:00:00Z',topicId:'t1'},'material',who)
  assert.equal(a.kind,'post')
  assert.equal(a.text,'room moved')
  assert.equal(a.author,'A Teacher')
  assert.equal(b.kind,'material')
  assert.equal(b.title,'Week 1')
  assert.equal(b.topic,'t1')
})

test('the public feed carries only published posts and mirrored files', async () => {
  let inbox=[
    {id:'announcement:1',kind:'post',title:'',text:'hello',created:'2026-08-02T10:00:00Z',links:[],drive:[],author:''},
    {id:'material:2',kind:'material',title:'Week 1',text:'',created:'2026-08-01T10:00:00Z',links:[],topic:'t1',author:'',
     drive:[{id:'f1',name:'a.pdf'},{id:'f2',name:'b.pdf'},{id:'f3',name:'c.pdf'}]},
    {id:'material:3',kind:'material',title:'Draft',text:'',created:'2026-07-01T10:00:00Z',links:[],drive:[],author:''}
  ]
  let e={STATE:store({
    inbox:JSON.stringify(inbox),
    published:JSON.stringify(['announcement:1','material:2']),
    'course:meta':JSON.stringify({name:'Partial Differential Equations',short:'PDE',teachers:['A Teacher'],topics:[{id:'t1',name:'Week 1'}]}),
    'file:f1':JSON.stringify({status:'ok',name:'a.pdf',path:'files/a-000001.pdf',size:120,type:'pdf'}),
    'file:f2':JSON.stringify({status:'skipped',reason:'larger than 20 MB'})
  })}
  let feed=await build(e)
  assert.equal(feed.items.length,2,'unpublished post must stay off the board')
  assert.equal(feed.course.name,'Partial Differential Equations')
  let wk=feed.items.find(x=>x.id==='material:2')
  assert.equal(wk.topic,'Week 1')
  assert.deepEqual(wk.files,[{name:'a.pdf',path:'files/a-000001.pdf',size:120,type:'pdf'}])
  assert.equal(wk.blocked,1,'oversized file is reported, not published')
  assert.equal(wk.pending,1,'unfetched file stays queued')
  assert.equal(feed.items[0].author,'A Teacher','posts fall back to the course teacher')
})
