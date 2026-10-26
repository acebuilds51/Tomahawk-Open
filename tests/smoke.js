// Smoke test: runs index.html and setup.html against apps-script/Code.gs on a simulated Google Sheet.
// Never touches the live Sheet. Usage: cd tests && npm install jsdom && node smoke.js
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
const ctx={PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>{props[k]=v;}})},
 SpreadsheetApp:{getActive:()=>({getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new Sheet())}),flush(){}},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({setMimeType(){return this;},text:t})},Date,JSON,Math,Number,String,Object,Array,RegExp};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'apps-script','Code.gs'),'utf8'),ctx);
// The live Sheet before this update: 5-column Scores with Oct 12's real round (from the backup).
const OCT12={'1707':[3,4,4,4,2,3,4,3,4,4,3,4,4,5,3,4,4,4],'905':[4,4,4,4,3,4,4,3,4,4,3,4,4,4,3,4,4,4],'906':[3,3,3,4,3,4,3,3,4,4,3,4,3,4,3,3,3,4],
 '205':[3,4,4,4,3,4,4,3,4,4,3,4,4,4,3,4,3,3],'505':[4,4,4,5,3,4,4,3,5,4,3,4,4,5,3,4,4,5],'1605':[4,4,4,4,3,4,4,3,4,4,3,4,4,4,3,4,4,5]};
sheets.Scores=new Sheet();sheets.Scores.appendRow(['Room','Hole','Strokes','Saved at','Drive']);
for(const room in OCT12)OCT12[room].forEach((v,i)=>sheets.Scores.appendRow([room,i+1,v,new Date('2026-10-12T20:00:00Z'),'X'+(i===0&&room==='205'?'|ghost':'')]));
ctx.setup();
let offline=false;
async function fakeFetch(url,opts){if(offline)throw new Error('offline');
  const u=new URL(url);const parameter=Object.fromEntries(u.searchParams);
  const out=opts&&opts.method==='POST'?ctx.doPost({postData:{contents:opts.body}}):ctx.doGet({parameter});
  return {ok:true,json:async()=>JSON.parse(out.text)};}
