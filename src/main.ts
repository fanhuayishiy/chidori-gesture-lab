import './style.css';
import { createIcons, Zap, CircleHelp, Maximize, Minimize, Scan as ScanHand, MousePointer2, ArrowUpRight, Info, VolumeX, Volume2, Hand, Grab as HandFist, MoveHorizontal, ShieldCheck, X, ArrowRight, Square, Settings2 } from 'lucide';
import { EnergyField, clamp } from './energy';
import { LightningRenderer } from './lightning';
import { ChidoriAudio } from './audio';
import { analyzeHands, type Landmark } from './gesture';
import { HandTracker } from './hand-tracker';
import { EffectController, type EffectMode, type BurstEvent } from './effects';
import { projectCoverPoint, visibleCoverHands } from './camera-projection';

const icons={Zap,CircleHelp,Maximize,Minimize,ScanHand,MousePointer2,ArrowUpRight,Info,VolumeX,Volume2,Hand,HandFist,MoveHorizontal,ShieldCheck,X,ArrowRight,Square,Settings2};
const refreshIcons=()=>createIcons({icons,attrs:{'stroke-width':1.5}});
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=element<HTMLCanvasElement>('lightning');
const camera=element<HTMLVideoElement>('camera');
const cameraButton=element<HTMLButtonElement>('camera-button');
const demoButton=element<HTMLButtonElement>('demo-button');
const muteButton=element<HTMLButtonElement>('mute-button');
const energyRange=element<HTMLInputElement>('energy-range');
const energyValue=element('energy-value');
const volumeRange=element<HTMLInputElement>('volume-range');
const statusMessage=element('status-message');
const modeLabel=element('mode-label');
const stateLabel=element('state-label');
const cameraPlaceholder=element('camera-placeholder');
const trackingBadge=element('tracking-badge');
const handOverlay=element<HTMLCanvasElement>('hand-overlay');
const overlayContext=handOverlay.getContext('2d')!;
const field=new EnergyField();
const audio=new ChidoriAudio();
const renderer=new LightningRenderer(canvas);
const effects=new EffectController();
const burstButton=element<HTMLButtonElement>('burst-button');
const settingsButton=element<HTMLButtonElement>('settings-button');
const settingsPanel=element('settings-panel');
const showLandmarks=element<HTMLInputElement>('show-landmarks');
let effectMode:EffectMode='chidori';
let interactionRevision=0, burstPending=false, interactionFocused=true;
type Mode='idle'|'demo'|'starting'|'camera';
let mode:Mode='idle', session=0, charging=false;
let chargeOwner:number|'keyboard'|null=null;
let frame=0, previousTime=performance.now(), lastHand=0, lastUi=0;
let pointerEnergy=.28, audioActivated=false, soundMuted=false;
let points:Landmark[][]=[];
let visiblePoints:Landmark[][]=[];
let stageSize={width:canvas.clientWidth,height:canvas.clientHeight};
let slowFrames=0;

function setSettings(open:boolean,restoreFocus=false){
  if(settingsPanel.hidden===!open)return;
  cancelCharge();settingsPanel.hidden=!open;
  settingsButton.setAttribute('aria-expanded',String(open));
  document.body.classList.toggle('settings-open',open);
  if(restoreFocus)settingsButton.focus({preventScroll:true});
}
settingsButton.addEventListener('click',()=>setSettings(settingsPanel.hidden));
document.addEventListener('keydown',(event)=>{
  if(event.key==='Escape'&&!settingsPanel.hidden&&!element<HTMLDialogElement>('help-dialog').open){
    event.preventDefault();setSettings(false,true);
  }
});
showLandmarks.addEventListener('change',()=>{
  document.body.classList.toggle('show-landmarks',showLandmarks.checked);drawHands();
});

