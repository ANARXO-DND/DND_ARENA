const http=require('http'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws');
const N=30,SPEED=6,r=s=>1+Math.floor(Math.random()*s),mod=s=>Math.floor((s-10)/2);
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
 halfplate:A('Полулаты',15,2,150),
 scale:A('Чешуйчатый доспех',14,2,50),
 chainmail:A('Тяжёлая кольчуга',16,0,75,13),
 shield:{k:'s',n:'Щит',ac:2,c:10},
 kit:{k:'k',n:'Комплект целителя',c:25,uses:10},
 shortbow:W('Короткий лук',[1,6],'колющий',{two:1,rng:16,arc:1},25),
 longbow:W('Длинный лук',[1,8],'колющий',{two:1,heavy:1,rng:30,arc:1},50),
 hcross:W('Тяжёлый арбалет',[1,10],'колющий',{two:1,heavy:1,rng:20},50),
 oil:{k:'t',n:'Масло',c:1,c1:'#e8922a',c2:'#7a4a1e',desc:'Действие, бросок на 4 кл.: спасбросок Ловкости (СЛ 8 + Лов + мастерство). При провале цель в масле 10 ходов: первый урон огнём +5 огнём, масло сгорает. Тратится при броске.'},
 acid:{k:'t',n:'Кислота',c:25,c1:'#6fd23a',c2:'#3b5a24',desc:'Действие, бросок на 4 кл.: спасбросок Ловкости (СЛ 8 + Лов + мастерство), при провале 2d6 кислотой, при успехе урона нет. Тратится при броске.'}};
for(const k of ['dagger','shortbow'])ITEMS[k].cat='simple';for(const k of ['shortsword','rapier','longsword','halberd','greatsword','longbow','hcross'])ITEMS[k].cat='martial';
for(const k of ['halfplate','scale','chainmail'])ITEMS[k].metal=1; // металлическая броня (Электрошок)
const COST={8:0,9:1,10:2,11:3,12:4,13:5,14:7,15:9},STYLES=['def','duel','gwf','twf'],PSTYLES=['def','duel','gwf','prot','blessed']; // стили паладина (без «Двух оружий»; Protection и Blessed Warrior — только у него)
// ---------- КЛАСС (заготовка под другие классы) ----------
const CLASSES={
 fighter:{name:'Воин',hitDie:10,prof:2,saves:[0,2],weapons:['simple','martial'],armor:['light','medium','heavy'],shield:true,secondWind:2},
 wizard:{name:'Волшебник',hitDie:6,prof:2,saves:[3,4],weapons:['simple'],armor:[],shield:false,slots:2,slots2:3,castStat:3}, // slots2 — ячейки на 2 уровне
 cleric:{name:'Жрец',hitDie:8,prof:2,saves:[4,5],weapons:['simple'],armor:['light','medium'],shield:true,slots:2,slots2:3,castStat:4},
 // Варвар: d12; спасброски Сила и Телосложение; лёгкие и средние доспехи, щиты; простое и воинское оружие.
 // rage — заряды Ярости (1–2 ур.: 2). noConc — в Ярости концентрироваться нельзя (заготовка на будущее: см. CONCS и 'cast').
 barbarian:{name:'Варвар',hitDie:12,prof:2,saves:[0,2],weapons:['simple','martial'],armor:['light','medium'],shield:true,rage:2,noConc:true},
 // Паладин (5.5e): d10; спасброски Мудрость и Харизма; любая броня и щиты; простое и воинское оружие.
 // slots — 2 ячейки 1 круга; prep — ровно 2 подготовленных заклинания из списка list (не зависит от характеристик);
 // castStat 5 — Харизма; pool — Возложение рук: 5 хитов × уровень паладина.
 paladin:{name:'Паладин',hitDie:10,prof:2,saves:[4,5],weapons:['simple','martial'],armor:['light','medium','heavy'],shield:true,slots:2,castStat:5,prep:2,pool:5,list:['divinesmite','bless','curewounds','shieldoffaith']}};
const PHYS=['колющий','рубящий','дробящий'],CONCS=['resistance','witchbolt','tasha','bless','shieldoffaith']; // физический урон (сопротивление Ярости); заклинания на концентрации
// категория доспеха по полю dex: 'full' — лёгкий, число — средний, 0 — тяжёлый. Божественный порядок «Защитник» даёт жрецу воинское оружие и тяжёлые доспехи
const armCat=a=>a.dex==='full'?'light':a.dex===0?'heavy':'medium',armOk=(p,a)=>CLASSES[p.cls].armor.includes(armCat(a))||(armCat(a)==='heavy'&&p.order==='protector'),wprof=p=>[...CLASSES[p.cls].weapons,...(p.order==='protector'?['martial']:[])];
const LEVEL=1,MAXLV=2,IDLE=5*60*1000,E8=[8,8,8,8,8,8];
const RACES={
 human:{n:'Человек',start:[9,9,9,9,9,9],size:'Средний',desc:'Все характеристики +1 (старт с 9)'},
 halfling:{n:'Полурослик',start:E8,size:'Маленький',lucky:true,pass:true,desc:'Маленький. Выпавшая 1 на d20 перебрасывается. Проходит сквозь врагов, но не может остановиться в их клетке'},
 dwarf:{n:'Дворф',start:E8,size:'Средний',hpPerLevel:1,poisonRes:true,desc:'+1 хит за уровень. Сопротивление яду (пока не используется)'},
 elf:{n:'Эльф',start:E8,size:'Средний',charmAdv:true,desc:'Средний размер, скорость 6 клеток. Преимущество на спасброски против очарования (пока не используется). Нужно выбрать подрасу.',subs:{
  high:{n:'Высший эльф',desc:'+1 заговор из списка волшебника (любой класс), колдуется Интеллектом'},
  dark:{n:'Тёмный эльф',desc:'Заклинательная характеристика на выбор: Харизма, Мудрость или Интеллект. Влияет на СЛ спасбросков, атаки заклинаниями и прочее, даже если класс использует другую'},
  wood:{n:'Лесной эльф',desc:'Скорость 35 фт (7 клеток), рывок даёт ещё 7 клеток (70 фт)'}}}};
const FEATS={
 tough:{n:'Крепкий (Tough)',ab:2,hpPerLevel:2,desc:'+1 Телосложение (сверх лимита). +2 хита за уровень'},
 savage:{n:'Свирепый атакующий (Savage Attacker)',ab:0,desc:'+1 Сила (сверх лимита). Раз за ход при попадании оружием кости урона бросаются дважды, берётся лучший результат'},
 alert:{n:'Бдительный (Alert)',ab:1,initProf:true,desc:'+1 Ловкость (сверх лимита). К инициативе добавляется бонус мастерства'},
 medic:{n:'Боевой медик (Battle Medic)',ab:4,desc:'+1 Мудрость (сверх лимита). Действие: потратить заряд комплекта целителя (в руке), цель в 5 футах (можно себя) тратит кость хитов, лечение = кость + бонус мастерства'},
 initiate:{n:'Посвящённый в магию (Magic Initiate)',ab:-1,desc:'Выберите список: Жрец, Друид или Волшебник. 2 заговора и 1 заклинание 1 круга из него; заклинание можно сотворить 1 раз бесплатно (без ячейки). +1 к заклинательной характеристике списка (Мудрость или Интеллект)'}};
const SPELLS={
 shield:{n:'Щит',react:1,desc:'Реакция на атаку по вам: +5 КД до начала вашего следующего хода, блокирует Волшебную стрелу.'},
 magicmissile:{n:'Волшебная стрела',desc:'3 дротика, автопопадание, 24 кл., 1d4+1 силового каждый; можно разделить между целями (3 клика).'},
 tasha:{n:'Смех Таши',desc:'Концентрация. Цель в 6 кл.: спасбросок Мудрости; при провале ничком и недееспособна, повтор в конце хода и при уроне (с преимуществом).'},
 thunderwave:{n:'Волна грома',desc:'Волна вокруг вас: все существа в радиусе 1 клетки (в т.ч. по диагонали), направление не выбирается. Спасбросок Телосложения, 2d8 звука и отталкивание на 2 кл. от вас; при успехе половина урона.'},
 falselife:{n:'Псевдожизнь',desc:'Вы получаете 1d4+4 временных хитов.'},
 curewounds:{n:'Лечение ран',desc:'Касание (1 кл.): восстанавливает 2d8 + мод. заклинательной характеристики.'},
 divinesmite:{n:'Божественная кара',bonus:1,desc:'Школа: воплощение. Бонусное действие сразу после попадания рукопашной атакой; на себя, V, мгновенно: цель получает 2d8 излучением (4d8 при критическом попадании). Тратит ячейку.'},
 guidingbolt:{n:'Направляющий снаряд',rng:24,desc:'Дальняя атака заклинанием, 24 кл.: 4d6 излучением. Следующая атака любого существа по цели до конца вашего следующего хода — с преимуществом.'},
 healingword:{n:'Слово исцеления',rng:12,bonus:1,desc:'Бонусное действие, 12 кл.: цель (можно себя) восстанавливает 2d4 + мод. заклинательной характеристики хитов.'},
 shieldoffaith:{n:'Щит веры',rng:12,bonus:1,desc:'Бонусное действие, концентрация, 12 кл.: цель (можно себя) получает +2 к КД, пока вы концентрируетесь.'},
 command:{n:'Приказ',rng:12,desc:'Жрец, паладин. Действие, 12 кл.: спасбросок Мудрости, иначе в свой следующий ход цель выполняет команду сама (ход проходит автоматически): Подойди — идёт к вам и останавливается вплотную; Брось — убирает предметы из рук в инвентарь; Убегай — тратит ход на бегство прочь (с Рывком); Падай — падает ничком; Стой — ничего не делает.'},
 disguise:{n:'Маскировка',desc:'На себя. Выберите любой токен (воины и маги) или вернитесь к своему — меняется только токен, его видят все. Действует, пока не примените снова.'},
 witchbolt:{n:'Ведьмин снаряд',desc:'Концентрация, 12 кл. Дальняя атака заклинанием: 2d12 электричеством. В каждый следующий ваш ход бонусным действием 1d12 цели автоматически (даже после промаха). Прерывается, если цель дальше 12 клеток.'},
 bless:{n:'Благословение',rng:6,desc:'Жрец, паладин. Концентрация, до 10 раундов. До 3 существ в 6 кл. (можно себя): каждый бросок атаки и спасбросок получает +1d4.'}};