const post=b=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(b)}}).text);
// ---- run the pages ----
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const shtml=fs.readFileSync(path.join(ROOT,'setup.html'),'utf8'),sscript=shtml.match(/<script>([\s\S]*?)<\/script>/)[1];
function open(h,s,q){const dom=new JSDOM(h,{runScripts:'outside-only',url:'https://acebuilds51.github.io/x/'+(q||'')});dom.window.fetch=fakeFetch;dom.window.scrollTo=()=>{};dom.window.eval(s);return dom.window;}
const phone=q=>open(html,script,q);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;const check=(name,ok,got)=>{console.log((ok?'PASS ':'FAIL ')+name+(ok?'':'  got: '+got));if(!ok)fails++;};
const OLD='2026-10-12-roommates';
(async()=>{
 // ---------- Migration of the Oct 12 round ----------
 check('setup files old scores under the Oct 12 event',sheets.Scores.rows.slice(1).every(r=>r[5]===OLD)&&sheets.Scores.rows.length===109,sheets.Scores.rows.length+' '+JSON.stringify(sheets.Scores.rows[1]));
 check('Courses seeded (Meadowlands, Blackmoor)',sheets.Courses.rows.length===3,JSON.stringify(sheets.Courses.rows.map(r=>r[0])));
 check('Oct 12 is the current event and final',props.CURRENT_EVENT===OLD&&JSON.parse(ctx.doGet({parameter:{}}).text).event.status==='final','');
 ctx.setup(); check('running setup twice changes nothing',sheets.Events.rows.length===2&&sheets.Courses.rows.length===3&&sheets.Scores.rows.length===109,'');
 let w=phone(); await wait(50);
 const q=s=>w.document.querySelector(s),qa=s=>[...w.document.querySelectorAll(s)];
 const board=win=>[...(win||w).document.querySelectorAll('.lr')].map(r=>r.querySelector('.pos').textContent+' '+r.querySelector('b').textContent+' '+r.querySelector('.sc').textContent).join(' | ');
 check('Oct 12 results show (906 won)',board().startsWith('1 Room 906'),board());
 check('final event shows "Final results" and no scorekeeper button',w.document.body.textContent.includes('Final results')&&!q('[data-act=keeper-on]'),'');
 check('a final event refuses new scores',post({action:'score',room:'905',hole:1,strokes:3,drive:'Fitz'}).error==='event_final','');
 check('old ghost-hole save still reads',[...w.document.querySelectorAll('.team')].find(t=>t.textContent.includes('Room 205')).querySelector('.holes').textContent.includes('1G'),'');
 // ---------- Committee: courses and a new event ----------
 check('saving a course needs the PIN',post({action:'saveCourse',course:{}}).error==='bad_pin','');
 const par=[4,4,3,5,4,4,3,4,5,4,4,3,5,4,4,3,4,5],hcp=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18];
 check('bad hole handicaps are refused',post({action:'saveCourse',pin:'2468',course:{name:'Test GC',par:par,hcp:hcp.map(()=>1)}}).error==='course_hcp','');
 check('a good course saves',post({action:'saveCourse',pin:'2468',course:{name:'Test GC',place:'Here',par:par,hcp:hcp}}).ok===true&&sheets.Courses.rows.length===4,'');
 // Create the event through setup.html like the committee would
 const s=open(shtml,sscript); await wait(30);
 const sq=x=>s.document.querySelector(x),sqa=x=>[...s.document.querySelectorAll(x)];
 const type=(el,v)=>{el.value=v;el.dispatchEvent(new s.Event('input',{bubbles:true}));};
 type(sq('#pin'),'1111'); sq('[data-act=unlock]').click(); await wait(30);
 check('setup page: wrong PIN stays locked',sq('.msg').textContent.includes('Wrong committee PIN')&&sq('#pin'),'');
 type(sq('#pin'),'2468'); sq('[data-act=unlock]').click(); await wait(30);
 check('setup page: right PIN shows events and courses',s.document.body.textContent.includes('On the scoreboard now')&&s.document.body.textContent.includes('Test GC'),'');
 sq('[data-act=new]').click(); await wait(10);
 check('new event copies the last rooms',sqa('.room').length===6&&sq('[data-path="rooms.0.p.0"]').value==='Rock','');
 type(sq('[data-path="name"]'),'Roommates Scramble 2027'); type(sq('[data-path="date"]'),'2027-10-15');
 const cs=sq('[data-path="course"]'); cs.value='Test GC'; cs.dispatchEvent(new s.Event('change',{bubbles:true}));
 const st=sq('[data-path="rooms.1.start"]'); st.value='10'; st.dispatchEvent(new s.Event('change',{bubbles:true}));   // Room 905 starts on the back
 type(sq('[data-path="rooms.2.p.3"]'),'Chub-Rock');                                                                        // 906 is a foursome again
 sq('[data-act=room-del][data-i="5"]').click(); await wait(5);                                                              // drop room 1605
 sq('[data-act=room-add]').click(); await wait(5);
 type(sq('[data-path="rooms.5.id"]'),'777'); ['A1','B2','C3'].forEach((n,j)=>type(sq('[data-path="rooms.5.p.'+j+'"]'),n));
 type(sq('[data-path="rooms.5.strokes"]'),'2.5');
 sq('[data-act=save-event]').click(); await wait(40);
 const NEW=props.CURRENT_EVENT;
 check('setup page saved the event and put it on the scoreboard',NEW==='2027-10-15-roommates-scramble-2027'&&sq('.msg.ok'),NEW);
 const ev=JSON.parse(ctx.doGet({parameter:{}}).text).event;
 check('event config saved right',ev.course==='Test GC'&&ev.par.join()===par.join()&&ev.rooms.length===6&&ev.rooms[1].start===10&&ev.rooms[2].p.length===4&&ev.rooms[5].id==='777'&&ev.rooms[5].strokes===2.5,JSON.stringify(ev.rooms));
 // ---------- Scoring the new event ----------
 w=phone(); await wait(50);
 check('scoreboard switched to the new event',w.document.querySelector('h1').textContent==='Roommates Scramble 2027'&&w.document.body.textContent.includes('Test GC'),w.document.querySelector('h1').textContent);
 w.document.querySelector('[data-act=keeper-on]').click();
 w.document.querySelector('[data-act=pick][data-t="905"]').click();
 const sel=()=>w.document.querySelector('#hole-sel');
 check('back-nine room starts on hole 10',sel().value==='10'&&sel().options[0].value==='10'&&sel().options[9].value==='1','first '+sel().options[0].value);
 w.document.querySelector('[data-act=save-hole]').click(); await wait(10);
 const alert=w.document.querySelector('[role=alert]');
 check('no-drive error shows right above Save',alert&&alert.textContent.includes('Tap whose drive')&&alert.nextElementSibling===w.document.querySelector('[data-act=save-hole]'),alert&&alert.textContent);
 check('drive buttons are highlighted',!!w.document.querySelector('.drives.pickme'),'');
 const drive=p=>w.document.querySelector('[data-act=drive][data-p="'+p+'"]').click();
 drive('Fitz'); check('picking a drive clears the error',!w.document.querySelector('[role=alert]'),'');
 w.document.querySelector('[data-act="v-"]').click(); w.document.querySelector('[data-act=save-hole]').click(); await wait(30);
 const rows=()=>sheets.Scores.rows.filter(r=>r[5]===NEW).map(r=>[r[0],r[1],r[2],r[4]]);
 check('score saved under the new event',JSON.stringify(rows())==='[["905",10,3,"Fitz"]]',JSON.stringify(rows()));
 check('next hole is 11',sel().value==='11',sel().value);
 check('leaderboard shows Thru 1* for the back-nine room',board().includes('Room 905'),board());
 check('Thru shows the star',[...w.document.querySelectorAll('.lr')].find(r=>r.textContent.includes('Room 905')).querySelector('.th').textContent==='Thru 1*','');
 check('Oct 12 scores untouched',sheets.Scores.rows.filter(r=>r[5]===OLD).length===108,'');
 // finish the back nine and wrap to the front
 for(let i=0;i<8;i++){drive(i%2?'Doc':'Blanch'); w.document.querySelector('[data-act=save-hole]').click(); await wait(15);}
 check('after 18 the back-nine room wraps to hole 1',sel().value==='1',sel().value);
 // offline save then reconnect
 offline=true; drive('Scoobie'); w.document.querySelector('[data-act=save-hole]').click(); await wait(30);
 check('offline save waits',w.document.body.textContent.includes('1 save waiting'),'');
 offline=false; w.dispatchEvent(new w.Event('online')); await wait(60);
 check('after reconnect it reached the Sheet',rows().some(r=>r[0]==='905'&&r[1]===1&&r[3]==='Scoobie'),JSON.stringify(rows()));
 // ghost + strokes on the new event: room 777 has 2.5 strokes, no ghost holes
 w.document.querySelector('[data-act=pick][data-t="777"]').click();
 check('room with 0 ghost holes has no ghost buttons',!w.document.querySelector('[data-act=ghost-yes]'),'');
 drive('A1'); w.document.querySelector('[data-act=save-hole]').click(); await wait(30);   // hole 1 par 4 at par
 check('2½ strokes come off (777 net −2½)',board().includes('Room 777 −2½'),board());
 // ---------- History ----------
 const h=phone('?event='+OLD); await wait(50);
 check('history link shows the Oct 12 round read-only',h.document.querySelector('h1').textContent==='Roommates Scramble'&&h.document.body.textContent.includes('looking at a past event')&&!h.document.querySelector('[data-act=keeper-on]'),'');
 check('history board matches Oct 12',board(h).startsWith('1 Room 906'),board(h));
 h.document.querySelector('[data-act=past]').click(); await wait(30);
 const links=[...h.document.querySelectorAll('.rules a')].map(a=>a.textContent);
 check('Past events lists both events, newest first',links.join('|')==='Roommates Scramble 2027|Roommates Scramble',links.join('|'));
 // second phone on the current event sees the same
 const w2=phone(); await wait(60);
 check('phone 2 sees the same board',board(w2)===board(),board(w2)+' vs '+board());
 // committee marks it final, then resetRound only touches the current event
 check('mark final works',post({action:'setStatus',pin:'2468',id:NEW,status:'final'}).ok&&post({action:'score',event:NEW,room:'905',hole:2,strokes:4,drive:'Fitz'}).error==='event_final','');
 ctx.resetRound();
 check('resetRound clears only the current event',sheets.Scores.rows.filter(r=>r[5]===NEW).length===0&&sheets.Scores.rows.filter(r=>r[5]===OLD).length===108,'');
 const rc=JSON.parse(ctx.doGet({parameter:{game:'rc'}}).text); check('Ryder Cup GET unaffected',rc.matches.length===6,'');
 console.log(fails?fails+' FAILED':'All passed');
 process.exit(fails?1:0);
})();
