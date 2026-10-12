// Smoke test: runs index.html against apps-script/Code.gs on a simulated Google Sheet. Never touches the live Sheet.
// Usage: cd tests && npm install jsdom && node smoke.js
const fs=require('fs'),vm=require('vm'),{JSDOM}=require('jsdom');
const path=require('path');const ROOT=path.join(__dirname,'..');
// ---- fake Google Sheets to run the real Code.gs ----
function Sheet(){this.rows=[];}
Sheet.prototype={getLastRow(){return this.rows.length;},appendRow(r){this.rows.push(r.slice());},deleteRow(i){this.rows.splice(i-1,1);},deleteRows(i,n){this.rows.splice(i-1,n);},
 getRange(r,c,nr,nc){const sh=this;if(typeof r==='string')return {setNumberFormat(){}};nr=nr||1;nc=nc||1;
  return {getValue(){const row=sh.rows[r-1]||[];return row[c-1]===undefined?'':row[c-1];},
   getValues(){const o=[];for(let i=0;i<nr;i++){const row=sh.rows[r-1+i]||[];o.push(Array.from({length:nc},(_,j)=>row[c-1+j]===undefined?'':row[c-1+j]));}return o;},
   setValues(v){v.forEach((row,i)=>{const t=sh.rows[r-1+i]=sh.rows[r-1+i]||[];row.forEach((x,j)=>t[c-1+j]=x);});},
   setValue(x){for(let i=0;i<nr;i++)for(let j=0;j<nc;j++){const t=sh.rows[r-1+i]=sh.rows[r-1+i]||[];t[c-1+j]=x;}},
   clearContent(){for(let i=0;i<nr;i++)for(let j=0;j<nc;j++)sh.rows[r-1+i][c-1+j]='';}};}};
const sheets={};
const props={COMMITTEE_PIN:'2468'};
const ctx={PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null})},SpreadsheetApp:{getActive:()=>({getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new Sheet())}),flush(){}},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({setMimeType(){return this;},text:t})},Date,JSON,Math,Number,String,Object};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'apps-script','Code.gs'),'utf8'),ctx);
// Simulate a Sheet from before this update: a 4-column Scores tab with an old row, and no Bonus tab.
sheets.Scores=new Sheet();sheets.Scores.appendRow(['Room','Hole','Strokes','Saved at']);sheets.Scores.appendRow(['1605',1,4,new Date()]);
ctx.setup();
let offline=false;
async function fakeFetch(url,opts){if(offline)throw new Error('offline');
  const u=new URL(url);const parameter=Object.fromEntries(u.searchParams);
  const out=opts&&opts.method==='POST'?ctx.doPost({postData:{contents:opts.body}}):ctx.doGet({parameter});
  return {ok:true,json:async()=>JSON.parse(out.text)};}
