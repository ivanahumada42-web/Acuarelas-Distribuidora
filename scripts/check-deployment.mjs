import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { del } from '@vercel/blob';
import ExcelJS from 'exceljs';
import { openDatabase } from '../database.mjs';

const base = process.argv[2] || 'https://acuarelas-distribuidora.vercel.app';
const password = readFileSync('data/vercel-admin-password.txt','utf8').trim();
const login = await fetch(base+'/api/login', {method:'POST',headers:{'Content-Type':'application/json',origin:base},body:JSON.stringify({email:'admin@acuarelasdistribuidora.com.ar',password})});
assert.equal(login.status,200);
const cookie = login.headers.get('set-cookie').split(';')[0];
let blobUrl;
try {
  assert.equal((await fetch(base+'/api/admin/overview')).status,403);
  const overview = await fetch(base+'/api/admin/overview',{headers:{cookie}});
  assert.equal(overview.status,200);
  const settings=await (await fetch(base+'/api/admin/config',{headers:{cookie}})).json();
  assert.equal(settings.uploadLimitMb,4);
  const config = await (await fetch(base+'/assets/category-banners.json')).json();
  for (const category of ['Escolar','Comercio','Agendas','Papelera']) {
    const page = await fetch(base+'/catalogo?category='+category);
    assert.equal(page.status,200);
    assert.ok(config[category].length>0);
  }
  assert.equal((await fetch(base+'/assets/logo.jpg')).status,200);
  const form = new FormData();
  form.append('image', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1kAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'check.png');
  const upload = await fetch(base+'/api/admin/image',{method:'POST',headers:{cookie,origin:base},body:form});
  assert.equal(upload.status,200);
  blobUrl = (await upload.json()).url;
  assert.ok(blobUrl.startsWith('https://'));
  assert.equal((await fetch(blobUrl)).status,200);
  const library=await (await fetch(base+'/api/admin/images',{headers:{cookie}})).json();
  assert.ok(library.items.some(image=>image.url===blobUrl));
  const spreadsheet = await fetch(base+'/api/admin/excel',{headers:{cookie}});
  assert.equal(spreadsheet.status,200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await spreadsheet.arrayBuffer()));
  assert.equal(wb.getWorksheet('Productos').getCell('G1').value,'Precio mayorista');
  assert.equal(wb.getWorksheet('Productos').getCell('M1').value,'Subcategoria');
  console.log('Producción verificada: páginas, categorías, logo, administración, permisos, imágenes persistentes y Excel.');
} finally {
  if(blobUrl){await del(blobUrl);const db=openDatabase('unused.sqlite');try{await db.prepare('DELETE FROM media WHERE url=?').run(blobUrl);}finally{db.close();}}
  await fetch(base+'/api/logout',{method:'POST',headers:{cookie,origin:base,'Content-Type':'application/json'},body:'{}'});
}