// Заговоры: 0 круг, без ячеек, можно колдовать бесконечно. Атака: d20 + мастерство + Инт; СЛ = 8 + мастерство + Инт
const CANTRIPS={
 firebolt:{n:'Огненный снаряд',rng:24,die:10,dt:'огнём',atk:1,col:'#ff8a3a',desc:'Дальняя атака заклинанием, 24 кл.: 1d10 огнём.'},
 rayoffrost:{n:'Луч холода',rng:12,die:8,dt:'холодом',atk:1,col:'#bfefff',desc:'Выстрел, 12 кл.: 1d8 холодом; скорость цели −2 кл. до начала вашего следующего хода.'},
 shockinggrasp:{n:'Электрошок',rng:1,die:8,dt:'электричеством',atk:1,col:'#ffe14a',desc:'Касание (1 кл.): 1d8 электричеством; цель без реакций до начала своего хода. Атака с преимуществом против металлической брони.'},
 acidsplash:{n:'Кислотный всплеск',rng:12,die:6,dt:'кислотой',col:'#9be34a',desc:'12 кл.: одна цель или две на соседних клетках; спасбросок Ловкости, при провале 1d6 кислотой.'},
 chilltouch:{n:'Леденящее прикосновение',rng:24,die:10,dt:'некротической энергией',atk:1,col:'#9a7bd1',desc:'Дальняя атака, 24 кл.: 1d10 некротической; цель не восстанавливает хиты до начала вашего следующего хода.'},
 swordburst:{n:'Вспышка мечей',rng:1,die:6,dt:'силовым полем',aoe:1,sv:1,desc:'Вокруг вас (радиус 1 кл.): спасбросок Ловкости, при провале 1d6 силовым полем.'},
 // заговоры жреца и друида (в первоначальном списке не были заданы — минимальный набор для черты «Посвящённый в магию»)
 sacredflame:{n:'Священное пламя',rng:12,die:8,dt:'излучением',sv:1,nocover:1,col:'#ffe9a3',desc:'Жрец. 12 кл.: спасбросок Ловкости, при провале 1d8 излучением. Игнорирует укрытия (кроме полного: за стеной не сработает).'},
 tollthedead:{n:'Погребальный звон',rng:12,die:8,dt:'некротической энергией',sv:4,col:'#7d8a9a',desc:'Жрец. 12 кл.: спасбросок Мудрости, при провале 1d8 некротической (1d12, если цель уже ранена).'},
 wordofradiance:{n:'Слово сияния',rng:1,die:6,dt:'излучением',aoe:1,sv:2,col:'#fff3b0',desc:'Жрец. Вокруг вас (радиус 1 кл.): выбранные существа делают спасбросок Телосложения, при провале 1d6 излучением.'},
 poisonspray:{n:'Ядовитые брызги',rng:6,die:12,dt:'ядом',sv:2,col:'#7ad23a',desc:'Друид. 6 кл.: спасбросок Телосложения, при провале 1d12 ядом.'},
 starrywisp:{n:'Звёздный огонёк',rng:12,die:8,dt:'излучением',atk:1,col:'#cfe8ff',desc:'Друид. Дальняя атака заклинанием, 12 кл.: 1d8 излучением.'},
 primalsavagery:{n:'Дикая ярость',rng:1,die:10,dt:'кислотой',atk:1,col:'#9be34a',desc:'Друид. Касание (1 кл.): рукопашная атака заклинанием, 1d10 кислотой.'},
 sparethedying:{n:'Спасение умирающего',rng:3,util:1,col:'#9dffb0',desc:'Жрец. Касание (до 3 кл., можно себя): существо без сознания и не стабильное становится стабильным.'},
 resistance:{n:'Сопротивление',rng:1,util:1,col:'#ffd166',desc:'Жрец. Касание (1 кл., можно себя), концентрация: один раз цель добавляет 1d4 к спасброску (бросается автоматически при первом же спасброске), затем заклинание заканчивается.'}};
// Списки классов для «Посвящённого в магию» (и для волшебника: его заговоры/заклинания — список wizard)
const MI={
 wizard:{n:'Волшебник',stat:3,cant:['firebolt','rayoffrost','shockinggrasp','acidsplash','chilltouch','swordburst'],spell:['shield','magicmissile','tasha','thunderwave','falselife','curewounds','disguise','witchbolt']},
 cleric:{n:'Жрец',stat:4,cant:['sacredflame','tollthedead','wordofradiance','sparethedying','resistance'],spell:['guidingbolt','curewounds','healingword','shieldoffaith','bless','command']},
 druid:{n:'Друид',stat:4,cant:['poisonspray','starrywisp','primalsavagery'],spell:['guidingbolt','curewounds','healingword']}};
const SN=['Сила','Ловкость','Телосложение','Интеллект','Мудрость','Харизма'];
const TOKENS=['human','dwarf','elf','halfling','w_human','w_dwarf','w_elf','w_halfling','c_human','c_dwarf','c_elf','c_halfling','b_human','b_dwarf','b_elf','b_halfling','p_elf','p_human']; // воины и маги, доступны для Маскировки
const spd=p=>p.sub==='wood'?7:SPEED,sab=p=>p.sab!=null?p.sab:(CLASSES[p.cls].castStat??3); // скорость (лесной эльф 35 фт) и заклинательная характеристика
const d20=p=>{let v=r(20);if(RACES[p.race]?.lucky&&v===1)v=r(20);return v};
const cantAll=p=>[...(p.cant||[]),...(p.mi?p.mi.cant:[])]; // заговоры класса/эльфа + «Посвящённый в магию»
// характеристика заклинания: тёмный эльф перекрывает всё, иначе — характеристика списка черты (если заклинание оттуда), иначе класса
const sabFor=(p,k)=>p.sab!=null?p.sab:(p.mi&&(p.mi.cant.includes(k)||p.mi.spell===k)&&!(CLASSES[p.cls].slots&&((p.prep||[]).includes(k)||(p.cant||[]).includes(k)))?p.mi.stat:sab(p));
const shSrc=t=>t.mi&&t.mi.spell==='shield'&&!t.mi.used?'free':(t.slots>0&&((t.prep||[]).includes('shield')||(t.mi&&t.mi.spell==='shield'))?'slot':null);
// ---------- СОСТОЯНИЕ ----------
const players=[null,null,null,null];let g={phase:'lobby',order:[],turn:0,log:[]};
const sg=n=>(n>=0?'+':'')+n,J=JSON.stringify,log=s=>{g.log.push(s);if(g.log.length>120)g.log.splice(0,60)}; // клиентам уходят только последние 40 строк
const pub=p=>p&&{id:p.id,name:p.name,race:p.race,cls:p.cls,thp:p.thp,slots:p.slots,prep:p.prep,prone:p.prone,incap:p.incap,conc:!!p.conc,shielded:p.shielded,react:p.react,down:p.down,stable:p.stable,dsL:p.dsL,dsD:p.dsD,feat:p.feat,kit:p.kit,hd:p.hd,ready:p.ready,color:p.color,x:p.x,y:p.y,hp:p.hp,maxhp:p.maxhp,ac:(p.ac||0)+(p.shielded?5:0),mv:p.mv,act:p.act,bonus:p.bonus,sw:p.sw,dodge:p.dodge,dead:p.dead,eq:p.eq,inv:p.inv,st:p.st,init:p.init,style:p.style,cmd:!!p.cmd,cant:cantAll(p),mi:p.mi?{spell:p.mi.spell,used:p.mi.used}:null,lvl:p.lvl,sof:!!(p.sof&&p.sof.length),bless:!!(p.bless&&p.bless.length),order:p.order,gb:!!p.gb,disg:p.disg,sub:p.sub,wb:(p.conc&&p.conc.spell==='witchbolt')?p.conc.target:null,oil:p.oil,rage:p.rage||0,rg:p.rg,level:p.level,sx:p.sx,asg:p.asg,reck:!!p.reck,fs:p.fs,ak:p.atkd,loh:p.loh,lm:p.cls==='paladin'?CLASSES.paladin.pool*p.level:0,sm:!!p.sm,slow:!!(p.slow&&p.slow.length),noheal:!!(p.noheal&&p.noheal.length)};
const bc=()=>{chkWB();const m=J({t:'state',phase:g.phase,order:g.order,turn:g.turn,log:g.log.slice(-40),players:players.map(pub),pend:g.pend?{kind:g.pend.kind,reactor:g.pend.reactor,mover:g.pend.mover,target:g.pend.target,tot:g.pend.tot,dc:g.pend.dc}:null});players.forEach(p=>p&&p.ws.readyState===1&&p.ws.send(m))};
const fx=o=>{const m=J({t:'fx',...o});players.forEach(p=>p&&p.ws.readyState===1&&p.ws.send(m))};
const err=(p,m)=>p.ws.send(J({t:'err',m}));
function derive(p){const M=p.st.map(mod),a=ITEMS[p.eq.armor];let ac=10+M[1]+(p.cls==='barbarian'&&!a?M[2]:0); // Защита без доспехов: 10 + Лов + Тел (щит разрешён)
 if(a){ac=a.base+(a.dex==='full'?M[1]:Math.min(M[1],a.dex));if(p.style==='def')ac+=1}
 if(p.eq.off==='shield')ac+=ITEMS.shield.ac;p.ac=ac+(p.sof&&p.sof.length?2:0)}
function eqOk(p,e){const cnt={};
 for(const k of [e.main,e.off,e.armor])if(k)cnt[k]=(cnt[k]||0)+1;
 for(const k in cnt)if((p.inv[k]||0)<cnt[k])return 'Нет такого предмета';
 const m=ITEMS[e.main],o=ITEMS[e.off],a=ITEMS[e.armor];
 if(e.main&&(!m||(m.k!=='w'&&m.k!=='k')))return 'Неверный предмет в правой руке';
 if(e.off&&!(e.off==='shield'||(o&&(o.k==='k'||(o.k==='w'&&o.f.light)))))return 'В левую руку: щит, лёгкое оружие или комплект';
 if(m&&m.f?.two&&e.off)return 'Двуручное оружие: вторая рука должна быть свободна';
 if(e.armor&&(!a||a.k!=='a'))return 'Неверный доспех';
 if(a&&a.str&&p.st[0]<a.str)return `Нужна Сила ${a.str}`;if(a&&!armOk(p,a))return 'Класс не владеет этим доспехом';if(e.off==='shield'&&!CLASSES[p.cls].shield)return 'Класс не владеет щитами';return null}
function wInfo(p,wh){const w=ITEMS[p.eq[wh]],M=p.st.map(mod);
 if(!w||w.k!=='w')return{n:'Кулак',dice:[0,0],m:M[0],two:false,reach:1,w:{}};
 const two=!!(w.f.two||(w.v&&wh==='main'&&!p.eq.off&&p.style!=='duel')); // Дуэлянт держит универсальное оружие одной рукой (1d8+2 выгоднее 1d10)
 return{n:w.n,dice:two&&w.v?w.v:w.d,m:w.f.rng?M[1]:w.f.finesse?Math.max(M[0],M[1]):M[0],two,reach:w.f.reach?2:1,rng:w.f.rng||0,w}}