function cancelCharge(){
  charging=false;chargeOwner=null;effects.cancel();interactionRevision++;
  if(mode==='demo')stateLabel.textContent='自由操控';
}
function emitBurst(event:BurstEvent|null){
  if(!event)return;
  audio.triggerBurst(event);
  element('burst-count').textContent=String(event.id).padStart(3,'0');
  stateLabel.textContent='全域释放';
}
function selectEffect(next:EffectMode){
  if(next===effectMode)return;
  cancelCharge();effectMode=next;effects.setMode(next);audio.setEffect(next);
  const wind=next==='shuriken';
  document.body.dataset.effect=next;
  element('effect-chidori').setAttribute('aria-pressed',String(!wind));
  element('effect-shuriken').setAttribute('aria-pressed',String(wind));
  element('effect-title').textContent=wind?'旋风手里剑':'千鸟';
  const rangeName=wind?'风旋范围':'雷电范围';
  document.querySelector('label[for="energy-range"]')!.textContent=rangeName;
  energyRange.setAttribute('aria-label',rangeName);
  canvas.setAttribute('aria-label',`${wind?'风旋':'雷电'}互动区域，鼠标模式下按空格蓄力、松开释放`);
  document.querySelector('.sound-heading > div > span')!.textContent=wind?'风切回响':'雷鸣序曲';
  message(`已切换${wind?'旋风手里剑':'千鸟'} · 收拢蓄力后展开爆发，也可点击「爆发」。`);
}
element('effect-chidori').addEventListener('click',()=>selectEffect('chidori'));
element('effect-shuriken').addEventListener('click',()=>selectEffect('shuriken'));
burstButton.addEventListener('click',async()=>{
  if(burstPending||effects.snapshot(performance.now()).cooldown>0)return;
  if(mode==='idle')enterDemo();
  // This click may unlock audio, but a visual-only burst still works if it fails.
  const revision=interactionRevision;
  burstPending=true;
  try{
    if(!audio.isPlaying)await startSound();
    if(revision!==interactionRevision||document.hidden)return;
    charging=false;chargeOwner=null;emitBurst(effects.trigger(performance.now()));
  }finally{burstPending=false;}
});

function message(text:string,error=false){
  statusMessage.textContent=text;statusMessage.classList.toggle('error',error);
}
function syncSound(){
  const muted=!audio.isPlaying||audio.isMuted;
  muteButton.setAttribute('aria-label',muted?'开启声音':'静音');
  muteButton.setAttribute('aria-pressed',String(muted));
  muteButton.innerHTML=`<i data-lucide="${muted?'volume-x':'volume-2'}"></i>`;
  document.body.classList.toggle('sound-on',!muted);refreshIcons();
}
async function startSound(){
  try{await audio.start();audioActivated=true;audio.setMuted(soundMuted);syncSound();}
  catch{message('声音未能启动，可点击声音按钮重试；雷电体验仍可使用。',true);syncSound();}
}
function cameraUi(active:boolean){
  document.body.classList.toggle('camera-active',active);
  renderer.cameraBackground=active;
  cameraButton.innerHTML=active?'<i data-lucide="square"></i><span>停止手势</span>':'<i data-lucide="scan-hand"></i><span>开启手势</span><i data-lucide="arrow-up-right" class="button-arrow"></i>';
  cameraButton.disabled=false;
  cameraPlaceholder.style.display=active?'none':'flex';
  trackingBadge.textContent=active?'LIVE':'STANDBY';trackingBadge.classList.toggle('active',active);
  element('tracking-label').textContent=active?'寻找手掌…':'摄像头未开启';
  element('tracking-dot').style.background=active?'#73cdbd':'#6d7e95';
  refreshIcons();
}
function stopTracking(){
  ++session; cancelCharge();mode='idle';tracker.stop();points=[];visiblePoints=[];cameraUi(false);drawHands();
  element('hand-count').textContent='—';
}
const tracker=new HandTracker(camera,(hands)=>{
  points=hands;
  updateCameraHands(true);
},(text)=>{
  const failed=/中断|断开/.test(text);
  if(failed){stopTracking();modeLabel.textContent='追踪已停止';}
  message(text,failed);
});

