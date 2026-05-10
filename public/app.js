const API='';let currentUser=null,authToken=localStorage.getItem('token'),materialesList=[],currentQuiz=[],currentQuestion=0,correctAnswers=0,currentSubject='';
function authHeaders(){return{'Authorization':'Bearer '+authToken,'Content-Type':'application/json'}}
function toast(msg){var t=document.getElementById('toast');document.getElementById('toastTxt').textContent=msg;t.classList.add('on');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('on'),3500)}
function toggleSidebar(){document.querySelector('.sidebar').classList.toggle('open');document.getElementById('sidebarOverlay').classList.toggle('open')}

// AUTH
async function checkAuth(){if(!authToken){showLogin();return}try{const r=await fetch(API+'/api/auth/me',{headers:authHeaders()});if(!r.ok)throw 0;currentUser=await r.json();showApp()}catch(e){doLogout()}}
function showLogin(){document.getElementById('loginPage').style.display='block';document.getElementById('parentApp').classList.add('hidden');document.getElementById('kidApp').classList.add('hidden')}
function doLogout(){localStorage.removeItem('token');authToken=null;currentUser=null;location.reload()}
async function doLogin(){
  var role=document.querySelector('.role-btn.sel');
  if(!role)return toast('Selecciona un rol');
  var isParent=role.id==='rParent';
  var email=isParent?'padres@familia.cl':'hija@familia.cl';
  var password=isParent?'padre2026':'hija2026';
  try{
    const r=await fetch(API+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    if(!r.ok)throw 0;const d=await r.json();authToken=d.token;localStorage.setItem('token',authToken);currentUser=d.user;showApp();toast('¡Bienvenid@ '+currentUser.nombre+'!')
  }catch(e){document.getElementById('loginError').style.display='block'}
}
function selRole(r){document.getElementById('rParent').classList.toggle('sel',r==='parent');document.getElementById('rKid').classList.toggle('sel',r==='kid')}

function showApp(){
  document.getElementById('loginPage').style.display='none';
  if(currentUser.rol==='padre'){document.getElementById('parentApp').classList.remove('hidden');document.getElementById('kidApp').classList.add('hidden');initParent()}
  else{document.getElementById('kidApp').classList.remove('hidden');document.getElementById('parentApp').classList.add('hidden');initKid()}
}

// PARENT
function goPage(id,el){document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));document.querySelectorAll('.sb-item').forEach(i=>i.classList.remove('active'));document.getElementById('page-'+id).classList.add('on');if(el)el.classList.add('active');if(window.innerWidth<=850){document.querySelector('.sidebar').classList.remove('open');document.getElementById('sidebarOverlay').classList.remove('open')}
var m={dashboard:loadDash,materiales:loadMateriales,tareas:loadTareasConfig,evaluaciones:loadEvals,config:loadConfig};if(m[id])m[id]()}

async function initParent(){checkApiKey();loadDash()}

