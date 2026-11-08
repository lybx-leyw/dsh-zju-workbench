// Chat-only persistent key protection. Database plaintext is never persisted.
// DPAPI CurrentUser binds the blob to this Windows account; path + DB salt
// bind it to one database generation. Cache hits must pass the existing HMAC.
public static partial class WeixinBizDbProbe {
 static byte[] ChatEntropy(string path,byte[] page){
  if(page==null||page.Length!=4096)throw new System.Exception("Invalid database header.");
  byte[] location=System.Text.Encoding.UTF8.GetBytes(System.IO.Path.GetFullPath(path).ToUpperInvariant());
  byte[] input=new byte[location.Length+16];System.Array.Copy(location,input,location.Length);System.Array.Copy(page,0,input,location.Length,16);
  return Sha256(input);
 }
 static string ChatCachePath(string directory,byte[] entropy){
  return System.IO.Path.Combine(System.IO.Path.GetFullPath(directory),Hex(entropy).ToLowerInvariant()+".bin");
 }
 static Result LoadChatKey(string path,byte[] page,string directory){
  byte[] entropy=ChatEntropy(path,page),blob=null,key=null;
  try{
   string file=ChatCachePath(directory,entropy);
   if(!System.IO.File.Exists(file))return null;
   using(var stream=new System.IO.FileStream(file,System.IO.FileMode.Open,System.IO.FileAccess.Read,System.IO.FileShare.Read|System.IO.FileShare.Delete)){
    if(stream.Length<1||stream.Length>16384)return null;blob=new byte[(int)stream.Length];
    for(int n=0;n<blob.Length;){int count=stream.Read(blob,n,blob.Length-n);if(count==0)return null;n+=count;}
   }
   key=System.Security.Cryptography.ProtectedData.Unprotect(blob,entropy,System.Security.Cryptography.DataProtectionScope.CurrentUser);
   byte[] salt=new byte[16];System.Array.Copy(page,salt,16);
   if(key.Length!=32||!Verify(key,salt,page))return null;
   var result=new Result();Confirm(result,key);return result;
  }catch(System.Security.Cryptography.CryptographicException){return null;}
   catch(System.IO.IOException){return null;}
   catch(System.UnauthorizedAccessException){return null;}
  finally{if(key!=null)System.Array.Clear(key,0,key.Length);if(blob!=null)System.Array.Clear(blob,0,blob.Length);}
 }
 public static void StoreChatKey(string path,byte[] page,byte[] key,string directory){
  byte[] salt=new byte[16];System.Array.Copy(page,salt,16);
  if(key==null||key.Length!=32||!Verify(key,salt,page))throw new System.Exception("wechat_key_unavailable");
  byte[] entropy=ChatEntropy(path,page),blob=null;string temporary=null;
  try{
   string root=System.IO.Path.GetFullPath(directory);System.IO.Directory.CreateDirectory(root);
   string destination=ChatCachePath(root,entropy);
   blob=System.Security.Cryptography.ProtectedData.Protect(key,entropy,System.Security.Cryptography.DataProtectionScope.CurrentUser);
   temporary=System.IO.Path.Combine(root,System.Guid.NewGuid().ToString("N")+".tmp");
   using(var stream=new System.IO.FileStream(temporary,System.IO.FileMode.CreateNew,System.IO.FileAccess.Write,System.IO.FileShare.None)){
    stream.Write(blob,0,blob.Length);stream.Flush(true);
   }
   if(System.IO.File.Exists(destination))System.IO.File.Replace(temporary,destination,null);
   else System.IO.File.Move(temporary,destination);
   temporary=null;
  }finally{
   if(blob!=null)System.Array.Clear(blob,0,blob.Length);
   // Only this call's generated temporary file, within the resolved cache root.
   if(temporary!=null&&System.IO.Path.GetDirectoryName(temporary)==System.IO.Path.GetFullPath(directory)&&System.IO.File.Exists(temporary))System.IO.File.Delete(temporary);
  }
 }
 public static Result ChatKey(int pid,string path,byte[] page,string directory){
  var cached=LoadChatKey(path,page,directory);if(cached!=null)return cached;
  if(pid<=0)throw new System.Exception("wechat_offline_key_unavailable");
  var result=Run(pid,page);
  if(!result.VerifiedDatabaseKey){Forget(result);throw new System.Exception("wechat_key_unavailable");}
  try{StoreChatKey(path,page,result.VerifiedKey,directory);return result;}
  catch{Forget(result);throw new System.Exception("wechat_key_cache_failed");}
 }
}
