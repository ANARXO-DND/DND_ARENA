const http=require('http'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws');
const N=90,SPEED=6,r=s=>1+Math.floor(Math.random()*s),mod=s=>Math.floor((s-10)/2);
// ---------- ДАННЫЕ (единственный источник правил) ----------
const W=(n,d,dt,f,c,v)=>({k:'w',n,d,dt,f,c,v});
const A=(n,base,dex,c,str)=>({k:'a',n,base,dex,c,str});
const ITEMS={
 dagger:W('Кинжал',[1,4],'колющий',{light:1,finesse:1,thrown:1},4),
 shortsword:W('Короткий меч',[1,6],'колющий',{light:1,finesse:1},20),
 rapier:W('Рапира',[1,8],'колющий',{finesse:1},35),
 longsword:W('Длинный меч',[1,8],'рубящий',{},15,[1,10]),
 halberd:W('Алебарда',[1,10],'рубящий',{two:1,reach:1},20),
 greatsword:W('Большой меч',[2,6],'рубящий',{two:1},50),
 leather:A('Кожаный доспех',11,'full',15),
 studded:A('Проклёпанный кожаный',12,'full',45),
 halfplate:A('Полулаты',15,2,120),
 scale:A('Чешуйчатый доспех',14,2,50),
 chainmail:A('Тяжёлая кольчуга',16,0,75,13),
 shield:{k:'s',n:'Щит',ac:2,c:10},
 kit:{k:'k',n:'Комплект целителя',c:25,uses:10}};
for(const k of ['dagger'])ITEMS[k].cat='simple';for(const k of ['shortsword','rapier','longsword','halberd','greatsword'])ITEMS[k].cat='martial';
const COST={8:0,9:1,10:2,11:3,12:4,13:5,14:7,15:9},STYLES=['def','duel','gwf','twf'];
// ---------- КЛАСС (заготовка под другие классы) ----------
const CLASSES={
 fighter:{name:'Воин',hitDie:10,prof:2,saves:[0,2],weapons:['simple','martial'],armor:true,secondWind:2},
 wizard:{name:'Волшебник',hitDie:6,prof:2,saves:[3,4],weapons:['simple'],armor:false,slots:2,castStat:3}};
const LEVEL=1,IDLE=5*60*1000,E8=[8,8,8,8,8,8];
const RACES={
 human:{n:'Человек',start:[9,9,9,9,9,9],size:'Средний',desc:'Все характеристики +1 (старт с 9)'},
 halfling:{n:'Полурослик',start:E8,size:'Маленький',lucky:true,pass:true,desc:'Маленький. Выпавшая 1 на d20 перебрасывается. Проходит сквозь врагов, но не может остановиться в их клетке'},
 dwarf:{n:'Дворф',start:E8,size:'Средний',hpPerLevel:1,poisonRes:true,desc:'+1 хит за уровень. Сопротивление яду (пока не используется)'}};
const FEATS={
 tough:{n:'Крепкий (Tough)',ab:2,hpPerLevel:2,desc:'+1 Телосложение (сверх лимита). +2 хита за уровень'},
 savage:{n:'Свирепый атакующий (Savage Attacker)',ab:0,desc:'+1 Сила (сверх лимита). Раз за ход при попадании оружием кости урона бросаются дважды, берётся лучший результат'},
 alert:{n:'Бдительный (Alert)',ab:1,initProf:true,desc:'+1 Ловкость (сверх лимита). К инициативе добавляется бонус мастерства'},
 medic:{n:'Боевой медик (Battle Medic)',ab:4,desc:'+1 Мудрость (сверх лимита). Действие: потратить заряд комплекта целителя (в руке), цель в 5 футах (можно себя) тратит кость хитов, лечение = кость + бонус мастерства'}};
const SPELLS={
 shield:{n:'Щит',react:1,desc:'Реакция на атаку по вам: +5 КД до начала вашего следующего хода, блокирует Волшебную стрелу.'},
 magicmissile:{n:'Волшебная стрела',desc:'3 дротика, автопопадание, 24 кл., 1d4+1 силового каждый; можно разделить между целями (3 клика).'},
 tasha:{n:'Смех Таши',desc:'Концентрация. Цель в 6 кл.: спасбросок Мудрости; при провале ничком и недееспособна, повтор в конце хода и при уроне (с преимуществом).'},
 thunderwave:{n:'Волна грома',desc:'Куб 3×3 от вас в выбранную сторону: спасбросок Телосложения, 2d8 звука и отталкивание на 2 кл.; при успехе половина урона.'},
 falselife:{n:'Псевдожизнь',desc:'Вы получаете 1d4+4 временных хитов.'},
 curewounds:{n:'Лечение ран',desc:'Касание (1 кл.): восстанавливает 1d8 + мод. Интеллекта.'}};
const d20=p=>{let v=r(20);if(RACES[p.race]?.lucky&&v===1)v=r(20);return v};
// ---------- СОСТОЯНИЕ ----------
const players=[null,null,null,null];let g={phase:'lobby',order:[],turn:0,log:[]};
const sg=n=>(n>=0?'+':'')+n,J=JSON.stringify,log=s=>g.log.push(s);
const pub=p=>p&&{id:p.id,name:p.name,race:p.race,cls:p.cls,thp:p.thp,slots:p.slots,prep:p.prep,prone:p.prone,incap:p.incap,conc:!!p.conc,shielded:p.shielded,react:p.react,down:p.down,stable:p.stable,dsL:p.dsL,dsD:p.dsD,feat:p.feat,kit:p.kit,hd:p.hd,ready:p.ready,color:p.color,x:p.x,y:p.y,hp:p.hp,maxhp:p.maxhp,ac:(p.ac||0)+(p.shielded?5:0),mv:p.mv,act:p.act,bonus:p.bonus,sw:p.sw,dodge:p.dodge,dead:p.dead,eq:p.eq,inv:p.inv,st:p.st,init:p.init,style:p.style};
const bc=()=>{const m=J({t:'state',phase:g.phase,order:g.order,turn:g.turn,log:g.log.slice(-40),players:players.map(pub),pend:g.pend?{kind:g.pend.kind,reactor:g.pend.reactor,mover:g.pend.mover}:null});players.forEach(p=>p&&p.ws.readyState===1&&p.ws.send(m))};
const fx=o=>{const m=J({t:'fx',...o});players.forEach(p=>p&&p.ws.readyState===1&&p.ws.send(m))};
const err=(p,m)=>p.ws.send(J({t:'err',m}));
function derive(p){const M=p.st.map(mod),a=ITEMS[p.eq.armor];let ac=10+M[1];
 if(a){ac=a.base+(a.dex==='full'?M[1]:Math.min(M[1],a.dex));if(p.style==='def')ac+=1}
 if(p.eq.off==='shield')ac+=ITEMS.shield.ac;p.ac=ac}
function eqOk(p,e){const cnt={};
 for(const k of [e.main,e.off,e.armor])if(k)cnt[k]=(cnt[k]||0)+1;
 for(const k in cnt)if((p.inv[k]||0)<cnt[k])return 'Нет такого предмета';
 const m=ITEMS[e.main],o=ITEMS[e.off],a=ITEMS[e.armor];
 if(e.main&&(!m||(m.k!=='w'&&m.k!=='k')))return 'Неверный предмет в правой руке';
 if(e.off&&!(e.off==='shield'||(o&&(o.k==='k'||(o.k==='w'&&o.f.light)))))return 'В левую руку: щит, лёгкое оружие или комплект';
 if(m&&m.f?.two&&e.off)return 'Двуручное оружие: вторая рука должна быть свободна';
 if(e.armor&&(!a||a.k!=='a'))return 'Неверный доспех';
 if(a&&a.str&&p.st[0]<a.str)return `Нужна Сила ${a.str}`;if(!CLASSES[p.cls].armor&&(e.armor||e.off==='shield'))return 'Класс не владеет бронёй и щитами';return null}
function wInfo(p,wh){const w=ITEMS[p.eq[wh]],M=p.st.map(mod);
 if(!w||w.k!=='w')return{n:'Кулак',dice:[0,0],m:M[0],two:false,reach:1,w:{}};
 const two=!!(w.f.two||(w.v&&wh==='main'&&!p.eq.off));
 return{n:w.n,dice:two&&w.v?w.v:w.d,m:w.f.finesse?Math.max(M[0],M[1]):M[0],two,reach:w.f.reach?2:1,w}}
const dist=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const alive=()=>players.filter(p=>p&&p.ready&&!p.dead&&!p.down);
function startTurn(p){p.mv=SPEED;p.act=p.bonus=true;p.atkd=false;p.dodge=false;p.react=true;p.dis=false;p.savUsed=false;p.shielded=false;log(`— Ход: ${p.name} —`)}
function deathRoll(p){if(p.stable)return;const v=d20(p);
 if(v===1)p.dsD+=2;else if(v<10)p.dsD++;else if(v===20)p.dsL+=2;else p.dsL++;
 log(`✖ ${p.name}: спасбросок от смерти ${v} (жизнь ${Math.min(p.dsL,3)}/3, смерть ${Math.min(p.dsD,3)}/3)`);
 if(p.dsD>=3){p.dead=true;endConc(p);log(`☠ ${p.name} умирает`)}else if(p.dsL>=3){p.stable=true;log(`${p.name} стабилизировался`)}}
function goDown(t){endConc(t);t.down=true;t.hp=0;t.stable=false;t.dsL=t.dsD=0;log(`✖ ${t.name} теряет сознание`)}
function next(){if(g.phase!=='battle')return;if(alive().length<=1){g.phase='over';setTimeout(resetGame,6000);const w=alive()[0];log(w?`🏆 Победил ${w.name}!`:'Все пали.');return}
 do{g.turn=(g.turn+1)%g.order.length}while(players[g.order[g.turn]].dead);const q=players[g.order[g.turn]];if(q.down){log(`— Ход: ${q.name} (без сознания) —`);deathRoll(q);return next()}startTurn(q)}
function resetGame(){if(g.phase!=='over')return;g={phase:'lobby',order:[],turn:0,log:[],pend:null};
 players.forEach((p,i)=>{if(!p||p.ws.readyState!==1){players[i]=null;return}
  for(const k of ['st','style','inv','eq','x','y','hp','maxhp','ac','mv','act','bonus','sw','dodge','dead','init','race','atkd','react','dis','path','down','stable','dsL','dsD','feat','kit','hd','initBonus','savUsed','waive','cls','thp','slots','prep','prone','incap','conc','shielded','laugh'])delete p[k];
  p.ready=false;p.name='Игрок'+(p.id+1);p.last=Date.now();p.ws.send(J({t:'reset'}))});bc()}
function startBattle(){g.phase='battle';const used=new Set();
 for(const p of players){let x,y;do{x=37+r(16);y=37+r(16)}while(used.has(x+','+y));used.add(x+','+y);
  Object.assign(p,{x,y,init:d20(p)+mod(p.st[1])+p.initBonus,react:true,down:false})}
 g.order=players.map(p=>p.id).sort((a,b)=>players[b].init-players[a].init||players[b].st[1]-players[a].st[1]||a-b);
 g.turn=0;log('Бой начался! Инициатива: '+g.order.map(i=>`${players[i].name} ${players[i].init}`).join(', '));startTurn(players[g.order[0]])}
const occ=(p,x,y)=>players.some(o=>o&&o.ready&&!o.dead&&o!==p&&o.x===x&&o.y===y);
const zr=e=>{const i=wInfo(e,'main');return i.reach>1&&!e.eq.off?2:1};
const zone=(e,c)=>dist(e,c)<=zr(e);
function bfs(p,tx,ty){const pass=!!RACES[p.race]?.pass,seen=new Set([p.x*N+p.y]);let fr=[{x:p.x,y:p.y,d:0,pr:null}];
 while(fr.length){const c=fr.shift();
  if(c.x===tx&&c.y===ty){const a=[];for(let n=c;n.pr;n=n.pr)a.unshift({x:n.x,y:n.y});return a}
  const sc=p.prone?2:1;if(c.d+sc>p.mv)continue;
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){if(!dx&&!dy)continue;const x=c.x+dx,y=c.y+dy,k=x*N+y;
   if(x<0||y<0||x>=N||y>=N||seen.has(k)||(!pass&&occ(p,x,y)))continue;seen.add(k);fr.push({x,y,d:c.d+sc,pr:c})}}
 return null}