const dist=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
// ===== СТЕНЫ И УКРЫТИЯ =====
// Каждое препятствие занимает ВСЮ клетку и непроходимо. Типы:
//   wall  — стена, полное укрытие: через неё не летят ни стрелы, ни заклинания (нет линии эффекта)
//   three — укрытие на три четверти: +5 к КД против дальнобойной атаки, летящей через него
//   half  — полуукрытие: +2 к КД против дальнобойной атаки, летящей через него
// Бонус нигде не «прилипает» к игроку: он считается заново для каждой атаки по линии «стрелок → цель».
// Из нескольких укрытий на линии действует самое сильное (они не складываются).
const COVER={wall:{n:'Стена',full:true},three:{n:'Укрытие на 3/4',ac:5},half:{n:'Полуукрытие',ac:2}};
const OBST=[
 // ДОБАВЛЯЙТЕ СТЕНЫ СЮДА, например: {x:12,y:9,t:'wall'}, {x:15,y:9,t:'three'}, {x:18,y:9,t:'half'},
];
if(process.env.DEMO_COVER==='1')OBST.push( // демо-расстановка для проверки: DEMO_COVER=1 node server.js
 ...[9,10,11,12,13].map(x=>({x,y:13,t:'wall'})),{x:17,y:13,t:'three'},{x:18,y:13,t:'three'},
 {x:10,y:17,t:'half'},{x:11,y:17,t:'half'},{x:12,y:17,t:'half'},{x:16,y:17,t:'wall'},{x:16,y:18,t:'wall'});
const terrain=new Map(OBST.filter(o=>COVER[o.t]&&Number.isInteger(o.x)&&Number.isInteger(o.y)&&o.x>=0&&o.y>=0&&o.x<N&&o.y<N).map(o=>[o.x*N+o.y,o.t]));
const terrList=()=>[...terrain].map(([k,t])=>({x:Math.floor(k/N),y:k%N,t}));
const blocked=(x,y)=>terrain.has(x*N+y),fullAt=(x,y)=>{const t=terrain.get(x*N+y);return !!t&&!!COVER[t].full};
// Линия от клетки a к клетке b (целочисленный обход сетки): {blk:true} — путь закрыт стеной; иначе {ac} — бонус КД от лучшего укрытия на пути.
// Концевые клетки не учитываются (там стоят существа). Диагональ через угол «щели» между двумя стенами тоже закрыта.
function cover(a,b){if(!terrain.size)return{blk:false,ac:0}; // на карте без препятствий — мгновенно
 const nx=Math.abs(b.x-a.x),ny=Math.abs(b.y-a.y),sx=Math.sign(b.x-a.x),sy=Math.sign(b.y-a.y);let x=a.x,y=a.y,ix=0,iy=0,ac=0;
 while(ix<nx||iy<ny){const d=(1+2*ix)*ny-(1+2*iy)*nx;
  if(d===0){if(fullAt(x+sx,y)&&fullAt(x,y+sy))return{blk:true,ac:0};x+=sx;y+=sy;ix++;iy++}else if(d<0){x+=sx;ix++}else{y+=sy;iy++}
  if(ix===nx&&iy===ny)break;const t=terrain.get(x*N+y);if(t){const c=COVER[t];if(c.full)return{blk:true,ac:0};ac=Math.max(ac,c.ac)}}
 return{blk:false,ac}}
// Для будущего: поставить/убрать препятствие во время игры (разослёт карту всем). t=null — убрать.
function setTerrain(x,y,t){if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=N||y>=N)return false;
 if(t){if(!COVER[t]||players.some(o=>o&&o.ready&&!o.dead&&o.x===x&&o.y===y))return false;terrain.set(x*N+y,t)}else terrain.delete(x*N+y);
 const m=J({t:'terrain',list:terrList()});players.forEach(p=>p&&p.ws.readyState===1&&p.ws.send(m));return true}
const alive=()=>players.filter(p=>p&&p.ready&&!p.dead&&!p.down);
function startTurn(p){if(p.conc&&p.conc.r0!=null&&(g.round||1)-p.conc.r0>=10)endConc(p,'10 раундов прошло');for(const o of players)if(o){if(o.slow)o.slow=o.slow.filter(i=>i!==p.id);if(o.noheal)o.noheal=o.noheal.filter(i=>i!==p.id);if(o.gb&&o.gb.by===p.id){if(o.gb.n>=1)o.gb=null;else o.gb.n=1}} // эффекты заговоров кончаются с началом хода заклинателя
 if(p.oil>0)p.oil--;p.mv=spd(p)-(p.slow&&p.slow.length?2:0);p.act=p.bonus=true;p.atkd=false;p.reck=false;p.surge=false;p.dodge=false;p.react=true;p.dis=false;p.savUsed=false;p.wbOk=true;p.shielded=false;p.lvl=false;log(`— Ход: ${p.name} —`)}
function deathRoll(p){if(p.stable)return;const v=d20(p),bl=blessD(p);
 if(v===1)p.dsD+=2;else if(v===20)p.dsL+=2;else if(v+bl<10)p.dsD++;else p.dsL++;
 log(`✖ ${p.name}: спасбросок от смерти ${v}${bl?'+'+bl+'(благ.)':''} (жизнь ${Math.min(p.dsL,3)}/3, смерть ${Math.min(p.dsD,3)}/3)`);
 if(p.dsD>=3){p.dead=true;endConc(p);log(`☠ ${p.name} умирает`)}else if(p.dsL>=3){p.stable=true;log(`${p.name} стабилизировался`)}}
function goDown(t){t.rage=0;endConc(t);if(t.laugh)endLaugh(t);t.down=true;t.hp=0;t.stable=false;t.dsL=t.dsD=0;log(`✖ ${t.name} теряет сознание`)}
function next(){if(g.phase!=='battle')return;{const cu=players[g.order[g.turn]];if(cu){if(cu.laugh&&!cu.dead&&!cu.down)endTurnFx(cu);if(cu.rage)rageTick(cu);cu.sm=null; // в конце КАЖДОГО хода — спасбросок против Смеха Таши
  for(const o of players)if(o&&o.gb&&o.gb.by===cu.id&&o.gb.n>=1)o.gb=null}} // подсветка снимается в конце следующего хода заклинателя
 if(alive().length<=1){g.phase='over';setTimeout(resetGame,6000);const w=alive()[0];log(w?`🏆 Победил ${w.name}!`:'Все пали.');return}
 const prevT=g.turn;do{g.turn=(g.turn+1)%g.order.length}while(players[g.order[g.turn]].dead);if(g.turn<=prevT)g.round=(g.round||1)+1; // круг очерёдности завершён — новый раунд
 const q=players[g.order[g.turn]];if(q.down){log(`— Ход: ${q.name} (без сознания) —`);deathRoll(q);return next()}startTurn(q);if(q.cmd){runCmd(q);return next()}}
const CMDS={approach:'Подойди',drop:'Брось',flee:'Убегай',prone:'Падай',halt:'Стой'};
// все клетки, до которых цель дойдёт за limit очков движения (те же правила, что у bfs: стены, существа, диагональ мимо двух стен)
function reachAll(p,limit,ok){const pass=!!RACES[p.race]?.pass,start={x:p.x,y:p.y,d:0,pr:null},seen=new Map([[p.x*N+p.y,start]]),fr=[start];
 for(let h=0;h<fr.length;h++){const c=fr[h],sc=p.prone?2:1;if(c.d+sc>limit)continue;
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){if(!dx&&!dy)continue;const x=c.x+dx,y=c.y+dy,k=x*N+y;
   if(x<0||y<0||x>=N||y>=N||seen.has(k)||blocked(x,y)||(dx&&dy&&blocked(c.x+dx,c.y)&&blocked(c.x,c.y+dy))||(!pass&&occ(p,x,y))||(ok&&!ok(c,{x,y})))continue;const n={x,y,d:c.d+sc,pr:c};seen.set(k,n);fr.push(n)}}
 return fr}
// Ход под действием Приказа: игрок ничего не делает, программа выполняет команду и сразу передаёт ход
function runCmd(p){const c=p.cmd,cs=players[c.by];p.cmd=null;p.dis=true; // принуждённое движение не провоцирует атак по возможности
 log(`${p.name} исполняет приказ «${CMDS[c.opt]}»`);
 if(c.opt==='drop'){p.eq.main='';p.eq.off='';derive(p)} // руки пустеют, предметы остаются в инвентаре
 else if(c.opt==='prone'){p.prone=true}
 else if((c.opt==='approach'||c.opt==='flee')&&cs&&!cs.dead){
  const sp=spd(p)-(p.slow&&p.slow.length?2:0),limit=c.opt==='flee'?sp*2:sp; // «Убегай» — с Рывком
  const cells=reachAll(p,limit,c.opt==='flee'?(a,b)=>dist(b,cs)>=dist(a,cs):null).filter(n=>!occ(p,n.x,n.y)),cur=dist(p,cs),e2=(a)=>Math.hypot(a.x-cs.x,a.y-cs.y),score=n=>c.opt==='approach'?[-dist(n,cs),-e2(n),-n.d]:[dist(n,cs),e2(n),-n.d];
  let best=null;for(const n of cells){if(!best){best=n;continue}const a=score(n),b=score(best);for(let i=0;i<a.length;i++){if(a[i]!==b[i]){if(a[i]>b[i])best=n;break}}}
  const better=best&&(c.opt==='approach'?dist(best,cs)<cur:dist(best,cs)>cur||(dist(best,cs)===cur&&e2(best)>e2(p)));
  if(better&&(best.x!==p.x||best.y!==p.y)){const route=[];for(let n=best;n.pr;n=n.pr)route.unshift({x:n.x,y:n.y});p.mv=limit;p.path=route;walk(p);fx({kind:'ring',x:p.x,y:p.y,color:'#ff8fa3'})}
  else log(`  ${p.name} не может ${c.opt==='approach'?'подойти ближе':'убежать дальше'}`)}
 p.mv=0;p.act=p.bonus=false;p.path=[]}
function resetGame(){if(g.phase!=='over')return;if(g.pend)clearTimeout(g.pend.timer);g={phase:'lobby',order:[],turn:0,log:[],pend:null};
 players.forEach((p,i)=>{if(!p||p.ws.readyState!==1){players[i]=null;return}
  for(const k of ['st','style','inv','eq','x','y','hp','maxhp','ac','mv','act','bonus','sw','dodge','dead','init','race','atkd','react','dis','path','down','stable','dsL','dsD','feat','kit','hd','initBonus','savUsed','waive','sub','sab','wbOk','disg','cls','thp','slots','prep','prone','incap','conc','shielded','laugh','cant','disg','slow','noheal','oil','mi','lvl','gb','sof','bless','res','order','rage','rg','cmd','loh','sm','level','sx','asg','surge','reck','fs'])delete p[k];
  p.ready=false;p.name='Игрок'+(p.id+1);p.last=Date.now();p.ws.send(J({t:'reset'}))});bc()}
function startBattle(){g.phase='battle';g.round=1;const used=new Set();
 for(const p of players){let x,y;do{x=7+r(16);y=7+r(16)}while(used.has(x+','+y)||blocked(x,y));used.add(x+','+y);
  Object.assign(p,{x,y,init:d20(p)+mod(p.st[1])+p.initBonus,react:true,down:false})}
 g.order=players.map(p=>p.id).sort((a,b)=>players[b].init-players[a].init||players[b].st[1]-players[a].st[1]||a-b);
 g.turn=0;log('Бой начался! Инициатива: '+g.order.map(i=>`${players[i].name} ${players[i].init}`).join(', '));startTurn(players[g.order[0]])}
