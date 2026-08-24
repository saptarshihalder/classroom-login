// Checks the published site is internally consistent before it ships.
import {readFileSync,existsSync} from 'node:fs'

const problems=[]
const fail=m=>problems.push(m)
const read=p=>readFileSync(p,'utf8')

const REQUIRED=[
  'index.html','board.html','login.html',
  'directory.js','board.js','login.js','styles.css','icon.svg',
  'manifest.webmanifest','data/site.json',
  'worker/src/index.js','worker/src/store.js','worker/src/sync.js',
  'worker/src/google.js','worker/src/pages.js','worker/src/util.js',
  'worker/wrangler.toml.example'
]

for(const path of REQUIRED)if(!existsSync(path))fail(`missing ${path}`)

const json=path=>{
  try{return JSON.parse(read(path))}
  catch(err){fail(`${path} is not valid JSON: ${err.message}`);return null}
}

const site=json('data/site.json')
json('manifest.webmanifest')

/* the one setting the pages need to find the workspace */
if(site){
  if(!('api' in site))fail('site: needs an api field, even if it is empty until the workspace is deployed')
  if(site.api&&!/^https:\/\/[^\s/]+$/.test(String(site.api).replace(/\/+$/,'')))
    fail(`site: api must be a bare https origin, got ${site.api}`)
}

/* every local file the pages ask for has to exist */
for(const page of ['index.html','board.html','login.html']){
  if(!existsSync(page))continue
  const refs=[...read(page).matchAll(/(?:href|src)="([^"]+)"/g)].map(m=>m[1])
  for(const ref of refs){
    if(/^(https?:|mailto:|#|data:)/.test(ref))continue
    const path=ref.replace(/^\.\//,'').split(/[?#]/)[0]
    if(path&&!existsSync(path))fail(`${page} points at ${ref}, which does not exist`)
  }
}

/* the pages read the workspace address from one place, so keep it that way */
for(const script of ['directory.js','board.js','login.js']){
  if(!existsSync(script))continue
  if(!read(script).includes('data/site.json'))fail(`${script} should read the workspace address from data/site.json`)
}

if(problems.length){
  console.error(`site check failed:\n${problems.map(p=>`  - ${p}`).join('\n')}`)
  process.exit(1)
}
console.log('site check passed')
