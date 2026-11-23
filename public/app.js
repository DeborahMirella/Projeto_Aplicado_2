const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let citizenDistricts = [];

function showView(name){
 document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===name));
 document.querySelectorAll(".nav-link").forEach(n=>n.classList.toggle("active",n.dataset.view===name));
 if(name=== "citizen")resetCitizen();
 window.scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));

async function loadDatasets(){
 try{const r=await fetch("/api/datasets"),ds=await r.json();const cnes=ds.find(d=>d.category.includes("Estabelecimentos"));if(cnes&&$("hero-cnes"))$("hero-cnes").textContent=Number(cnes.row_count).toLocaleString("pt-BR");if($("dataset"))$("dataset").innerHTML='<option value="">Todos os conjuntos</option>'+ds.map(d=>`<option value="${d.id}">${esc(d.category)} (${d.row_count})</option>`).join("");}catch(e){}
}

function resetCitizen(){
 $("citizen-menu").classList.remove("hidden");$("citizen-content").classList.add("hidden");$("citizen-content").innerHTML="";
 $("citizen-title").textContent="Como podemos ajudar?";$("citizen-description").textContent="Escolha uma opção para começar. Você não precisa conhecer siglas ou nomes técnicos.";
 $("citizen-breadcrumb").innerHTML="";$("results-head").classList.add("hidden");$("results").innerHTML="";
}
function breadcrumb(parts){$("citizen-breadcrumb").innerHTML=parts.map((p,i)=>`${i?' <span aria-hidden="true">›</span> ':''}<button type="button">${esc(p)}</button>`).join("")}
async function units(district="",type="",service=""){const p=new URLSearchParams();if(district)p.set("district",district);if(type)p.set("type",type);if(service)p.set("service",service);const r=await fetch("/api/citizen/units"+(p.toString()?"?"+p:""));return r.json()}
let activeFilters={district:"",type:"",service:""};
function unitCard(u){
 const lat=Number(u.lat),lon=Number(u.lon),valid=Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180;
 const map=valid?`<button class="button-card map" data-map='${esc(JSON.stringify(u))}'>Ver no mapa</button>`:"";
 return `<article class="unit-card"><div class="unit-symbol">+</div><div class="unit-info"><h3>${esc(u.name)}</h3>${u.district?`<p><strong>Bairro:</strong> ${esc(u.district)}</p>`:""}${u.address?`<p><strong>Endereço:</strong> ${esc(u.address)}</p>`:""}${u.cep?`<p><strong>CEP:</strong> ${esc(u.cep)}</p>`:""}<div class="unit-actions"><button class="button-card detail" data-detail='${esc(JSON.stringify(u))}'>Ver detalhes</button>${map}</div></div></article>`;
}
function bindDetails(){document.querySelectorAll("[data-detail]").forEach(b=>b.addEventListener("click",()=>showDetail(JSON.parse(b.dataset.detail))));document.querySelectorAll("[data-map]").forEach(b=>b.addEventListener("click",()=>locateUnit(JSON.parse(b.dataset.map))))}
function bindDistricts(){document.querySelectorAll("[data-district]").forEach(b=>b.addEventListener("click",()=>b.dataset.district==="__ALL__"?openDistricts(true):showDistrict(b.dataset.district)))}
async function openDistricts(all=false){
 $("citizen-menu").classList.add("hidden");$("citizen-content").classList.remove("hidden");
 if(all){const d=await units();$("citizen-title").textContent="Todas as unidades cadastradas";$("citizen-description").textContent="Todas as unidades disponíveis no cadastro público.";breadcrumb(["Início","Todas as unidades"]);$("citizen-content").innerHTML=`<div class="unit-grid">${d.units.length?d.units.map(unitCard).join(""):'<p class="empty">Não encontramos unidades nesta seleção.</p>'}</div>`;bindDetails()}
 else{const d=await units();$("citizen-title").textContent="Escolha um bairro";$("citizen-description").textContent="Os bairros abaixo foram encontrados no cadastro real de unidades de saúde.";breadcrumb(["Início","Bairros"]);$("citizen-content").innerHTML=`<div class="district-grid">${d.districts.map(x=>`<button class="district-card" data-district="${esc(x)}"><span>${esc(x)}</span><b>›</b></button>`).join("")}<button class="district-card all" data-district="__ALL__"><span>Ver todas as unidades</span><b>›</b></button></div>`;bindDistricts()}
}
async function showDistrict(district){const d=await units(district);$("citizen-title").textContent="Unidades em "+district;$("citizen-description").textContent="Selecione uma unidade para ver os dados disponíveis.";breadcrumb(["Início","Bairros",district]);$("citizen-content").innerHTML=`<div class="unit-grid">${d.units.length?d.units.map(unitCard).join(""):'<p class="empty">Não encontramos unidades neste bairro.</p>'}</div>`;bindDetails()}
function showDetail(u){
 $("citizen-title").textContent=u.name;$("citizen-description").textContent="Dados cadastrais disponíveis para esta unidade.";breadcrumb(["Início","Unidade",u.name]);
 const lat=Number(u.lat),lon=Number(u.lon),valid=Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180;
 $("citizen-content").innerHTML=`<article class="unit-detail"><button class="back-button" id="detail-back">← Voltar aos bairros</button><div class="detail-grid">${u.district?`<div><span>Bairro</span><strong>${esc(u.district)}</strong></div>`:""}${u.address?`<div><span>Endereço</span><strong>${esc(u.address)}</strong></div>`:""}${u.cep?`<div><span>CEP</span><strong>${esc(u.cep)}</strong></div>`:""}${u.cnes?`<div><span>Código cadastral</span><strong>${esc(u.cnes)}</strong></div>`:""}</div>${valid?`<a class="button primary" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(u.lat)}&mlon=${encodeURIComponent(u.lon)}&zoom=16">Abrir localização no mapa</a>`:""}</article>`;
 $("detail-back").addEventListener("click",()=>openDistricts(false));
}
async function showIndicators(){
 $("citizen-menu").classList.add("hidden");$("citizen-content").classList.remove("hidden");$("citizen-title").textContent="Indicadores públicos";$("citizen-description").textContent="Os indicadores são municipais e explicados de forma simples.";breadcrumb(["Início","Indicadores"]);
 const d=await(await fetch("/api/dashboard")).json(),acs=d.acsSeries.filter(x=>x.coverage).at(-1),aps=d.apsSeries.filter(x=>x.capacity).at(-1);
 $("citizen-content").innerHTML=`<div class="indicator-grid">${acs?`<article class="indicator-card"><span>Agentes Comunitários de Saúde</span><strong>${esc(acs.coverage)}</strong><p>Período ${esc(acs.competence)}</p><small>Estimativa municipal da cobertura de ACS.</small></article>`:'<article class="indicator-card unavailable"><span>Agentes Comunitários de Saúde</span><strong>Indisponível</strong><small>Não há valor publicado para este indicador.</small></article>'}${aps?`<article class="indicator-card"><span>Capacidade da atenção primária</span><strong>${esc(aps.capacity)}</strong><p>Período ${esc(aps.competence)}</p><small>Indicador municipal da capacidade das equipes.</small></article>`:'<article class="indicator-card unavailable"><span>Capacidade da atenção primária</span><strong>Indisponível</strong><small>Não há valor publicado para este indicador.</small></article>'}</div><p class="source-note">Os valores representam o município de Belo Horizonte. Não correspondem a uma unidade individual.</p>`;
}
function showNetwork(){
 $("citizen-menu").classList.add("hidden");$("citizen-content").classList.remove("hidden");$("citizen-title").textContent="Informações sobre a rede";$("citizen-description").textContent="Entenda, de forma simples, o que o SUS+ apresenta.";breadcrumb(["Início","Rede"]);
 $("citizen-content").innerHTML='<div class="network-grid"><article><b>Unidades</b><p>Dados cadastrais de estabelecimentos de Belo Horizonte.</p></article><article><b>Atendimento básico</b><p>Informações públicas sobre atenção primária e produção municipal.</p></article><article><b>Indicadores</b><p>Medidas agregadas da rede. Não representam atendimento individual.</p></article></div>';
}
document.querySelectorAll("[data-citizen-action]").forEach(b=>b.addEventListener("click",()=>{const a=b.dataset.citizenAction;if(a==="units")renderFilteredUnits();if(a==="neighborhoods")openDistricts(false);if(a==="network")showNetwork();if(a=== "indicators")showIndicators()}));
$("citizen-back").addEventListener("click",()=>{if($("citizen-menu").classList.contains("hidden"))resetCitizen();else showView("home")});