const occ=(p,x,y)=>players.some(o=>o&&o.ready&&!o.dead&&o!==p&&o.x===x&&o.y===y);
const zr=e=>{const w=ITEMS[e.eq.main];return w&&w.k==='w'&&w.f.reach&&!e.eq.off?2:1}; // без лишних объектов на каждый шаг
const zone=(e,c)=>{const d=dist(e,c);return d<=1||(d===2&&zr(e)===2&&!cover(e,c).blk)}; // досягаемость 2 не работает сквозь стену
function bfs(p,tx,ty){const pass=!!RACES[p.race]?.pass,seen=new Set([p.x*N+p.y]);let fr=[{x:p.x,y:p.y,d:0,pr:null}];
 for(let h=0;h<fr.length;h++){const c=fr[h]; // индекс вместо shift()
  if(c.x===tx&&c.y===ty){const a=[];for(let n=c;n.pr;n=n.pr)a.unshift({x:n.x,y:n.y});return a}
  const sc=p.prone?2:1;if(c.d+sc>p.mv)continue;
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){if(!dx&&!dy)continue;const x=c.x+dx,y=c.y+dy,k=x*N+y;
   if(x<0||y<0||x>=N||y>=N||seen.has(k)||blocked(x,y)||(dx&&dy&&blocked(c.x+dx,c.y)&&blocked(c.x,c.y+dy))||(!pass&&occ(p,x,y)))continue;seen.add(k);fr.push({x,y,d:c.d+sc,pr:c})}}
 return null}
function walk(p){while(p.path&&p.path.length){const c=p.path[0],prev={x:p.x,y:p.y};
 if(!p.dis){const e=players.find(e=>e&&e.ready&&!e.dead&&!e.down&&!e.incap&&e!==p&&e.react&&!(p.waive&&p.waive.has(e.id))&&zone(e,prev)&&!zone(e,c));
  if(e){(p.waive=p.waive||new Set()).add(e.id);g.pend={kind:'oa',mover:p.id,reactor:e.id,timer:setTimeout(()=>{try{if(g.pend&&g.pend.reactor===e.id)resolvePend(false);bc()}catch{}},15000)};log(`${p.name} покидает зону ${e.name}…`);return}}
 p.x=c.x;p.y=c.y;p.mv-=p.prone?2:1;p.path.shift();p.waive=null}
 p.path=[]}
function blessD(p){return p.bless&&p.bless.length?r(4):0} // Благословение: +1d4 к каждой атаке и спасброску (не складывается само с собой)
function resD(p){if(!p.res||!p.res.length)return 0;const c=players[p.res[0]];p.res=[];if(c&&c.conc&&c.conc.spell==='resistance')endConc(c,'использовано');return r(4)} // Сопротивление: один раз, затем заклинание заканчивается
function save(t,ab,dc,adv,cb){let a=d20(t);if(adv||(ab===0&&t.rage)||(ab===1&&t.cls==='barbarian'&&t.level>=2&&!t.incap))a=Math.max(a,d20(t)); // Ярость — Сила; Чувство опасности — Ловкость
  // Ярость: преимущество на спасброски Силы
 const c=CLASSES[t.cls||'fighter'],mm=mod(t.st[ab]),pf=c.saves.includes(ab)?c.prof:0,bl=blessD(t),rs=resD(t),cv=cb||0,tot=a+mm+pf+bl+rs+cv;return{ok:tot>=dc,txt:`${a}${sg(mm)}${pf?'+'+pf:''}${bl?'+'+bl+'(благ.)':''}${rs?'+'+rs+'(сопр.)':''}${cv?'+'+cv+'(укрытие)':''}=${tot} vs ${dc}`}}
// Бонус укрытия к спасброску Ловкости от эффекта, идущего из клетки src (+2 полуукрытие, +5 укрытие на 3/4). Вплотную укрытия нет; ignore — «Священное пламя»
const cvSave=(src,t,ignore)=>ignore||dist(src,t)<=1?0:cover(src,t).ac;
// конец хода варвара: Ярость длится до конца его СЛЕДУЮЩЕГО хода (2 «конца хода»), продление бонусным действием снова ставит 2
function rageTick(p){if(!p.rage)return;if(p.down||p.dead||p.incap){p.rage=0;log(`${p.name}: ярость прекращается`);return}if(--p.rage<=0){p.rage=0;log(`${p.name}: ярость заканчивается (не продлена)`)}}
function endLaugh(p){const c=players[p.laugh.by];if(c&&c.conc&&c.conc.target===p.id)c.conc=null;p.laugh=null;p.incap=false}
function chkWB(){for(const c of players){if(!c||!c.conc)continue;if(c.dead||c.down){endConc(c);continue}
 if(c.conc.spell==='shieldoffaith'){const t0=players[c.conc.target];if(!t0||t0.dead)endConc(c);continue}if(c.conc.spell!=='witchbolt')continue;
 const t=players[c.conc.target];if(!t||t.dead){log(`Ведьмин снаряд ${c.name} прерван: цель выбыла`);endConc(c)}else if(dist(c,t)>12){log(`Ведьмин снаряд ${c.name} прерван: цель дальше 12 клеток`);endConc(c)}else if(cover(c,t).blk){log(`Ведьмин снаряд ${c.name} прерван: путь закрыт стеной`);endConc(c)}}}
function endConc(c,why){if(!c.conc)return;const cc=c.conc,t=players[cc.target];if(t&&t.laugh&&t.laugh.by===c.id){t.laugh=null;t.incap=false}if(t&&t.sof){t.sof=t.sof.filter(i=>i!==c.id);derive(t)}
 if(cc.spell==='bless')for(const i of cc.targets||[]){const o=players[i];if(o&&o.bless)o.bless=o.bless.filter(x=>x!==c.id)}
 if(cc.spell==='resistance'&&t&&t.res)t.res=t.res.filter(x=>x!==c.id);
 c.conc=null;log(`${c.name} теряет концентрацию${why?' ('+why+')':''}`)}
function endTurnFx(p){if(p.laugh){const s=save(p,4,p.laugh.dc);log(`${p.name}: спасбросок против Смеха в конце хода ${s.txt}${s.ok?' — смех прекращается':' — продолжает смеяться'}`);if(s.ok)endLaugh(p)}}
function hurt(t,dm,ty){if(t.rage&&dm>0&&PHYS.includes(ty)){const h=Math.floor(dm/2);log(`  ${t.name}: сопротивление Ярости — ${dm} → ${h}`);dm=h} // Ярость: сопротивление дробящему, колющему, рубящему
 if(ty==='огнём'&&t.oil>0&&dm>0){t.oil=0;dm+=5;log(`🔥 Масло на ${t.name} вспыхивает: +5 урона огнём`)}
 if(dm>0)fx({kind:'dmg',x:t.x,y:t.y,n:dm}); // число урона над существом
 const ab=Math.min(t.thp||0,dm);t.thp=(t.thp||0)-ab;dm-=ab;
 if(t.down){t.dsD++;t.stable=false;t.dsL=0;log(`✖ ${t.name}: +1 к смерти (${t.dsD}/3)`);if(t.dsD>=3){t.dead=true;endConc(t);log(`☠ ${t.name} умирает`)}return}
 if(dm<=0)return;t.hp=Math.max(0,t.hp-dm);
 if(t.hp<=0)return goDown(t);
 if(t.laugh){const s=save(t,4,t.laugh.dc,true);log(`${t.name}: спасбросок против Смеха при уроне ${s.txt}${s.ok?' — смех прекращается':''}`);if(s.ok)endLaugh(t)}
 if(t.conc){const s=save(t,2,Math.max(10,Math.floor(dm/2)));log(`${t.name}: концентрация ${s.txt}${s.ok?' — держит':''}`);if(!s.ok)endConc(t)}}
const nh=t=>!!(t.noheal&&t.noheal.length);
const canCast=p=>p&&!p.dead&&!p.down&&!p.incap&&(p.cls==='wizard'?!['main','off'].some(h=>ITEMS[p.eq[h]]?.cat==='martial'):(CLASSES[p.cls].slots>0||cantAll(p).length>0)); // воин колдует только заговором эльфа, у волшебника — запрет воинского оружия
const canShield=t=>canCast(t)&&t.react&&!t.shielded&&!!shSrc(t);
// Защита (паладин 2 ур., стиль Protection): реакцией помеха атаке по существу рядом, если в руке щит (союзников в игре нет — защищаем любого соседа)
const findProt=(att,t)=>players.find(o=>o&&o!==t&&o!==att&&o.ready&&!o.dead&&!o.down&&!o.incap&&o.react&&o.style==='prot'&&ITEMS[o.eq.off]?.k==='s'&&dist(o,t)<=1&&!cover(o,att).blk);
function askProt(o,att,t,cont){g.pend={kind:'prot',mover:att.id,reactor:o.id,target:t.id,cont,timer:setTimeout(()=>{try{if(g.pend&&g.pend.kind==='prot'&&g.pend.reactor===o.id)resolveProt(false);bc()}catch{}},15000)}}
function resolveProt(yes){const q=g.pend;if(!q)return;clearTimeout(q.timer);g.pend=null;const o=players[q.reactor],t=players[q.target],a=players[q.mover];let dis=false;
 if(yes&&o&&t&&a&&o.react&&!o.dead&&!o.down&&!o.incap){o.react=false;dis=true;fx({kind:'ring',x:o.x,y:o.y,color:'#9cf'});log(`${o.name}: Защита — помеха атаке ${a.name} по ${t.name}`)}else if(o)log(`${o.name} не применяет Защиту`);
 q.cont(dis);bc()}
// Тактический разум (воин 2 ур.): провалена проверка характеристики — можно потратить Second Wind и добавить 1d10; не помогло — применение не тратится
function askTM(p,tot,dc,cont){g.pend={kind:'tm',mover:p.id,reactor:p.id,tot,dc,cont,timer:setTimeout(()=>{try{if(g.pend&&g.pend.kind==='tm'&&g.pend.reactor===p.id)resolveTM(false);bc()}catch{}},15000)}}
function resolveTM(yes){const q=g.pend;if(!q)return;clearTimeout(q.timer);g.pend=null;const p=players[q.reactor];
 if(yes&&p&&p.sw>0){const d=r(10),nt=q.tot+d;if(nt>=q.dc){p.sw--;log(`${p.name}: Тактический разум +1d10=${d} → ${nt} vs ${q.dc} — успех (Second Wind потрачен, осталось ${p.sw})`);q.cont(true,nt)}else{log(`${p.name}: Тактический разум +1d10=${d} → ${nt} vs ${q.dc} — всё равно провал (Second Wind не потрачен)`);q.cont(false,nt)}}
 else{if(p)log(`${p.name} не применяет Тактический разум`);q.cont(false,q.tot)}bc()}
