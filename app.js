'use strict';
// ---------- State ----------
const NN=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const Q={maj:[0,4,7],min:[0,3,7],dim:[0,3,6]};
const SC={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10]};
const KP={major:[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],minor:[6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17]};
const newSong=()=>({title:'Untitled Melody',key:0,mode:'major',bpm:96,melody:[],progression:[],settings:{playbackSpeed:1,volume:0.8}});
let song=newSong(),blob=null,ctx=null,cur={root:0,q:'maj',v:'close'},ranked=[],keyCands=[],master=null,raf=0,approx=false;
let rec=null,chunks=[],recT=0,recStart=0,meterRaf=0,editing=null;
// ---------- DOM ----------
const $=s=>document.querySelector(s);
const audio=$('#audio');
const say=(m,err)=>{const s=$('#status');s.textContent=m;s.className=err?'err':''};
// ---------- Helpers ----------
const mName=m=>NN[m%12]+(Math.floor(m/12)-1);
const mFreq=m=>440*2**((m-69)/12);
const cName=c=>NN[c.root]+(c.q==='maj'?'':c.q==='min'?'m':'dim');
const cPcs=c=>Q[c.q].map(i=>(c.root+i)%12);
const getCtx=()=>{ctx=ctx||new (window.AudioContext||window.webkitAudioContext)();ctx.resume();return ctx};
const mmss=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(Math.floor(s%60)).padStart(2,'0');
// ---------- Recording ----------
async function startRec(){
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:true})}
  catch(e){say('Microphone access was denied. You can upload an audio file instead.',1);return}
  const c=getCtx(),src=c.createMediaStreamSource(stream),an=c.createAnalyser();an.fftSize=512;src.connect(an);
  chunks=[];rec=new MediaRecorder(stream);
  rec.ondataavailable=e=>chunks.push(e.data);
  rec.onstop=()=>{stream.getTracks().forEach(t=>t.stop());cancelAnimationFrame(meterRaf);clearInterval(recT);
    $('#recLive').hidden=true;$('#btnRec').hidden=false;
    setBlob(new Blob(chunks,{type:rec.mimeType}));say('Recording complete. Play it, then choose Analyze Melody.')};
  rec.start();recStart=Date.now();$('#btnRec').hidden=true;$('#recLive').hidden=false;say('Recording…');
  recT=setInterval(()=>$('#recTime').textContent='● '+mmss((Date.now()-recStart)/1000),250);
  const cv=$('#meter'),g=cv.getContext('2d'),d=new Uint8Array(an.fftSize);
  (function draw(){an.getByteTimeDomainData(d);g.clearRect(0,0,cv.width,cv.height);g.fillStyle='#d6a84f';
    for(let i=0;i<d.length;i+=8){const h=Math.abs(d[i]-128)/128*cv.height*2+2;g.fillRect(i/d.length*cv.width,(cv.height-h)/2,4,h)}
    meterRaf=requestAnimationFrame(draw)})();
}
// ---------- Audio Loading ----------
function setBlob(b){blob=b;audio.src=URL.createObjectURL(b);$('#player').hidden=false}
function onFile(f){
  if(!f)return;
  if(!/\.(mp3|wav|m4a|ogg|webm)$/i.test(f.name)&&!f.type.startsWith('audio/')){say("This audio format isn't supported. Try WAV, MP3, M4A, OGG, or WebM.",1);return}
  setBlob(f);say('Loaded '+f.name+'. Choose Analyze Melody.');
}
// ---------- Pitch Detection ----------
function detectPitch(x,sr){ // normalized autocorrelation on a frame; returns {f,conf} or null
  let e=0;for(let i=0;i<x.length;i++)e+=x[i]*x[i];
  if(Math.sqrt(e/x.length)<0.015)return null;
  const minL=Math.floor(sr/900),maxL=Math.floor(sr/80),n=x.length-maxL,r=[];let best=0;
  for(let l=minL;l<=maxL;l++){let s=0,a=0,b=0;for(let i=0;i<n;i++){s+=x[i]*x[i+l];a+=x[i]*x[i];b+=x[i+l]*x[i+l]}
    r[l]=s/Math.sqrt(a*b+1e-9);if(r[l]>best)best=r[l]}
  if(best<0.6)return null;
  for(let l=minL+1;l<maxL;l++)if(r[l]>=0.93*best&&r[l]>=r[l-1]&&r[l]>=r[l+1]){
    const p=r[l-1],q=r[l+1],d=(p-2*r[l]+q),o=d?0.5*(p-q)/d:0;return{f:sr/(l+o),conf:Math.min(1,r[l])}}
  return null;
}
async function analyze(){
  if(!blob)return;say('Analyzing…');
  let buf;
  try{buf=await getCtx().decodeAudioData(await blob.arrayBuffer())}
  catch(e){say("This audio format isn't supported. Try WAV, MP3, M4A, OGG, or WebM.",1);return}
  const ch=buf.getChannelData(0),k=Math.max(1,Math.round(buf.sampleRate/11025)),sr=buf.sampleRate/k,ds=new Float32Array(Math.floor(ch.length/k));
  for(let i=0;i<ds.length;i++){let s=0;for(let j=0;j<k;j++)s+=ch[i*k+j];ds[i]=s/k}
  const F=640,H=256,fr=[];
  for(let p=0;p+F<=ds.length;p+=H){if((p/H)%200===0)await new Promise(r=>setTimeout(r));
    const d=detectPitch(ds.subarray(p,p+F),sr);fr.push(d?{m:Math.round(69+12*Math.log2(d.f/440)),f:d.f,c:d.conf,t:p/sr}:null)}
  song.melody=segment(fr,H/sr);
  if(!song.melody.length){say("We couldn't detect a clear melody. Try singing/humming a single-note melody without background music.",1);return}
  const avg=song.melody.reduce((a,n)=>a+n.confidence,0)/song.melody.length;approx=avg<0.8;
  song.bpm=estBpm();$('#bpm').value=song.bpm;
  $('#work').hidden=false;$('#bar').hidden=false;
  detectKey();refresh();say(approx?'The detected notes are approximate. You can correct them manually.':'Analysis complete.',approx);
}
// ---------- Melody Processing ----------
function segment(fr,hop){
  const out=[];let run=null;
  const flush=()=>{if(run&&run.f.length>=4){const m=run.m,fs=run.f.reduce((a,b)=>a+b,0)/run.f.length;
    out.push({midi:m,note:mName(m),frequency:+fs.toFixed(2),start:+run.t.toFixed(3),duration:+(run.f.length*hop).toFixed(3),confidence:+(run.c.reduce((a,b)=>a+b,0)/run.c.length).toFixed(2)})}run=null};
  fr.forEach(f=>{if(!f){if(run){run.gap=(run.gap||0)+1;if(run.gap>2)flush()}return}
    if(run&&Math.abs(f.m-run.m)<=0){run.f.push(f.f);run.c.push(f.c);run.gap=0}
    else{flush();run={m:f.m,t:f.t,f:[f.f],c:[f.c]}}});
  flush();return out;
}
function estBpm(){
  const s=song.melody.map(n=>n.start),g=[];for(let i=1;i<s.length;i++)g.push(s[i]-s[i-1]);
  if(!g.length)return 96;g.sort((a,b)=>a-b);let b=60/g[Math.floor(g.length/2)];
  while(b<70)b*=2;while(b>160)b/=2;return Math.round(b);
}
// ---------- Key Detection ----------
function detectKey(){
  const h=Array(12).fill(0);song.melody.forEach(n=>h[n.midi%12]+=n.duration);
  const cor=(a,b)=>{const ma=a.reduce((x,y)=>x+y)/12,mb=b.reduce((x,y)=>x+y)/12;let s=0,x=0,y=0;
    for(let i=0;i<12;i++){s+=(a[i]-ma)*(b[i]-mb);x+=(a[i]-ma)**2;y+=(b[i]-mb)**2}return s/Math.sqrt(x*y+1e-9)};
  keyCands=[];['major','minor'].forEach(m=>{for(let r=0;r<12;r++)keyCands.push({root:r,mode:m,score:(cor(h,KP[m].map((_,i)=>KP[m][(i-r+12)%12]))+1)/2})});
  keyCands.sort((a,b)=>b.score-a.score);song.key=keyCands[0].root;song.mode=keyCands[0].mode;
}
// ---------- Chord Analysis ----------
function scoreChords(){
  const sc=SC[song.mode].map(i=>(i+song.key)%12),tot=song.melody.reduce((a,n)=>a+n.duration,0)||1,out=[];
  for(const q in Q)for(let root=0;root<12;root++){
    const c={root,q},pcs=cPcs(c);let s=0;
    song.melody.forEach(n=>{const pc=n.midi%12,w=n.duration*(0.6+0.4*n.confidence);
      if(pcs.includes(pc))s+=w;else if(pcs.some(p=>Math.min((pc-p+12)%12,(p-pc+12)%12)===1))s-=0.6*w;else s-=0.15*w});
    const dia=pcs.every(p=>sc.includes(p)),deg=sc.indexOf(root);
    const fit=0.75*Math.max(0,Math.min(1,s/tot))+0.25*(dia?1:0.2);
    out.push({...c,fit,dia,deg,name:cName(c)});
  }
  ranked=out.sort((a,b)=>b.fit-a.fit).slice(0,8);
}
const ROM=['I','II','III','IV','V','VI','VII'];
const roman=c=>{if(!c.dia)return '—';let r=ROM[c.deg];return c.q==='maj'?r:r.toLowerCase()+(c.q==='dim'?'°':'')};
function whyList(c){
  const pcs=cPcs(c),seen=[...new Set(song.melody.map(n=>n.midi%12))];
  const li=seen.map(p=>pcs.includes(p)?`<li>✓ ${NN[p]} is a chord tone</li>`:`<li>✗ ${NN[p]} is a non-chord tone</li>`);
  li.push(c.dia?`<li>✓ Compatible with ${NN[song.key]} ${song.mode}</li>`:`<li>✗ Outside ${NN[song.key]} ${song.mode} (borrowed colour)</li>`);
  return li.join('');
}
// ---------- Chord Playback ----------
function voice(c){
  const m=Q[c.q].map(i=>48+c.root+i);
  if(c.v==='first')m[0]+=12;else if(c.v==='second'){m[0]+=12;m[1]+=12}else if(c.v==='open'){m[0]-=12;m[1]+=12}
  return m.sort((a,b)=>a-b);
}
function tone(m,t,d,vol,type){
  const c=getCtx(),g=c.createGain(),o=c.createOscillator(),o2=c.createOscillator();
  o.type=type||'triangle';o2.type='sine';o.frequency.value=mFreq(m);o2.frequency.value=mFreq(m)*2;
  const v=vol*song.settings.volume;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+0.02);
  g.gain.exponentialRampToValueAtTime(v*0.4,t+Math.min(0.3,d));g.gain.setValueAtTime(v*0.4,t+d);g.gain.linearRampToValueAtTime(0,t+d+0.25);
  o.connect(g);o2.connect(g);g.connect(master);o.start(t);o2.start(t);o.stop(t+d+0.3);o2.stop(t+d+0.3);
}
const newMaster=()=>{stopAll();master=getCtx().createGain();master.connect(ctx.destination)};
function playChord(c,dur=1.2){newMaster();voice(c).forEach(m=>tone(m,ctx.currentTime+0.02,dur,0.22))}
const beat=()=>60/song.bpm;
function playSeq(withMelody){
  if(!song.progression.length&&!withMelody)return;newMaster();const t0=ctx.currentTime+0.1,cd=beat()*4,sp=song.settings.playbackSpeed;
  song.progression.forEach((c,i)=>voice(c).forEach(m=>tone(m,t0+i*cd,cd*0.95,0.18)));
  if(withMelody)song.melody.forEach(n=>tone(n.midi+12,t0+n.start,n.duration,0.25,'sine'));
  const total=Math.max(song.progression.length*cd,withMelody?Math.max(...song.melody.map(n=>n.start+n.duration)):0);
  const items=[...document.querySelectorAll('#progList li')];
  (function loop(){const e=ctx.currentTime-t0;items.forEach((li,i)=>li.classList.toggle('playing',e>=i*cd&&e<(i+1)*cd));
    if(e<total+0.4)raf=requestAnimationFrame(loop);else stopAll()})();
}
function stopAll(){cancelAnimationFrame(raf);document.querySelectorAll('.playing').forEach(e=>e.classList.remove('playing'));
  if(master){try{master.disconnect()}catch(e){}master=null}}