function walk(p){while(p.path&&p.path.length){const c=p.path[0],prev={x:p.x,y:p.y};
 if(!p.dis){const e=players.find(e=>e&&e.ready&&!e.dead&&!e.down&&!e.incap&&e!==p&&e.react&&!(p.waive&&p.waive.has(e.id))&&zone(e,prev)&&!zone(e,c));
  if(e){(p.waive=p.waive||new Set()).add(e.id);g.pend={kind:'oa',mover:p.id,reactor:e.id,timer:setTimeout(()=>{try{if(g.pend&&g.pend.reactor===e.id)resolvePend(false);bc()}catch{}},15000)};log(`${p.name} покидает зону ${e.name}…`);return}}
 p.x=c.x;p.y=c.y;p.mv-=p.prone?2:1;p.path.shift();p.waive=null}
 p.path=[]}
function save(t,ab,dc,adv){let a=d20(t);if(adv)a=Math.max(a,d20(t));const c=CLASSES[t.cls||'fighter'],mm=mod(t.st[ab]),pf=c.saves.includes(ab)?c.prof:0,tot=a+mm+pf;return{ok:tot>=dc,txt:`${a}${sg(mm)}${pf?'+'+pf:''}=${tot} vs ${dc}`}}
function endLaugh(p){const c=players[p.laugh.by];if(c&&c.conc&&c.conc.target===p.id)c.conc=null;p.laugh=null;p.incap=false}
function endConc(c){if(!c.conc)return;const t=players[c.conc.target];if(t&&t.laugh&&t.laugh.by===c.id){t.laugh=null;t.incap=false}c.conc=null;log(`${c.name} теряет концентрацию`)}
function endTurnFx(p){if(p.laugh){const s=save(p,4,p.laugh.dc);log(`${p.name}: спасбросок против Смеха в конце хода ${s.txt}${s.ok?' — смех прекращается':' — продолжает смеяться'}`);if(s.ok)endLaugh(p)}}
function hurt(t,dm){const ab=Math.min(t.thp||0,dm);t.thp=(t.thp||0)-ab;dm-=ab;
 if(t.down){t.dsD++;t.stable=false;t.dsL=0;log(`✖ ${t.name}: +1 к смерти (${t.dsD}/3)`);if(t.dsD>=3){t.dead=true;endConc(t);log(`☠ ${t.name} умирает`)}return}
 if(dm<=0)return;t.hp=Math.max(0,t.hp-dm);
 if(t.hp<=0)return goDown(t);
 if(t.laugh){const s=save(t,4,t.laugh.dc,true);log(`${t.name}: спасбросок против Смеха при уроне ${s.txt}${s.ok?' — смех прекращается':''}`);if(s.ok)endLaugh(t)}
 if(t.conc){const s=save(t,2,Math.max(10,Math.floor(dm/2)));log(`${t.name}: концентрация ${s.txt}${s.ok?' — держит':''}`);if(!s.ok)endConc(t)}}