async function loadDash(){
  try{
    const[resE,resT,resEst]=await Promise.all([fetch(API+'/api/evaluaciones',{headers:authHeaders()}),fetch(API+'/api/tareas/hoy',{headers:authHeaders()}),fetch(API+'/api/estrellitas',{headers:authHeaders()})]);
    const evals=await resE.json(),tareas=await resT.json(),estrellas=await resEst.json();
    const totalEst=Array.isArray(estrellas)?estrellas.reduce((a,b)=>a+parseInt(b.total),0):0;
    const tareasOk=Array.isArray(tareas)?tareas.filter(t=>t.completada).length:0;
    const totalT=Array.isArray(tareas)?tareas.length:0;
    document.getElementById('dEst').textContent=totalEst;
    document.getElementById('dTareas').textContent=tareasOk+'/'+totalT;
    document.getElementById('dEvals').textContent=Array.isArray(evals)?evals.length:0;
    // Proximas evaluaciones
    var el=document.getElementById('dashEvals');
    if(Array.isArray(evals)&&evals.length){
      el.innerHTML=evals.slice(0,4).map(e=>{var d=Math.ceil((new Date(e.fecha)-new Date())/(86400000));var cls=d<=2?'b-rose':d<=5?'b-amber':'b-green';return'<div class="flex aic gap3 mb3"><div style="width:36px;height:36px;border-radius:9px;background:var(--coral-l);display:flex;align-items:center;justify-content:center;font-size:18px">📝</div><div style="flex:1"><div class="sm bold">'+e.asignatura+' · '+(e.tipo||'Prueba')+'</div><div class="xs muted">'+e.titulo+'</div></div><span class="b '+cls+'">'+(d<=0?'¡Hoy!':d+'d')+'</span></div>'}).join('')
    }else el.innerHTML='<p class="sm muted">Sin evaluaciones 🎉</p>';
    // Tareas pendientes
    var tp=document.getElementById('dashTareas');
    if(Array.isArray(tareas)&&tareas.length){
      tp.innerHTML=tareas.map(t=>'<div class="task-row"><div class="task-ico" style="background:'+(t.completada?'var(--emerald-l)':'var(--amber-l)')+'">'+(t.completada?'✅':'⏳')+'</div><div class="task-text"><div class="task-name">'+t.titulo+'</div><div class="task-sub">'+t.horario+'</div></div></div>').join('')
    }else tp.innerHTML='<p class="sm muted">Sin tareas hoy</p>';
  }catch(e){console.error(e)}
}

async function loadMateriales(){
  try{
    const r=await fetch(API+'/api/materiales',{headers:authHeaders()});materialesList=await r.json();
    document.getElementById('matList').innerHTML=materialesList.length?'<table class="tbl"><thead><tr><th>Materia</th><th>Título</th><th>Fecha</th></tr></thead><tbody>'+materialesList.map(m=>'<tr><td><strong>'+m.asignatura+'</strong></td><td>'+m.titulo+'</td><td class="xs muted">'+(m.created_at||'').split('T')[0]+'</td></tr>').join('')+'</tbody></table>':'<p class="sm muted">Sin materiales subidos</p>';
  }catch(e){toast('Error cargando materiales')}
}

async function subirMaterial(){
  var file=document.getElementById('uploadFile').files[0],asig=document.getElementById('uploadAsig').value;
  if(!file)return toast('Selecciona un archivo');
  document.getElementById('uploadBtn').disabled=true;document.getElementById('uploadBtn').textContent='Procesando...';
  var fd=new FormData();fd.append('material',file);fd.append('asignatura',asig);fd.append('titulo',file.name);
  try{await fetch(API+'/api/materiales/subir',{method:'POST',headers:{'Authorization':'Bearer '+authToken},body:fd});toast('✅ Material subido');document.getElementById('uploadFile').value='';loadMateriales()}catch(e){toast('Error al subir')}
  document.getElementById('uploadBtn').disabled=false;document.getElementById('uploadBtn').textContent='Subir Material ✨';
}

async function subirPlan(){
  var file=document.getElementById('filePlan').files[0],inicio=document.getElementById('planWeek').value;
  if(!file||!inicio)return toast('Selecciona archivo y fecha');
  var fd=new FormData();fd.append('plan',file);fd.append('semana_inicio',inicio);
  try{await fetch(API+'/api/plan/subir',{method:'POST',headers:{'Authorization':'Bearer '+authToken},body:fd});toast('✅ Plan cargado')}catch(e){toast('Error al subir plan')}
}

async function subirCronograma(){
  var file=document.getElementById('fileCrono').files[0];if(!file)return toast('Selecciona el PDF');
  var fd=new FormData();fd.append('archivo',file);
  try{await fetch(API+'/api/evaluaciones/subir',{method:'POST',headers:{'Authorization':'Bearer '+authToken},body:fd});toast('✅ Cronograma procesado');loadEvals()}catch(e){toast('Error al subir')}
}

