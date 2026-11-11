namespace WeixinResearch {
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Text.RegularExpressions;

public static class ChatSnapshot {
 // Framed pipe: name length, image length (little-endian int32), UTF-8 name, image.
 // Only one decrypted shard is held by the producer at a time.
 public static string Read(int pid,string[] paths,string python,string helper,string query,bool useCache){
  if(!Regex.IsMatch(query,@"\A[A-Za-z0-9+/=]+\z")||helper.IndexOf('"')>=0)throw new Exception("Invalid parser arguments.");
  var info=new ProcessStartInfo(python){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true};
  info.Arguments="\""+helper+"\" "+query;
  using(var p=Process.Start(info)){
   var stdout=p.StandardOutput.ReadToEndAsync();var stderr=p.StandardError.ReadToEndAsync();
   // Message shards whose key Weixin no longer holds in memory (long-idle history) are skipped and reported
   // as partial, so one old shard does not fail every query. Downloads need their exact shard and never skip.
   int skipped=0,messages=0;
   try{
    foreach(string path in paths){
     string name=Path.GetFileName(path);
     if(name!="contact.db"&&name!="session.db"&&name!="hardlink.db"&&!Regex.IsMatch(name,@"\A(message|media)_[0-9]+\.db\z"))throw new Exception("Unsupported chat database.");
     bool shard=Regex.IsMatch(name,@"\Amessage_[0-9]+\.db\z");
     byte[] page=new byte[4096];
     using(var f=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){
      for(int n=0;n<page.Length;){int read=f.Read(page,n,page.Length-n);if(read==0)throw new Exception("Incomplete header.");n+=read;}
     }
     string cache=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"weread-skill","chat-keys");
     global::WeixinBizDbProbe.Result key;
     try{key=useCache?global::WeixinBizDbProbe.ChatKey(pid,path,page,cache):global::WeixinBizDbProbe.Run(pid,page);}
     catch(Exception e){
      if(useCache&&shard&&(e.Message=="wechat_key_unavailable"||e.Message=="wechat_offline_key_unavailable")){skipped++;Array.Clear(page,0,page.Length);continue;}
      throw;
     }
     if(shard)messages++;
     try{
      if(!key.VerifiedDatabaseKey)throw new Exception("wechat_key_unavailable");
      byte[] plain=BizSnapshot.Decrypt(key.VerifiedKey,path,131072);
      try{
       byte[] label=Encoding.UTF8.GetBytes(name);var stream=p.StandardInput.BaseStream;
       stream.Write(BitConverter.GetBytes(label.Length),0,4);stream.Write(BitConverter.GetBytes(plain.Length),0,4);
       stream.Write(label,0,label.Length);stream.Write(plain,0,plain.Length);stream.Flush();
      }finally{Array.Clear(plain,0,plain.Length);}
     }finally{global::WeixinBizDbProbe.Forget(key);Array.Clear(page,0,page.Length);}
    }
    if(skipped>0&&messages==0)throw new Exception("wechat_key_unavailable");
    p.StandardInput.Close();
    if(!p.WaitForExit(30000))throw new Exception("Chat parser timeout.");
    if(p.ExitCode!=0)throw new Exception("Chat parser failed.");
    string output=stdout.Result.Trim();
    if(skipped>0&&output.StartsWith("{")&&output.Length>2)output="{\"partial\":true,\"skippedShards\":"+skipped+","+output.Substring(1);
    return output;
   }finally{if(!p.HasExited)p.Kill();}
  }
 }
}
}