function updateCameraHands(fresh:boolean){
  if(mode!=='camera')return;
  const source={width:camera.videoWidth,height:camera.videoHeight};
  visiblePoints=visibleCoverHands(points,source,stageSize);
  const reading=analyzeHands(visiblePoints);
  const position=reading?projectCoverPoint(reading,source,stageSize):null;
  const now=performance.now();
  // Only actual model samples may accrue arming; resize cannot synthesize a gesture.
  if(fresh)emitBurst(effects.observe(interactionFocused?reading:null,now));
  if(reading&&position){
    if(fresh)lastHand=now;
    field.setTarget({...reading,...position});
    element('tracking-label').textContent=reading.handCount===2?'双手已锁定':'手掌已锁定';
    element('hand-count').textContent=`${reading.handCount} / 2`;
    stateLabel.textContent=reading.expansion<.18?'掌心聚合':reading.expansion>.83?'全域释放':effectMode==='chidori'?'雷电展开':'风刃展开';
  }else{
    element('tracking-label').textContent='请将手掌移入画面';element('hand-count').textContent='0 / 2';
  }
}
const stageObserver=new ResizeObserver(()=>{
  stageSize={width:canvas.clientWidth,height:canvas.clientHeight};
  if(mode==='camera'){cancelCharge();updateCameraHands(false);drawHands();}
});
stageObserver.observe(canvas);

cameraButton.addEventListener('click',async()=>{
  setSettings(false);
  if(mode==='camera'||mode==='starting'){
    stopTracking();modeLabel.textContent='待机演示';stateLabel.textContent='能量待命';message('摄像头已关闭。可重新开启手势，或切换鼠标体验。');return;
  }
  const sound=startSound(); // Invoked in the click, before any model/camera await.
  stopTracking();const token=++session;mode='starting';
  demoButton.classList.remove('active');cameraButton.innerHTML='<i data-lucide="square"></i><span>取消启动</span>';refreshIcons();
  modeLabel.textContent='正在连接';trackingBadge.textContent='LOADING';
  try{
    await tracker.start();
    if(token!==session||mode!=='starting')return;
    mode='camera';lastHand=performance.now();modeLabel.textContent='手势控制';cameraUi(true);
    message('收拢保持片刻蓄力，再展开爆发；双手靠拢蓄力、拉开释放。');
  }catch(error){
    if(token!==session)return;
    mode='idle';cameraUi(false);modeLabel.textContent='待机演示';
    message(error instanceof Error?error.message:'连接失败，请重试或使用鼠标体验。',true);
  }
  await sound;
});

function enterDemo(){
  stopTracking();mode='demo';demoButton.classList.add('active');modeLabel.textContent='鼠标控制';
  stateLabel.textContent='自由操控';field.setTarget({x:.55,y:.46,expansion:pointerEnergy});
  setDemoEnergy(pointerEnergy);
  message('移动定位 · 按住蓄力、松开释放 · 滚轮 / 滑杆调节范围 · 空格也可结印');
}
demoButton.addEventListener('click',()=>{setSettings(false);void startSound();enterDemo();canvas.focus({preventScroll:true});});

function setDemoEnergy(value:number){
  pointerEnergy=clamp(value);field.setTarget({expansion:pointerEnergy});
  energyRange.value=String(Math.round(pointerEnergy*100));
  energyRange.style.setProperty('--range-fill',`${pointerEnergy*100}%`);
}