async function loadTareasConfig(){
  try{
    const tareas=await fetch(API+'/api/tareas/config',{headers:authHeaders()}).then(r=>r.json());
    document.getElementById('tareasBody').innerHTML=tareas.map(t=>'<tr><td>'+t.emoji+' <strong>'+t.titulo+'</strong></td><td class="xs muted">'+t.horario+'</td><td><button class="btn btn-ghost btn-sm" onclick="borrarTarea('+t.id+')">🗑️</button></td></tr>').join('')
  }catch(e){}
}
async function agregarTarea(){
  var titulo=document.getElementById('ntName').value.trim();if(!titulo)return toast('Ingresa nombre');
  var data={titulo,emoji:document.getElementById('ntEmoji').value||'🏠',horario:document.getElementById('ntHora').value||'Pendiente',requiere_foto:document.getElementById('ntFoto').checked};
  await fetch(API+'/api/tareas/config',{method:'POST',headers:authHeaders(),body:JSON.stringify(data)});
  document.getElementById('ntName').value='';closeMod('newTaskMod');loadTareasConfig();toast('Tarea añadida ✓')
}
async function borrarTarea(id){if(!confirm('¿Borrar?'))return;await fetch(API+'/api/tareas/config/'+id,{method:'DELETE',headers:authHeaders()});loadTareasConfig();toast('Eliminada')}

async function loadEvals(){
  try{
    const r=await fetch(API+'/api/evaluaciones',{headers:authHeaders()});const data=await r.json();
    document.getElementById('evalBody').innerHTML=data.map(e=>{var d=Math.ceil((new Date(e.fecha)-new Date())/(86400000));var cls=d<=2?'b-rose':d<=5?'b-amber':'b-green';return'<tr><td><strong>'+e.asignatura+'</strong></td><td><span class="b b-violet">'+(e.tipo||'Prueba')+'</span></td><td class="xs muted">'+e.titulo+'</td><td>'+e.fecha+'</td><td><span class="b '+cls+'">'+(d<=0?'¡Hoy!':d+'d')+'</span></td></tr>'}).join('')
  }catch(e){}
}

async function loadConfig(){checkApiKey()}
async function checkApiKey(){try{const r=await fetch(API+'/api/config/apikey/status',{headers:authHeaders()});const d=await r.json();document.getElementById('keySt').textContent=d.configured?'✓ Configurada':'Sin configurar';document.getElementById('keySt').style.color=d.configured?'var(--emerald)':'var(--rose)';document.getElementById('dashGB').textContent=d.configured?'🤖 Gemini activo':'🤖 Sin API Key'}catch(e){}}
async function saveKey(){var k=document.getElementById('apiKeyInput').value.trim();if(!k)return toast('Ingresa API Key');try{await fetch(API+'/api/config/apikey',{method:'POST',headers:authHeaders(),body:JSON.stringify({apiKey:k})});toast('API Key guardada ✓');checkApiKey()}catch(e){toast('Error')}}

// KID
async function initKid(){loadKidHome()}
function kidNav(sec,el){document.querySelectorAll('.kid-page').forEach(p=>p.classList.remove('on'));document.querySelectorAll('.kni').forEach(n=>n.classList.remove('on'));document.getElementById('kidP-'+sec).classList.add('on');if(el)el.classList.add('on');else{var idx=['home','study','quiz','logros',''].indexOf(sec);if(idx>=0)document.querySelectorAll('.kni')[idx].classList.add('on')}}

