async function load(){
 const ks=await fetch("/api/kiosks").then(r=>r.json());
 document.getElementById("kiosks").innerHTML=ks.map(k=>`
  <div style="margin:12px;padding:12px;background:#111c32">
   <b>${k.id}</b><br/>
   ${k.online?"ONLINE":"OFFLINE"}<br/>
   <button onclick="disableK('${k.id}')">Disable</button>
  </div>`).join("");
}
window.disableK=async id=>{await fetch("/api/kiosks/"+id+"/disable",{method:"POST"});load();}
load();setInterval(load,5000);