function beginCharge(owner:number|'keyboard'){
  if(mode!=='demo'||charging)return;
  charging=true;chargeOwner=owner;effects.beginCharge(performance.now());stateLabel.textContent='蓄力中';setDemoEnergy(.035);
}
function releaseCharge(owner:number|'keyboard'){
  if(!charging||chargeOwner!==owner)return;
  charging=false;chargeOwner=null;setDemoEnergy(1);stateLabel.textContent='全域释放';emitBurst(effects.release(performance.now()));
}
canvas.addEventListener('pointermove',(event)=>{
  if(mode!=='demo'||!event.isPrimary||(typeof chargeOwner==='number'&&event.pointerId!==chargeOwner))return;
  const rect=canvas.getBoundingClientRect();field.setTarget({x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height});
});
canvas.addEventListener('pointerdown',(event)=>{
  if(mode!=='demo'||!event.isPrimary||event.button!==0||chargeOwner!==null)return;
  const rect=canvas.getBoundingClientRect();field.setTarget({x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height});
  canvas.setPointerCapture(event.pointerId);beginCharge(event.pointerId);
});
canvas.addEventListener('pointerup',(event)=>releaseCharge(event.pointerId));
canvas.addEventListener('pointercancel',(event)=>{if(chargeOwner===event.pointerId)cancelCharge();});
canvas.addEventListener('lostpointercapture',(event)=>{if(chargeOwner===event.pointerId)cancelCharge();});
canvas.addEventListener('wheel',(event)=>{
  if(mode!=='demo')return;event.preventDefault();
  setDemoEnergy(pointerEnergy-event.deltaY*.001);
},{passive:false});
document.addEventListener('keydown',(event)=>{
  if(event.code!=='Space'||event.repeat||mode!=='demo'||!settingsPanel.hidden||element<HTMLDialogElement>('help-dialog').open)return;
  if(event.target instanceof HTMLElement&&event.target.closest('button,input,textarea,select,a'))return;
  event.preventDefault();beginCharge('keyboard');
});
document.addEventListener('keyup',(event)=>{if(event.code==='Space'&&chargeOwner==='keyboard'){event.preventDefault();releaseCharge('keyboard');}});
window.addEventListener('blur',()=>{interactionFocused=false;cancelCharge();});
window.addEventListener('focus',()=>{interactionFocused=true;});
energyRange.addEventListener('input',()=>{
  const requested=Number(energyRange.value)/100;
  if(mode!=='demo')enterDemo();
  if(charging)cancelCharge();
  setDemoEnergy(requested);
  stateLabel.textContent=pointerEnergy>.85?'全域释放':pointerEnergy<.18?'掌心聚合':'自由操控';
});
volumeRange.addEventListener('input',()=>{
  audio.setVolume(Number(volumeRange.value)/100);element('volume-value').textContent=`${volumeRange.value}%`;
  volumeRange.style.setProperty('--range-fill',`${volumeRange.value}%`);
});
muteButton.addEventListener('click',()=>{
  if(!audio.isPlaying){soundMuted=false;void startSound();return;}
  soundMuted=!soundMuted;audio.setMuted(soundMuted);syncSound();
});
const reduceFlash=element<HTMLInputElement>('reduce-flash');
reduceFlash.checked=matchMedia('(prefers-reduced-motion: reduce)').matches;
renderer.reducedMotion=reduceFlash.checked;
reduceFlash.addEventListener('change',()=>{renderer.reducedMotion=reduceFlash.checked;});

const help=element<HTMLDialogElement>('help-dialog');
element('help-button').addEventListener('click',()=>{setSettings(false);cancelCharge();help.showModal();});
element('close-help').addEventListener('click',()=>help.close());
element('got-it').addEventListener('click',()=>help.close());
help.addEventListener('click',(event)=>{if(event.target===help){const rect=help.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)help.close();}});
const fullscreenButton=element('fullscreen-button');
fullscreenButton.addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
  catch{message('浏览器暂不支持全屏，可使用浏览器菜单进入全屏。',true);}
});
document.addEventListener('fullscreenchange',()=>{
  const full=!!document.fullscreenElement;fullscreenButton.setAttribute('aria-label',full?'退出全屏':'进入全屏');
  fullscreenButton.innerHTML=`<i data-lucide="${full?'minimize':'maximize'}"></i>`;refreshIcons();
});