async function loadKidHome(){
  try{
    const[resE,resT,resEst]=await Promise.all([fetch(API+'/api/evaluaciones',{headers:authHeaders()}),fetch(API+'/api/tareas/hoy',{headers:authHeaders()}),fetch(API+'/api/estrellitas',{headers:authHeaders()})]);
    const evals=await resE.json(),tareas=await resT.json(),estrellas=await resEst.json();
    const totalPts=Array.isArray(estrellas)?estrellas.reduce((a,b)=>a+parseInt(b.total),0):0;
    document.getElementById('kidPts').textContent=totalPts;
    // Tareas
    var kt=document.getElementById('kidTasks');
    if(Array.isArray(tareas)&&tareas.length){
      kt.innerHTML=tareas.map(t=>{
        var btn='';
        if(t.completada){btn='<span class="b b-green">✅ Hecho</span>'}
        else if(t.requiere_foto){btn='<label class="btn btn-p btn-sm" style="cursor:pointer">📸<input type="file" accept="image/*" style="display:none" onchange="subirFoto('+t.id+',this)"></label>'}
        else{btn='<button class="btn btn-p btn-sm" onclick="completarTarea('+t.id+')">✅</button>'}
        return'<div class="task-row"><div class="task-ico" style="background:'+(t.completada?'var(--emerald-l)':'var(--amber-l)')+'">'+(t.emoji||'🏠')+'</div><div class="task-text"><div class="task-name">'+t.titulo+'</div><div class="task-sub">'+t.horario+'</div></div>'+btn+'</div>'
      }).join('')
    }else kt.innerHTML='<p class="sm muted">Sin tareas hoy 🎉</p>';
    // Eval
    var ke=document.getElementById('kidEval');
    if(Array.isArray(evals)&&evals.length){var e=evals[0];var d=Math.ceil((new Date(e.fecha)-new Date())/(86400000));ke.innerHTML='<div style="background:'+(d<=2?'var(--rose-l)':'var(--amber-l)')+';border-radius:var(--r);padding:12px 14px;display:flex;align-items:center;gap:12px"><div style="font-size:28px">📝</div><div><div class="sm bold">'+e.asignatura+'</div><div class="xs muted">'+e.titulo+'</div><div class="xs bold" style="color:'+(d<=2?'var(--rose)':'var(--amber)')+'">En '+(d<=0?'¡HOY!':d+' días')+'</div></div></div>'}
    else ke.innerHTML='<p class="sm muted">Sin evaluaciones 🎉</p>';
  }catch(e){console.error(e)}
}

async function completarTarea(id){try{await fetch(API+'/api/tareas/completar',{method:'POST',headers:authHeaders(),body:JSON.stringify({tarea_id:id,completada:1})});toast('✅ ¡Hecho!');loadKidHome()}catch(e){}}
async function subirFoto(id,inp){var file=inp.files[0];if(!file)return;var fd=new FormData();fd.append('foto',file);fd.append('tarea_id',id);fd.append('completada',1);try{await fetch(API+'/api/tareas/completar',{method:'POST',headers:{'Authorization':'Bearer '+authToken},body:fd});toast('📸 Foto enviada');loadKidHome()}catch(e){toast('Error')}}