const canCast=p=>p&&p.cls==='wizard'&&!p.dead&&!p.down&&!p.incap&&!['main','off'].some(h=>ITEMS[p.eq[h]]?.cat==='martial');
const canShield=t=>canCast(t)&&t.react&&t.slots>0&&(t.prep||[]).includes('shield')&&!t.shielded;
function askShield(t,att,cont){g.pend={kind:'shield',mover:att.id,reactor:t.id,cont,timer:setTimeout(()=>{try{if(g.pend&&g.pend.kind==='shield'&&g.pend.reactor===t.id)resolveShield(false);bc()}catch{}},15000)}}
function resolveShield(yes){const q=g.pend;if(!q)return;clearTimeout(q.timer);g.pend=null;const t=players[q.reactor];let ok=false;
 if(yes&&t&&canShield(t)){t.slots--;t.react=false;t.shielded=true;ok=true;fx({kind:'ring',x:t.x,y:t.y,color:'#6cf'});log(`${t.name}: Щит (+5 КД до начала своего хода)`)}else if(t)log(`${t.name} не применяет Щит`);
 q.cont(ok);bc()}
function resolvePend(yes){if(!g.pend)return;g.pend.kind==='shield'?resolveShield(yes):resolveOA(yes)}
function mmChain(p,gr,i){if(i>=gr.length){if(alive().length<=1)next();bc();return}
 const[t,n]=gr[i],go=sh=>{if(sh)log(`Щит блокирует стрелы по ${t.name}`);else{let d=0;for(let k=0;k<n;k++)d+=r(4)+1;log(`  ${n} стр. → ${t.name}: ${d} силового урона`);hurt(t,d)}mmChain(p,gr,i+1)};
 if(t.dead)mmChain(p,gr,i+1);else if(t.shielded)go(true);else if(canShield(t))askShield(t,p,go);else go(false)}