// ---------- Progression Builder ----------
const addChord=c=>{song.progression.push({root:c.root,q:c.q,v:c.v||cur.v});refresh()};
// ---------- Rendering ----------
function renderRoll(){
  const el=$('#roll'),ms=song.melody.map(n=>n.midi),lo=Math.min(...ms)-2,hi=Math.max(...ms)+2,rh=18,pps=90;
  const end=Math.max(...song.melody.map(n=>n.start+n.duration),3)+0.5;
  el.innerHTML='';const inner=document.createElement('div');inner.style.cssText=`position:relative;width:${end*pps+40}px;height:${(hi-lo+1)*rh+18}px`;
  for(let m=hi;m>=lo;m--){const r=document.createElement('div');r.className='row'+(NN[m%12].includes('#')?' blk':'');r.style.top=(hi-m)*rh+'px';r.style.height=rh+'px';r.textContent=mName(m);inner.append(r)}
  for(let s=0;s<end;s++){const t=document.createElement('span');t.className='row';t.style.cssText=`left:${s*pps+34}px;top:${(hi-lo+1)*rh}px;border:0;right:auto`;t.textContent=s+'s';inner.append(t)}
  song.melody.forEach((n,i)=>{const b=document.createElement('button');b.className='note'+(n.confidence<0.8?' approx':'');
    b.style.cssText=`left:${34+n.start*pps}px;top:${(hi-n.midi)*rh+1}px;width:${Math.max(14,n.duration*pps)}px;height:${rh-2}px;min-height:0;padding:0 3px`;
    b.textContent=n.note;b.title=`${n.note}\n${n.frequency} Hz\n${n.duration} sec\n${Math.round(n.confidence*100)}% confidence`;
    b.onclick=()=>openNote(i);inner.append(b)});
  el.append(inner);
}
function renderKey(){
  const sel=$('#keySel');if(!sel.options.length)['major','minor'].forEach(m=>NN.forEach((n,i)=>sel.add(new Option(n+' '+m,i+m))));
  sel.value=song.key+song.mode;
  const top=keyCands.slice(0,3).map(k=>`${NN[k.root]} ${k.mode} ${Math.round(k.score*100)}%`).join(' · ');
  $('#keyInfo').textContent=keyCands.length?(keyCands[0].score<0.75?'Possible keys: ':'Detected: ')+top:'';
}
function renderCards(){
  const box=$('#cards');box.innerHTML='';
  ranked.forEach(c=>{const b=document.createElement('button');b.className='card';b.setAttribute('aria-pressed',cur.root===c.root&&cur.q===c.q);
    const th=$('#theory').checked;
    b.innerHTML=`<b>${c.name}</b><small>${cPcs(c).map(p=>NN[p]).join(' ')}</small><small>${Math.round(c.fit*100)}% fit</small>${th?`<small class="theory">${roman(c)}</small>`:''}`;
    b.onclick=()=>{cur={root:c.root,q:c.q,v:$('#voicing').value};playChord(cur);renderWhy(c);renderCards();renderVoice()};box.append(b)});
  const sel=$('#addSel');sel.innerHTML='';ranked.forEach((c,i)=>sel.add(new Option(`${c.name} (${Math.round(c.fit*100)}%)`,i)));
  const sb=$('#simpleBox');sb.hidden=!$('#simple').checked;$('#cards').hidden=$('#simple').checked;
  if(!sb.hidden){const top=ranked.slice(0,4),ic=['🥇','🥈','🥉','④'];
    sb.innerHTML=`<p>Your melody seems to work well with:</p>${top.map((c,i)=>`<p>${ic[i]} <strong>${c.name}</strong></p>`).join('')}<p>Try: ${top.map(c=>c.name).join(' → ')}</p><p><button id="hear">▶ Hear It</button> <button id="whyBtn">Why?</button></p>`;
    $('#hear').onclick=()=>{song.progression=top.map(c=>({root:c.root,q:c.q,v:'close'}));refresh();playSeq(false)};
    $('#whyBtn').onclick=()=>{$('#why').innerHTML='<ul>'+top.map(c=>`<li><strong>${c.name}</strong> (${roman(c)}): ${Math.round(c.fit*100)}% fit<ul>${whyList(c)}</ul></li>`).join('')+'</ul>'};}
}
function renderWhy(c){$('#why').innerHTML=`<strong>Why ${c.name} fits</strong><ul>${whyList(c)}</ul>`}
function renderVoice(){$('#voicing').value=cur.v;$('#voiceNotes').textContent=cName(cur)+': '+voice(cur).map(mName).join(' ')}
function renderProg(){
  const ol=$('#progList');ol.innerHTML='';
  song.progression.forEach((c,i)=>{const li=document.createElement('li');li.draggable=true;const th=$('#theory').checked,r=ranked.find(x=>x.root===c.root&&x.q===c.q)||{...c,dia:cPcs(c).every(p=>SC[song.mode].map(s=>(s+song.key)%12).includes(p)),deg:SC[song.mode].map(s=>(s+song.key)%12).indexOf(c.root)};
    li.innerHTML=`<b>${cName(c)}</b>${th?`<small class="theory">${roman(r)}</small><br>`:''}<button aria-label="Audition">▶</button><button aria-label="Duplicate">⧉</button><button aria-label="Replace with selected suggestion">⇄</button><button aria-label="Delete">✕</button>`;
    const bs=li.querySelectorAll('button');
    bs[0].onclick=()=>{cur=c;renderVoice();playChord(c)};bs[1].onclick=()=>{song.progression.splice(i+1,0,{...c});refresh()};
    bs[2].onclick=()=>{song.progression[i]={root:cur.root,q:cur.q,v:cur.v};refresh()};bs[3].onclick=()=>{song.progression.splice(i,1);refresh()};
    li.ondragstart=e=>e.dataTransfer.setData('text/plain',i);li.ondragover=e=>e.preventDefault();
    li.ondrop=e=>{e.preventDefault();const f=+e.dataTransfer.getData('text/plain'),[m]=song.progression.splice(f,1);song.progression.splice(i,0,m);refresh()};
    ol.append(li)});
  if(!song.progression.length)ol.innerHTML='<li class="muted">Add chords from the suggestions.</li>';
  $('#sheet').innerHTML=`<h2>${song.title}</h2><p>Key: ${NN[song.key]} ${song.mode} · ${song.bpm} BPM</p><div class="ch">${song.progression.map(cName).join('&nbsp;&nbsp;&nbsp;&nbsp;')}</div><p>Melody: ${song.melody.map(n=>n.note).join(' ')}</p>`;
}
function refresh(){scoreChords();renderRoll();renderKey();renderCards();renderProg();renderVoice();$('#lowConf').hidden=!approx}
// ---------- Persistence ----------
const store=()=>JSON.parse(localStorage.getItem('m2c')||'{}');
function renderSaved(){const l=$('#pList');l.innerHTML='';Object.keys(store()).forEach(k=>l.add(new Option(k,k)))}
function loadSong(s){song=Object.assign(newSong(),s);$('#title').value=song.title;$('#bpm').value=song.bpm;$('#vol').value=song.settings.volume;
  if(song.melody.length){$('#work').hidden=false;$('#bar').hidden=false;detectKeyList();refresh()}}
