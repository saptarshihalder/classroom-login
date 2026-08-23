// Checks the published site is internally consistent before it ships.
import {readFileSync,existsSync} from 'node:fs'

const problems=[]
const fail=m=>problems.push(m)
const read=p=>readFileSync(p,'utf8')

const REQUIRED=[
  'index.html','login.html','app.js','login.js','styles.css','icon.svg',
  'manifest.webmanifest','data/feed.json','data/site.json',
  'worker/src/index.js','worker/wrangler.toml.example'
]

for(const path of REQUIRED)if(!existsSync(path))fail(`missing ${path}`)

const json=path=>{
  try{return JSON.parse(read(path))}
  catch(err){fail(`${path} is not valid JSON: ${err.message}`);return null}
}

const feed=json('data/feed.json')
const site=json('data/site.json')
json('manifest.webmanifest')

/* the feed is the contract between the worker and the board */
if(feed){
  const course=feed.course||{}
  if(typeof course.name!=='string'||!course.name)fail('feed: course.name is required')
  if(typeof course.short!=='string')fail('feed: course.short must be a string')
  if(!Array.isArray(feed.items))fail('feed: items must be an array')

  const seenId=new Set(),seenPath=new Set()
  for(const item of feed.items||[]){
    const where=`feed item ${item.id||'(no id)'}`
    if(!item.id)fail(`${where}: needs an id`)
    if(seenId.has(item.id))fail(`${where}: duplicate id`)
    seenId.add(item.id)
    if(!['post','material'].includes(item.kind))fail(`${where}: unknown kind ${item.kind}`)
    if(isNaN(new Date(item.created)))fail(`${where}: created is not a date`)
    if(!Array.isArray(item.links))fail(`${where}: links must be an array`)
    if(!Array.isArray(item.files))fail(`${where}: files must be an array`)

    for(const link of item.links||[]){
      if(!/^https?:\/\//.test(link.url||''))fail(`${where}: link is not http(s): ${link.url}`)
    }
    for(const file of item.files||[]){
      if(!file.name)fail(`${where}: a file has no name`)
      if(!String(file.path||'').startsWith('files/'))fail(`${where}: file path must sit under files/ (${file.path})`)
      if(!existsSync(file.path))fail(`${where}: ${file.path} is listed but not in the repository`)
      if(seenPath.has(file.path))fail(`${where}: ${file.path} is listed twice`)
      seenPath.add(file.path)
    }
  }
}

if(site&&site.admin&&!/^https:\/\//.test(site.admin))fail('site: admin must be an https address or empty')

/* every local file the pages ask for has to exist */
for(const page of ['index.html','login.html']){
  if(!existsSync(page))continue
  const refs=[...read(page).matchAll(/(?:href|src)="([^"]+)"/g)].map(m=>m[1])
  for(const ref of refs){
    if(/^(https?:|mailto:|#|data:)/.test(ref))continue
    const path=ref.replace(/^\.\//,'').split(/[?#]/)[0]
    if(path&&!existsSync(path))fail(`${page} points at ${ref}, which does not exist`)
  }
}

if(problems.length){
  console.error(`site check failed:\n${problems.map(p=>`  - ${p}`).join('\n')}`)
  process.exit(1)
}
console.log('site check passed')