function resolveOA(yes){const q=g.pend;if(!q)return;clearTimeout(q.timer);g.pend=null;const e=players[q.reactor],m=players[q.mover];
 const cont=()=>{if(!m.dead&&!m.down&&g.phase==='battle')walk(m);else m.path=[];bc()};
 if(yes&&e&&!e.dead&&!e.down&&!e.incap&&e.react&&!m.dead){e.react=false;log(`${e.name}: провоцированная атака`);try{attack(e,m,'main',cont);return}catch(x){log(x.message)}}
 else if(e)log(`${e.name} не атакует`);
 cont()}
function attack(p,t,wh,after){const done=()=>{if(after)after()},i=wInfo(p,wh);
 if(!t||t.dead||t===p)throw Error('Неверная цель');
 const d=dist(p,t);if(d>i.reach)throw Error(`Цель вне досягаемости (${i.reach} кл.)`);
 const pen=i.reach>1&&d===2&&players.some(o=>o&&o!==p&&!o.dead&&dist(o,p)===1); // досягаемое оружие: враг вплотную → помеха по дальним целям
 const dis=!!(t.dodge||pen),adv=!!(t.down||t.prone);let a=d20(p),rr='';
 if(dis!==adv){const b=d20(p);rr=` (${dis?'помеха':'преимущество'} ${a}/${b}${pen&&!t.dodge?', рядом враг':''})`;a=dis?Math.min(a,b):Math.max(a,b)}
 const cl=CLASSES[p.cls||'fighter'],pb=(!i.w.k||cl.weapons.includes(i.w.cat))?cl.prof:0; // мод. характеристики добавляется всегда, мастерство — только при владении (и только к попаданию)
 const total=a+i.m+pb,eac=t.ac+(t.shielded?5:0),hit=a===20||(a!==1&&total>=eac),head=`${p.name} → ${t.name} (${i.n}): ${a}${sg(i.m)}${pb?'+'+pb:''}=${total} vs КД ${eac}${rr}`;
 const fin=sh=>{
  if(sh||!hit){log(head+(sh?' — Щит! промах':' — промах'));return done()}
  const crit=a===20,sides=i.dice[1],nd=i.dice[0]*(crit?2:1);
  const roll=()=>{let s=0;for(let k=0;k<nd;k++){let x=r(sides);if(p.style==='gwf'&&i.two&&x<=2)x=r(sides);s+=x}return s};
  let d0=roll(),sv='';
  if(i.dice[0]&&p.feat==='savage'&&!p.savUsed&&g.order[g.turn]===p.id){const o=roll();p.savUsed=true;sv=` [Свирепый: ${d0}/${o}]`;d0=Math.max(d0,o)}
  if(!i.dice[0])d0=1;
  let am=i.m;if(wh==='off'&&p.style!=='twf'&&am>0)am=0;
  const du=(p.style==='duel'&&wh==='main'&&!i.two&&i.w.k&&ITEMS[p.eq.off]?.k!=='w')?2:0,dm=Math.max(0,d0+am+du);
  log(`${head} — ${crit?'КРИТ! ':'попал, '}урон ${dm} (кости ${d0}${sv}, мод ${sg(am)}${du?', стиль +2':''})`);
  hurt(t,dm);
  if((t.dead||t.down)&&(alive().length<=1||t.id===g.order[g.turn]))next();
  done()};
 if(hit&&a!==20&&!t.shielded&&canShield(t)&&total<t.ac+5){askShield(t,p,fin);return}
 fin(false)}
