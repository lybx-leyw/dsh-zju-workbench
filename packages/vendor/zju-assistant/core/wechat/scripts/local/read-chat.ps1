# Read only the databases required for this query. No plaintext files or network.
param([string]$NodePath,[string]$QueryBase64)
$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
function Fail([string]$Code){'{"error":"'+$Code+'"}';exit 1}
$appData=if($env:APPDATA){$env:APPDATA}else{[Environment]::GetFolderPath('ApplicationData')}
# One account's data is <account>\db_storage. The folder is usually wxid_*, but not for every account.
function IsAccount([string]$Path){Test-Path -LiteralPath (Join-Path $Path 'db_storage\contact\contact.db') -PathType Leaf}
# The accounts in a folder someone points at: an account folder, its db_storage, the xwechat_files folder
# holding the accounts, or the storage folder above xwechat_files that Weixin's settings show.
function AccountsIn([string]$Folder){
 if(-not $Folder -or -not (Test-Path -LiteralPath $Folder -PathType Container)){return}
 $item=Get-Item -LiteralPath $Folder -Force
 if(IsAccount $item.FullName){return $item}
 if($item.Name -eq 'db_storage' -and $item.Parent -and (IsAccount $item.Parent.FullName)){return $item.Parent}
 foreach($root in @($item.FullName,(Join-Path $item.FullName 'xwechat_files'))){
  $found=@(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue|Where-Object{IsAccount $_.FullName}|Sort-Object Name)
  if($found.Count){return $found}
 }
}
# Where Weixin keeps xwechat_files. Settings > Account and Storage records it in config\*.ini: the default place
# reads "Appdata:Tencent\xwechat", a moved one the folder's full path. The two usual default places follow.
function StorageFolders{
 foreach($ini in @(Get-ChildItem -LiteralPath (Join-Path $appData 'Tencent\xwechat\config') -Filter '*.ini' -File -ErrorAction SilentlyContinue|Sort-Object LastWriteTimeUtc -Descending)){
  try{
   $line=@([IO.File]::ReadAllLines($ini.FullName)|Where-Object{$_.Trim()})[0]
   if(-not $line){continue}
   $line=$line.Trim(" `t`0".ToCharArray())
   if($line -match '^appdata:(.*)$'){[IO.Path]::Combine($appData,$Matches[1].TrimStart('\','/'))}
   elseif($line -match '^mydocuments?:(.*)$'){[IO.Path]::Combine([Environment]::GetFolderPath('MyDocuments'),$Matches[1].TrimStart('\','/'))}
   elseif($line -match '^(?:[a-z]:[\\/]|\\\\)'){$line}
  }catch{}
 }
 Join-Path $appData 'Tencent\xwechat'
 [Environment]::GetFolderPath('MyDocuments')
}
try {
 $query=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($QueryBase64))|ConvertFrom-Json
 if($query.op -notin @('profiles','list','contacts','info','members','read','search','download')){Fail 'invalid_input'}
 $offline=$query.offline -eq $true
 $query.PSObject.Properties.Remove('offline')
 # A chosen folder (--data-dir, or the plugin's setting) replaces the search; pointing at one account folder
 # also settles which account to read when there are several.
 $chosen=[string]$query.'data-dir'
 $query.PSObject.Properties.Remove('data-dir')
 if($chosen){
  try{$profiles=@(AccountsIn $chosen)}catch{$profiles=@()}
  if($profiles.Count -eq 0){Fail 'wechat_folder_unrecognized'}
 }else{
  $profiles=@()
  foreach($folder in @(StorageFolders)){$profiles=@(AccountsIn $folder);if($profiles.Count){break}}
  if($profiles.Count -eq 0){Fail 'wechat_database_missing'}
 }
 if($query.op -eq 'profiles'){@{ok=$true;profiles=@($profiles|ForEach-Object{@{id=$_.Name;path=$_.FullName}})}|ConvertTo-Json -Compress -Depth 4;exit 0}
 if($profiles.Count -ne 1){Fail 'multiple_wechat_profiles'}
 $owners=@(if(-not $offline){Get-CimInstance Win32_Process|Where-Object{$_.Name -eq 'Weixin.exe' -and $_.CommandLine -notmatch '--type='}})
 if($owners.Count -gt 1){Fail 'multiple_wechat_processes'}
 $ownerPid=0
 if($owners.Count -eq 1){$ownerPid=[int]$owners[0].ProcessId}
 if($query.op -eq 'download' -and $ownerPid -eq 0){Fail 'wechat_not_running'}
 $query|Add-Member -NotePropertyName profile -NotePropertyValue $profiles[0].Name -Force
 if($query.op -eq 'download'){$query|Add-Member -NotePropertyName profilePath -NotePropertyValue $profiles[0].FullName}
 $QueryBase64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($query|ConvertTo-Json -Compress -Depth 8)))
 $storage=Join-Path $profiles[0].FullName 'db_storage'
 $paths=@(Join-Path $storage 'contact\contact.db')
 if($query.op -in @('list','info','read','search','download')){$paths+=Join-Path $storage 'session\session.db'}
 if($query.op -in @('read','search','download')){
  $shards=@(Get-ChildItem -LiteralPath (Join-Path $storage 'message') -Filter 'message_*.db' -File|Where-Object{$_.Name -match '^message_\d+\.db$'}|Sort-Object Name)
  if($shards.Count -eq 0){Fail 'wechat_database_missing'}
  # Each shard has its own key, and Weixin keeps only recently opened shards' keys in memory.
  # A shard last written before the range starts holds no message in it (two days of slack), so skip it:
  # otherwise one long-idle shard fails every recent read, including the chat monitor.
  if($query.op -ne 'download' -and $null -ne $query.since){
   $from=[DateTimeOffset]::FromUnixTimeMilliseconds([long]$query.since).UtcDateTime.AddDays(-2)
   $recent=@($shards|Where-Object{$_.LastWriteTimeUtc -ge $from})
   $shards=if($recent.Count -gt 0){$recent}else{@($shards|Sort-Object LastWriteTimeUtc -Descending|Select-Object -First 1)}
  }
  $paths+=@($shards|ForEach-Object{$_.FullName})
 }
 if($query.op -eq 'download'){
  $paths+=@(Get-ChildItem -LiteralPath (Join-Path $storage 'message') -Filter 'media_*.db' -File|Where-Object{$_.Name -match '^media_\d+\.db$'}|ForEach-Object{$_.FullName})
  $hardlink=Join-Path $storage 'hardlink\hardlink.db'
  if(Test-Path -LiteralPath $hardlink){$paths+=$hardlink}
 }
 foreach($path in $paths){if(-not(Test-Path -LiteralPath $path)){Fail 'wechat_database_missing'}}
 Add-Type -ReferencedAssemblies System.Security -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'runtime-key.cs'))+[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'snapshot.cs'))+[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'chat-key-cache.cs'))+[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'chat-snapshot.cs')))
 try{[WeixinResearch.ChatSnapshot]::Read($ownerPid,[string[]]$paths,$NodePath,(Join-Path $PSScriptRoot 'chat.mjs'),$QueryBase64,($query.op -ne 'download'))}
 catch{foreach($code in @('wechat_offline_key_unavailable','wechat_key_cache_failed','wechat_key_unavailable')){if($_.Exception.ToString().Contains($code)){Fail $code}};Fail 'snapshot_failed'}
}catch{Fail 'local_reader_failed'}
