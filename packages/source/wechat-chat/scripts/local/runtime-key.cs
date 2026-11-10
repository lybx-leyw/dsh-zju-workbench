using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

// Compiled by Add-Type in the Windows PowerShell 5.1 that ships with Windows:
// keep to C# 5 syntax and .NET Framework 4.8 APIs so the reader needs no extra runtime.
public static partial class WeixinBizDbProbe {
 [StructLayout(LayoutKind.Sequential)] struct Region {
  public IntPtr BaseAddress,AllocationBase;public uint AllocationProtect;public ushort PartitionId,Padding;
  public UIntPtr RegionSize;public uint State,Protect,Type,Padding2;
 }
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr OpenProcess(uint a,bool inherit,int pid);
 [DllImport("kernel32.dll")]static extern UIntPtr VirtualQueryEx(IntPtr p,IntPtr a,out Region r,UIntPtr s);
 [DllImport("kernel32.dll")]static extern bool ReadProcessMemory(IntPtr p,IntPtr a,byte[] b,UIntPtr s,out UIntPtr n);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr p);
 public sealed class Result {public bool ProcessReadable,VerifiedDatabaseKey;internal byte[] VerifiedKey;}
 public static void Forget(Result result){if(result.VerifiedKey!=null){Array.Clear(result.VerifiedKey,0,result.VerifiedKey.Length);result.VerifiedKey=null;}}
 static void Confirm(Result result,byte[] key){result.VerifiedDatabaseKey=true;result.VerifiedKey=(byte[])key.Clone();}
 public static string ReadSnapshot(Result result,string path,string python,string helper){if(result.VerifiedKey==null)throw new Exception("No verified runtime key retained.");try{return WeixinResearch.BizSnapshot.Inspect(result.VerifiedKey,path,python,helper);}finally{Forget(result);}}

 internal static string Hex(byte[] value){return BitConverter.ToString(value).Replace("-","");}
 internal static byte[] FromHex(string text){
  if(text.Length%2!=0)throw new FormatException();
  byte[] value=new byte[text.Length/2];
  for(int i=0;i<text.Length;i++){
   int c=text[i],digit=c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;
   if(digit<0)throw new FormatException();
   value[i/2]=(byte)(i%2==0?digit<<4:value[i/2]|digit);
  }
  return value;
 }
 // Constant-time comparison of count bytes.
 internal static bool Same(byte[] a,int aOffset,byte[] b,int bOffset,int count){
  if(aOffset+count>a.Length||bOffset+count>b.Length)return false;
  int difference=0;for(int i=0;i<count;i++)difference|=a[aOffset+i]^b[bOffset+i];return difference==0;
 }
 internal static byte[] Pbkdf2(byte[] password,byte[] salt,int iterations){using(var kdf=new Rfc2898DeriveBytes(password,salt,iterations,HashAlgorithmName.SHA512)){return kdf.GetBytes(32);}}
 internal static byte[] Sha256(byte[] value){using(var sha=SHA256.Create()){return sha.ComputeHash(value);}}
 // Finds needle in data[from..end). Keyed on a non-zero byte because zero runs dominate process memory.
 static int IndexOf(byte[] data,int from,int end,byte[] needle){
  int anchor=0;while(anchor<needle.Length-1&&needle[anchor]==0)anchor++;
  int last=end-needle.Length;
  for(int i=from;i<=last;i++){
   i=Array.IndexOf(data,needle[anchor],i+anchor,last-i+1)-anchor;
   if(i<0)return -1;
   int j=0;while(j<needle.Length&&data[i+j]==needle[j])j++;
   if(j==needle.Length)return i;
  }
  return -1;
 }

 static bool DecodeKnownKeySpec(byte[] blob,byte[] salt,byte[] page,Result result){
  foreach(bool upper in new[]{false,true}){byte[] suffix=Encoding.ASCII.GetBytes(upper?Hex(salt):Hex(salt).ToLowerInvariant());byte[] mask=new byte[32];byte[] decoded=new byte[99];
   try{for(int j=66;j<98;j++)mask[j%32]=(byte)(blob[j]^suffix[j-66]);for(int j=0;j<99;j++)decoded[j]=(byte)(blob[j]^mask[j%32]);
    if(decoded[0]!=120||decoded[1]!=39||decoded[98]!=39)continue;
    byte[] candidate=null;try{candidate=FromHex(Encoding.ASCII.GetString(decoded,2,64));if(Verify(candidate,salt,page)){Confirm(result,candidate);return true;}}catch(FormatException){}finally{if(candidate!=null)Array.Clear(candidate,0,candidate.Length);}
   }finally{Array.Clear(mask,0,32);Array.Clear(decoded,0,99);}
  }return false;
 }
 static byte[] ReadSmall(IntPtr h,ulong address,int count) {
  if(address<0x10000||address>0x00007FFFFFFF0000UL)return null;
  byte[] b=new byte[count];UIntPtr n;
  if(!ReadProcessMemory(h,new IntPtr(unchecked((long)address)),b,new UIntPtr((uint)count),out n)||n.ToUInt64()!=(ulong)count){Array.Clear(b,0,b.Length);return null;}return b;
 }
 // Field relationships from Tencent/sqlcipher crypto_impl.c and SQLCipher 4.x.
 // Read key pointers only after the referenced salt matches this one target DB.
 static bool CheckCodec(IntPtr h,ulong address,byte[] salt,byte[] page,Result result) {
  byte[] ctx=ReadSmall(h,address,144);if(ctx==null)return false;
  try{foreach(int saltOffset in new[]{64,72}){
   byte[] referencedSalt=ReadSmall(h,BitConverter.ToUInt64(ctx,saltOffset),16);if(referencedSalt==null)continue;
   bool matches=Same(salt,0,referencedSalt,0,16);Array.Clear(referencedSalt,0,16);if(!matches)continue;
   foreach(int pointerOffset in new[]{saltOffset+32,saltOffset+40}){
    byte[] cipher=ReadSmall(h,BitConverter.ToUInt64(ctx,pointerOffset),64);if(cipher==null)continue;
    try{
     // Runtime blob format documented by TANGandXUE/wcdb-key-tool (MIT).
     // See THIRD_PARTY_NOTICES.txt. Only this DB's already-matched codec is read.
     if(BitConverter.ToInt32(ctx,32)==99){byte[] blob=ReadSmall(h,BitConverter.ToUInt64(cipher,32),99);if(blob!=null){try{if(DecodeKnownKeySpec(blob,salt,page,result))return true;byte[] mask=FromHex("d2c7442458020000004889442450488b450048844c2448488944254048584c24");for(int j=0;j<blob.Length;j++)blob[j]^=mask[j%mask.Length];
       if(blob[0]==120&&blob[1]==39&&blob[98]==39){try{byte[] candidate=FromHex(Encoding.ASCII.GetString(blob,2,64));byte[] embedded=FromHex(Encoding.ASCII.GetString(blob,66,32));try{if(Same(embedded,0,salt,0,16)&&Verify(candidate,salt,page)){Confirm(result,candidate);return true;}}finally{Array.Clear(candidate,0,32);Array.Clear(embedded,0,16);}}catch(FormatException){}}
      }finally{Array.Clear(blob,0,blob.Length);}}}
     for(int keyOffset=8;keyOffset<=56;keyOffset+=8){byte[] key=ReadSmall(h,BitConverter.ToUInt64(cipher,keyOffset),32);if(key!=null){try{if(Verify(key,salt,page)){Confirm(result,key);return true;}}finally{Array.Clear(key,0,32);}}}
    }finally{Array.Clear(cipher,0,cipher.Length);}
   }
  }}finally{Array.Clear(ctx,0,ctx.Length);}return false;
 }
 static bool Verify(byte[] key,byte[] salt,byte[] page) {
  byte[] hSalt=new byte[16];for(int i=0;i<16;i++)hSalt[i]=(byte)(salt[i]^0x3a);
  byte[] macKey=Pbkdf2(key,hSalt,2);
  try{byte[] message=new byte[4020];Array.Copy(page,16,message,0,4016);message[4016]=1;
   using(var hmac=new HMACSHA512(macKey)){return Same(hmac.ComputeHash(message),0,page,4032,64);}
  }finally{Array.Clear(macKey,0,macKey.Length);}
 }
 public static Result Run(int pid,byte[] page) {
  var result=new Result();if(Process.GetProcessById(pid).ProcessName!="Weixin")throw new Exception("Unexpected process.");
  IntPtr h=OpenProcess(0x410,false,pid);if(h==IntPtr.Zero)return result;result.ProcessReadable=true;
  byte[] salt=new byte[16];Array.Copy(page,salt,16);byte[] lower=Encoding.ASCII.GetBytes(Hex(salt).ToLowerInvariant());byte[] upper=Encoding.ASCII.GetBytes(Hex(salt));
  var seen=new HashSet<string>();var watch=Stopwatch.StartNew();var buffer=new byte[1024*1024];ulong address=0;long bytesRead=0;
  byte[] signature=new byte[28];int[] fields={256000,2,16,32,16,16,4096};for(int i=0;i<fields.Length;i++)Array.Copy(BitConverter.GetBytes(fields[i]),0,signature,i*4,4);
  try{while(address<0x00007FFFFFFF0000UL&&bytesRead<768L*1024*1024){
   if(watch.Elapsed.TotalSeconds>50)break;
   Region r;if(VirtualQueryEx(h,new IntPtr(unchecked((long)address)),out r,new UIntPtr((uint)Marshal.SizeOf(typeof(Region)))).ToUInt64()==0)break;
   ulong start=unchecked((ulong)r.BaseAddress.ToInt64()),size=r.RegionSize.ToUInt64(),next=start+size;if(next<=address)break;address=next;
   uint protection=r.Protect&0xff;if(r.State!=0x1000||r.Type!=0x20000||(r.Protect&0x100)!=0||(protection!=4&&protection!=8&&protection!=0x40&&protection!=0x80))continue;
   for(ulong off=0;off<size;){
    if(bytesRead>=768L*1024*1024||watch.Elapsed.TotalSeconds>50)break;
    int wanted=(int)Math.Min((ulong)buffer.Length,size-off);UIntPtr got;ReadProcessMemory(h,new IntPtr(unchecked((long)(start+off))),buffer,new UIntPtr((uint)wanted),out got);int n=(int)Math.Min((ulong)wanted,got.ToUInt64());bytesRead+=n;
    {int from=0;while(from<n){int hit=IndexOf(buffer,from,n,signature);if(hit<0)break;if(CheckCodec(h,start+off+(ulong)hit-4,salt,page,result))return result;from=hit+signature.Length;}}
    foreach(var needle in new[]{salt,lower,upper}){int from=0;while(from<n){int hit=IndexOf(buffer,from,n,needle);if(hit<0)break;
      var offsets=needle==salt?new[]{hit-32,hit-40,hit-48,hit+16,hit+24,hit+32}:new[]{hit-64};
      foreach(int p in offsets){if(p<0||p+(needle==salt?32:64)>n)continue;byte[] key=null;try{if(needle==salt){key=new byte[32];Buffer.BlockCopy(buffer,p,key,0,32);}else key=FromHex(Encoding.ASCII.GetString(buffer,p,64));}catch{continue;}
       try{string fingerprint=Hex(Sha256(key));if(!seen.Add(fingerprint))continue;if(Verify(key,salt,page)){Confirm(result,key);return result;}
       }finally{Array.Clear(key,0,key.Length);}
      }
      from=hit+needle.Length;
    }}
    if(wanted<=256)break;off+=(uint)(wanted-256);
   }
  }}finally{Array.Clear(buffer,0,buffer.Length);CloseHandle(h);}
  return result;
 }
}