function handle(p,m){
 if(m.t==='ready'){if(g.phase!=='lobby'||p.ready)return;const c=m.c||{};
  const b=c.base;if(!Array.isArray(b)||b.length!==6||b.some(x=>!(x in COST)))throw Error('Неверные характеристики');
  const R=RACES[c.race];if(!R)throw Error('Выберите расу');const cl=CLASSES[c.cls];if(!cl)throw Error('Выберите класс');const F=FEATS[c.feat];if(!F)throw Error('Выберите черту');if(b.some((x,i)=>x<R.start[i]||x>15))throw Error('Характеристика вне диапазона (макс. 15)');
  if(b.reduce((s,x,i)=>s+COST[x]-COST[R.start[i]],0)>27)throw Error('Больше 27 очков');
  if(c.cls==='fighter'&&!STYLES.includes(c.style))throw Error('Выберите боевой стиль');
  const inv={};let spent=0;for(const k in c.inv||{}){const n=c.inv[k];if(!ITEMS[k]||!Number.isInteger(n)||n<0)throw Error('Неверный инвентарь');if(n){inv[k]=n;spent+=ITEMS[k].c*n}}
  if(spent>150)throw Error('Не хватает монет');
  Object.assign(p,{name:String(c.name||p.name).slice(0,16),st:b.map((x,i)=>x+(F.ab===i?1:0)),race:c.race,cls:c.cls,feat:c.feat,style:c.style,inv,eq:{main:c.eq?.main||'',off:c.eq?.off||'',armor:c.eq?.armor||''}});
  const e=eqOk(p,p.eq);if(e)throw Error(e);
  if(c.cls!=='fighter')p.style='';
  if(!cl.armor&&Object.keys(p.inv).some(k=>ITEMS[k].k==='a'||ITEMS[k].k==='s'))throw Error('Класс не владеет бронёй и щитами');
  p.prep=[];if(c.cls==='wizard'){const sp=c.spells,mx=Math.max(1,LEVEL+mod(p.st[3]));if(!Array.isArray(sp)||!sp.length||sp.length>mx||new Set(sp).size!==sp.length||sp.some(x=>!SPELLS[x]))throw Error(`Выберите от 1 до ${mx} заклинаний`);p.prep=sp.slice()}
  p.maxhp=Math.max(1,cl.hitDie+mod(p.st[2])+((R.hpPerLevel||0)+(F.hpPerLevel||0))*LEVEL);p.hp=p.maxhp;p.sw=cl.secondWind||0;p.slots=cl.slots||0;p.thp=0;p.initBonus=F.initProf?cl.prof:0;p.hd=LEVEL;p.kit=(p.inv.kit||0)*ITEMS.kit.uses;derive(p);p.ready=true;
  if(players.filter(x=>x&&x.ready).length===4)startBattle();return bc()}
 if(g.phase==='battle'&&m.t==='oa'){if(g.pend&&g.pend.reactor===p.id)resolvePend(!!m.yes);return}
 if(g.phase==='battle'&&g.pend)throw Error('Ждём ответ на провоцированную атаку');
 if(g.phase!=='battle'||players[g.order[g.turn]]!==p)throw Error('Не ваш ход');
 const need=(k)=>{if(!p[k])throw Error(k==='act'?'Действие уже потрачено':'Бонусное действие потрачено')};
if(p.incap&&['attack','dash','disengage','dodge','secondwind','cast','medic','stabilize','equip'].includes(m.t))throw Error('Вы недееспособны');
 switch(m.t){
 case'move':{const x=m.x,y=m.y;if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=N||y>=N)throw Error('Вне поля');
  if(occ(p,x,y))throw Error('Клетка занята');const path=bfs(p,x,y);if(!path)throw Error('Нет пути: далеко или заблокировано');p.path=path;p.waive=null;walk(p);break}
 case'attack':{const wh=m.which==='off'?'off':'main';
  if(wh==='main'){need('act');attack(p,players[m.target],'main');p.act=false;p.atkd=true}
  else{need('bonus');if(!p.atkd)throw Error('Сначала совершите атаку');
   if(!ITEMS[p.eq.main]?.f?.light||!ITEMS[p.eq.off]?.f?.light)throw Error('Нужно два лёгких оружия');
   attack(p,players[m.target],'off');p.bonus=false}break}
 case'dash':need('act');p.act=false;p.mv+=SPEED;log(`${p.name}: Рывок`);break;
 case'disengage':need('act');p.act=false;p.dis=true;log(`${p.name}: Отход`);break;
 case'dodge':need('act');p.act=false;p.dodge=true;log(`${p.name}: Уклонение`);break;
 case'secondwind':{need('bonus');if(p.sw<=0)throw Error('Применения кончились');
  const roll=r(CLASSES.fighter.hitDie),heal=Math.max(0,roll+mod(p.st[2])+1),old=p.hp;
  p.hp=Math.min(p.maxhp,p.hp+heal);p.sw--;p.bonus=false;log(`${p.name}: Second Wind d10=${roll}${mod(p.st[2])>=0?'+':''}${mod(p.st[2])}+1, +${p.hp-old} хп`);break}
 case'equip':{const e={main:m.main||'',off:m.off||'',armor:p.eq.armor};
  const er=eqOk(p,e);if(er)throw Error(er);
  const sh=(e.off==='shield')!==(p.eq.off==='shield');
  if(sh){need('act');p.act=false}
  p.eq=e;derive(p);log(`${p.name} меняет экипировку${sh?' (щит — действие)':''}`);break}
 case'standup':{if(!p.prone)throw Error('Вы не лежите');if(p.laugh)throw Error('Нельзя встать, пока вы смеётесь');const c=Math.floor(SPEED/2);if(p.mv<c)throw Error(`Нужна половина перемещения (${c})`);p.mv-=c;p.prone=false;log(`${p.name} встаёт`);break}
 case'stabilize':{need('act');const t=players[m.target];if(!t||t.dead||!t.ready||dist(p,t)>1)throw Error('Цель должна быть в пределах 5 футов');
  if(!t.down||t.stable)throw Error('Цель не нуждается в стабилизации');
  if((p.eq.main==='kit'||p.eq.off==='kit')&&p.kit>0){p.kit--;t.stable=true;log(`${p.name} стабилизирует ${t.name} комплектом`)}
  else{const v=d20(p),w=mod(p.st[4]),tot=v+w;if(tot>=10){t.stable=true;log(`${p.name} стабилизирует ${t.name} (Мудрость: ${v}${sg(w)}=${tot})`)}else log(`${p.name} не смог стабилизировать ${t.name} (${v}${sg(w)}=${tot} < 10)`)}
  p.act=false;break}
 case'medic':{need('act');if(p.feat!=='medic')throw Error('Нужна черта «Боевой медик»');if(p.eq.main!=='kit'&&p.eq.off!=='kit')throw Error('Возьмите комплект целителя в руку');
  if(p.kit<=0)throw Error('В комплекте нет зарядов');const t=players[m.target];
  if(!t||t.dead||!t.ready||dist(p,t)>1)throw Error('Цель должна быть в пределах 5 футов');
  if(t.hd<=0)throw Error('У цели нет костей хитов');if(!t.down&&t.hp>=t.maxhp)throw Error('Цель здорова');
  const hd=CLASSES[t.cls].hitDie,pf=CLASSES[p.cls].prof,d=r(hd),h=d+pf,o=t.hp;t.hd--;t.hp=Math.min(t.maxhp,t.hp+h);
  if(t.down){t.down=false;t.stable=false;t.dsL=t.dsD=0}
  log(`${p.name} лечит ${t.name} (Боевой медик): d${hd}=${d}+${pf}, +${t.hp-o} хп`);p.kit--;p.act=false;break}
 case'cast':{const k=m.spell,sp=SPELLS[k];if(!sp||sp.react)throw Error('Это заклинание так не применяется');need('act');
  if(p.cls!=='wizard'||!(p.prep||[]).includes(k))throw Error('Заклинание не подготовлено');
  if(!canCast(p))throw Error('Нельзя колдовать: в руках воинское оружие');if(p.slots<=0)throw Error('Нет ячеек заклинаний');
  const pr=CLASSES.wizard.prof,im=mod(p.st[3]),dc=8+pr+im,use=()=>{p.slots--;p.act=false};
  const tgt=(rng,self)=>{const t=players[m.target];if(!t||!t.ready||t.dead||(!self&&t===p)||dist(p,t)>rng)throw Error(`Цель вне дальности (${rng} кл.)`);return t};
  if(k==='magicmissile'){const ids=m.targets;if(!Array.isArray(ids)||ids.length!==3)throw Error('Нужно 3 стрелы');const cnt=new Map();
   ids.forEach(id=>{const t=players[id];if(!t||!t.ready||t.dead||t===p||dist(p,t)>24)throw Error('Цель вне дальности (24 кл.)');cnt.set(id,(cnt.get(id)||0)+1)});
   use();ids.forEach((id,i)=>fx({kind:'dart',from:{x:p.x,y:p.y},to:{x:players[id].x,y:players[id].y},delay:i*130}));
   log(`${p.name} — Волшебная стрела`);mmChain(p,[...cnt].map(([id,n])=>[players[id],n]),0);return bc()}
  if(k==='tasha'){const t=tgt(6);use();if(p.conc)endConc(p);fx({kind:'ring',x:t.x,y:t.y,color:'#b06bff'});
   const s=save(t,4,dc);log(`${p.name} — Смех Таши на ${t.name}: спасбросок Мудрости ${s.txt}${s.ok?' — успех':' — провал: ничком и недееспособен'}`);
   if(!s.ok){t.laugh={by:p.id,dc};t.incap=true;t.prone=true;p.conc={spell:'tasha',target:t.id}}break}
  if(k==='thunderwave'){const dx=m.dx,dy=m.dy;if(![-1,0,1].includes(dx)||![-1,0,1].includes(dy)||(!dx&&!dy))throw Error('Выберите направление');
   const rg=d=>d?(d>0?[1,3]:[-3,-1]):[-1,1],[x0,x1]=rg(dx).map(v=>p.x+v),[y0,y1]=rg(dy).map(v=>p.y+v);
   use();fx({kind:'wave',x:x0,y:y0,w:x1-x0+1,h:y1-y0+1});log(`${p.name} — Волна грома (куб 3×3)`);const dmg=r(8)+r(8);
   players.filter(t=>t&&t.ready&&!t.dead&&t!==p&&t.x>=x0&&t.x<=x1&&t.y>=y0&&t.y<=y1).forEach(t=>{
    const s=save(t,2,dc),d=s.ok?Math.floor(dmg/2):dmg;log(`  ${t.name}: Телосложение ${s.txt} — ${s.ok?'успех':'провал, отброшен'}, ${d} звуком`);
    if(!s.ok)for(let q=0;q<2;q++){const nx=t.x+dx,ny=t.y+dy;if(nx<0||ny<0||nx>=N||ny>=N||occ(t,nx,ny))break;t.x=nx;t.y=ny}
    hurt(t,d)});
   if(alive().length<=1)next();break}
  if(k==='falselife'){use();const v=r(4)+4;p.thp=Math.max(p.thp||0,v);fx({kind:'ring',x:p.x,y:p.y,color:'#8ff'});log(`${p.name} — Псевдожизнь: ${v} врем. хитов (итого ${p.thp})`);break}
  if(k==='curewounds'){const t=tgt(1,true);if(!t.down&&t.hp>=t.maxhp)throw Error('Цель здорова');use();
   const d=r(8),h=Math.max(1,d+im),o=t.hp;t.hp=Math.min(t.maxhp,t.hp+h);if(t.down){t.down=false;t.stable=false;t.dsL=t.dsD=0}
   fx({kind:'ring',x:t.x,y:t.y,color:'#6f6'});log(`${p.name} — Лечение ран на ${t.name}: d8=${d}${sg(im)}, +${t.hp-o} хп`);break}
  break}
 case'end':endTurnFx(p);next();break;
 default:return}
 bc()}
