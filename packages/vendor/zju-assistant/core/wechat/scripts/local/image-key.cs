// V1/V2 cache layout: 15-byte header, padded AES-ECB prefix, plain middle, XOR tail.
// The image key stays in this process; only the requested decoded file is exported.
public static partial class WeixinBizDbProbe {
 static bool Alpha(byte b){return b>=48&&b<=57||b>=65&&b<=90||b>=97&&b<=122;}
 public static string ImageFormat(byte[] b){
  if(b.Length<12)return null;
  if(b[0]==255&&b[1]==216&&b[2]==255)return "jpg";
  if(b[0]==137&&Encoding.ASCII.GetString(b,1,7)=="PNG\r\n\x1a\n")return "png";
  string first=Encoding.ASCII.GetString(b,0,4);
  if(first=="GIF8")return "gif";
  if(first=="RIFF"&&Encoding.ASCII.GetString(b,8,4)=="WEBP")return "webp";
  if(first=="wxgf")return "wxgf";
  return null;
 }
 static byte[] ImagePrefix(byte[] input,byte[] key){
  int size=BitConverter.ToInt32(input,6),encrypted=checked((size/16+1)*16);
  if(size<0||15+encrypted>input.Length)throw new Exception("Invalid image header.");
  using(var aes=Aes.Create()){
   aes.Key=key;aes.Mode=CipherMode.ECB;aes.Padding=PaddingMode.PKCS7;
   using(var dec=aes.CreateDecryptor()){
    byte[] plain=dec.TransformFinalBlock(input,15,encrypted);
    if(plain.Length!=size)throw new Exception("Invalid image prefix.");
    return plain;
   }
  }
 }
 static bool ImageKeyMatches(byte[] input,byte[] key){
  try{
   using(var aes=Aes.Create()){
    aes.Key=key;aes.Mode=CipherMode.ECB;aes.Padding=PaddingMode.None;
    using(var dec=aes.CreateDecryptor()){
     byte[] head=dec.TransformFinalBlock(input,15,16);bool valid=ImageFormat(head)!=null;Array.Clear(head,0,head.Length);
     if(!valid)return false;
    }
   }
   byte[] prefix=ImagePrefix(input,key);Array.Clear(prefix,0,prefix.Length);return true;
  }catch(CryptographicException){return false;}
 }
 static byte[] FindImageKey(int pid,byte[] input,string profile){
  if(Process.GetProcessById(pid).ProcessName!="Weixin")throw new Exception("Unexpected process.");
  IntPtr handle=OpenProcess(0x410,false,pid);if(handle==IntPtr.Zero)throw new Exception("image_key_unavailable");
  string wxid=System.Text.RegularExpressions.Regex.Match(System.IO.Path.GetFileName(profile),@"^wxid_[^_]+").Value;
  byte[] buffer=new byte[1024*1024];var seen=new HashSet<string>();var watch=Stopwatch.StartNew();ulong address=0;long scanned=0;
  try{
   while(address<0x00007FFFFFFF0000UL&&watch.Elapsed.TotalSeconds<60&&scanned<1536L*1024*1024){
    Region region;if(VirtualQueryEx(handle,new IntPtr(unchecked((long)address)),out region,new UIntPtr((uint)Marshal.SizeOf(typeof(Region)))).ToUInt64()==0)break;
    ulong start=unchecked((ulong)region.BaseAddress.ToInt64()),size=region.RegionSize.ToUInt64();if(start+size<=address)break;address=start+size;
    uint protect=region.Protect&255;if(region.State!=0x1000||(region.Protect&0x100)!=0||protect!=4&&protect!=8&&protect!=0x40&&protect!=0x80)continue;
    for(ulong offset=0;offset<size&&watch.Elapsed.TotalSeconds<60;){
     int wanted=(int)Math.Min((ulong)buffer.Length,size-offset);UIntPtr got;
     ReadProcessMemory(handle,new IntPtr(unchecked((long)(start+offset))),buffer,new UIntPtr((uint)wanted),out got);int count=(int)got.ToUInt64();scanned+=count;
     for(int i=0;i<count;){
      if(!Alpha(buffer[i])){i++;continue;}int begin=i;while(i<count&&Alpha(buffer[i]))i++;int length=i-begin;
      if(length!=16&&length!=32&&(length<5||length>10))continue;
      string token=Encoding.ASCII.GetString(buffer,begin,Math.Min(length,16));if(!seen.Add(token))continue;
      byte[] key;
      if(length<16){
       uint seed;if(wxid.Length==0||!UInt32.TryParse(token,out seed))continue;
       using(var md5=MD5.Create()){key=Encoding.ASCII.GetBytes(Hex(md5.ComputeHash(Encoding.ASCII.GetBytes(seed.ToString()+wxid))).Substring(0,16).ToLowerInvariant());}
      }else key=Encoding.ASCII.GetBytes(token);
      if(ImageKeyMatches(input,key))return key;Array.Clear(key,0,key.Length);
     }
     if(wanted<=32)break;offset+=(uint)(wanted-32);
    }
   }
  }finally{Array.Clear(buffer,0,buffer.Length);CloseHandle(handle);}
  throw new Exception("image_key_unavailable");
 }
 static int TailKey(byte[] input,string format){
  byte[] ending=format=="jpg"?new byte[]{255,217}:format=="png"?new byte[]{0,0,0,0,73,69,78,68,174,66,96,130}:null;
  if(ending==null||BitConverter.ToInt32(input,10)<ending.Length)return -1;
  int key=input[input.Length-ending.Length]^ending[0];
  for(int i=1;i<ending.Length;i++)if((input[input.Length-ending.Length+i]^ending[i])!=key)return -1;
  return key;
 }
 public static byte[] DecodeImage(int pid,string path,string profile){
  byte[] input=System.IO.File.ReadAllBytes(path);
  if(ImageFormat(input)!=null)return input;
  bool v2=input.Length>=31&&input[0]==7&&input[1]==8&&input[2]==86&&(input[3]==49||input[3]==50)&&input[4]==8&&input[5]==7;
  if(!v2){
   foreach(byte first in new byte[]{255,137,71,82}){
    byte key=(byte)(input[0]^first);byte[] head=new byte[Math.Min(16,input.Length)];for(int i=0;i<head.Length;i++)head[i]=(byte)(input[i]^key);
    if(ImageFormat(head)==null)continue;for(int i=0;i<input.Length;i++)input[i]^=key;return input;
   }
   throw new Exception("unsupported_image");
  }
  byte[] aesKey=input[3]==49?Encoding.ASCII.GetBytes("cfcd208495d565ef"):FindImageKey(pid,input,profile);
  try{
   byte[] prefix=ImagePrefix(input,aesKey);int encrypted=(prefix.Length/16+1)*16,xorSize=BitConverter.ToInt32(input,10),middle=input.Length-15-encrypted-xorSize;
   if(xorSize<0||middle<0)throw new Exception("Invalid image layout.");
   int xor=TailKey(input,ImageFormat(prefix));
   if(xorSize>0&&xor<0){
    foreach(string candidate in System.IO.Directory.EnumerateFiles(System.IO.Path.Combine(profile,"msg","attach"),"*_t.dat",System.IO.SearchOption.AllDirectories)){
     byte[] thumbnail=System.IO.File.ReadAllBytes(candidate);
     if(thumbnail.Length<31||thumbnail[0]!=7||thumbnail[3]!=50||!ImageKeyMatches(thumbnail,aesKey))continue;
     byte[] head=ImagePrefix(thumbnail,aesKey);xor=TailKey(thumbnail,ImageFormat(head));Array.Clear(head,0,head.Length);if(xor>=0)break;
    }
    if(xor<0)throw new Exception("image_xor_unavailable");
   }
   byte[] result=new byte[prefix.Length+middle+xorSize];Array.Copy(prefix,result,prefix.Length);Array.Clear(prefix,0,prefix.Length);
   Array.Copy(input,15+encrypted,result,result.Length-xorSize-middle,middle);
   for(int i=0;i<xorSize;i++)result[result.Length-xorSize+i]=(byte)(input[input.Length-xorSize+i]^xor);
   return result;
  }finally{Array.Clear(aesKey,0,aesKey.Length);}
 }
}