$("toggle-search").addEventListener("click",()=>$("search-panel").classList.toggle("hidden"));
async function search(){const p=new URLSearchParams();if($("dataset").value)p.set("datasetId",$("dataset").value);if($("q").value)p.set("q",$("q").value);p.set("mode","all");try{const r=await fetch("/api/search?"+p),rows=await r.json();$("results-head").classList.remove("hidden");$("count").textContent=rows.length+" encontrados";$("results").innerHTML=rows.length?rows.filter(x=>x.CNES).map(x=>unitCard({name:x["NOME FANTASIA"]||x["RAZAO SOCIAL"]||"",district:x.BAIRRO||"",address:[x.LOGRADOURO,x.NUMERO].filter(Boolean).join(", "),cep:x.CEP||"",lat:x.LATITUDE||"",lon:x.LONGITUDE||"",cnes:x.CNES||""})).join(""):'<p class="empty">Não encontramos unidades com esses dados.</p>';bindDetails()}catch(e){$("results").innerHTML='<p class="empty">Não foi possível realizar a busca.</p>'}}
$("search").addEventListener("click",search);$("q").addEventListener("keydown",e=>{if(e.key==="Enter")search()});

function barChart(id,series,key,suffix=""){const el=$(id),parsed=series.map(x=>{let raw=String(x[key]??"").replace("%","").trim();let value;if(raw.includes(",")){value=parseFloat(raw.replace(/\./g,"").replace(",","."));}else if(raw.includes(".")){value=parseFloat(raw);}else{value=parseFloat(raw.replace(/[^0-9]/g,""));}return {label:x.competence,value,suffix}}).filter(x=>Number.isFinite(x.value));if(!parsed.length){el.innerHTML='<p class="empty">Não há valores publicados para este indicador.</p>';return}const max=Math.max(...parsed.map(x=>x.value),1);el.innerHTML=parsed.map(x=>`<div class="bar-row"><span>${esc(x.label)}</div><div class="bar-track"><i style="width:${Math.max(3,x.value/max*100)}%"></i></div><strong>${x.value.toLocaleString("pt-BR",{maximumFractionDigits:2})}${x.suffix}</strong></div>`).join("")}
function table(id,columns,rows,empty="Sem registros"){const el=$(id);if(!rows.length){el.innerHTML=`<p class="empty">${empty}</p>`;return}el.innerHTML=`<table><thead><tr>${columns.map(c=>`<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${columns.map(c=>`<td>${esc(r[c.key]??"")}</td>`).join("")}</tr>`).join("")}</tbody></table>`}
async function loadDashboard(){try{const d=await(await fetch("/api/dashboard")).json();$("kpi-cnes").textContent=d.counts.establishments.toLocaleString("pt-BR");$("kpi-aps").textContent=d.counts.aps.toLocaleString("pt-BR");$("kpi-acs").textContent=d.counts.acs.toLocaleString("pt-BR");$("kpi-monitor").textContent=d.counts.monitor.toLocaleString("pt-BR");barChart("acs-chart",d.acsSeries.map(x=>({competence:x.competence,value:x.coverage})),"value","%");barChart("aps-chart",d.apsSeries.map(x=>({competence:x.competence,value:x.capacity})),"value","%");table("sisab-table",[{label:"Município",key:"Municipio"},{label:"Atendimento individual",key:"Atendimento Individual"},{label:"Atendimento odontológico",key:"Atendimento Odontológico"},{label:"Procedimento",key:"Procedimento"},{label:"Visita domiciliar",key:"Visita Domiciliar"}],d.sisab);table("sia-table",[{label:"Município",key:"Município"},{label:"Quantidade aprovada",key:"Qtd.aprovada"}],d.sia);table("monitor-table",[{label:"Aba",key:"sheet"},{label:"Município",key:"municipality"},{label:"Situação",key:"status"},{label:"Tempo sem envio",key:"count"}],d.monitor.filter(x=>x.municipality&&/BELO HORIZONTE/i.test(x.municipality)),"Nenhum registro municipal identificado.")}catch(e){document.querySelectorAll(".kpis strong").forEach(x=>x.textContent="—")}}

