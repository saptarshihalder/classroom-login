<#
  Stands up the sync workspace on Cloudflare and points it at this repository.

  From the repository folder:
    powershell -ExecutionPolicy Bypass -File tools\setup.ps1

  Everything it asks for is typed in, never written to disk. The Google
  project and OAuth client have to be made in a browser first; the README
  says which screens.
#>
[CmdletBinding()]
param(
  [string]$SiteUrl = 'https://saptarshihalder.github.io/classroom-login/',
  [string]$Bucket  = 'course-board-files'
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$text){ Write-Host ''; Write-Host "-- $text" -ForegroundColor Cyan }
function Write-Fail([string]$text){ Write-Host ''; Write-Host $text -ForegroundColor Red; exit 1 }

function Read-Secret([string]$label){
  $secure = Read-Host $label -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Set-WorkerSecret([string]$name,[string]$value){
  if(-not $value){ Write-Fail "$name was blank, so nothing was stored." }
  $value | & npx wrangler secret put $name
  if($LASTEXITCODE -ne 0){ Write-Fail "Could not store $name." }
}

if(-not (Get-Command node -ErrorAction SilentlyContinue)){
  Write-Fail 'Node.js is not installed. Install it from https://nodejs.org, close this window, open a new one, and run this again.'
}

$root   = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$worker = Join-Path $root 'worker'
if(-not (Test-Path (Join-Path $worker 'wrangler.toml.example'))){
  Write-Fail 'Run this from inside the repository, it expects a worker folder beside tools.'
}
Set-Location $worker

Write-Step 'Installing what the worker needs'
& npm install --no-fund --no-audit
if($LASTEXITCODE -ne 0){ Write-Fail 'npm install failed.' }

Write-Step 'Cloudflare account'
$who = (& npx wrangler whoami 2>&1 | Out-String)
if($who -match 'not authenticated'){
  Write-Host 'A browser window will open. Approve it, then come back here.'
  & npx wrangler login
  if($LASTEXITCODE -ne 0){ Write-Fail 'Cloudflare sign-in did not finish.' }
}else{
  Write-Host 'Already signed in.'
}

Write-Step 'Creating the state store and the file bucket'
"name = `"course-boards`"`nmain = `"src/index.js`"`ncompatibility_date = `"2026-08-20`"`n" |
  Set-Content -Path 'wrangler.toml' -Encoding ascii
& npx wrangler r2 bucket create $Bucket 2>&1 | Where-Object { $_ -notmatch 'already exists' }
$made = (& npx wrangler kv namespace create STATE 2>&1 | Out-String)
Write-Host $made
$kvId = ''
if($made -match '(?i)id\s*=\s*"([0-9a-f]{32})"'){ $kvId = $Matches[1] }
elseif($made -match '(?i)"id"\s*:\s*"([0-9a-f]{32})"'){ $kvId = $Matches[1] }
else { $kvId = (Read-Host 'Paste the namespace id shown above').Trim() }
if($kvId -notmatch '^[0-9a-f]{32}$'){ Write-Fail "That does not look like a namespace id: $kvId" }

Write-Step 'Writing the settings'
(Get-Content 'wrangler.toml.example') |
  ForEach-Object {
    $_ -replace 'replace-with-kv-id',$kvId `
       -replace '^SITE_URL = .*',"SITE_URL = `"$SiteUrl`"" `
       -replace '^bucket_name = .*',"bucket_name = `"$Bucket`""
  } | Set-Content -Path 'wrangler.toml' -Encoding utf8
Write-Host (Get-Content 'wrangler.toml' | Where-Object { $_ -notmatch '^#' } | Out-String)

Write-Step 'Deploying'
$out = (& npx wrangler deploy 2>&1 | Out-String)
Write-Host $out
if($LASTEXITCODE -ne 0){ Write-Fail 'The deploy failed. The output above says why.' }
$url = ''
if($out -match 'https://[a-z0-9.\-]+\.workers\.dev'){ $url = $Matches[0] }

Write-Step 'Credentials'
Write-Host 'Typed in here, stored with Cloudflare, never saved to this computer.'
Set-WorkerSecret 'GOOGLE_CLIENT_ID'     (Read-Secret 'Google client ID')
Set-WorkerSecret 'GOOGLE_CLIENT_SECRET' (Read-Secret 'Google client secret')

if($url){
  Write-Step 'Pointing the site at the workspace'
  & node -e "const f='../data/site.json',fs=require('fs');const j=JSON.parse(fs.readFileSync(f));j.api=process.argv[1];fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')" $url
}

Write-Host ''
Write-Host 'The workspace is up.' -ForegroundColor Green
if($url){
  Write-Host ''
  Write-Host "  workspace   $url"
  Write-Host "  site        $SiteUrl"
  Write-Host ''
  Write-Host 'Two things left.'
  Write-Host ''
  Write-Host '1. In the browser, open the Google OAuth client and add this exact'
  Write-Host '   address under Authorized redirect URIs:'
  Write-Host ''
  Write-Host "     $url/oauth" -ForegroundColor Yellow
  Write-Host ''
  Write-Host '2. data/site.json now points at the workspace. Commit and push it:'
  Write-Host ''
  Write-Host '     git add data/site.json'
  Write-Host '     git commit -m "point the site at the workspace"'
  Write-Host '     git push'
  Write-Host ''
  Write-Host 'Then anyone enrolled can sign in and put their course up.'
}else{
  Write-Host 'Could not read the address back. Find it in the Cloudflare dashboard under'
  Write-Host 'Workers, add <that address>/oauth to the Google OAuth client, and put the'
  Write-Host 'same address in the api field of data/site.json.'
}
