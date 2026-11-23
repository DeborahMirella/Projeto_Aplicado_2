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

function parseManagerNumber(raw,suffix=""){
 if(raw===null||raw===undefined||String(raw).trim()==="")return null;
 let text=String(raw).replace(/%/g,"%").trim();
 let value;
 if(text.includes(",")){value=parseFloat(text.replace(/[^0-9,-]/g,"").replace("-","-").replace(".","").replace(",","."));}
 else{value=parseFloat(text.replace(/[^0-9.-]/g,""));}
 return Number.isFinite(value)?value:null;
}
function formatManagerNumber(value,suffix=""){
 return value===null?"Dado não disponível na fonte":value.toLocaleString("pt-BR",{minimumFractionDigits:suffix?2:0,maximumFractionDigits:suffix?2:2})+suffix;
}
function lineChart(id,series,key,title,suffix=""){
 const el=$(id); if(!el)return;
 const parsed=series.map((x,i)=>({label:x.competence,value:parseManagerNumber(x[key],suffix),index:i})).filter(x=>x.value!==null);
 if(!parsed.length){el.innerHTML='<div class="chart-empty"><strong>Dado não disponível na fonte</strong><span>Não há valores publicados para esta série.</span></div>';return}
 const width=620,height=260,padding={top:24,right:24,bottom:48,left:54};
 const values=parsed.map(x=>x.value);
 const spread=Math.max(...values)-Math.min(...values);
 const min=Math.max(0,Math.min(...values)-Math.max(5,spread*0.25));
 const max=Math.max(...values)+Math.max(5,spread*0.25);
 const xPos=i=>padding.left+i*(width-padding.left-padding.right)/Math.max(parsed.length-1,1);
 const y=v=>padding.top+(max-v)*(height-padding.top-padding.bottom)/(max-min||1);
 let grid="";
 for(let i=0;i<=4;i++){const v=min+(max-min)*i/4,yy=y(v);grid+=`<line x1="${padding.left}" y1="${yy}" x2="${width-padding.right}" y2="${yy}" class="chart-grid-line"/><text x="${padding.left-10}" y="${yy+4}" text-anchor="end" class="chart-axis-text">${v.toFixed(v%1?1:0)}${suffix}</text>`}
 const coords=parsed.map((x,i)=>`${xPos(i)},${y(x.value)}`).join(" ");
 const pointMarkup=parsed.map((x,i)=>`<g><circle cx="${xPos(i)}" cy="${y(x.value)}" r="5" class="chart-point"><title>${esc(title)} — ${esc(x.label)}: ${formatManagerNumber(x.value,suffix)}</title></circle><text x="${xPos(i)}" y="${height-18}" text-anchor="middle" class="chart-axis-text">${esc(String(x.label).replace(/^20/,""))}</text></g>`).join("");
 el.innerHTML=`<svg class="manager-line-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img"><g>${grid}</g><polyline points="${coords}" class="chart-line"/>${pointMarkup}</svg><div class="chart-legend"><span></span>${esc(title)} · unidade: percentual</div>`;
}

const managerTableState=new Map();
function dataTable(id,columns,rows,options={}){
 const el=$(id);if(!el)return;
 const key=id;
 if(!rows||!rows.length){el.innerHTML='<div class="data-empty"><strong>Nenhum registro encontrado</strong><span>Não há dados disponíveis para esta seleção.</span></div>';return}
 const state=managerTableState.get(key)||{page:1,pageSize:10,sortKey:"",sortDir:"asc"};
 let filtered=[...rows];
 if(state.sortKey){const col=columns.find(c=>c.key===state.sortKey);filtered.sort((a,b)=>{const av=a[state.sortKey]??"",bv=b[state.sortKey]??"";const an=parseManagerNumber(av),bn=parseManagerNumber(bv);let result=an!==null&&bn!==null?an-bn:String(av).localeCompare(String(bv),"pt-BR",{numeric:true});return state.sortDir==="asc"?result:-result})}
 const total=filtered.length,totalPages=Math.max(1,Math.ceil(total/state.pageSize));state.page=Math.min(state.page,totalPages);managerTableState.set(key,state);
 const start=(state.page-1)*state.pageSize,pageRows=filtered.slice(start,start+state.pageSize);
 el.innerHTML=`<div class="table-toolbar"><strong>${total.toLocaleString("pt-BR")} registro${total===1?"":"s"} encontrado${total===1?"":"s"}</strong><label>Exibir<select class="table-page-size"><option value="10" ${state.pageSize===10?"selected":""}>10</option><option value="25" ${state.pageSize===25?"selected":""}>25</option><option value="50" ${state.pageSize===50?"selected":""}>50</option></select> por página</label></div><div class="table-scroll"><table><thead><tr>${columns.map(c=>`<th scope="col" data-sort="${esc(c.key)}" class="${state.sortKey===c.key?`sorted-${state.sortDir}`:""}">${esc(c.label)}<span aria-hidden="true">↕</span></th>`).join("")}</tr></thead><tbody>${pageRows.map((r,rowIndex)=>`<tr>${columns.map(c=>`<td class="${c.numeric?"numeric":""}">${esc(r[c.key]??"")||'<span class="data-unavailable">Não informado</span>'}</td>`).join("")}</tr>`).join("")}</tbody></table></div><div class="table-pagination"><button type="button" data-page="prev" ${state.page<=1?"disabled":""}>‹ Anterior</button><span>Página ${state.page} de ${totalPages}</span><button type="button" data-page="next" ${state.page>=totalPages?"disabled":""}>Próxima ›</button></div>`;
 el.querySelector(".table-page-size").addEventListener("change",e=>{state.page=1;state.pageSize=Number(e.target.value);managerTableState.set(key,state);dataTable(id,columns,rows,options)});
 el.querySelectorAll("th[data-sort]").forEach(th=>th.addEventListener("click",()=>{const sortKey=th.dataset.sort;state.sortDir=state.sortKey===sortKey&&state.sortDir==="asc"?"desc":"asc";state.sortKey=sortKey;state.page=1;managerTableState.set(key,state);dataTable(id,columns,rows,options)}));
 el.querySelector("[data-page=prev]").addEventListener("click",()=>{state.page=Math.max(1,state.page-1);managerTableState.set(key,state);dataTable(id,columns,rows,options)});
 el.querySelector("[data-page=next]").addEventListener("click",()=>{state.page=Math.min(totalPages,state.page+1);managerTableState.set(key,state);dataTable(id,columns,rows,options)});
}