async function loadKidStudy(){
  try{const r=await fetch(API+'/api/materiales',{headers:authHeaders()});materialesList=await r.json();
    document.getElementById('kidStudyList').innerHTML=materialesList.length?materialesList.map(m=>'<div class="flex aic jb mb3" style="padding:12px;background:var(--violet-l);border-radius:12px;cursor:pointer" onclick="showKidResumen('+m.id+')"><div class="flex aic gap2"><span style="font-size:22px">📚</span><div><div class="sm bold">'+m.asignatura+'</div><div class="xs muted">'+m.titulo+'</div></div></div><span style="font-size:18px">→</span></div>').join(''):'<p class="sm muted">Sin materiales</p>'}catch(e){}
}
function showKidResumen(id){
  var m=materialesList.find(x=>x.id===id);if(!m)return;
  document.getElementById('kidResArea').classList.remove('hidden');
  document.getElementById('kidResArea').innerHTML='<div class="kid-card"><div class="kid-card-title">📋 '+m.asignatura+' · '+m.titulo+'</div><div class="gbox mb4"><div class="gbox-hd">Resumen IA</div><div class="gbox-body" style="white-space:pre-line">'+(m.resumen||'Sin resumen')+'</div></div><button class="btn btn-g wf" onclick="startKidQuiz('+m.id+')">🎮 Hacer Quiz con IA</button></div>'
}
async function startKidQuiz(id){
  var m=materialesList.find(x=>x.id===id);if(!m)return;currentSubject=m.asignatura;
  document.getElementById('kidResArea').innerHTML='<div class="kid-card" style="text-align:center;padding:30px"><div style="font-size:3rem;margin-bottom:15px">🧠</div><div class="ldg" style="justify-content:center"><div class="dots"><span></span><span></span><span></span></div><span>Generando quiz...</span></div></div>';
  try{const r=await fetch(API+'/api/quiz/generar',{method:'POST',headers:authHeaders(),body:JSON.stringify({texto:m.resumen||m.titulo})});const d=await r.json();
    if(d.quiz&&d.quiz.length>0){currentQuiz=d.quiz;currentQuestion=0;correctAnswers=0;document.getElementById('kidResArea').innerHTML='<div class="kid-card" id="qzBox"></div>';showQ()}
    else{toast('Error generando quiz');showKidResumen(id)}
  }catch(e){toast('Error de conexión');showKidResumen(id)}
}
function showQ(){
  var q=currentQuiz[currentQuestion];
  document.getElementById('qzBox').innerHTML='<div class="flex aic jb mb4"><span class="b b-violet">'+(currentQuestion+1)+'/'+currentQuiz.length+'</span></div><p style="font-family:Sora;font-size:16px;font-weight:700;margin-bottom:16px">'+q.q+'</p>'+q.options.map((o,i)=>'<button class="qopt" onclick="ansQ('+i+',this)">'+o+'</button>').join('')
}
function ansQ(i,btn){
  if(btn.dataset.done)return;var q=currentQuiz[currentQuestion];
  document.querySelectorAll('.qopt').forEach((b,j)=>{b.dataset.done='1';if(j===q.correct)b.classList.add('ok');else if(j===i&&i!==q.correct)b.classList.add('no')});
  if(i===q.correct)correctAnswers++;
  setTimeout(()=>{currentQuestion++;if(currentQuestion<currentQuiz.length)showQ();else showQResult()},1100)
}
async function showQResult(){
  var pct=Math.round(correctAnswers/currentQuiz.length*100);
  document.getElementById('qzBox').innerHTML='<div style="text-align:center;padding:24px"><div style="font-size:56px;margin-bottom:10px">'+(pct>=70?'🎉':'💪')+'</div><div style="font-family:Sora;font-size:28px;font-weight:800;color:var(--violet)">'+pct+'%</div><div class="sm muted mb4">'+correctAnswers+'/'+currentQuiz.length+' correctas</div><button class="btn btn-v wf" onclick="document.getElementById(\'kidResArea\').classList.add(\'hidden\')">← Volver</button></div>';
  if(currentUser.rol==='hijo'){try{await fetch(API+'/api/quiz/resultado',{method:'POST',headers:authHeaders(),body:JSON.stringify({asignatura:currentSubject,correctas:correctAnswers,total:currentQuiz.length})})}catch(e){}}
}

async function loadKidLogros(){
  try{const r=await fetch(API+'/api/estrellitas',{headers:authHeaders()});const d=await r.json();
    document.getElementById('kidLogros').innerHTML=Array.isArray(d)&&d.length?d.map(e=>'<div style="background:var(--violet-l);border-radius:14px;padding:14px;text-align:center"><div style="font-size:26px;margin-bottom:5px">⭐</div><div class="sm bold">'+e.total+'</div><div class="xs muted">'+e.asignatura+'</div></div>').join(''):'<p class="sm muted">Aún sin estrellas</p>'}catch(e){}
}

function openMod(id){document.getElementById(id).classList.add('on')}
function closeMod(id){document.getElementById(id).classList.remove('on')}
document.querySelectorAll('.ov').forEach(o=>{o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('on')})});
checkAuth();
