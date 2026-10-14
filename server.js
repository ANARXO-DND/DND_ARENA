const http=require('http'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws');
const N=90,SPEED=6,r=s=>1+Math.floor(Math.random()*s),mod=s=>Math.floor((s-10)/2);
// ---------- ДАННЫЕ (единственный источник правил) ----------
const W=(n,d,dt,f,c,v)=>({k:'w',n,d,dt,f,c,v});
const A=(n,base,dex,c,str)=>({k:'a',n,base,dex,c,str});
const ITEMS={
 dagger:W('Кинжал',[1,4],'колющий',{light:1,finesse:1,thrown:1},10),
 shortsword:W('Короткий меч',[1,6],'колющий',{light:1,finesse:1},20),
 rapier:W('Рапира',[1,8],'колющий',{finesse:1},35),
 longsword:W('Длинный меч',[1,8],'рубящий',{},30,[1,10]),
 halberd:W('Алебарда',[1,10],'рубящий',{two:1,reach:1},40),
 greatsword:W('Большой меч',[2,6],'рубящий',{two:1},50),
 leather:A('Кожаный доспех',11,'full',15),
 studded:A('Проклёпанный кожаный',12,'full',30),
 chainshirt:A('Кольчуга',13,2,40),
 scale:A('Чешуйчатый доспех',14,2,50),
 chainmail:A('Тяжёлая кольчуга',16,0,65,13),
 shield:{k:'s',n:'Щит',ac:2,c:10}};
for(const k of ['dagger'])ITEMS[k].cat='simple';for(const k of ['shortsword','rapier','longsword','halberd','greatsword'])ITEMS[k].cat='martial';
const COST={8:0,9:1,10:2,11:3,12:4,13:5,14:7,15:9},STYLES=['def','duel','gwf','twf'];
// ---------- КЛАСС (заготовка под другие классы) ----------
const CLASSES={fighter:{name:'Воин',hitDie:10,prof:2,saves:[0,2],weapons:['simple','martial'],secondWind:2}};
// ---------- СОСТОЯНИЕ ----------
const players=[null,null,null,null];let g={phase:'lobby',order:[],turn:0,log:[]};
const sg=n=>(n>=0?'+':'')+n,J=JSON.stringify,log=s=>g.log.push(s);
const pub=p=>p&&{id:p.id,name:p.name,ready:p.ready,color:p.color,x:p.x,y:p.y,hp:p.hp,maxhp:p.maxhp,ac:p.ac,mv:p.mv,act:p.act,bonus:p.bonus,sw:p.sw,dodge:p.dodge,dead:p.dead,eq:p.eq,inv:p.inv,st:p.st,init:p.init,style:p.style};
const bc=()=>{const m=J({t:'state',phase:g.phase,order:g.order,turn:g.turn,log:g.log.slice(-40),players:players.map(pub)});players.forEach(p=>p&&p.ws.readyState===1&&p.ws.send(m))};
const err=(p,m)=>p.ws.send(J({t:'err',m}));
function derive(p){const M=p.st.map(mod),a=ITEMS[p.eq.armor];let ac=10+M[1];
 if(a){ac=a.base+(a.dex==='full'?M[1]:Math.min(M[1],a.dex));if(p.style==='def')ac+=1}
 if(p.eq.off==='shield')ac+=ITEMS.shield.ac;p.ac=ac}
function eqOk(p,e){const cnt={};
 for(const k of [e.main,e.off,e.armor])if(k)cnt[k]=(cnt[k]||0)+1;
 for(const k in cnt)if((p.inv[k]||0)<cnt[k])return 'Нет такого предмета';
 const m=ITEMS[e.main],o=ITEMS[e.off],a=ITEMS[e.armor];
 if(e.main&&(!m||m.k!=='w'))return 'Неверное оружие';
 if(e.off&&!(e.off==='shield'||(o&&o.k==='w'&&o.f.light)))return 'В левую руку: щит или лёгкое оружие';
 if(m&&m.f.two&&e.off)return 'Двуручное оружие: вторая рука должна быть свободна';
 if(e.armor&&(!a||a.k!=='a'))return 'Неверный доспех';
 if(a&&a.str&&p.st[0]<a.str)return `Нужна Сила ${a.str}`;return null}
function wInfo(p,wh){const w=ITEMS[p.eq[wh]],M=p.st.map(mod);
 if(!w||w.k!=='w')return{n:'Кулак',dice:[0,0],m:M[0],two:false,reach:1,w:{}};
 const two=!!(w.f.two||(w.v&&wh==='main'&&!p.eq.off));
 return{n:w.n,dice:two&&w.v?w.v:w.d,m:w.f.finesse?Math.max(M[0],M[1]):M[0],two,reach:w.f.reach?2:1,w}}
const dist=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const alive=()=>players.filter(p=>p&&p.ready&&!p.dead);
function startTurn(p){p.mv=SPEED;p.act=p.bonus=true;p.atkd=false;p.dodge=false;log(`— Ход: ${p.name} —`)}
function next(){if(alive().length<=1){g.phase='over';const w=alive()[0];log(w?`🏆 Победил ${w.name}!`:'Все пали.');return}
 do{g.turn=(g.turn+1)%g.order.length}while(players[g.order[g.turn]].dead);startTurn(players[g.order[g.turn]])}
function startBattle(){g.phase='battle';const used=new Set();
 for(const p of players){let x,y;do{x=37+r(16);y=37+r(16)}while(used.has(x+','+y));used.add(x+','+y);
  Object.assign(p,{x,y,init:r(20)+mod(p.st[1])})}
 g.order=players.map(p=>p.id).sort((a,b)=>players[b].init-players[a].init||players[b].st[1]-players[a].st[1]||a-b);
 g.turn=0;log('Бой начался! Инициатива: '+g.order.map(i=>`${players[i].name} ${players[i].init}`).join(', '));startTurn(players[g.order[0]])}
function attack(p,t,wh){const i=wInfo(p,wh);
 if(!t||t.dead||t===p)throw Error('Неверная цель');
 if(dist(p,t)>i.reach)throw Error(`Цель вне досягаемости (${i.reach} кл.)`);
 let a=r(20);if(t.dodge){const b=r(20);a=Math.min(a,b)}
 const pb=(!i.w.k||CLASSES.fighter.weapons.includes(i.w.cat))?CLASSES.fighter.prof:0; // мод. характеристики добавляется всегда, мастерство — только при владении
 const total=a+i.m+pb,hit=a===20||(a!==1&&total>=t.ac);
 if(!hit){log(`${p.name} → ${t.name}: ${a}${sg(i.m)}${pb?'+'+pb:''}=${total} vs КД ${t.ac} — промах`);return}
 const crit=a===20;let d=0;const sides=i.dice[1];
 for(let k=0;k<i.dice[0]*(crit?2:1);k++){let x=r(sides);if(p.style==='gwf'&&i.two&&x<=2)x=r(sides);d+=x}
 if(!i.dice[0])d=1;
 let add=i.m;if(wh==='off'&&p.style!=='twf'&&add>0)add=0;
 if(p.style==='duel'&&wh==='main'&&i.w.k&&!i.two&&(!p.eq.off||p.eq.off==='shield'))add+=2;
 d=Math.max(0,d+add);t.hp=Math.max(0,t.hp-d);
 log(`${p.name} → ${t.name} (${i.n}): ${a}${sg(i.m)}${pb?'+'+pb:''}=${total} vs КД ${t.ac} — ${crit?'КРИТ! ':'попал, '}урон ${d}`);
 if(t.hp<=0){t.dead=true;log(`☠ ${t.name} повержен`);if(alive().length<=1)next()}}
function handle(p,m){
 if(m.t==='ready'){if(g.phase!=='lobby'||p.ready)return;const c=m.c||{};
  const b=c.base;if(!Array.isArray(b)||b.length!==6||b.some(x=>!(x in COST)))throw Error('Неверные характеристики');
  if(b.reduce((s,x)=>s+COST[x],0)>27)throw Error('Больше 27 очков');
  if(!STYLES.includes(c.style))throw Error('Выберите боевой стиль');
  const inv={};let spent=0;for(const k in c.inv||{}){const n=c.inv[k];if(!ITEMS[k]||!Number.isInteger(n)||n<0)throw Error('Неверный инвентарь');if(n){inv[k]=n;spent+=ITEMS[k].c*n}}
  if(spent>150)throw Error('Не хватает монет');
  Object.assign(p,{name:String(c.name||p.name).slice(0,16),st:b.map(x=>x+1),style:c.style,inv,eq:{main:c.eq?.main||'',off:c.eq?.off||'',armor:c.eq?.armor||''}});
  const e=eqOk(p,p.eq);if(e)throw Error(e);
  p.maxhp=Math.max(1,CLASSES.fighter.hitDie+mod(p.st[2]));p.hp=p.maxhp;p.sw=CLASSES.fighter.secondWind;derive(p);p.ready=true;
  if(players.filter(x=>x&&x.ready).length===4)startBattle();return bc()}
 if(g.phase!=='battle'||players[g.order[g.turn]]!==p)throw Error('Не ваш ход');
 const need=(k)=>{if(!p[k])throw Error(k==='act'?'Действие уже потрачено':'Бонусное действие потрачено')};
 switch(m.t){
 case'move':{const x=m.x,y=m.y;if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=N||y>=N)throw Error('Вне поля');
  if(players.some(o=>o&&o.ready&&!o.dead&&o.x===x&&o.y===y))throw Error('Клетка занята');
  const d=dist(p,{x,y});if(d>p.mv)throw Error('Не хватает перемещения');p.mv-=d;p.x=x;p.y=y;break}
 case'attack':{const wh=m.which==='off'?'off':'main';
  if(wh==='main'){need('act');attack(p,players[m.target],'main');p.act=false;p.atkd=true}
  else{need('bonus');if(!p.atkd)throw Error('Сначала совершите атаку');
   if(!ITEMS[p.eq.main]?.f?.light||!ITEMS[p.eq.off]?.f?.light)throw Error('Нужно два лёгких оружия');
   attack(p,players[m.target],'off');p.bonus=false}break}
 case'dash':need('act');p.act=false;p.mv+=SPEED;log(`${p.name}: Рывок`);break;
 case'disengage':need('act');p.act=false;log(`${p.name}: Отход`);break;
 case'dodge':need('act');p.act=false;p.dodge=true;log(`${p.name}: Уклонение`);break;
 case'secondwind':{need('bonus');if(p.sw<=0)throw Error('Применения кончились');
  const roll=r(CLASSES.fighter.hitDie),heal=Math.max(0,roll+mod(p.st[2])+1),old=p.hp;
  p.hp=Math.min(p.maxhp,p.hp+heal);p.sw--;p.bonus=false;log(`${p.name}: Second Wind d10=${roll}${mod(p.st[2])>=0?'+':''}${mod(p.st[2])}+1, +${p.hp-old} хп`);break}
 case'equip':{const e={main:m.main||'',off:m.off||'',armor:p.eq.armor};
  const er=eqOk(p,e);if(er)throw Error(er);
  const sh=(e.off==='shield')!==(p.eq.off==='shield');
  if(sh){need('act');p.act=false}
  p.eq=e;derive(p);log(`${p.name} меняет экипировку${sh?' (щит — действие)':''}`);break}
 case'end':next();break;
 default:return}
 bc()}
