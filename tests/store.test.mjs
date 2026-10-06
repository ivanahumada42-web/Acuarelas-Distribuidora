import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
const dir=mkdtempSync(path.join(tmpdir(),'acuarelas-test-'));
process.env.DATA_DIR=dir;process.env.PORT='0';process.env.ADMIN_EMAIL='admin@test.local';process.env.ADMIN_PASSWORD='Administrador-Test-2026';
const {server,db}=await import('../server.mjs');
if(!server.listening)await new Promise(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+server.address().port;
after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});});
async function call(url,body,cookie='',method=body===undefined?'GET':'POST'){const res=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
async function excelUpload(buffer,cookie){const form=new FormData();form.append('file',new Blob([buffer]),'catalogo.xlsx');const res=await fetch(base+'/api/admin/import/preview',{method:'POST',headers:{cookie},body:form});return {status:res.status,data:await res.json()};}
let adminCookie,customerCookie,customerId;
test('precios protegidos y aprobación/revocación de mayoristas',async()=>{
  const publicData=await call('/api/products');assert.equal(publicData.status,200);assert.equal(publicData.data.items.length,12);assert.equal('wholesale' in publicData.data.items[0],false);assert.equal(publicData.data.items[0].price_type,'minorista');
  assert.equal((await call('/api/admin/excel')).status,403);assert.equal((await call('/api/admin/products')).status,403);
  assert.equal((await call('/api/products?q=lapices')).data.items[0].id,1);
  assert.equal((await call('/api/register',{name:'Comercio Test',email:'cliente@test.local',password:'Cliente-Test-2026',role:'admin',wholesale_status:'approved'})).status,200);
  const login=await call('/api/login',{email:'cliente@test.local',password:'Cliente-Test-2026'});customerCookie=login.cookie;customerId=login.data.user.id;assert.equal(login.data.user.role,'customer');assert.equal(login.data.user.wholesale_status,'none');
  assert.equal((await call('/api/admin/requests',undefined,customerCookie)).status,403);
  await call('/api/wholesale',{company:'Librería Test',tax_id:'30-12345678-0',phone:'1112345678',address:'Dirección Test 123'},customerCookie);
  assert.equal((await call('/api/products/1',undefined,customerCookie)).data.price,6800);
  adminCookie=(await call('/api/login',{email:'admin@test.local',password:'Administrador-Test-2026'})).cookie;
  assert.equal((await call('/api/admin/requests/'+customerId,{status:'approved'},adminCookie,'PATCH')).status,200);
  const approved=(await call('/api/products/1',undefined,customerCookie)).data;assert.equal(approved.price,4750);assert.equal(approved.price_type,'mayorista');
  await call('/api/admin/requests/'+customerId,{status:'rejected'},adminCookie,'PATCH');assert.equal((await call('/api/products/1',undefined,customerCookie)).data.price,6800);
});
test('el servidor calcula precio, reserva stock y cancela una sola vez',async()=>{
  const product=(await call('/api/products/1')).data;const body={name:'Cliente Test',email:'cliente@test.local',phone:'1112345678',address:'Dirección de prueba 123',items:[{id:1,qty:2,price:1}],total:1};
  const order=await call('/api/orders',body,customerCookie);assert.equal(order.status,200);assert.equal(order.data.total,13600);assert.equal((await call('/api/products/1')).data.stock,product.stock-2);
  assert.equal((await call('/api/orders',{...body,items:[{id:1,qty:999999}]},customerCookie)).status,400);assert.equal((await call('/api/products/1')).data.stock,product.stock-2);
  await call('/api/admin/orders/'+order.data.id,{status:'Cancelado'},adminCookie,'PATCH');assert.equal((await call('/api/products/1')).data.stock,product.stock);assert.equal((await call('/api/admin/orders/'+order.data.id,{status:'Cancelado'},adminCookie,'PATCH')).status,400);assert.equal((await call('/api/products/1')).data.stock,product.stock);
  assert.equal((await call('/api/orders',{...body,items:[{id:1,qty:1},{id:1,qty:1}]})).status,400);
});
test('Excel exporta precios y la importación valida antes de guardar',async()=>{
  const res=await fetch(base+'/api/admin/excel',{headers:{cookie:adminCookie}});assert.equal(res.status,200);const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));const ws=wb.getWorksheet('Productos');assert.equal(ws.getCell('G1').value,'Precio mayorista');assert.equal(ws.getCell('F2').value,6800);assert.equal(ws.getCell('G2').value,4750);
  ws.getCell('F2').value=7100;const preview=await excelUpload(await wb.xlsx.writeBuffer(),adminCookie);assert.equal(preview.data.updated,12);assert.equal((await call('/api/products/1')).data.price,6800);
  assert.equal((await call('/api/admin/import/confirm',{token:preview.data.token},adminCookie)).status,200);assert.equal((await call('/api/products/1')).data.price,7100);assert.equal((await call('/api/admin/import/confirm',{token:preview.data.token},adminCookie)).status,400);
  ws.getCell('D2').value='Categoría inválida';const invalid=await excelUpload(await wb.xlsx.writeBuffer(),adminCookie);assert.equal(invalid.data.errorCount,1);assert.equal(invalid.data.token,null);assert.equal((await call('/api/products/1')).data.price,7100);
});
test('carga real de 8.000 artículos con Excel y catálogo paginado',async()=>{
  const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Productos');ws.addRow(['SKU','Nombre','Marca','Categoria','Descripcion','Precio minorista','Precio mayorista','Stock','Minimo mayorista','Imagen URL','Destacado','Activo']);
  for(let i=1;i<=8000;i++)ws.addRow(['CARGA-'+i,`Artículo de prueba ${i}`,'Marca de prueba','Escolar','Verificación de catálogo grande',1500,1000,50,5,'',0,1]);
  const start=performance.now();const preview=await excelUpload(await wb.xlsx.writeBuffer(),adminCookie);assert.equal(preview.status,200);assert.equal(preview.data.added,8000);assert.equal(preview.data.errorCount,0);await call('/api/admin/import/confirm',{token:preview.data.token},adminCookie);
  const queryStart=performance.now();const data=await call('/api/products?brand=Marca%20de%20prueba&page=300&limit=12');assert.equal(data.data.total,8000);assert.equal(data.data.items.length,12);assert.equal(data.data.pages,667);assert.equal(data.data.page,300);assert.ok(data.data.items.every(p=>!('wholesale' in p)));console.log(`8.000 artículos importados en ${Math.round(performance.now()-start)} ms; página consultada en ${Math.round(performance.now()-queryStart)} ms.`);
  await call('/api/admin/requests/'+customerId,{status:'approved'},adminCookie,'PATCH');const p=data.data.items[0];assert.equal((await call('/api/orders',{name:'Cliente Test',email:'cliente@test.local',phone:'1112345678',address:'Dirección Test 123',items:[{id:p.id,qty:1}]},customerCookie)).status,400);
});
test('bloquea escrituras de otros orígenes y valida archivos',async()=>{
  const res=await fetch(base+'/api/contact',{method:'POST',headers:{'Content-Type':'application/json',origin:'https://sitio-ajeno.example'},body:JSON.stringify({name:'Test',email:'t@t.local',message:'Consulta de prueba'})});assert.equal(res.status,403);
  const form=new FormData();form.append('image',new Blob(['<script>malicioso</script>'],{type:'image/png'}),'falso.png');assert.equal((await fetch(base+'/api/admin/image',{method:'POST',headers:{cookie:adminCookie},body:form})).status,400);
  assert.equal((await call('/api/products?q=%25')).data.total,0);
});
test('pedidos y cancelaciones simultáneos conservan el stock',async()=>{
  const product=(await call('/api/products/2')).data;
  const body={name:'Cliente Concurrente',email:'concurrente@test.local',phone:'1112345678',address:'Dirección de prueba 123',items:[{id:2,qty:product.stock-1}]};
  const orders=await Promise.all([call('/api/orders',body),call('/api/orders',body)]);
  assert.deepEqual(orders.map(order=>order.status).sort(),[200,400]);
  assert.equal((await call('/api/products/2')).data.stock,1);
  const id=orders.find(order=>order.status===200).data.id;
  const cancellations=await Promise.all([call('/api/admin/orders/'+id,{status:'Cancelado'},adminCookie,'PATCH'),call('/api/admin/orders/'+id,{status:'Cancelado'},adminCookie,'PATCH')]);
  assert.deepEqual(cancellations.map(result=>result.status).sort(),[200,400]);
  assert.equal((await call('/api/products/2')).data.stock,product.stock);
});
test('Excel interpreta subcategorías, coma decimal y Sí/No sin guardar antes de confirmar',async()=>{
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Productos');
  ws.addRow(['SKU','Nombre','Marca','Categoria','Descripcion','Precio minorista','Precio mayorista','Stock','Minimo mayorista','Imagen URL','Destacado','Activo','Subcategoría']);
  ws.addRow(['SUB-001','Acrílico amarillo','EQ','Escolar > Acrilicos','','5.000,50','3420',100,6,'','','SI','']);
  ws.addRow(['SUB-002','Bolígrafo azul','BIC','Comercio','','5000,00',3000,50,1,'','NO','Sí','Bolígrafos']);
  const preview=await excelUpload(await wb.xlsx.writeBuffer(),adminCookie);
  assert.equal(preview.data.errorCount,0);assert.equal(preview.data.total,2);
  assert.equal(preview.data.preview[0].category,'Escolar');assert.equal(preview.data.preview[0].subcategory,'Acrilicos');assert.equal(preview.data.preview[0].retail,5000.5);assert.equal(preview.data.preview[0].active,1);
  assert.equal((await call('/api/products?q=SUB-001')).data.total,0);
  assert.equal((await call('/api/admin/import/confirm',{token:preview.data.token},adminCookie)).status,200);
  const school=await call('/api/products?category=Escolar&subcategory=Acrilicos');assert.equal(school.data.total,1);assert.ok(school.data.subcategories.includes('Acrilicos'));assert.equal(school.data.items[0].subcategory,'Acrilicos');assert.equal('wholesale' in school.data.items[0],false);
  assert.equal((await call('/api/products?category=Papelera&subcategory=Acrilicos')).data.total,0);
  const exported=await fetch(base+'/api/admin/excel',{headers:{cookie:adminCookie}}),roundtrip=new ExcelJS.Workbook();await roundtrip.xlsx.load(Buffer.from(await exported.arrayBuffer()));
  assert.equal(roundtrip.getWorksheet('Productos').getCell('M1').value,'Subcategoria');
  assert.equal((await excelUpload(await roundtrip.xlsx.writeBuffer(),adminCookie)).data.errorCount,0);
});
test('la validación informa todos los campos incorrectos con fila y columna',async()=>{
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Productos');
  ws.addRow(['SKU','Nombre','Marca','Categoria','Descripcion','Precio minorista','Precio mayorista','Stock','Minimo mayorista','Imagen URL','Destacado','Activo']);
  ws.addRow(['ERRORES-001','','EQ','Categoría inexistente','','precio incorrecto',3000,2.5,0,'http://ejemplo.com/foto.jpg','tal vez','tal vez']);
  const result=await excelUpload(await wb.xlsx.writeBuffer(),adminCookie);
  assert.equal(result.data.token,null);assert.equal(result.data.invalidRows,1);assert.equal(result.data.errorCount,8);
  const price=result.data.errors.find(issue=>issue.field==='Precio minorista');assert.equal(price.row,2);assert.equal(price.column,'F');assert.equal(price.value,'precio incorrecto');assert.match(price.error,/5000,00/);
  assert.ok(result.data.errors.some(issue=>issue.field==='Nombre'));
  assert.equal((await call('/api/products?q=ERRORES-001')).data.total,0);
  ws.getRow(1).getCell(1).value='Código distinto';
  const missing=await excelUpload(await wb.xlsx.writeBuffer(),adminCookie);assert.equal(missing.status,400);assert.match(missing.data.error,/Faltan estas columnas.*SKU/);
});
test('biblioteca de imágenes exige administración y conserva la URL subida',async()=>{
  assert.equal((await call('/api/admin/images')).status,403);
  const form=new FormData();form.append('image',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1kAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'foto-prueba.png');
  const response=await fetch(base+'/api/admin/image',{method:'POST',headers:{cookie:adminCookie},body:form});assert.equal(response.status,200);const {url}=await response.json();
  const gallery=(await call('/api/admin/images',undefined,adminCookie)).data;
  assert.equal(gallery.items[0].filename,'foto-prueba.png');assert.equal(gallery.items[0].url,url);
  assert.equal((await fetch(base+url)).status,200);
});
