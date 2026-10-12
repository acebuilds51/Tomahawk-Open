// Smoke test: runs index.html against apps-script/Code.gs on a simulated Google Sheet. Never touches the live Sheet.
// Usage: cd tests && npm install jsdom && node smoke.js
const fs=require('fs'),vm=require('vm'),{JSDOM}=require('jsdom');
const path=require('path');const ROOT=path.join(__dirname,'..');
// ---- fake Google Sheets to run the real Code.gs ----
function Sheet(){this.rows=[];}
Sheet.prototype={getLastRow(){return this.rows.length;},appendRow(r){this.rows.push(r.slice());},deleteRow(i){this.rows.splice(i-1,1);},
 getRange(r,c,nr,nc){const sh=this;if(typeof r==='string')return {setNumberFormat(){}};nr=nr||1;nc=nc||1;
  return {getValues(){const o=[];for(let i=0;i<nr;i++){const row=sh.rows[r-1+i]||[];o.push(Array.from({length:nc},(_,j)=>row[c-1+j]===undefined?'':row[c-1+j]));}return o;},
   setValues(v){v.forEach((row,i)=>{const t=sh.rows[r-1+i]=sh.rows[r-1+i]||[];row.forEach((x,j)=>t[c-1+j]=x);});},
   setValue(x){for(let i=0;i<nr;i++)for(let j=0;j<nc;j++){const t=sh.rows[r-1+i]=sh.rows[r-1+i]||[];t[c-1+j]=x;}},
   clearContent(){for(let i=0;i<nr;i++)for(let j=0;j<nc;j++)sh.rows[r-1+i][c-1+j]='';}};}};
const sheets={};
const ctx={SpreadsheetApp:{getActive:()=>({getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new Sheet())}),flush(){}},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({setMimeType(){return this;},text:t})},Date,JSON,Math,Number,String};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'apps-script','Code.gs'),'utf8'),ctx);ctx.setup();
let offline=false;
async function fakeFetch(url,opts){if(offline)throw new Error('offline');
  const out=opts&&opts.method==='POST'?ctx.doPost({postData:{contents:opts.body}}):ctx.doGet();
  return {ok:true,json:async()=>JSON.parse(out.text)};}
// ---- run the page ----
let html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://acebuilds51.github.io/x/'});const w=dom.window;
w.fetch=fakeFetch;w.scrollTo=()=>{};
w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const board=()=>qa('.lr').map(r=>r.querySelector('.pos').textContent+' '+r.querySelector('b').textContent+' '+r.querySelector('.sc').textContent).join(' | ');
(async()=>{
 await wait(50);
 console.log('live line:',qa('.sub')[1].textContent);
 q('[data-act=keeper-on]').click();
 q('[data-act=pick][data-t="905"]').click();
 q('[data-act="v-"]').click(); q('[data-act=save-hole]').click(); await wait(30);   // hole 1 par4 -> 3
 q('[data-act=save-hole]').click(); await wait(30);                                 // hole 2 par 4
 q('[data-act=pick][data-t="205"]').click(); q('[data-act="v+"]').click(); q('[data-act=save-hole]').click(); await wait(30); // hole1 5
 console.log('sheet rows:',JSON.stringify(sheets.Scores.rows.slice(1).map(r=>r.slice(0,3))));
 console.log('board:',board());
 // offline save then recover
 offline=true; q('[data-act=pick][data-t="905"]').click(); q('[data-act="v-"]').click(); q('[data-act=save-hole]').click(); await wait(30);
 console.log('offline line:',qa('.sub')[1].textContent,'| board:',board());
 offline=false; w.dispatchEvent(new w.Event('online')); await wait(50);
 console.log('after reconnect rows:',sheets.Scores.rows.length-1,'| line:',qa('.sub')[1].textContent);
 // update existing hole, remove hole
 q('#hole-sel').value='1'; q('#hole-sel').dispatchEvent(new w.Event('change',{bubbles:true}));
 q('[data-act="v+"]').click(); q('[data-act=save-hole]').click(); await wait(30);
 q('#hole-sel').value='2'; q('#hole-sel').dispatchEvent(new w.Event('change',{bubbles:true}));
 q('[data-act=clear-hole]').click(); await wait(30);
 console.log('after update+remove:',JSON.stringify(sheets.Scores.rows.slice(1).map(r=>r.slice(0,3))));
 // ticks
 q('[data-act=setup-toggle]').click(); q('[data-act="tk+"][data-t="205"]').click(); q('[data-act=save-ticks]').click(); await wait(30);
 console.log('ticks:',JSON.stringify(sheets.Ticks.rows),'| board:',board());
 // second phone sees everything
 const dom2=new JSDOM(html,{runScripts:'outside-only',url:'https://acebuilds51.github.io/x/'});dom2.window.fetch=fakeFetch;dom2.window.scrollTo=()=>{};
 dom2.window.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]); await wait(50);
 console.log('phone 2 board:',[...dom2.window.document.querySelectorAll('.lr')].slice(0,3).map(r=>r.textContent).join(' || '));
 ctx.resetRound(); console.log('after reset rows:',sheets.Scores.rows.filter(r=>r.join('')).length-1, JSON.stringify(sheets.Ticks.rows.slice(1)));
 process.exit(0);
})();
