import { mkdirSync, readdirSync, copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const brands={5:'Maped',6:'Keyroad',7:'Pizzini',8:'Triunfante',9:'Éxito',10:'Trabi',11:'Filgo',12:'MIT',13:'Lama',14:'CBX',15:'BIC',16:'Plastivas',17:'DPM',18:'Banplast',19:'Koviplast',20:'Antártida',21:'Brandpack',22:'Luma',23:'EQ',24:'SIFAP',25:'Olami',26:'Mooving'};
const manifest={};
for(const category of ['Escolar','Comercio','Agendas','Papelera']){
  const source=path.join(root,'Imagenes','Banners de marcas',category);
  const destination=path.join(root,'public','assets','marcas',category);
  mkdirSync(destination,{recursive:true});
  const files=readdirSync(source).filter(f=>/\.(jpg|jpeg|png|webp)$/i.test(f)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  manifest[category]=files.map(file=>{
    copyFileSync(path.join(source,file),path.join(destination,file));
    return {image:`/assets/marcas/${category}/${file}`,brand:brands[path.parse(file).name]||path.parse(file).name};
  });
}
writeFileSync(path.join(root,'public','assets','category-banners.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Banners sincronizados:',Object.entries(manifest).map(([category,items])=>`${category}: ${items.length}`).join(' · '));