function detectKeyList(){keyCands=keyCands.length?keyCands:[]}
// ---------- Event Handlers ----------
function openNote(i){
  editing=i;const n=i===-1?{midi:60,start:0,duration:0.5}:song.melody[i];
  const sel=$('#nPitch');if(!sel.options.length)for(let m=84;m>=36;m--)sel.add(new Option(mName(m),m));
  sel.value=n.midi;$('#nStart').value=n.start;$('#nDur').value=n.duration;$('#noteH').textContent=i===-1?'Add note':'Detected: '+n.note;$('#nDel').hidden=i===-1;$('#dlgNote').showModal();
}
function bind(){
  $('#btnRec').onclick=startRec;$('#btnStop').onclick=()=>rec&&rec.stop();
  $('#file').onchange=e=>onFile(e.target.files[0]);
  const d=$('#drop');['dragenter','dragover'].forEach(v=>d.addEventListener(v,e=>{e.preventDefault();d.classList.add('over')}));
  ['dragleave','drop'].forEach(v=>d.addEventListener(v,e=>{e.preventDefault();d.classList.remove('over')}));
  d.addEventListener('drop',e=>onFile(e.dataTransfer.files[0]));
  document.querySelectorAll('[data-rate]').forEach(b=>b.onclick=()=>{audio.playbackRate=+b.dataset.rate;song.settings.playbackSpeed=+b.dataset.rate});
  $('#btnRestart').onclick=()=>{audio.currentTime=0;audio.play()};
  $('#btnAnalyze').onclick=analyze;
  $('#keySel').onchange=e=>{const v=e.target.value;song.key=parseInt(v);song.mode=v.replace(/\d+/,'');refresh()};
  $('#bpm').onchange=e=>song.bpm=+e.target.value||96;
  $('#simple').onchange=renderCards;$('#theory').onchange=refresh;
  $('#voicing').onchange=e=>{cur.v=e.target.value;renderVoice();playChord(cur)};
  $('#btnAddChord').onclick=()=>{const c=ranked[$('#addSel').value];if(c)addChord(c)};
  $('#btnAddNote').onclick=()=>openNote(-1);
  $('#btnPlayProg').onclick=()=>playSeq(false);$('#btnPlayAll').onclick=()=>playSeq(true);$('#btnStopAll').onclick=stopAll;
  $('#btnPrint').onclick=()=>window.print();
  $('#btnSettings').onclick=()=>{renderSaved();$('#dlgSet').showModal()};
  $('#title').oninput=e=>song.title=e.target.value;$('#vol').oninput=e=>song.settings.volume=+e.target.value;
  $('#pNew').onclick=()=>{song=newSong();$('#title').value=song.title;$('#work').hidden=true;$('#bar').hidden=true;say('New project.')};
  $('#pSave').onclick=()=>{const s=store();s[song.title]=song;localStorage.setItem('m2c',JSON.stringify(s));renderSaved();say('Saved "'+song.title+'".')};
  $('#pLoad').onclick=()=>{const s=store()[$('#pList').value];if(s){loadSong(s);say('Loaded.')}};
  $('#pDel').onclick=()=>{const s=store();delete s[$('#pList').value];localStorage.setItem('m2c',JSON.stringify(s));renderSaved()};
  $('#pExport').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(song,null,2)],{type:'application/json'}));a.download=song.title.replace(/\W+/g,'-')+'.json';a.click()};
  $('#nOk').onclick=()=>{const n={midi:+$('#nPitch').value,start:+$('#nStart').value,duration:+$('#nDur').value,confidence:1};
    n.note=mName(n.midi);n.frequency=+mFreq(n.midi).toFixed(2);
    if(editing===-1)song.melody.push(n);else song.melody[editing]=n;
    song.melody.sort((a,b)=>a.start-b.start);refresh()};
  $('#nDel').onclick=()=>{song.melody.splice(editing,1);$('#dlgNote').close();if(song.melody.length)refresh()};
}
// ---------- Initialization ----------
bind();