function askShield(t,att,cont){g.pend={kind:'shield',mover:att.id,reactor:t.id,cont,timer:setTimeout(()=>{try{if(g.pend&&g.pend.kind==='shield'&&g.pend.reactor===t.id)resolveShield(false);bc()}catch{}},15000)}}
function resolveShield(yes){const q=g.pend;if(!q)return;clearTimeout(q.timer);g.pend=null;const t=players[q.reactor];let ok=false;
 if(yes&&t&&canShield(t)){if(shSrc(t)==='free')t.mi.used=true;else t.slots--;t.react=false;t.shielded=true;ok=true;fx({kind:'ring',x:t.x,y:t.y,color:'#6cf'});log(`${t.name}: Щит (+5 КД до начала своего хода)`)}else if(t)log(`${t.name} не применяет Щит`);
 q.cont(ok);bc()}
function resolvePend(yes){if(!g.pend)return;const k=g.pend.kind;(k==='shield'?resolveShield:k==='prot'?resolveProt:k==='tm'?resolveTM:resolveOA)(yes)}
function spAtk(p,t,nm,adv0,onHit,ab,pd){if(pd===undefined){const pr=findProt(p,t);if(pr){askProt(pr,p,t,d=>spAtk(p,t,nm,adv0,onHit,ab,d));return}}const gb=!!t.gb;if(gb){t.gb=null;log(`  ${t.name}: преимущество от Направляющего снаряда`)}const nr=dist(p,t)<=1,cvS=nr?0:cover(p,t).ac,dis=!!(t.dodge||pd||(t.prone&&!nr)),adv=!!(adv0||gb||t.reck||t.down||(t.prone&&nr)),pb=CLASSES[p.cls].prof,im=mod(p.st[ab==null?sab(p):ab]);let a=d20(p),rr='';
 if(dis!==adv){const b=d20(p);rr=` (${dis?'помеха':'преимущество'} ${a}/${b})`;a=dis?Math.min(a,b):Math.max(a,b)}
 const bl=blessD(p),tot=a+pb+im+bl,eac=t.ac+(t.shielded?5:0)+cvS,hit=a===20||(a!==1&&tot>=eac),head=`${p.name} → ${t.name} (${nm}): ${a}${sg(im)}+${pb}${bl?'+'+bl+'(благ.)':''}=${tot} vs КД ${eac}${cvS?` (укрытие +${cvS})`:''}${rr}`;
 const fin=sh=>{if(sh||!hit){log(head+(sh?' — Щит! промах':' — промах'));return}onHit(head,a===20)};
 if(hit&&a!==20&&!t.shielded&&canShield(t)&&tot<t.ac+cvS+5)return askShield(t,p,fin);fin(false)}
function mmChain(p,gr,i){if(i>=gr.length){if(alive().length<=1)next();bc();return}
 const[t,n]=gr[i],go=sh=>{if(sh)log(`Щит блокирует стрелы по ${t.name}`);else{let d=0;for(let k=0;k<n;k++)d+=r(4)+1;log(`  ${n} стр. → ${t.name}: ${d} силового урона`);hurt(t,d)}mmChain(p,gr,i+1)};
 if(t.dead)mmChain(p,gr,i+1);else if(t.shielded)go(true);else if(canShield(t))askShield(t,p,go);else go(false)}
function resolveOA(yes){const q=g.pend;if(!q)return;clearTimeout(q.timer);g.pend=null;const e=players[q.reactor],m=players[q.mover];
 const cont=()=>{if(!m.dead&&!m.down&&g.phase==='battle')walk(m);else m.path=[];bc()};
 if(yes&&e&&!e.dead&&!e.down&&!e.incap&&e.react&&!m.dead){e.react=false;log(`${e.name}: провоцированная атака`);try{attack(e,m,'main',cont);return}catch(x){log(x.message)}}
 else if(e)log(`${e.name} не атакует`);
 cont()}
function attack(p,t,wh,after,pd){const done=()=>{if(after)after()},i=wInfo(p,wh);
 if(!t||t.dead||t===p)throw Error('Неверная цель');
 const d=dist(p,t);if(i.rng?d>i.rng*4:d>i.reach)throw Error(i.rng?`Цель вне дальности (${i.rng*4} кл.)`:`Цель вне досягаемости (${i.reach} кл.)`);
 const cv=cover(p,t);if(cv.blk)throw Error('Между вами стена: атаковать нельзя');const cvA=i.rng?cv.ac:0; // укрытие +2/+5 КД — только против дальнобойной атаки и только для неё
 if(pd===undefined){const pr=findProt(p,t);if(pr){askProt(pr,p,t,d=>attack(p,t,wh,after,d));return}} // реакция «Защита» паладина — до броска
 if(i.rng)fx({kind:'arrow',from:{x:p.x,y:p.y},to:{x:t.x,y:t.y},arc:i.w.f.arc?1:0}); // лук — дуга, арбалет — прямо
 const gb=!!t.gb;if(gb){t.gb=null;log(`  ${t.name}: преимущество от Направляющего снаряда`)}
 const pen=i.reach>1&&d===2&&players.some(o=>o&&o!==p&&!o.dead&&dist(o,p)===1); // досягаемое оружие: враг вплотную → помеха по дальним целям
 const rw=!!i.rng,dis=!!(t.dodge||pen||pd||(rw&&(t.prone||d<=1||d>i.rng||(i.w.f.heavy&&RACES[p.race]?.size==='Маленький')))),adv=!!(t.down||gb||t.reck||(p.reck&&!rw&&i.m===mod(p.st[0]))||(t.prone&&!rw)); // дальнобойное: помеха по лежащим, вплотную, дальше нормы; тяжёлое — помеха малым
 let a=d20(p),rr='';
 if(dis!==adv){const b=d20(p);rr=` (${dis?'помеха':'преимущество'} ${a}/${b}${pen&&!t.dodge?', рядом враг':''})`;a=dis?Math.min(a,b):Math.max(a,b)}
 const cl=CLASSES[p.cls||'fighter'],pb=(!i.w.k||wprof(p).includes(i.w.cat))?cl.prof:0; // мод. характеристики добавляется всегда, мастерство — только при владении (и только к попаданию)
 const bl=blessD(p),total=a+i.m+pb+bl,eac=t.ac+(t.shielded?5:0)+cvA,hit=a===20||(a!==1&&total>=eac),head=`${p.name} → ${t.name} (${i.n}): ${a}${sg(i.m)}${pb?'+'+pb:''}${bl?'+'+bl+'(благ.)':''}=${total} vs КД ${eac}${cvA?` (укрытие +${cvA})`:''}${rr}`;
 const fin=sh=>{
  if(sh||!hit){log(head+(sh?' — Щит! промах':' — промах'));return done()}
  const crit=a===20,sides=i.dice[1],nd=i.dice[0]*(crit?2:1);
  const roll=()=>{let s=0;for(let k=0;k<nd;k++){let x=r(sides);if(p.style==='gwf'&&i.two&&!i.rng&&x<=2)x=r(sides);s+=x}return s};
  let d0=roll(),sv='';
  if(i.dice[0]&&p.feat==='savage'&&!p.savUsed&&g.order[g.turn]===p.id){const o=roll();p.savUsed=true;sv=` [Свирепый: ${d0}/${o}]`;d0=Math.max(d0,o)}
  if(!i.dice[0])d0=1;
  let am=i.m;if(wh==='off'&&p.style!=='twf'&&am>0)am=0;
  const du=(p.style==='duel'&&wh==='main'&&!i.two&&!i.rng&&i.w.k&&ITEMS[p.eq.off]?.k!=='w')?2:0,rg=(p.rage&&!i.rng&&i.m===mod(p.st[0]))?2:0,dm=Math.max(0,d0+am+du+rg); // Ярость: +2 к урону ближнего боя от Силы
  log(`${head} — ${crit?'КРИТ! ':'попал, '}урон ${dm} (кости ${d0}${sv}, мод ${sg(am)}${du?', стиль +2':''}${rg?', ярость +2':''})`);
  hurt(t,dm,i.w.dt||'дробящий');
  if(p.cls==='paladin'&&!i.rng&&!t.dead&&!t.down&&players[g.order[g.turn]]===p&&(p.prep||[]).includes('divinesmite'))p.sm={t:t.id,crit}; // можно сразу применить Божественную кару
  if((t.dead||t.down)&&(alive().length<=1||t.id===g.order[g.turn]))next();
  done()};
 if(hit&&a!==20&&!t.shielded&&canShield(t)&&total<t.ac+cvA+5){askShield(t,p,fin);return}
 fin(false)}