$("import").addEventListener("click",async()=>{const file=$("file").files[0];if(!file){$("message").textContent="Selecione um arquivo.";return}const fd=new FormData();fd.append("file",file);fd.append("category",$("category").value);fd.append("source",$("source").value);fd.append("period",$("period").value);$("message").textContent="Importando...";try{const r=await fetch("/api/import",{method:"POST",headers:{"x-admin-token":$("token").value},body:fd});const data=await r.json();$("message").textContent=r.ok?`${data.message} ${data.rows} linhas em ${data.sheets} aba(s).`:data.error;await loadDatasets();await loadDashboard()}catch(e){$("message").textContent="Não foi possível concluir a importação."}});

loadDatasets();loadDashboard();
async function renderFilteredUnits(){
 $("citizen-menu").classList.add("hidden");
 $("citizen-content").classList.remove("hidden");
 $("citizen-title").textContent="Encontre uma unidade";
 $("citizen-description").textContent="Combine bairro, tipo de unidade e nome cadastral. Os serviços não são confirmados além do cadastro informado.";
 breadcrumb(["Início","Filtros","Unidades"]);
 $("citizen-content").innerHTML=`<div class="filter-panel skeleton-block"><div class="skeleton-line wide"></div><div class="filter-grid-citizen"><div class="skeleton-input"></div><div class="skeleton-input"></div><div class="skeleton-input"></div></div></div><div class="map-layout"><div><div id="citizen-map-status" class="map-status"></div><div id="citizen-map" class="map-skeleton" aria-label="Mapa das unidades filtradas"><span>Carregando mapa…</span></div></div><div class="map-summary skeleton-block"><div class="skeleton-line wide"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></div><div class="filter-result-head"><h2>Carregando unidades…</h2></div><div class="unit-grid" id="unit-grid-loading">${'<div class="unit-card skeleton-card"><div class="skeleton-circle"></div><div><div class="skeleton-line wide"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></div>'.repeat(6)}</div>`;

 const unitsRequest=units(activeFilters.district,activeFilters.type,activeFilters.service);
 setTimeout(()=>initCitizenMap([]),0);
 const d=await unitsRequest;
 const districtOptions=d.districts.map(x=>`<option value="${esc(x)}" ${activeFilters.district===x?"selected":""}>${esc(x)}</option>`).join("");
 const typeOptions=["UBS","UPA","Hospital","SAMU","Farmácia"].map(x=>`<option value="${esc(x)}" ${activeFilters.type===x?"selected":""}>${esc(x)}</option>`).join("");
 const serviceOptions=["Odontologia","Farmácia"].map(x=>`<option value="${esc(x)}" ${activeFilters.service===x?"selected":""}>${esc(x)}</option>`).join("");
 $("citizen-content").innerHTML=`<div class="filter-panel"><div class="filter-grid-citizen"><label>Bairro<select id="filter-district"><option value="">Todos os bairros</option>${districtOptions}</option></select></label><label>Tipo de unidade<select id="filter-type"><option value="">Todos os tipos</option>${typeOptions}</option></select></label><label>Nome cadastral relacionado ao serviço<select id="filter-service"><option value="">Todos</option>${serviceOptions}</option></select></label></div><div class="filter-actions"><button class="button primary" id="apply-filters">Aplicar filtros</button><button class="button-card" id="clear-filters">Limpar filtros</button></div><p class="filter-warning">Os tipos e serviços são identificados por termos presentes no nome cadastral. O cadastro não contém uma lista confirmada de especialidades oferecidas.</p></div><div class="map-layout"><div><div id="citizen-map-status" class="map-status"></div><div id="citizen-map" aria-label="Mapa das unidades filtradas"><span class="map-skeleton-label">Carregando mapa…</span></div></div><div class="map-summary"><h2>Localização das unidades</h2><strong id="citizen-map-count">Calculando…</strong><p>Algumas unidades não aparecem no mapa porque não possuem coordenadas geográficas cadastradas na base consultada. Isso não significa que não existam.</p></div></div><div class="filter-result-head"><h2>${d.units.length} unidade${d.units.length===1?"":"s"} encontrada${d.units.length===1?"":"s"}</h2></div><div class="unit-grid" id="unit-grid-results"></div>`;
 $("filter-district").addEventListener("change",e=>activeFilters.district=e.target.value);
 $("filter-type").addEventListener("change",e=>activeFilters.type=e.target.value);
 $("filter-service").addEventListener("change",e=>activeFilters.service=e.target.value);
 $("apply-filters").addEventListener("click",renderFilteredUnits);
 $("clear-filters").addEventListener("click",()=>{activeFilters={district:"",type:"",service:""};renderFilteredUnits()});

 const grid=$("unit-grid-results");
 const batchSize=100;
 let index=0;
 function renderUnitBatch(){
  const next=d.units.slice(index,index+batchSize);
  grid.insertAdjacentHTML("beforeend",next.map(unitCard).join("")||(d.units.length?'':'<p class="empty">Nenhuma unidade corresponde à combinação selecionada.</p>'));
  index+=batchSize;
  bindDetails();
  if(index<d.units.length){requestIdleCallback?requestIdleCallback(renderUnitBatch,{timeout:250}):setTimeout(renderUnitBatch,0);}
 }
 renderUnitBatch();
 setTimeout(()=>initCitizenMap(d.units),50);
}