const connections=[[0,1,2,3,4],[0,5,6,7,8],[5,9,10,11,12],[9,13,14,15,16],[13,17,18,19,20],[0,17]];
function drawHands(){
  const width=handOverlay.clientWidth,height=handOverlay.clientHeight;
  if(handOverlay.width!==width||handOverlay.height!==height){handOverlay.width=width;handOverlay.height=height;}
  overlayContext.clearRect(0,0,width,height);
  if(mode!=='camera'||!showLandmarks.checked)return;
  const source={width:camera.videoWidth,height:camera.videoHeight};
  const viewport={width,height};
  overlayContext.strokeStyle='#89dfff';overlayContext.fillStyle='#d8f7ff';overlayContext.lineWidth=1;
  for(const hand of visiblePoints){
    for(const chain of connections){overlayContext.beginPath();chain.forEach((index,i)=>{
      const p=hand[index];if(!p)return;
      const projected=projectCoverPoint({x:1-p.x,y:p.y},source,viewport);if(!projected)return;
      const x=projected.x*width,y=projected.y*height;
      if(i===0)overlayContext.moveTo(x,y);else overlayContext.lineTo(x,y);
    });overlayContext.stroke();}
    for(const p of hand){
      const projected=projectCoverPoint({x:1-p.x,y:p.y},source,viewport);if(!projected)continue;
      overlayContext.beginPath();overlayContext.arc(projected.x*width,projected.y*height,1.5,0,Math.PI*2);overlayContext.fill();
    }
  }
}
function animate(time:number){
  const dt=Math.min((time-previousTime)/1000,.1);previousTime=time;
  if(mode==='idle')field.setTarget({x:innerWidth<760?.51:.55,y:innerWidth<760?.43:.47,expansion:.28+Math.sin(time*.0006)*.022});
  if(mode==='camera'&&time-lastHand>350){field.setTarget({expansion:.07});stateLabel.textContent='等待手掌';}
  const effect=effects.snapshot(time);
  const state=field.update(dt);renderer.render(time,state,effect);
  audio.setEnergy(Math.max(state.expansion,effect.charge));
  document.body.classList.toggle('immersive',state.expansion>.72||!!effect.burst);
  document.body.classList.toggle('bursting',!!effect.burst);
  if(dt>.037)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
  if(slowFrames>80)renderer.setQuality(.75);
  if(time-lastUi>80){
    lastUi=time;const percent=Math.round(state.expansion*100);energyValue.textContent=String(percent);
    burstButton.disabled=effect.cooldown>0||burstPending;
    element('burst-status').textContent=effect.cooldown>0?`${(effect.cooldown/1000).toFixed(1)}s`:'READY';
    element('charge-label').textContent=effect.cooldown>0?'余波消散':effect.armed?'蓄力 · 展开释放':effect.charge>0?'正在聚合':'能量就绪';
    element('charge-fill').style.width=`${Math.round(effect.charge*100)}%`;
    if(mode!=='demo'){energyRange.value=String(percent);energyRange.style.setProperty('--range-fill',`${percent}%`);}
    element('coord-x').textContent=state.x.toFixed(3);element('coord-y').textContent=state.y.toFixed(3);drawHands();
  }
  frame=requestAnimationFrame(animate);
}
function pauseExperience(){
  cancelAnimationFrame(frame);audio.pause();syncSound();cancelCharge();
  if(mode==='camera'||mode==='starting'){
    stopTracking();modeLabel.textContent='待机演示';message('页面离开后已关闭摄像头，点击「开启手势」重新连接。');
  }
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){pauseExperience();return;}
  previousTime=performance.now();cancelAnimationFrame(frame);frame=requestAnimationFrame(animate);
  if(audioActivated&&!soundMuted)message('画面已恢复，点击声音按钮继续音乐。');
});
window.addEventListener('pagehide',pauseExperience);
window.addEventListener('pageshow',(event)=>{if(event.persisted){previousTime=performance.now();cancelAnimationFrame(frame);frame=requestAnimationFrame(animate);}});
refreshIcons();frame=requestAnimationFrame(animate);