function handle(p,m){
 if(m.t==='ready'){if(g.phase!=='lobby'||p.ready)return;const c=m.c||{};
  const b=c.base;if(!Array.isArray(b)||b.length!==6||b.some(x=>!(x in COST)))throw Error('Неверные характеристики');
  const R=RACES[c.race];if(!R)throw Error('Выберите расу');const cl=CLASSES[c.cls];if(!cl)throw Error('Выберите класс');const F=FEATS[c.feat];if(!F)throw Error('Выберите черту');if(b.some((x,i)=>x<R.start[i]||x>15))throw Error('Характеристика вне диапазона (макс. 15)');
  const lv=c.level===undefined?1:c.level;if(!Number.isInteger(lv)||lv<1||lv>MAXLV)throw Error(`Уровень: от 1 до ${MAXLV}`);
  if(b.reduce((s,x,i)=>s+COST[x]-COST[R.start[i]],0)>27)throw Error('Больше 27 очков');
  if(c.cls==='fighter'&&!STYLES.includes(c.style))throw Error('Выберите боевой стиль');if(c.cls==='paladin'&&lv>=2&&!PSTYLES.includes(c.style))throw Error('Паладин: выберите боевой стиль');
  let esub=null,eab=null,exc=null;if(c.race==='elf'){esub=c.sub;if(!R.subs[esub])throw Error('Выберите подрасу эльфа');
   if(esub==='dark'){eab=c.ab;if(![3,4,5].includes(eab))throw Error('Тёмный эльф: выберите Интеллект, Мудрость или Харизму')}
   if(esub==='high'){exc=c.xc;if(!MI.wizard.cant.includes(exc))throw Error('Высший эльф: выберите заговор волшебника')}}
  let mi=null;if(c.feat==='initiate'){const L=MI[c.mi?.cls],ct=c.mi?.cant;if(!L)throw Error('Посвящённый в магию: выберите класс');
   if(!Array.isArray(ct)||ct.length!==2||new Set(ct).size!==2||ct.some(x=>!L.cant.includes(x)))throw Error('Посвящённый в магию: выберите 2 заговора');
   if(!L.spell.includes(c.mi.spell))throw Error('Посвящённый в магию: выберите заклинание 1 круга');mi={cls:c.mi.cls,cant:ct.slice(),spell:c.mi.spell,stat:L.stat,used:false}}
  if(c.cls==='cleric'&&!['protector','thaumaturge'].includes(c.order))throw Error('Жрец: выберите Божественный порядок');
  const inv={};let spent=0;for(const k in c.inv||{}){const n=c.inv[k];if(!ITEMS[k]||!Number.isInteger(n)||n<0)throw Error('Неверный инвентарь');if(n){inv[k]=n;spent+=ITEMS[k].c*n}}
  if(spent>150)throw Error('Не хватает монет');
  Object.assign(p,{name:String(c.name||p.name).slice(0,16),st:b.map((x,i)=>x+(F.ab===i?1:0)+(mi&&mi.stat===i?1:0)),race:c.race,cls:c.cls,order:c.cls==='cleric'?c.order:null,feat:c.feat,style:c.style,inv,eq:{main:c.eq?.main||'',off:c.eq?.off||'',armor:c.eq?.armor||''}});
  p.sub=esub;p.sab=eab;p.mi=mi;p.lvl=false;const e=eqOk(p,p.eq);if(e)throw Error(e);
  if(c.cls!=='fighter'&&!(c.cls==='paladin'&&lv>=2))p.style='';
  if(Object.keys(p.inv).some(k=>(ITEMS[k].k==='a'&&!armOk(p,ITEMS[k]))||(ITEMS[k].k==='s'&&!cl.shield)))throw Error('Класс не владеет этим доспехом или щитом');
  p.prep=[];p.cant=[];if(cl.slots){const L=cl.list?{cant:[],spell:cl.list}:MI[c.cls],cn=cl.list?[]:c.cantrips,mc=cl.list?0:(lv<4?3:4)+(p.order==='thaumaturge'?1:0); // Чудотворец — один лишний заговор
   if(!Array.isArray(cn)||cn.length!==mc||new Set(cn).size!==mc||cn.some(x=>!L.cant.includes(x)))throw Error(`Выберите заговоры: ровно ${mc}`);p.cant=cn.slice();
   const sp=c.spells,mx=cl.prep||Math.max(1,lv+mod(p.st[sab(p)])); // подготовка: уровень + мод. заклинательной характеристики, минимум 1
   if(!Array.isArray(sp)||!sp.length||sp.length>mx||(cl.prep&&sp.length!==mx)||new Set(sp).size!==sp.length||sp.some(x=>!L.spell.includes(x)))throw Error(`Выберите ${cl.prep?'ровно':'от 1 до'} ${mx} заклинаний`);p.prep=sp.slice()}
  if(c.cls==='paladin'&&lv>=2&&c.style==='blessed'){const bw=c.bw;if(!Array.isArray(bw)||bw.length!==2||new Set(bw).size!==2||bw.some(x=>!MI.cleric.cant.includes(x)))throw Error('Благословлённый воин: выберите 2 заговора жреца');p.cant=bw.slice()} // заговоры жреца на Харизме
  if(exc){if(p.cant.includes(exc))throw Error('Этот заговор уже выбран у волшебника — выберите другой для эльфа');p.cant.push(exc)}
  if(mi&&mi.cant.some(x=>p.cant.includes(x)))throw Error('Заговор «Посвящённого в магию» уже выбран другим источником');
  p.level=lv;p.maxhp=Math.max(1,cl.hitDie+mod(p.st[2])+(lv-1)*(Math.floor(cl.hitDie/2)+1+mod(p.st[2]))+((R.hpPerLevel||0)+(F.hpPerLevel||0))*lv);p.hp=p.maxhp;p.sw=cl.secondWind||0;p.asg=(c.cls==='fighter'&&lv>=2)?1:0;p.fs=(c.cls==='paladin'&&lv>=2)?1:0;p.loh=(cl.pool||0)*lv;p.sm=null;p.rg=cl.rage||0;p.rage=0;p.sx=(lv>=2&&cl.slots2)||cl.slots||0;p.slots=p.sx;p.thp=0;p.initBonus=F.initProf?cl.prof:0;p.hd=lv;p.kit=(p.inv.kit||0)*ITEMS.kit.uses;derive(p);p.ready=true;
  if(players.filter(x=>x&&x.ready).length===4)startBattle();return bc()}
 if(g.phase==='battle'&&m.t==='oa'){if(g.pend&&g.pend.reactor===p.id)resolvePend(!!m.yes);return}
 if(g.phase==='battle'&&g.pend)throw Error('Ждём ответ на провоцированную атаку');
 if(g.phase==='battle'&&m.t==='dropconc'){if(!p.conc)throw Error('Вы не концентрируетесь');endConc(p);return bc()} // бесплатно и в любой момент
 if(p.sm&&!(m.t==='cast'&&m.spell==='divinesmite'))p.sm=null; // окно Божественной кары — только сразу после попадания
 if(g.phase!=='battle'||players[g.order[g.turn]]!==p)throw Error('Не ваш ход');
 const need=(k)=>{if(!p[k])throw Error(k==='act'?'Действие уже потрачено':'Бонусное действие потрачено')};
if(p.incap&&['attack','dash','disengage','dodge','secondwind','cast','medic','stabilize','equip','throw','wbzap','rage','rageext','layonhands','actionsurge'].includes(m.t))throw Error('Вы недееспособны');
 switch(m.t){
 case'move':{const x=m.x,y=m.y;if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=N||y>=N)throw Error('Вне поля');
  if(blocked(x,y))throw Error('Там стена или укрытие — клетка непроходима');
  if(occ(p,x,y))throw Error('Клетка занята');const path=bfs(p,x,y);if(!path)throw Error('Нет пути: далеко или заблокировано');p.path=path;p.waive=null;walk(p);break}
 case'attack':{const wh=m.which==='off'?'off':'main';
  if(wh==='main'){need('act');const rk=!!m.reckless&&p.cls==='barbarian'&&p.level>=2&&!p.atkd&&!p.reck; // объявляется перед ПЕРВОЙ атакой хода
    if(rk){p.reck=true;log(`${p.name} атакует безрассудно`)}
    try{attack(p,players[m.target],'main')}catch(e){if(rk){p.reck=false;g.log.pop()}throw e}p.act=false;p.atkd=true}
  else{need('bonus');if(!p.atkd)throw Error('Сначала совершите атаку');
   if(!ITEMS[p.eq.main]?.f?.light||!ITEMS[p.eq.off]?.f?.light)throw Error('Нужно два лёгких оружия');
   attack(p,players[m.target],'off');p.bonus=false}break}
 case'throw':{need('act');const k=m.item,it=ITEMS[k];if(!it||it.k!=='t'||!(p.inv[k]>0))throw Error('Нет такого предмета');
  const t=players[m.target];if(!t||!t.ready||t.dead||t===p||dist(p,t)>4)throw Error('Цель вне дальности (4 кл.)');if(cover(p,t).blk)throw Error('Цель за стеной: бросок невозможен');
  p.inv[k]--;p.act=false;fx({kind:'lob',from:{x:p.x,y:p.y},to:{x:t.x,y:t.y},c1:it.c1,c2:it.c2});fx({kind:'ring',x:t.x,y:t.y,color:it.c1,delay:600});
  const s=save(t,1,8+mod(p.st[1])+CLASSES[p.cls].prof,false,cvSave(p,t));
  if(k==='oil'){log(`${p.name} бросает масло в ${t.name}: Ловкость ${s.txt}${s.ok?' — увернулся':' — покрыт маслом на 10 ходов'}`);if(!s.ok)t.oil=10}
  else{const d=r(6)+r(6);log(`${p.name} бросает кислоту в ${t.name}: Ловкость ${s.txt}${s.ok?' — уклонился, урона нет':` — провал, ${d} кислотой`}`);if(!s.ok)hurt(t,d,'кислотой')}
  if(alive().length<=1)next();break}
 case'dash':need('act');p.act=false;p.mv+=spd(p)-(p.slow&&p.slow.length?2:0);log(`${p.name}: Рывок`);break;
 case'disengage':need('act');p.act=false;p.dis=true;log(`${p.name}: Отход`);break;
 case'layonhands':{need('bonus');if(p.cls!=='paladin')throw Error('Возложение рук доступно только паладину');
  const t=players[m.target];if(!t||!t.ready||t.dead||dist(p,t)>1)throw Error('Нужна цель рядом (касание, 1 кл.), можно и себя');
  if(nh(t))throw Error('Цель не может восстанавливать хиты');if(!(p.loh>0))throw Error('Пул Возложения рук пуст');
  const want=Number.isInteger(m.amount)?m.amount:p.loh;if(want<1||want>p.loh)throw Error(`Выберите от 1 до ${p.loh} хитов`);
  const h=Math.min(want,t.maxhp-t.hp);if(h<=0)throw Error('Цель здорова'); // тратится только реально восстановленное
  p.bonus=false;p.loh-=h;t.hp+=h;if(t.down){t.down=false;t.stable=false;t.dsL=t.dsD=0}
  fx({kind:'ring',x:t.x,y:t.y,color:'#ffe08a'});log(`🙌 ${p.name} возлагает руки на ${t.name}: +${h} хп (в пуле осталось ${p.loh})`);break}
 case'actionsurge':{if(p.cls!=='fighter'||p.level<2)throw Error('Всплеск действий — умение воина 2 уровня');if(!(p.asg>0))throw Error('Всплеск действий уже использован');if(p.act)throw Error('Сначала потратьте обычное действие — Всплеск даёт ещё одно');
  p.asg--;p.act=true;p.surge=true;fx({kind:'ring',x:p.x,y:p.y,color:'#ffd166'});log(`⚡ ${p.name}: Всплеск действий — ещё одно действие (заклинание им сотворить нельзя)`);break}
 case'rage':{need('bonus');if(p.cls!=='barbarian')throw Error('Ярость доступна только варвару');if(p.rage)throw Error('Вы уже в ярости — её можно продлить');if(!(p.rg>0))throw Error('Заряды ярости кончились');
  p.bonus=false;p.rg--;p.rage=2;if(p.conc)endConc(p,'ярость'); // в ярости концентрироваться нельзя
  fx({kind:'ring',x:p.x,y:p.y,color:'#e5533d'});log(`🔥 ${p.name} впадает в ярость (зарядов осталось: ${p.rg}): +2 урона Силой, сопротивление дробящему/колющему/рубящему`);break}
 case'rageext':{need('bonus');if(!p.rage)throw Error('Вы не в ярости');p.bonus=false;p.rage=2;fx({kind:'ring',x:p.x,y:p.y,color:'#e5533d'});log(`🔥 ${p.name} продлевает ярость до конца своего следующего хода`);break}
 case'dodge':need('act');p.act=false;p.dodge=true;log(`${p.name}: Уклонение`);break;
 case'secondwind':{need('bonus');if(nh(p))throw Error('Вы не можете восстанавливать хиты (Леденящее прикосновение)');if(p.sw<=0)throw Error('Применения кончились');
  const roll=r(CLASSES.fighter.hitDie),heal=Math.max(0,roll+mod(p.st[2])+1),old=p.hp;
  p.hp=Math.min(p.maxhp,p.hp+heal);p.sw--;p.bonus=false;log(`${p.name}: Second Wind d10=${roll}${mod(p.st[2])>=0?'+':''}${mod(p.st[2])}+1, +${p.hp-old} хп`);break}
 case'equip':{const e={main:m.main||'',off:m.off||'',armor:p.eq.armor};
  const er=eqOk(p,e);if(er)throw Error(er);
  const sh=(e.off==='shield')!==(p.eq.off==='shield');
  if(sh){need('act');p.act=false}
  p.eq=e;derive(p);log(`${p.name} меняет экипировку${sh?' (щит — действие)':''}`);break}
 case'standup':{if(!p.prone)throw Error('Вы не лежите');if(p.laugh)throw Error('Нельзя встать, пока вы смеётесь');const c=Math.floor(spd(p)/2);if(p.mv<c)throw Error(`Нужна половина перемещения (${c})`);p.mv-=c;p.prone=false;log(`${p.name} встаёт`);break}
 case'stabilize':{need('act');const t=players[m.target];if(!t||t.dead||!t.ready||dist(p,t)>1)throw Error('Цель должна быть в пределах 5 футов');
  if(!t.down||t.stable)throw Error('Цель не нуждается в стабилизации');
  if((p.eq.main==='kit'||p.eq.off==='kit')&&p.kit>0){p.kit--;t.stable=true;log(`${p.name} стабилизирует ${t.name} комплектом`)}
  else{const v=d20(p),w=mod(p.st[4]),tot=v+w,txt=`Мудрость: ${v}${sg(w)}=${tot}`;
    if(tot>=10){t.stable=true;log(`${p.name} стабилизирует ${t.name} (${txt})`)}
    else if(p.cls==='fighter'&&p.level>=2&&p.sw>0&&tot+10>=10)askTM(p,tot,10,(ok,nt)=>{if(ok){t.stable=true;log(`${p.name} стабилизирует ${t.name} (${txt}; с d10 → ${nt})`)}else log(`${p.name} не смог стабилизировать ${t.name} (${txt}${nt!==tot?'; с d10 → '+nt:''} < 10)`)});
    else log(`${p.name} не смог стабилизировать ${t.name} (${v}${sg(w)}=${tot} < 10)`)}
  p.act=false;break}
 case'medic':{need('act');if(p.feat!=='medic')throw Error('Нужна черта «Боевой медик»');if(p.eq.main!=='kit'&&p.eq.off!=='kit')throw Error('Возьмите комплект целителя в руку');
  if(p.kit<=0)throw Error('В комплекте нет зарядов');const t=players[m.target];
  if(!t||t.dead||!t.ready||dist(p,t)>1)throw Error('Цель должна быть в пределах 5 футов');
  if(t.hd<=0)throw Error('У цели нет костей хитов');if(nh(t))throw Error('Цель не может восстанавливать хиты');if(!t.down&&t.hp>=t.maxhp)throw Error('Цель здорова');
  const hd=CLASSES[t.cls].hitDie,pf=CLASSES[p.cls].prof,d=r(hd),h=d+pf,o=t.hp;t.hd--;t.hp=Math.min(t.maxhp,t.hp+h);
  if(t.down){t.down=false;t.stable=false;t.dsL=t.dsD=0}
  log(`${p.name} лечит ${t.name} (Боевой медик): d${hd}=${d}+${pf}, +${t.hp-o} хп`);p.kit--;p.act=false;break}
 case'cast':{const k=m.spell,cn=CANTRIPS[k],sp=cn||SPELLS[k];if(!sp||sp.react)throw Error('Это заклинание так не применяется');need(sp.bonus?'bonus':'act');if(p.surge&&!sp.bonus)throw Error('Действие от Всплеска действий нельзя потратить на заклинание');if(p.rage&&CONCS.includes(k))throw Error('В ярости нельзя концентрироваться');
  const fr=!cn&&!!p.mi&&p.mi.spell===k&&!p.mi.used; // бесплатное заклинание «Посвящённого в магию»
  if(cn?!cantAll(p).includes(k):!((p.prep||[]).includes(k)||(p.mi&&p.mi.spell===k)))throw Error('Заклинание не подготовлено');
  if(!canCast(p))throw Error('Нельзя колдовать: в руках воинское оружие');
  if(!cn){if(p.lvl)throw Error('В один ход — только одно заклинание с ячейкой (заговоры не считаются)');if(!fr&&!(k==='divinesmite'&&p.fs>0)&&p.slots<=0)throw Error('Нет ячеек заклинаний')}
  const ab=sabFor(p,k),pr=CLASSES[p.cls].prof,im=mod(p.st[ab]),dc=8+pr+im,use=()=>{if(!cn){if(fr)p.mi.used=true;else if(k==='divinesmite'&&p.fs>0)p.fs--;else p.slots--;p.lvl=true}p[sp.bonus?'bonus':'act']=false},chk=()=>{if(alive().length<=1)next()};
  const tgt=(rng,self)=>{const t=players[m.target];if(!t||!t.ready||t.dead||(!self&&t===p)||dist(p,t)>rng)throw Error(`Цель вне дальности (${rng} кл.)`);if(cover(p,t).blk)throw Error('Цель за стеной: прямого пути нет');return t};
  if(k==='sparethedying'){const t=tgt(cn.rng,true);if(!t.down||t.stable)throw Error('Цель не нуждается в стабилизации');use();t.stable=true;fx({kind:'ring',x:t.x,y:t.y,color:cn.col});log(`${p.name} — Спасение умирающего: ${t.name} стабилизирован`);break}
  if(k==='resistance'){const t=tgt(cn.rng,true);use();if(p.conc)endConc(p,'новая концентрация');(t.res=t.res||[]).push(p.id);p.conc={spell:'resistance',target:t.id};fx({kind:'ring',x:t.x,y:t.y,color:cn.col});log(`${p.name} — Сопротивление на ${t.name}: +1d4 к одному спасброску (концентрация)`);break}
  if(k==='divinesmite'){const sm=p.sm,t=sm&&players[sm.t];if(!t||t.dead)throw Error('Божественную кару можно применить только сразу после попадания рукопашной атакой');
   const fsu=p.fs>0;use();p.sm=null;let d=0;for(let i=0;i<(sm.crit?4:2);i++)d+=r(8);
   fx({kind:'ring',x:t.x,y:t.y,color:'#ffe08a'});log(`✨ ${p.name} — Божественная кара по ${t.name}: ${sm.crit?'4d8':'2d8'}=${d} излучением${fsu?' (без траты ячейки)':''}`);hurt(t,d,'излучением');chk();break}
  if(cn&&cn.atk){const t=tgt(cn.rng);use();fx({kind:'dart',from:{x:p.x,y:p.y},to:{x:t.x,y:t.y},color:cn.col,str:1});
   spAtk(p,t,cn.n,k==='shockinggrasp'&&!!ITEMS[t.eq.armor]?.metal,(h,cr)=>{let d=0;for(let i=0;i<(cr?2:1);i++)d+=r(cn.die);
    log(`${h} — ${cr?'КРИТ! ':'попал, '}${d} ${cn.dt}`);hurt(t,d,cn.dt);
    if(k==='rayoffrost'){(t.slow=t.slow||[]).push(p.id);log(`  ${t.name}: скорость −2 кл. до начала хода ${p.name}`)}
    if(k==='shockinggrasp'){t.react=false;log(`  ${t.name} не может совершать реакции до начала своего хода`)}
    if(k==='chilltouch'){(t.noheal=t.noheal||[]).push(p.id);log(`  ${t.name} не восстанавливает хиты до начала хода ${p.name}`)}
    chk()},ab);break}
  if(k==='acidsplash'){const ids=m.targets;if(!Array.isArray(ids)||ids.length<1||ids.length>2||ids.some(i=>!Number.isInteger(i))||new Set(ids).size!==ids.length)throw Error('Выберите 1 или 2 цели');
   const ts=ids.map(i=>{const t=players[i];if(!t||!t.ready||t.dead||t===p||dist(p,t)>12)throw Error('Цель вне дальности (12 кл.)');if(cover(p,t).blk)throw Error('Цель за стеной: прямого пути нет');return t});
   if(ts.length===2&&dist(ts[0],ts[1])>1)throw Error('Две цели должны стоять на соседних клетках');
   use();const dmg=r(6);log(`${p.name} — Кислотный всплеск`);
   ts.forEach(t=>{fx({kind:'dart',from:{x:p.x,y:p.y},to:{x:t.x,y:t.y},color:cn.col,str:1});const s=save(t,1,dc,false,cvSave(p,t));log(`  ${t.name}: Ловкость ${s.txt} — ${s.ok?'успех':`провал, ${dmg} кислотой`}`);if(!s.ok)hurt(t,dmg)});chk();break}
  if(cn&&cn.aoe){const ids=m.targets;if(!Array.isArray(ids)||!ids.length||ids.some(i=>!Number.isInteger(i))||new Set(ids).size!==ids.length)throw Error('Выберите существ рядом с собой');
   const ts=ids.map(i=>{const t=players[i];if(!t||!t.ready||t.dead||t===p||dist(p,t)>1)throw Error('Цель должна быть рядом (1 кл.)');return t});
   use();fx(k==='swordburst'?{kind:'swords',x:p.x,y:p.y}:{kind:'ring',x:p.x,y:p.y,color:cn.col});log(`${p.name} — ${cn.n}`);const dmg=r(cn.die);
   ts.forEach(t=>{const s=save(t,cn.sv,dc,false,cn.sv===1?cvSave(p,t,cn.nocover):0);log(`  ${t.name}: ${SN[cn.sv]} ${s.txt} — ${s.ok?'успех':`провал, ${dmg} ${cn.dt}`}`);if(!s.ok)hurt(t,dmg,cn.dt)});chk();break}
  if(cn&&cn.sv!=null){const t=tgt(cn.rng);use();fx({kind:'dart',from:{x:p.x,y:p.y},to:{x:t.x,y:t.y},color:cn.col,str:1});
   const s=save(t,cn.sv,dc,false,cn.sv===1?cvSave(p,t,cn.nocover):0),d=r(k==='tollthedead'&&t.hp<t.maxhp?12:cn.die);
   log(`${p.name} — ${cn.n} на ${t.name}: ${SN[cn.sv]} ${s.txt} — ${s.ok?'успех':`провал, ${d} ${cn.dt}`}`);if(!s.ok)hurt(t,d,cn.dt);chk();break}
  if(k==='command'){const opt=m.opt;if(!CMDS[opt])throw Error('Выберите команду');const t=tgt(12);if(t.down)throw Error('Цель без сознания и не слышит приказа');use();
   fx({kind:'dart',from:{x:p.x,y:p.y},to:{x:t.x,y:t.y},color:'#ff8fa3',str:1});const s=save(t,4,dc);
   log(`${p.name} — Приказ «${CMDS[opt]}» на ${t.name}: спасбросок Мудрости ${s.txt}${s.ok?' — устоял':' — подчинится в свой следующий ход'}`);if(!s.ok)t.cmd={by:p.id,opt};break}
  if(k==='disguise'){const tk=m.tok;if(tk!=='orig'&&!TOKENS.includes(tk))throw Error('Выберите токен');use();p.disg=tk==='orig'?null:tk;fx({kind:'ring',x:p.x,y:p.y,color:'#d9a6ff'});log(`${p.name} — Маскировка`);break}
  if(k==='magicmissile'){const ids=m.targets;if(!Array.isArray(ids)||ids.length!==3)throw Error('Нужно 3 стрелы');const cnt=new Map();
   ids.forEach(id=>{const t=players[id];if(!t||!t.ready||t.dead||t===p||dist(p,t)>24)throw Error('Цель вне дальности (24 кл.)');if(cover(p,t).blk)throw Error('Цель за стеной: прямого пути нет');cnt.set(id,(cnt.get(id)||0)+1)});
   use();ids.forEach((id,i)=>fx({kind:'dart',from:{x:p.x,y:p.y},to:{x:players[id].x,y:players[id].y},delay:i*130}));
   log(`${p.name} — Волшебная стрела`);mmChain(p,[...cnt].map(([id,n])=>[players[id],n]),0);return bc()}
  if(k==='witchbolt'){const t=tgt(12);use();if(p.conc)endConc(p);p.conc={spell:'witchbolt',target:t.id};p.wbOk=false; // концентрация начинается даже при промахе
   fx({kind:'dart',from:{x:p.x,y:p.y},to:{x:t.x,y:t.y},color:'#bfe3ff',str:1});log(`${p.name} — Ведьмин снаряд на ${t.name} (концентрация)`);
   spAtk(p,t,sp.n,false,(h,cr)=>{let d=0;for(let i=0;i<(cr?4:2);i++)d+=r(12);log(`${h} — ${cr?'КРИТ! ':'попал, '}${d} электричеством`);hurt(t,d,'электричеством');chk()},ab);break}
  if(k==='tasha'){const t=tgt(6);use();if(p.conc)endConc(p);fx({kind:'ring',x:t.x,y:t.y,color:'#b06bff'});
   const s=save(t,4,dc);log(`${p.name} — Смех Таши на ${t.name}: спасбросок Мудрости ${s.txt}${s.ok?' — успех':' — провал: ничком и недееспособен'}`);
   if(!s.ok){t.laugh={by:p.id,dc};t.incap=true;if(t.rage){t.rage=0;log(`${t.name}: ярость прекращается (недееспособен)`)}t.prone=true;p.conc={spell:'tasha',target:t.id}}break}
  if(k==='thunderwave'){use();fx({kind:'wave',x:p.x-1,y:p.y-1,w:3,h:3});log(`${p.name} — Волна грома (радиус 1 кл. вокруг мага)`);const dmg=r(8)+r(8);
   players.filter(t=>t&&t.ready&&!t.dead&&t!==p&&dist(p,t)<=1).forEach(t=>{const dx=Math.sign(t.x-p.x),dy=Math.sign(t.y-p.y);
    const s=save(t,2,dc),d=s.ok?Math.floor(dmg/2):dmg;log(`  ${t.name}: Телосложение ${s.txt} — ${s.ok?'успех':'провал, отброшен'}, ${d} звуком`);
    if(!s.ok)for(let q=0;q<2;q++){const nx=t.x+dx,ny=t.y+dy;if(nx<0||ny<0||nx>=N||ny>=N||blocked(nx,ny)||occ(t,nx,ny))break;t.x=nx;t.y=ny}
    hurt(t,d)});chk();break}
  if(k==='falselife'){use();const v=r(4)+4;p.thp=Math.max(p.thp||0,v);fx({kind:'ring',x:p.x,y:p.y,color:'#8ff'});log(`${p.name} — Псевдожизнь: ${v} врем. хитов (итого ${p.thp})`);break}
  if(k==='curewounds'||k==='healingword'){const cw=k==='curewounds',t=tgt(cw?1:12,true);if(nh(t))throw Error('Цель не может восстанавливать хиты');if(!t.down&&t.hp>=t.maxhp)throw Error('Цель здорова');use();
   const d=cw?r(8)+r(8):r(4)+r(4),h=Math.max(1,d+im),o=t.hp;t.hp=Math.min(t.maxhp,t.hp+h);if(t.down){t.down=false;t.stable=false;t.dsL=t.dsD=0}
   fx({kind:'ring',x:t.x,y:t.y,color:'#6f6'});log(`${p.name} — ${sp.n} на ${t.name}: ${cw?'2d8':'2d4'}=${d}${sg(im)}, +${t.hp-o} хп`);break}
  if(k==='guidingbolt'){const t=tgt(24);use();fx({kind:'dart',from:{x:p.x,y:p.y},to:{x:t.x,y:t.y},color:'#ffe9a3',str:1});
   spAtk(p,t,sp.n,false,(h,cr)=>{let d=0;for(let i=0;i<(cr?8:4);i++)d+=r(6);log(`${h} — ${cr?'КРИТ! ':'попал, '}${d} излучением`);hurt(t,d,'излучением');
    if(!t.dead){t.gb={by:p.id,n:0};log(`  ${t.name}: следующая атака по цели — с преимуществом до конца следующего хода ${p.name}`)}chk()},ab);break}
  if(k==='bless'){const ids=m.targets;if(!Array.isArray(ids)||!ids.length||ids.length>3||new Set(ids).size!==ids.length||ids.some(i=>!Number.isInteger(i)))throw Error('Выберите от 1 до 3 существ');
   const ts=ids.map(i=>players[i]);if(ts.some(t=>!t||!t.ready||t.dead||dist(p,t)>6||cover(p,t).blk))throw Error('Цели в пределах 6 клеток (30 фт) и не за стеной, можно и себя');
   use();if(p.conc)endConc(p,'новая концентрация');ts.forEach(t=>{(t.bless=t.bless||[]).push(p.id)});p.conc={spell:'bless',target:ts[0].id,targets:ids,r0:g.round||1};
   ts.forEach(t=>fx({kind:'ring',x:t.x,y:t.y,color:'#ffe08a'}));log(`${p.name} — Благословение: ${ts.map(t=>t.name).join(', ')} (+1d4 к атакам и спасброскам, концентрация до 10 раундов)`);break}
  if(k==='shieldoffaith'){const t=tgt(12,true);use();if(p.conc)endConc(p);(t.sof=t.sof||[]).push(p.id);p.conc={spell:'shieldoffaith',target:t.id};derive(t);
   fx({kind:'ring',x:t.x,y:t.y,color:'#ffd166'});log(`${p.name} — Щит веры на ${t.name}: +2 КД (концентрация)`);break}
  break}
 case'wbzap':{need('bonus');if(!p.conc||p.conc.spell!=='witchbolt')throw Error('Ведьмин снаряд не поддерживается');if(!p.wbOk)throw Error('Разряд доступен со следующего хода после сотворения');
  const t=players[p.conc.target];if(!t||t.dead||dist(p,t)>12||cover(p,t).blk){endConc(p);log(`Ведьмин снаряд ${p.name} прерван`);break}
  p.bonus=false;p.wbOk=false;fx({kind:'dart',from:{x:p.x,y:p.y},to:{x:t.x,y:t.y},color:'#bfe3ff',str:1});const d=r(12);
  log(`${p.name}: Ведьмин снаряд бьёт ${t.name} — ${d} электричеством`);hurt(t,d,'электричеством');if(alive().length<=1)next();break}
 case'end':next();break;
 default:return}
 bc()}