// ---------- HTTP + WS ----------
setInterval(()=>{if(g.phase!=='battle')return;const now=Date.now(),cur=players[g.order[g.turn]];
 for(const p of players)if(p&&!p.dead&&p.ready&&now-p.last>IDLE){p.dead=true;p.hp=0;log(`${p.name} бездействует 5 мин — выбывает`);try{p.ws.close()}catch{}}
 if(g.pend&&(players[g.pend.mover].dead||players[g.pend.reactor].dead))resolvePend(false);
 if(g.phase==='battle'&&(alive().length<=1||(cur&&cur.dead)))next();bc()},10000);
const PAGE=['public/index.html','index.html'].map(f=>path.join(__dirname,f)).find(f=>fs.existsSync(f));
const srv=http.createServer((q,s)=>{
 if(!PAGE){s.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});return s.end('index.html не найден: положите его в папку public/ рядом с server.js')}
 fs.readFile(PAGE,(e,d)=>{s.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});s.end(d)})});
const wss=new WebSocketServer({server:srv});
wss.on('connection',ws=>{
 const id=players.findIndex(x=>!x);
 if(g.phase!=='lobby'||id<0){ws.send(J({t:'err',m:'Игра уже идёт или мест нет'}));return ws.close()}
 const p=players[id]={id,ws,last:Date.now(),ready:false,name:'Игрок'+(id+1),color:`hsl(${id*90+r(40)} 70% 50%)`};
 ws.send(J({t:'init',id,ITEMS,COST,N,SPEED,RACES,FEATS,SPELLS,CLASSES:Object.fromEntries(Object.entries(CLASSES).map(([k,c])=>[k,{name:c.name}]))}));bc();
 ws.on('close',()=>{if(g.phase==='lobby'){players[id]=null}else if(!p.dead){p.dead=true;p.hp=0;log(`${p.name} отключился`);if(g.pend&&(g.pend.mover===p.id||g.pend.reactor===p.id))resolvePend(false);if(alive().length<=1||players[g.order[g.turn]]===p)next()}
  if(g.phase!=='lobby'&&!players.some(x=>x&&x.ws.readyState===1)){g.phase='over';resetGame()}bc()});
 ws.on('message',raw=>{p.last=Date.now();let m;try{m=JSON.parse(raw)}catch{return}try{handle(p,m)}catch(e){err(p,e.message)}})});
srv.listen(process.env.PORT||3000,()=>console.log('http://localhost:3000'));
