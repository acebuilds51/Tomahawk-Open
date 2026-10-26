// Smoke test: runs ryder-cup.html against apps-script/Code.gs on a simulated Google Sheet. Never touches the live Sheet.
// Usage: cd tests && npm install jsdom && node smoke-rc.js
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
const ctx={PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>{props[k]=v;}})},SpreadsheetApp:{getActive:()=>({getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new Sheet())}),flush(){}},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({setMimeType(){return this;},text:t})},Date,JSON,Math,Number,String};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'apps-script','Code.gs'),'utf8'),ctx);ctx.setup();
let offline=false;
async function fakeFetch(url,opts){if(offline)throw new Error('offline');
  const u=new URL(url);const parameter=Object.fromEntries(u.searchParams);
  const out=opts&&opts.method==='POST'?ctx.doPost({postData:{contents:opts.body}}):ctx.doGet({parameter});
  return {ok:true,json:async()=>JSON.parse(out.text)};}
// ---- run the page ----
const html=fs.readFileSync(path.join(ROOT,'ryder-cup.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function phone(){const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://acebuilds51.github.io/x/'});dom.window.fetch=fakeFetch;dom.window.scrollTo=()=>{};dom.window.eval(script);return dom.window;}
const w=phone();
const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const tally=win=>[...win.document.querySelectorAll('.side .num')].map(n=>n.textContent).join('-')+' | '+win.document.querySelector('.status').textContent;
const chips=win=>[...win.document.querySelectorAll('.chip b')].map(b=>b.textContent).join(' ');
const pickHole=n=>{q('#hole-sel').value=String(n);q('#hole-sel').dispatchEvent(new w.Event('change',{bubbles:true}));};
const setScore=(r,b)=>{ // steppers start at par; move them to r and b
  const cur=()=>[...qa('.step .v')].map(v=>+v.textContent);
  while(cur()[0]<r)q('[data-act="r+"]').click(); while(cur()[0]>r)q('[data-act="r-"]').click();
  while(cur()[1]<b)q('[data-act="b+"]').click(); while(cur()[1]>b)q('[data-act="b-"]').click();};
let fails=0;const check=(name,ok,got)=>{console.log((ok?'PASS ':'FAIL ')+name+(ok?'':'  got: '+got));if(!ok)fails++;};
(async()=>{
 await wait(50);
 check('matchups load from the Sheet',q('.pair .rn').textContent.includes('Brent “Angelo” & Kurt “Doc”'),q('.pair .rn').textContent);
 check('live line shows',qa('.sub').some(s=>s.textContent.includes('Live')),qa('.sub').map(s=>s.textContent).join('/'));
 q('[data-act=keeper-on]').click();
 // Match 1: Red wins holes 1-3, halves 4-16 -> Red wins 3&2 after 16
 q('[data-act=pick][data-i="0"]').click();
 for(let h=1;h<=16;h++){pickHole(h);setScore(h<=3?3:4,4);q('[data-act=save-hole]').click();await wait(20);}
 check('Sheet has 16 rows for match 1',sheets['RC Scores'].rows.length-1===16,sheets['RC Scores'].rows.length-1);
 check('match 1 decided 3&2',q('.mstat').textContent==='Red wins 3&2',q('.mstat').textContent);
 // Match 2: Blue 1 UP thru 1
 q('[data-act=pick][data-i="1"]').click(); pickHole(1); setScore(5,4); q('[data-act=save-hole]').click(); await wait(20);
 check('tally after M1 won, M2 in progress',tally(w)==='1-0 | Red leads 1–0',tally(w));
 check('chips',chips(w).startsWith('3&2 1 UP – –'),chips(w));
 // Offline save queues, then reconnects
 offline=true; pickHole(2); setScore(5,4); q('[data-act=save-hole]').click(); await wait(30);   // Blue wins hole 2
 check('offline save waits',qa('.sub').some(s=>s.textContent.includes('1 save waiting')),qa('.sub').map(s=>s.textContent).join('/'));
 offline=false; w.dispatchEvent(new w.Event('online')); await wait(60);
 check('after reconnect Blue 2 UP',w.document.querySelectorAll('.mstat')[1].textContent==='Blue 2 UP',w.document.querySelectorAll('.mstat')[1].textContent);
 // Update then remove a hole
 pickHole(2); setScore(4,4); q('[data-act=save-hole]').click(); await wait(20);
 check('update hole -> Blue 1 UP',w.document.querySelectorAll('.mstat')[1].textContent==='Blue 1 UP',w.document.querySelectorAll('.mstat')[1].textContent);
 pickHole(2); q('[data-act=clear-hole]').click(); await wait(20);
 check('removed hole gone from Sheet',!sheets['RC Scores'].rows.some(r=>r[0]===2&&r[1]===2),JSON.stringify(sheets['RC Scores'].rows.filter(r=>r[0]===2)));
 // Change who tees off on 7 for match 3 Red and swap a player
 const setPin=v=>{const p=q('#pin');p.value=v;p.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const swapAlt=()=>{q('[data-act=setup-toggle]').click();const altSel=q('select[data-set="2.redAlt"]'); altSel.value='1'; altSel.dispatchEvent(new w.Event('change',{bubbles:true}));};
 swapAlt(); q('[data-act=save-setup]').click(); await wait(20);
 check('matchups need a PIN',q('.msg').textContent.includes('Enter the committee PIN'),q('.msg').textContent);
 setPin('0000'); q('[data-act=save-setup]').click(); await wait(40);
 check('wrong PIN leaves matchups alone',q('.msg').textContent.includes('Wrong committee PIN')&&sheets['RC Matches'].rows[3][6]===1,q('.msg').textContent+' '+JSON.stringify(sheets['RC Matches'].rows[3]));
 swapAlt(); setPin('2468'); q('[data-act=save-setup]').click(); await wait(40);
 check('RC Matches tab updated',sheets['RC Matches'].rows[3][6]===2,JSON.stringify(sheets['RC Matches'].rows[3]));
 q('[data-act=pick][data-i="2"]').click(); pickHole(7);
 check('hole 7 tee shot follows setup',q('.tee').textContent.includes('Pat Ryan “Flyin Pat”'),q('.tee').textContent);
 // Duplicate player is blocked
 q('[data-act=setup-toggle]').click();
 const s0=q('select[data-set="0.red.0"]'); s0.value='Nate'; s0.dispatchEvent(new w.Event('change',{bubbles:true}));
 q('[data-act=save-setup]').click(); await wait(10);
 check('duplicate player blocked',q('.msg').textContent.includes('picked in two spots'),q('.msg').textContent);
 // A second phone sees everything
 const w2=phone(); await wait(60);
 check('phone 2 sees tally',tally(w2)==='1-0 | Red leads 1–0',tally(w2));
 // Roommates still works on the same script
 const rm=JSON.parse(ctx.doGet().text); check('roommates GET unaffected',rm.event&&Object.keys(rm.scores).length===6,JSON.stringify(rm).slice(0,80));
 ctx.resetRyderCup(); check('resetRyderCup clears scores, keeps matchups',sheets['RC Scores'].rows.length===1&&sheets['RC Matches'].rows.length===7,sheets['RC Scores'].rows.length+'/'+sheets['RC Matches'].rows.length);
 console.log(fails?fails+' FAILED':'All passed');
 process.exit(fails?1:0);
})();