let dashboardData=null;
async function loadDashboard(){
 try{
  const d=await(await fetch("/api/dashboard")).json();dashboardData=d;
  $("kpi-cnes").textContent=d.counts.establishments.toLocaleString("pt-BR");
  $("kpi-aps").textContent=d.counts.aps.toLocaleString("pt-BR");
  $("kpi-acs").textContent=d.counts.acs.toLocaleString("pt-BR");
  $("kpi-monitor").textContent=d.counts.monitor.toLocaleString("pt-BR");
  $("overview-cnes").textContent=d.counts.establishments.toLocaleString("pt-BR");
  $("kpi-monitor-meta").textContent=`Nacional · ${d.monitor.filter(x=>/BELO HORIZONTE/i.test(x.municipality||"")).length} registro(s) de BH`;
  const periods=[...new Set([...d.acsSeries.map(x=>x.competence),...d.apsSeries.map(x=>x.competence)].filter(Boolean))].sort();
  $("manager-period-filter").innerHTML='<option value="">Todas as competências</option>'+periods.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join("");
  $("overview-professionals").textContent=(d.counts.professionals||0).toLocaleString("pt-BR");
  const professionals=d.professionals||[];
  const cbos=[...new Set(professionals.map(r=>r.CBO).filter(Boolean))].sort();
  const professionalPeriods=[...new Set(professionals.map(r=>r["Comp. CNES"]).filter(Boolean))].sort();
  const professionalStatuses=[...new Set(professionals.map(r=>r["Status do envio de produção"]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
  $("professional-cbo-filter").innerHTML='<option value="">Todos os CBO</option>'+cbos.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
  $("professional-period-filter").innerHTML='<option value="">Todas as competências</option>'+professionalPeriods.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
  $("professional-status-filter").innerHTML='<option value="">Todas as situações</option>'+professionalStatuses.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
  applyProfessionalFilters();
 }catch(e){
  document.querySelectorAll(".kpi-card strong,.overview-card strong").forEach(x=>{if(!x.id||x.id!=="overview-cnes")x.textContent="Dado não disponível na fonte"});
 }
}
function applyManagerFilters(){
 if(!dashboardData)return;
 const d=dashboardData;
 const source=$("manager-source-filter").value;
 const period=$("manager-period-filter").value;
 const monitorGroup=$("manager-monitor-filter").value;
 const normalizeCompetence=value=>{const text=String(value||"").trim();const slash=text.match(/^([0-9]{1,2})\/([0-9]{4})$/);if(slash)return `${slash[2]}${slash[1].padStart(2,"0")}`;const compact=text.match(/^([0-9]{4})([0-9]{2})$/);return compact?value.replace(/[^0-9]/g,""):text.replace(/[^0-9]/g,"")};
 const acs=d.acsSeries.filter(x=>!period||normalizeCompetence(x.competence)==normalizeCompetence(period));
 const aps=d.apsSeries.filter(x=>!period||normalizeCompetence(x.competence)==normalizeCompetence(period));
 lineChart("acs-chart",source&&source!=="ACS"&&source!=="MONITOR"?[]:acs,"coverage","Cobertura dos Agentes Comunitários de Saúde","%");
 lineChart("aps-chart",source&&source!=="APS"&&source!=="MONITOR"?[]:aps,"capacity","Capacidade da Atenção Primária","%");
 dataTable("sisab-table",[
  {label:"Município",key:"Municipio"},{label:"Atendimento individual",key:"Atendimento Individual",numeric:true},{label:"Atendimento odontológico",key:"Atendimento Odontológico",numeric:true},{label:"Procedimento",key:"Procedimento",numeric:true},{label:"Visita domiciliar",key:"Visita Domiciliar",numeric:true}
 ],d.sisab);
 dataTable("sia-table",[
  {label:"Município",key:"Município"},{label:"Quantidade aprovada",key:"Qtd.aprovada",numeric:true}
 ],d.sia);
 let monitor=d.monitor;
 if(monitorGroup)monitor=monitor.filter(x=>x.sheet===monitorGroup);
 managerTableState.delete("monitor-table");
 dataTable("monitor-table",[
  {label:"Aba",key:"sheet"},{label:"Município",key:"municipality"},{label:"Situação",key:"status"},{label:"Tempo sem envio",key:"count"},{label:"CNES",key:"cnes",numeric:true}
 ],monitor);
 const active=[source?$("manager-source-filter").selectedOptions[0].text:"",period?`Competência ${period}`:"",monitorGroup?`Grupo ${monitorGroup}`:""].filter(Boolean);
 $("active-filter-label").textContent=active.length?active.join(" · "):"Nenhum filtro ativo";
 $("active-filter-label").classList.toggle("active",active.length>0);
}
$("manager-apply").addEventListener("click",applyManagerFilters);
$("manager-clear").addEventListener("click",()=>{$("manager-source-filter").value="";$("manager-period-filter").value="";$("manager-monitor-filter").value="";applyManagerFilters()});

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

function professionalHorizontalChart(id,items,labelKey,valueKey,title){
 const el=$(id);if(!el)return;
 if(!items||!items.length){el.innerHTML='<div class="data-empty"><strong>Nenhum registro encontrado</strong><span>Não há dados profissionais para esta seleção.</span></div>';return}
 const sorted=[...items].sort((a,b)=>Number(b[valueKey]||0)-Number(a[valueKey]||0));
 const max=Math.max(...sorted.map(x=>Number(x[valueKey]||0)),1);
 el.innerHTML=`<div class="horizontal-chart" aria-label="${esc(title)}">${sorted.map(x=>`<div class="horizontal-row"><span title="${esc(x[labelKey])}">${esc(x[labelKey])}</span><div class="horizontal-track"><i style="width:${Math.max(3,Number(x[valueKey])/max*100)}%"></i></div><strong>${Number(x[valueKey]).toLocaleString("pt-BR")}</strong></div>`).join("")}</div>`;
}
function applyProfessionalFilters(){
 if(!dashboardData)return;
 const rows=dashboardData.professionals||[];
 const cbo=$("professional-cbo-filter").value;
 const period=$("professional-period-filter").value;
 const status=$("professional-status-filter").value;
 const filtered=rows.filter(r=>(!cbo||r.CBO===cbo)&&(!period||r["Comp. CNES"]===period)&&(!status||r["Status do envio de produção"]===status));
 const cboMap=new Map(),statusMap=new Map();
 filtered.forEach(r=>{if(r.CBO)cboMap.set(r.CBO,(cboMap.get(r.CBO)||0)+1);const s=r["Status do envio de produção"]||"";if(s)statusMap.set(s,(statusMap.get(s)||0)+1)});
 professionalHorizontalChart("professional-cbo-chart",[...cboMap].map(([cbo,count])=>({cbo,count})),"cbo","count","Profissionais por CBO");
 professionalHorizontalChart("professional-status-chart",[...statusMap].map(([status,count])=>({status,count})),"status","count","Situação do envio");
 dataTable("professionals-table",[
  {label:"Competência",key:"Comp. CNES"},{label:"Município",key:"Municipio"},{label:"CBO",key:"CBO"},{label:"Situação do envio",key:"Status do envio de produção"},{label:"Competências sem envio",key:"Qtde. de competências consecutivas sem envio"}
 ],filtered);
 const active=[cbo?`CBO ${cbo}`:"",period?`Competência ${period}`:"",status?status:""].filter(Boolean);
 $("active-professional-filter").textContent=active.length?active.join(" · "):"Nenhum filtro ativo";
 $("active-professional-filter").classList.toggle("active",active.length>0);
}
$("professional-apply").addEventListener("click",applyProfessionalFilters);
$("professional-clear").addEventListener("click",()=>{$("professional-cbo-filter").value="";$("professional-period-filter").value="";$("professional-status-filter").value="";applyProfessionalFilters()});