let citizenMapInstance=null;
let citizenMarkers=null;
let citizenUnitData=[];
let leafLetLoadPromise=null;
let markerClusterLoadPromise=null;

function loadStylesheet(href){
 if(document.querySelector(`link[href="${href}"]`))return Promise.resolve();
 return new Promise(resolve=>{const link=document.createElement("link");link.rel="stylesheet";link.href=href;link.onload=resolve;link.onerror=resolve;document.head.appendChild(link)});
}
function loadScript(src){
 if([...document.scripts].some(s=>s.src===src))return Promise.resolve();
 return new Promise(resolve=>{const script=document.createElement("script");script.src=src;script.async=true;script.onload=resolve;script.onerror=resolve;document.head.appendChild(script)});
}
function loadLeaflet(){
 if(window.L)return Promise.resolve(window.L);
 if(leafLetLoadPromise)return leafLetLoadPromise;
 leafLetLoadPromise=Promise.all([
  loadStylesheet("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"),
  loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js")
 ]).then(()=>window.L||null);
 return leafLetLoadPromise;
}
function loadMarkerCluster(){
 if(window.L&&typeof window.L.markerClusterGroup==='function')return Promise.resolve(window.L);
 if(markerClusterLoadPromise)return markerClusterLoadPromise;
 markerClusterLoadPromise=Promise.all([
  loadStylesheet("https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"),
  loadStylesheet("https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"),
  loadScript("https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js")
 ]).then(()=>window.L&&typeof window.L.markerClusterGroup==='function'?window.L:null);
 return markerClusterLoadPromise;
}

