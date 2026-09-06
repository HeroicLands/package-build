import fs from "node:fs"; import path from "node:path"; import matter from "gray-matter";
const repos=["harn-ensemble","sohl-thalorna","sohl-kethira-basic","Song-of-Heroic-Lands-FoundryVTT"];
const miss={structure:0,"weight.base":0,"weight.calc":0,reachBase:0,bodyScaleBase:0,personalFatigue:0};
let beings=0, withBody=0, cmm=0, mp=0, cmmNonStr=0;
for(const r of repos){
  const root=`/Users/tomr/dev/github/${r}/assets/content`; if(!fs.existsSync(root))continue;
  const files=[]; (function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); e.isDirectory()?w(p):e.name.endsWith(".md")&&files.push(p);}})(root);
  for(const f of files){ let fm; try{fm=matter(fs.readFileSync(f,"utf8")).data;}catch{continue;}
    if(fm?.type!=="being")continue; beings++;
    const b=fm.sohl?.body; if(!b||typeof b!=="object")continue; withBody++;
    if(b.structure===undefined)miss.structure++;
    const w=b.weight||{};
    if(typeof b.weight!=="object"||w.base===undefined)miss["weight.base"]++;
    if(typeof b.weight!=="object"||w.calc===undefined)miss["weight.calc"]++;
    if(b.reachBase===undefined)miss.reachBase++;
    if(b.bodyScaleBase===undefined)miss.bodyScaleBase++;
    if(b.personalFatigue===undefined)miss.personalFatigue++;
    if(fm.sohl.currentMoveMedium!==undefined){cmm++; if(typeof fm.sohl.currentMoveMedium!=="string")cmmNonStr++;}
    if(fm.sohl.movementProfiles!==undefined)mp++;
  }
}
console.log(`being notes=${beings}, with sohl.body=${withBody}`);
console.log("keys normalizeBody would have to WRITE into the note (absent today):");
for(const [k,v] of Object.entries(miss)) console.log(`   ${String(v).padStart(5)}  body.${k}`);
console.log(`currentMoveMedium authored=${cmm} (non-string ${cmmNonStr}), movementProfiles authored=${mp}`);