// ---------- HTTP + WS ----------
setInterval(()=>{if(g.phase!=='battle')return;const now=Date.now(),cur=players[g.order[g.turn]];let ch=false;
 for(const p of players)if(p&&!p.dead&&p.ready&&now-p.last>IDLE){p.dead=true;p.hp=0;ch=true;log(`${p.name} бездействует 5 мин — выбывает`);try{p.ws.close()}catch{}}
 if(g.pend&&(players[g.pend.mover].dead||players[g.pend.reactor].dead)){resolvePend(false);ch=true}
 if(g.phase==='battle'&&(alive().length<=1||(cur&&cur.dead))){next();ch=true}if(ch)bc()},30000); // рассылка только если что-то изменилось
// keep-alive: лёгкий ping-кадр вместо полного состояния; не ответившее соединение закрывается
setInterval(()=>{for(const p of players)if(p&&p.ws.readyState===1){if(p.pong===false){p.ws.terminate();continue}p.pong=false;p.ws.ping()}},25000);
const PAGE=['public/index.html','index.html'].map(f=>path.join(__dirname,f)).find(f=>fs.existsSync(f));
const zlib=require('zlib'),crypto=require('crypto');let HTML=null,GZ=null,TAG='';
if(PAGE){HTML=fs.readFileSync(PAGE);GZ=zlib.gzipSync(HTML,{level:9});TAG='"'+crypto.createHash('md5').update(HTML).digest('hex')+'"'} // страница читается и сжимается один раз при старте
const srv=http.createServer((q,s)=>{
 if(!HTML){s.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});return s.end('index.html не найден: положите его в папку public/ рядом с server.js')}
 if(q.url==='/favicon.ico'){s.writeHead(204);return s.end()}
 if(q.headers['if-none-match']===TAG){s.writeHead(304,{ETag:TAG,'Cache-Control':'no-cache'});return s.end()}
 const gz=/\bgzip\b/.test(q.headers['accept-encoding']||'');
 s.writeHead(200,{'Content-Type':'text/html; charset=utf-8',ETag:TAG,'Cache-Control':'no-cache',Vary:'Accept-Encoding',...(gz?{'Content-Encoding':'gzip'}:{})});s.end(gz?GZ:HTML)});
