// In-memory, read-only SQLCipher snapshots. Callers select the allowed databases.
// Same constraint as runtime-key.cs: C# 5 syntax and .NET Framework 4.8 APIs only.
namespace WeixinResearch {
using System;
using System.IO;
using System.Collections.Generic;
using System.Diagnostics;
using System.Security.Cryptography;

public static class BizSnapshot {
 static uint Be(byte[] b,int o){return (uint)(b[o]<<24|b[o+1]<<16|b[o+2]<<8|b[o+3]);}
 static byte[] ReadFile(string path,int maxPages,bool optional=false) {
  if(optional&&!File.Exists(path))return new byte[0];
  using(var f=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){
   if(f.Length>(long)maxPages*4120+32)throw new Exception("Snapshot exceeds bounded size.");
   byte[] b=new byte[(int)f.Length];
   for(int read=0;read<b.Length;){int n=f.Read(b,read,b.Length-read);if(n<=0)throw new EndOfStreamException();read+=n;}
   return b;
  }
 }
 static bool Same(byte[] a,byte[] b){return a.Length==b.Length&&global::WeixinBizDbProbe.Same(global::WeixinBizDbProbe.Sha256(a),0,global::WeixinBizDbProbe.Sha256(b),0,32);}
 static void Sum(byte[] data,int offset,int count,bool little,ref uint s0,ref uint s1){
  for(int i=offset;i<offset+count;i+=8){uint a=little?BitConverter.ToUInt32(data,i):Be(data,i);uint b=little?BitConverter.ToUInt32(data,i+4):Be(data,i+4);s0=unchecked(s0+a+s1);s1=unchecked(s1+b+s0);}
 }
 static byte[] Page(byte[] input,int offset,uint pgno,byte[] key,byte[] macKey){
  int skip=pgno==1?16:0;byte[] message=new byte[4032-skip+4];Array.Copy(input,offset+skip,message,0,4032-skip);Array.Copy(BitConverter.GetBytes(pgno),0,message,4032-skip,4);
  using(var h=new HMACSHA512(macKey)){if(!global::WeixinBizDbProbe.Same(h.ComputeHash(message),0,input,offset+4032,64))throw new Exception("Page authentication failed.");}
  using(var aes=Aes.Create()){aes.Key=key;aes.Mode=CipherMode.CBC;aes.Padding=PaddingMode.None;byte[] iv=new byte[16];Array.Copy(input,offset+4016,iv,0,16);aes.IV=iv;
   using(var dec=aes.CreateDecryptor()){byte[] plain=dec.TransformFinalBlock(input,offset+skip,4016-skip);byte[] result=new byte[4096];if(pgno==1)Array.Copy(System.Text.Encoding.ASCII.GetBytes("SQLite format 3\0"),result,16);Array.Copy(plain,0,result,skip,plain.Length);Array.Clear(plain,0,plain.Length);return result;}
  }
 }
 sealed class WalState {
  public List<uint> Pages=new List<uint>();public List<int> Offsets=new List<int>();
  public int LastCommit=-1;public uint CommitPageCount;
 }
 static WalState ReadWal(byte[] wal,int maxPages){
  var result=new WalState();
  if(wal.Length==0)return result;
  if(wal.Length<32)throw new Exception("Incomplete WAL header.");
  uint magic=Be(wal,0);if((magic!=0x377f0682&&magic!=0x377f0683)||Be(wal,4)!=3007000||Be(wal,8)!=4096)throw new Exception("Unsupported WAL header.");
  uint s0=0,s1=0;bool little=magic==0x377f0682;Sum(wal,0,24,little,ref s0,ref s1);if(s0!=Be(wal,24)||s1!=Be(wal,28))throw new Exception("WAL header checksum failed.");
  for(int o=32;o+4120<=wal.Length;o+=4120){
   if(Be(wal,o+8)!=Be(wal,16)||Be(wal,o+12)!=Be(wal,20))break; // stale tail left by an earlier WAL generation
   uint t0=s0,t1=s1;Sum(wal,o,8,little,ref t0,ref t1);Sum(wal,o+24,4096,little,ref t0,ref t1);
   if(t0!=Be(wal,o+16)||t1!=Be(wal,o+20))throw new Exception("WAL frame checksum failed; latest metadata cannot be verified.");s0=t0;s1=t1;
   uint number=Be(wal,o);if(number==0||number>maxPages)throw new Exception("Invalid WAL page number.");
   result.Pages.Add(number);result.Offsets.Add(o+24);uint commitSize=Be(wal,o+4);if(commitSize!=0){result.LastCommit=result.Pages.Count-1;result.CommitPageCount=commitSize;}
  }
  return result;
 }
 // Windows paths cannot contain a double quote, so quoting the whole argument is sufficient.
 static string Quote(string path){if(path.IndexOf('"')>=0||path.EndsWith("\\"))throw new Exception("Unsupported path.");return "\""+path+"\"";}
 // The caller owns the returned plaintext and must clear it after use.
 internal static byte[] Decrypt(byte[] key,string path,int maxPages){
  byte[] db=null,wal=null,plain=null,macKey=null;
  try{
   for(int attempt=0;attempt<3;attempt++){
    db=ReadFile(path,maxPages);wal=ReadFile(path+"-wal",maxPages,true);byte[] again=ReadFile(path,maxPages);byte[] walAgain=ReadFile(path+"-wal",maxPages,true);
    bool stable=Same(db,again)&&Same(wal,walAgain);Array.Clear(again,0,again.Length);Array.Clear(walAgain,0,walAgain.Length);
    if(stable)break;Array.Clear(db,0,db.Length);Array.Clear(wal,0,wal.Length);db=null;wal=null;
   }
   if(db==null)throw new Exception("Database changed during snapshot; retry later.");
   if(db.Length<4096||db.Length%4096!=0)throw new Exception("Unexpected database size.");
   byte[] salt=new byte[16];Array.Copy(db,salt,16);for(int i=0;i<16;i++)salt[i]^=0x3a;macKey=global::WeixinBizDbProbe.Pbkdf2(key,salt,2);
   byte[] first=Page(db,0,1,key,macKey);uint pageCount=Be(first,28);Array.Clear(first,0,first.Length);
   var walState=ReadWal(wal,maxPages);
   if(walState.CommitPageCount>0)pageCount=walState.CommitPageCount;
   if(pageCount==0||pageCount>maxPages)throw new Exception("Invalid final page count.");
   var latest=new Dictionary<uint,int>();for(int i=0;i<=walState.LastCommit;i++)latest[walState.Pages[i]]=walState.Offsets[i];
   plain=new byte[checked((int)pageCount*4096)];
   for(uint number=1;number<=pageCount;number++){
    byte[] page;int offset;if(latest.TryGetValue(number,out offset)){page=Page(wal,offset,number,key,macKey);}else{offset=checked((int)(number-1)*4096);if(offset+4096>db.Length)throw new Exception("Missing database page.");page=Page(db,offset,number,key,macKey);}
    Array.Copy(page,0,plain,(number-1)*4096,4096);Array.Clear(page,0,page.Length);
   }
   // WAL has been merged into a private in-memory image. SQLite deserialize
   // requires rollback-journal header versions; the source files are untouched.
   plain[18]=1;plain[19]=1;
   byte[] output=plain;plain=null;return output;
  }finally{foreach(var b in new[]{db,wal,plain,macKey})if(b!=null)Array.Clear(b,0,b.Length);}
 }
 // Returns the helper's stdout: the JSON it derives from the decrypted image piped to its stdin.
 public static string Inspect(byte[] key,string path,string python,string helper){
  if(Path.GetFileName(path)!="biz_message_0.db")throw new Exception("Only the official-account database is allowed.");
  byte[] plain=Decrypt(key,path,16384);
  try{
   var info=new ProcessStartInfo(python){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true};
   info.Arguments=Quote(helper);
   using(var p=Process.Start(info)){
    var stdout=p.StandardOutput.ReadToEndAsync();var stderr=p.StandardError.ReadToEndAsync();p.StandardInput.BaseStream.Write(plain,0,plain.Length);p.StandardInput.Close();
    if(!p.WaitForExit(30000)){p.Kill();throw new Exception("Local metadata parser timed out.");}if(p.ExitCode!=0)throw new Exception("Local metadata parser failed.");
    return stdout.Result.Trim();
   }
  }finally{Array.Clear(plain,0,plain.Length);}
 }
}
}