// ---------- HTTP + WS ----------
const PAGE=['public/index.html','index.html'].map(f=>path.join(__dirname,f)).find(f=>fs.existsSync(f));
const srv=http.createServer((q,s)=>{
 if(!PAGE){s.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});return s.end('index.html не найден: положите его в папку public/ рядом с server.js')}
 fs.readFile(PAGE,(e,d)=>{s.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});s.end(d)})});
const wss=new WebSocketServer({server:srv});
wss.on('connection',ws=>{
 const id=players.findIndex(x=>!x);
 if(g.phase!=='lobby'||id<0){ws.send(J({t:'err',m:'Игра уже идёт или мест нет'}));return ws.close()}
 const p=players[id]={id,ws,ready:false,name:'Игрок'+(id+1),color:`hsl(${id*90+r(40)} 70% 50%)`};
 ws.send(J({t:'init',id,ITEMS,COST,N,SPEED}));bc();
 ws.on('close',()=>{if(g.phase==='lobby'){players[id]=null}else if(!p.dead){p.dead=true;log(`${p.name} отключился`);if(alive().length<=1||players[g.order[g.turn]]===p)next()}bc()});
 ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}try{handle(p,m)}catch(e){err(p,e.message)}})});
srv.listen(process.env.PORT||3000,()=>console.log('http://localhost:3000'));
