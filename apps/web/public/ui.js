async function load() {
  const kiosks = await fetch("/api/kiosks").then(r=>r.json());
  const root = document.getElementById("kiosks");
  root.innerHTML = kiosks.map(k => `
    <div class="card">
      <b>${k.id}</b><br/>
      Status: <span class="${k.online?'online':'offline'}">${k.online?'ONLINE':'OFFLINE'}</span><br/>
      Last Seen: ${new Date(k.lastSeen).toLocaleString()}<br/>
      <button onclick="disable('${k.id}')">Disable</button>
    </div>
  `).join("");
}

window.disable = async (id) => {
  await fetch("/api/kiosks/"+id+"/disable", { method:"POST" });
  load();
}

load();
setInterval(load, 5000);