// ---- run the page ----
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function phone(){const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://acebuilds51.github.io/x/'});dom.window.fetch=fakeFetch;dom.window.scrollTo=()=>{};dom.window.eval(script);return dom.window;}
const w=phone();
const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const board=win=>[...(win||w).document.querySelectorAll('.lr')].map(r=>r.querySelector('.pos').textContent+' '+r.querySelector('b').textContent+' '+r.querySelector('.sc').textContent).join(' | ');
const card=id=>qa('.team').find(t=>t.querySelector('.tn').textContent.startsWith('Room '+id));
const pickHole=n=>{q('#hole-sel').value=String(n);q('#hole-sel').dispatchEvent(new w.Event('change',{bubbles:true}));};
const drive=p=>q('[data-act=drive][data-p="'+p+'"]').click();
const rows=()=>JSON.stringify(sheets.Scores.rows.slice(1).filter(r=>r.join('')).map(r=>[r[0],r[1],r[2],r[4]]));
let fails=0;const check=(name,ok,got)=>{console.log((ok?'PASS ':'FAIL ')+name+(ok?'':'  got: '+got));if(!ok)fails++;};
(async()=>{
 await wait(50);
 check('setup adds Drive column and Bonus tab',sheets.Scores.rows[0][4]==='Drive'&&sheets.Bonus.rows.length===7,JSON.stringify(sheets.Scores.rows[0])+' / '+(sheets.Bonus&&sheets.Bonus.rows.length));
 check('old 4-column score still loads',card('1605').querySelector('.stats').textContent.includes('Thru 1'),card('1605').querySelector('.stats').textContent);
 q('[data-act=keeper-on]').click();
 q('[data-act=pick][data-t="905"]').click();
 q('[data-act="v-"]').click(); q('[data-act=save-hole]').click(); await wait(20);
 check('save without a drive is blocked',q('.msg').textContent.includes('whose drive')&&!rows().includes('"905",1'),q('.msg').textContent+' '+rows());
 drive('Fitz'); q('[data-act=save-hole]').click(); await wait(30);              // hole 1: 3, Fitz
 drive('Fitz'); q('[data-act=save-hole]').click(); await wait(30);              // hole 2: 4, Fitz
 drive('Doc'); q('[data-act=save-hole]').click(); await wait(30);               // hole 3: 4, Doc
 check('drives saved to the Sheet',rows().includes('["905",1,3,"Fitz"]')&&rows().includes('["905",3,4,"Doc"]'),rows());
 const drv=id=>[...card(id).querySelector('.drv').querySelectorAll('span')].slice(1).map(s=>s.textContent).join(', ');
 check('drive counts on the card',drv('905')==='Fitz 2, Blanch 0, Scoobie 0, Doc 1',drv('905'));
 // Strokes: 905 gets 1.5. Holes 1-3 = 3,4,4 on par 4,4,4 -> -1 to par -> net -2½
 check('strokes come off the total (905 net −2½)',board().includes('Room 905 −2½'),board());
 check('card shows their strokes and net',card('905').querySelector('.stats').textContent.includes('Their strokes 1½')&&card('905').querySelector('.stats').textContent.includes('Net −2½'),card('905').querySelector('.stats').textContent);
 // Threesomes show 3 drive buttons and their note
 q('[data-act=pick][data-t="906"]').click();
 check('threesome has 3 drive buttons',qa('[data-act=drive]').length===3,qa('[data-act=drive]').map(b=>b.dataset.p).join(','));
 check('threesome note on the card',card('906').textContent.includes('extra ball every shot'),'');
 // Ghost holes: 205 gets 1 per side
 q('[data-act=pick][data-t="205"]').click(); pickHole(1);
 q('[data-act="v+"]').click(); drive('Ace'); q('[data-act=ghost-yes]').click(); q('[data-act=save-hole]').click(); await wait(30);  // 205 hole 1: 5, ghost
 check('ghost hole saved in the Drive column',rows().includes('["205",1,5,"Ace|ghost"]'),rows());
 check('drive still counts with a ghost hole',drv('205').includes('Ace 1'),drv('205'));
 check('card marks the G and shows front used',card('205').querySelector('.holes').textContent.includes('1G')&&card('205').textContent.includes('Front used (#1)'),card('205').textContent.slice(0,300));
 check('205 board score is +1 (no strokes)',board().includes('Room 205 +1'),board());
 pickHole(2); drive('Nater'); q('[data-act=ghost-yes]').click();
 check('second front-9 ghost hole is blocked',q('.msg').textContent.includes('no ghost holes left on the front 9')&&q('[data-act=ghost-yes]').getAttribute('aria-pressed')==='false',q('.msg').textContent);
 pickHole(10); drive('Nater'); q('[data-act=ghost-yes]').click(); q('[data-act=save-hole]').click(); await wait(30);
 check('back-9 ghost hole allowed',rows().includes('["205",10,4,"Nater|ghost"]')&&card('205').textContent.includes('Back used (#10)'),rows());
 pickHole(1);
 check('existing ghost hole stays selected',q('[data-act=ghost-yes]').getAttribute('aria-pressed')==='true',q('[data-act=ghost-yes]').getAttribute('aria-pressed'));
 // 905 gets 3 any time
 q('[data-act=pick][data-t="905"]').click(); pickHole(5); drive('Blanch'); q('[data-act=ghost-yes]').click(); q('[data-act=save-hole]').click(); await wait(30);
 check('905 ghost count 1 of 3',card('905').textContent.includes('1 of 3 used (#5)'),card('905').textContent.slice(0,400));
 pickHole(5); q('[data-act=clear-hole]').click(); await wait(30);
 // offline save then recover
 offline=true; q('[data-act=pick][data-t="905"]').click(); q('[data-act="v-"]').click(); drive('Blanch'); q('[data-act=save-hole]').click(); await wait(30);
 check('offline save waits',qa('.sub')[1].textContent.includes('1 save waiting'),qa('.sub')[1].textContent);
 offline=false; w.dispatchEvent(new w.Event('online')); await wait(60);
 check('after reconnect the drive reached the Sheet',rows().includes('["905",4,4,"Blanch"]'),rows());   // hole 4 is a par 5
 // update existing hole changes the drive; remove a hole
 pickHole(1);
 check('existing hole preselects its drive',q('[data-act=drive][aria-pressed="true"]').dataset.p==='Fitz',q('[data-act=drive][aria-pressed="true"]')&&q('[data-act=drive][aria-pressed="true"]').dataset.p);
 drive('Scoobie'); q('[data-act=save-hole]').click(); await wait(30);
 pickHole(2); q('[data-act=clear-hole]').click(); await wait(30);
 check('update + remove',rows().includes('["905",1,3,"Scoobie"]')&&!rows().includes('"905",2,'),rows());
 // short-on-drives warning late in the round
 q('[data-act=pick][data-t="1707"]').click();
 for(let h=1;h<=12;h++){pickHole(h);drive('Rock');q('[data-act=save-hole]').click();await wait(15);}
 check('warning when players are short',(card('1707').querySelector('.need')||{}).textContent==='6 holes left, still need: Opie ×2, Gumby ×2, Teo ×2',(card('1707').querySelector('.need')||{}).textContent);
 pickHole(13);drive('Rock');q('[data-act=save-hole]').click();await wait(15);
 check('impossible-to-finish warning',(card('1707').querySelector('.need')||{}).textContent.includes('Not enough holes left'),(card('1707').querySelector('.need')||{}).textContent);
 // second phone sees everything
 const w2=phone(); await wait(60);
 check('phone 2 sees same board',board(w2)===board(),board(w2)+' vs '+board());
 check('phone 2 sees drives and marks',[...w2.document.querySelectorAll('.drv')].some(d=>d.textContent.includes('Scoobie 1'))&&w2.document.body.textContent.includes('Front used (#1)'),'');
 const res=JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action:'bonus',bonus:{'905':{ticks:[1,2,3]}},pin:'2468 '})}}).text);
 check('PIN with a stray space still works',res.ok===true,JSON.stringify(res).slice(0,60));
 delete props.COMMITTEE_PIN;
 const res2=JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action:'bonus',bonus:{},pin:'2468'})}}).text);
 check('no PIN set in the Sheet blocks ticks',res2.ok===false&&res2.error==='no_pin',JSON.stringify(res2));
 props.COMMITTEE_PIN='2468';
 // Ryder Cup on the same script still answers
 const rc=JSON.parse(ctx.doGet({parameter:{game:'rc'}}).text); check('ryder cup GET unaffected',rc.matches.length===6,JSON.stringify(rc).slice(0,60));
 ctx.resetRound();
 check('resetRound clears scores, drives, ticks, ghosts',sheets.Scores.rows.filter(r=>r.join('')).length===1&&sheets.Bonus.rows.slice(1).every(r=>r[1]===''&&r[2]===''),rows()+' '+JSON.stringify(sheets.Bonus.rows));
 console.log(fails?fails+' FAILED':'All passed');
 process.exit(fails?1:0);
})();