function locateUnit(u){
 const lat=Number(u.lat),lon=Number(u.lon);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat>90||lon< -180||lon>180)return;
 citizenUnitData=[u];
 if(!$("citizen-map")||!citizenMapInstance){renderFilteredUnits().then(()=>setTimeout(()=>locateUnit(u),300));return}
 citizenMapInstance.setView([lat,lon],16);
 if(citizenMarkers){citizenMarkers.eachLayer?.(layer=>{if(layer.getLatLng&&Math.abs(layer.getLatLng().lat-lat)<.000001&&Math.abs(layer.getLatLng().lng-lon)<.000001)layer.openPopup()})}
}

function initCitizenMap(units=[]){
 citizenUnitData=units;
 const mapElement=$("citizen-map");
 if(!mapElement)return;
 const status=$("citizen-map-status");
 if(status)status.textContent="Carregando mapa…";
 if(citizenMapInstance&&citizenMapInstance.getContainer()!==mapElement){
   citizenMapInstance.remove();
   citizenMapInstance=null;
   citizenMarkers=null;
 }
 loadLeaflet().then(L=>{
  if(!L||!$("citizen-map")){
   if(status)status.textContent="O mapa externo está temporariamente indisponível.";
   mapElement.classList.remove("map-skeleton");
   return;
  }
  if(!citizenMapInstance){
   citizenMapInstance=L.map(mapElement,{zoomControl:true}).setView([-19.9167,-43.9345],12);
   L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:'&copy; OpenStreetMap contributors',maxZoom:19}).addTo(citizenMapInstance);
  }
  if(citizenMarkers){citizenMapInstance.removeLayer(citizenMarkers);citizenMarkers=null}
  const valid=units.filter(u=>{
   const latText=String(u.lat??"").trim();
   const lonText=String(u.lon??"").trim();
   if(!latText||!lonText)return false;
   const lat=Number(latText.replace(",","."));
   const lon=Number(lonText.replace(",","."));
   return Number.isFinite(lat)&&Number.isFinite(lon)&&lat!==0&&lon!==0&&lat>=-20.10&&lat<=-19.65&&lon>=-44.20&&lon<=-43.75;
  });
  if($("citizen-map-count"))$("citizen-map-count").textContent=`${valid.length} unidade${valid.length===1?"":"s"} no mapa`;
  if(valid.length){
   const baseMarkers=L.featureGroup();
   valid.forEach(u=>{
    const marker=L.marker([Number(u.lat),Number(u.lon)]).bindPopup(`<strong>${esc(u.name)}</strong>${u.address?`<br>${esc(u.address)}`:""}`);
    baseMarkers.addLayer(marker);
   });
   citizenMarkers=baseMarkers;
   citizenMapInstance.addLayer(citizenMarkers);
   const bounds=citizenMarkers.getBounds();
   if(bounds.isValid())citizenMapInstance.fitBounds(bounds,{padding:[20,20],maxZoom:15});
   loadMarkerCluster().then(clusterL=>{
    if(!clusterL||citizenMarkers!==baseMarkers)return;
    const clustered=clusterL.markerClusterGroup();
    baseMarkers.eachLayer(marker=>clustered.addLayer(marker));
    citizenMapInstance.removeLayer(baseMarkers);
    citizenMapInstance.addLayer(clustered);
    citizenMarkers=clustered;
    setTimeout(()=>citizenMapInstance&&citizenMapInstance.invalidateSize(),50);
   });
  }else if(status)status.textContent="Nenhuma unidade desta seleção possui coordenadas.";
  if(status&&valid.length)status.textContent="";
  setTimeout(()=>citizenMapInstance&&citizenMapInstance.invalidateSize(),50);
 }).catch(()=>{if(status)status.textContent="O mapa externo está temporariamente indisponível."});
}