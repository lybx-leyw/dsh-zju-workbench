param([string]$Source,[string]$Profile,[string]$Destination)
$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
 $owners=@(Get-CimInstance Win32_Process|Where-Object{$_.Name -eq 'Weixin.exe' -and $_.CommandLine -notmatch '--type='})
 if($owners.Count -ne 1){throw 'image_key_unavailable'}
 Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'runtime-key.cs'))+[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'snapshot.cs'))+[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'image-key.cs')))
 $bytes=[WeixinBizDbProbe]::DecodeImage([int]$owners[0].ProcessId,$Source,$Profile)
 try {
  $format=[WeixinBizDbProbe]::ImageFormat($bytes)
  if(-not $format){throw 'unsupported_image'}
  $file=$Destination+'.'+$format
  $stream=[IO.FileStream]::new($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
  try{$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
  @{file=$file;format=$format}|ConvertTo-Json -Compress
 }finally{[Array]::Clear($bytes,0,$bytes.Length)}
}catch{
 $code='image_decode_failed'
 foreach($known in @('image_key_unavailable','image_xor_unavailable','unsupported_image')){if($_.Exception.ToString().Contains($known)){$code=$known}}
 @{error=$code}|ConvertTo-Json -Compress
 exit 1
}