const wss=new WebSocketServer({server:srv,maxPayload:65536});
wss.on('connection',ws=>{
 const id=players.findIndex(x=>!x);
 if(g.phase!=='lobby'||id<0){ws.send(J({t:'err',m:'Игра уже идёт или мест нет'}));return ws.close()}
 const p=players[id]={id,ws,pong:true,last:Date.now(),ready:false,name:'Игрок'+(id+1),color:`hsl(${id*90+r(40)} 70% 50%)`};
 ws.send(J({t:'init',id,ITEMS,COST,N,SPEED,RACES,FEATS,SPELLS,CANTRIPS,MI,CLASSES,COVER,CMDS,OBST:terrList(),MAXLV}));bc();
 ws.on('close',()=>{if(g.phase==='lobby'){players[id]=null}else if(!p.dead){p.dead=true;p.hp=0;log(`${p.name} отключился`);if(g.pend&&(g.pend.mover===p.id||g.pend.reactor===p.id))resolvePend(false);if(alive().length<=1||players[g.order[g.turn]]===p)next()}
  if(g.phase!=='lobby'&&!players.some(x=>x&&x.ws.readyState===1)){g.phase='over';resetGame()}bc()});
 ws.on('pong',()=>{p.pong=true});
 ws.on('message',raw=>{p.last=Date.now();let m;try{m=JSON.parse(raw)}catch{return}try{handle(p,m)}catch(e){err(p,e.message)}})});
srv.listen(process.env.PORT||3000,()=>console.log('http://localhost:3000'));
