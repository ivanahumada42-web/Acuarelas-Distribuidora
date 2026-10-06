import express from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
mkdirSync(dataDir, { recursive: true });
mkdirSync(path.join(root, 'public/uploads'), { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'acuarelas.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL, brand TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', retail INTEGER NOT NULL, wholesale INTEGER NOT NULL, stock INTEGER NOT NULL, min_qty INTEGER NOT NULL DEFAULT 1, image TEXT NOT NULL DEFAULT '', featured INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS products_category ON products(category,active);
CREATE INDEX IF NOT EXISTS products_brand ON products(brand);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', company TEXT NOT NULL DEFAULT '', tax_id TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', wholesale_status TEXT NOT NULL DEFAULT 'none', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, note TEXT NOT NULL, items TEXT NOT NULL, total INTEGER NOT NULL, price_type TEXT NOT NULL, status TEXT DEFAULT 'Pendiente', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS import_previews (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, payload TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, name TEXT, email TEXT, message TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
const categories = ['Escolar', 'Comercio', 'Agendas', 'Papelera'];
const hasSearchIndex = db.prepare("SELECT name FROM sqlite_master WHERE name='product_search'").get();
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS product_search USING fts5(name,sku,brand,content='products',content_rowid='id',tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS product_search_insert AFTER INSERT ON products BEGIN INSERT INTO product_search(rowid,name,sku,brand) VALUES(new.id,new.name,new.sku,new.brand); END;
CREATE TRIGGER IF NOT EXISTS product_search_delete AFTER DELETE ON products BEGIN INSERT INTO product_search(product_search,rowid,name,sku,brand) VALUES('delete',old.id,old.name,old.sku,old.brand); END;
CREATE TRIGGER IF NOT EXISTS product_search_update AFTER UPDATE ON products BEGIN INSERT INTO product_search(product_search,rowid,name,sku,brand) VALUES('delete',old.id,old.name,old.sku,old.brand); INSERT INTO product_search(rowid,name,sku,brand) VALUES(new.id,new.name,new.sku,new.brand); END;`);
if (!hasSearchIndex) db.exec("INSERT INTO product_search(product_search) VALUES('rebuild')");
const hash = password => { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password, salt, 64).toString('hex'); };
const verify = (password, saved) => { const [salt, key] = saved.split(':'); return timingSafeEqual(Buffer.from(key, 'hex'), scryptSync(password, salt, 64)); };
if (!db.prepare('SELECT id FROM users WHERE role=?').get('admin')) {
  if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) throw new Error('Configure ADMIN_PASSWORD y ADMIN_EMAIL antes de iniciar en producción.');
  const password = process.env.ADMIN_PASSWORD || randomBytes(18).toString('base64url');
  const email = process.env.ADMIN_EMAIL || 'admin@acuarelas.local';
  db.prepare('INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)').run('Administración Acuarelas', email, hash(password), 'admin');
  if (!process.env.ADMIN_PASSWORD) writeFileSync(path.join(dataDir, 'ACCESO-LOCAL.txt'), `Acceso de administración local\nURL: http://localhost:3000/admin\nEmail: ${email}\nContraseña: ${password}\n\nNo compartir este archivo. Cambiar la contraseña desde Mi cuenta.\n`, { mode: 0o600 });
}
if (!db.prepare('SELECT id FROM products LIMIT 1').get() && process.env.SEED_DEMO !== 'false') {
  const samples = [
    ['Lápices de colores · 24 colores','Maped','Escolar',6800,4750,86,'pencils'],
    ['Cuaderno A4 espiral · 80 hojas','Éxito','Escolar',4200,2900,145,'notebook'],
    ['Marcadores pastel · 6 colores','Filgo','Escolar',3900,2650,72,'markers'],
    ['Bolígrafo Cristal azul · x12','BIC','Comercio',5400,3800,210,'pens'],
    ['Agenda diaria · edición 2027','Mooving','Agendas',14900,10300,34,'agenda'],
    ['Resma A4 · 75 g · 500 hojas','Autor','Papelera',7800,5650,98,'paper'],
    ['Notas adhesivas · tonos pastel','Pizzini','Comercio',2150,1480,130,'notes'],
    ['Bolsa kraft · pack de 10','Brandpack','Papelera',3200,2200,65,'bag'],
    ['Carpeta A4 con elástico','Luma','Escolar',2800,1950,94,'notebook'],
    ['Cuaderno de ideas · tapa dura','Mooving','Agendas',8500,5900,48,'agenda'],
    ['Resaltadores · set de 4','Maped','Comercio',3600,2450,110,'markers'],
    ['Papel de colores · 20 hojas','Luma','Papelera',1900,1300,120,'paper']
  ];
  const insert = db.prepare('INSERT INTO products(sku,name,brand,category,description,retail,wholesale,stock,image,featured) VALUES(?,?,?,?,?,?,?,?,?,?)');
  samples.forEach((p,i) => insert.run(`AC-${String(i+1).padStart(4,'0')}`,p[0],p[1],p[2], 'Producto de demostración. Reemplazá esta ficha con las características y fotografías de tu catálogo real.',p[3]*100,p[4]*100,p[5],`/assets/${p[6]}.svg`, i<8?1:0));
}
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
app.use(express.json({ limit: '1mb' }));
app.use((req,res,next) => {
  res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});
  if (req.path.startsWith('/api')) res.set('Cache-Control','no-store');
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).json({ error:'Origen no permitido.' });
  const token = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('acuarelas_session='))?.split('=')[1];
  req.user = token ? db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(token,Date.now()) : null;
  req.sessionToken=token;
  next();
});
const fail = (res,status,message) => res.status(status).json({error:message});
const auth = (req,res,next) => req.user ? next() : fail(res,401,'Iniciá sesión para continuar.');
const admin = (req,res,next) => req.user?.role === 'admin' ? next() : fail(res,403,'Acceso exclusivo de administración.');
const publicUser = u => u ? {id:u.id,name:u.name,email:u.email,role:u.role,company:u.company,tax_id:u.tax_id,phone:u.phone,address:u.address,wholesale_status:u.wholesale_status} : null;
const wholesale = req => req.user?.wholesale_status === 'approved';
const productView = (p,req) => {
  const { wholesale:w, retail:r, ...rest }=p;
  return {...rest,retail:r/100,price:(wholesale(req)?w:r)/100,price_type:wholesale(req)?'mayorista':'minorista',...(req.user?.role==='admin'?{wholesale:w/100}: {})};
};
const rates = new Map();
const limit = (req,res,next) => { const k=req.ip; const now=Date.now(); let v=rates.get(k); if(!v || v.until<now) v={count:0,until:now+600000}; v.count++; rates.set(k,v); if(v.count>40)return fail(res,429,'Demasiados intentos. Volvé a intentar en 10 minutos.'); next(); };
const housekeeping=setInterval(()=>{const now=Date.now();for(const[k,v]of rates)if(v.until<now)rates.delete(k);db.prepare('DELETE FROM sessions WHERE expires<?').run(now);db.prepare('DELETE FROM import_previews WHERE expires<?').run(now);},600000);housekeeping.unref();
app.get('/api/me',(req,res)=>res.json({user:publicUser(req.user)}));
app.post('/api/register',limit,(req,res)=>{
  const {name,email,password}=req.body;
  if(typeof name!=='string'||name.trim().length<2||typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||typeof password!=='string'||password.length<10||password.length>128)return fail(res,400,'Completá tu nombre, un email válido y una contraseña de 10 a 128 caracteres.');
  try {db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)').run(name.trim().slice(0,100),email.trim().toLowerCase(),hash(password));res.json({ok:true});}catch{return fail(res,409,'Ya existe una cuenta con ese email.');}
});
app.post('/api/login',limit,(req,res)=>{
  const {email,password}=req.body;
  if(typeof email!=='string'||typeof password!=='string'||password.length>128)return fail(res,400,'Datos de acceso inválidos.');
  const u=db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase());
  if(!u||!verify(password,u.password))return fail(res,401,'Email o contraseña incorrectos.');
  const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,u.id,Date.now()+604800000);
  res.cookie('acuarelas_session',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:604800000,path:'/'}).json({user:publicUser(u)});
});
app.post('/api/logout',(req,res)=>{db.prepare('DELETE FROM sessions WHERE token=?').run(req.sessionToken||'');res.clearCookie('acuarelas_session',{path:'/'}).json({ok:true});});
app.post('/api/password',auth,limit,(req,res)=>{const {current,password}=req.body;if(typeof current!=='string'||current.length>128||typeof password!=='string'||password.length<10||password.length>128)return fail(res,400,'La nueva contraseña debe tener entre 10 y 128 caracteres.');if(!verify(current,req.user.password))return fail(res,400,'La contraseña actual es incorrecta.');db.prepare('UPDATE users SET password=? WHERE id=?').run(hash(password),req.user.id);db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(req.user.id,req.sessionToken);res.json({ok:true});});
app.post('/api/wholesale',auth,(req,res)=>{
  const {company,tax_id,phone,address}=req.body;
  if(![company,tax_id,phone,address].every(v=>typeof v==='string'&&v.trim().length>=3&&v.length<=300))return fail(res,400,'Completá todos los datos de tu comercio.');
  if(req.user.wholesale_status==='approved')return fail(res,400,'Tu cuenta ya tiene acceso mayorista.');
  db.prepare("UPDATE users SET company=?,tax_id=?,phone=?,address=?,wholesale_status='pending' WHERE id=?").run(company.trim(),tax_id.trim(),phone.trim(),address.trim(),req.user.id);res.json({ok:true});
});
app.get('/api/products',(req,res)=>{
  const q=String(req.query.q||'').slice(0,120);const category=String(req.query.category||'');const brand=String(req.query.brand||'');
  const page=Math.max(1,Math.min(10000,Number(req.query.page)||1));const size=Math.max(1,Math.min(48,Number(req.query.limit)||12));
  const conditions=['active=1'];const args=[];
  if(q){const words=q.match(/[\p{L}\p{N}]+/gu);if(words?.length){conditions.push('id IN (SELECT rowid FROM product_search WHERE product_search MATCH ?)');args.push(words.map(w=>'"'+w+'"*').join(' AND '));}else conditions.push('0');}
  if(category){conditions.push('category=?');args.push(category);}if(brand){conditions.push('brand=?');args.push(brand);}if(req.query.featured==='1')conditions.push('featured=1');if(req.query.stock==='1')conditions.push('stock>0');
  const where=conditions.join(' AND ');const price=wholesale(req)?'wholesale':'retail';const sort={price_asc:`${price} ASC`,price_desc:`${price} DESC`,name:'name ASC',new:'id DESC'}[req.query.sort]||'featured DESC,id ASC';
  const total=db.prepare(`SELECT count(*) n FROM products WHERE ${where}`).get(...args).n;
  const items=db.prepare(`SELECT * FROM products WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`).all(...args,size,(page-1)*size).map(p=>productView(p,req));
  res.json({items,total,page,pages:Math.ceil(total/size),brands:db.prepare('SELECT DISTINCT brand FROM products WHERE active=1 ORDER BY brand').all().map(x=>x.brand)});
});
app.get('/api/products/:id',(req,res)=>{const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(Number(req.params.id));return p?res.json(productView(p,req)):fail(res,404,'Producto no encontrado.');});
app.post('/api/orders',limit,(req,res)=>{
  const {name,email,phone,address,note='',items}=req.body;
  if(![name,email,phone,address].every(v=>typeof v==='string'&&v.trim().length>2&&v.length<=400)||!/^\S+@\S+\.\S+$/.test(email)||typeof note!=='string'||note.length>1000||!Array.isArray(items)||!items.length||items.length>200)return fail(res,400,'Revisá los datos de contacto y los productos del pedido.');
  try {
    db.exec('BEGIN IMMEDIATE');const lines=[];const ids=new Set();let total=0;
    for(const item of items){const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(Number(item.id));const qty=Number(item.qty);if(!p||!Number.isInteger(qty)||qty<1||qty>p.stock||ids.has(p.id)||(wholesale(req)&&qty<p.min_qty))throw new Error(`Revisá el stock y la cantidad mínima de ${p?.name||'un artículo'}.`);ids.add(p.id);const unit=wholesale(req)?p.wholesale:p.retail;lines.push({id:p.id,sku:p.sku,name:p.name,qty,unit:unit/100});total+=qty*unit;db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(qty,p.id);}
    const result=db.prepare('INSERT INTO orders(user_id,name,email,phone,address,note,items,total,price_type) VALUES(?,?,?,?,?,?,?,?,?)').run(req.user?.id||null,name.trim(),email.trim(),phone.trim(),address.trim(),note,JSON.stringify(lines),total,wholesale(req)?'mayorista':'minorista');db.exec('COMMIT');res.json({id:Number(result.lastInsertRowid),total:total/100});
  }catch(e){db.exec('ROLLBACK');return fail(res,400,e.message);}
});
app.get('/api/orders',auth,(req,res)=>res.json(db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id).map(o=>({...o,total:o.total/100,items:JSON.parse(o.items)}))));
app.post('/api/contact',limit,(req,res)=>{const {name,email,message}=req.body;if(typeof name!=='string'||name.length<2||name.length>100||typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||typeof message!=='string'||message.length<10||message.length>2000)return fail(res,400,'Completá tu nombre, email y una consulta de al menos 10 caracteres.');db.prepare('INSERT INTO messages(name,email,message) VALUES(?,?,?)').run(name,email,message);res.json({ok:true});});
app.use('/api/admin',admin);
app.get('/api/admin/overview',(req,res)=>res.json({products:db.prepare('SELECT count(*) n FROM products WHERE active=1').get().n,pending:db.prepare("SELECT count(*) n FROM users WHERE wholesale_status='pending'").get().n,orders:db.prepare('SELECT count(*) n FROM orders').get().n,lowStock:db.prepare('SELECT count(*) n FROM products WHERE stock<10 AND active=1').get().n}));
app.get('/api/admin/requests',(req,res)=>res.json(db.prepare("SELECT id,name,email,company,tax_id,phone,address,wholesale_status FROM users WHERE wholesale_status<>'none' ORDER BY created_at DESC").all()));
app.patch('/api/admin/requests/:id',(req,res)=>{if(!['approved','rejected','pending'].includes(req.body.status))return fail(res,400,'Estado inválido.');const result=db.prepare("UPDATE users SET wholesale_status=? WHERE id=? AND role<>'admin'").run(req.body.status,Number(req.params.id));if(!result.changes)return fail(res,404,'Solicitud no encontrada.');res.json({ok:true});});
app.get('/api/admin/orders',(req,res)=>res.json(db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 300').all().map(o=>({...o,total:o.total/100,items:JSON.parse(o.items)}))));
app.patch('/api/admin/orders/:id',(req,res)=>{if(!['Pendiente','Confirmado','En preparación','Despachado','Cancelado'].includes(req.body.status))return fail(res,400,'Estado inválido.');const order=db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));if(!order)return fail(res,404,'Pedido no encontrado.');if(order.status==='Cancelado')return fail(res,400,'Un pedido cancelado no se puede reactivar.');db.exec('BEGIN IMMEDIATE');try{if(req.body.status==='Cancelado')for(const l of JSON.parse(order.items))db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(l.qty,l.id);db.prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status,order.id);db.exec('COMMIT');res.json({ok:true});}catch(e){db.exec('ROLLBACK');throw e;}});
app.get('/api/admin/messages',(req,res)=>res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 300').all()));
app.get('/api/admin/products',(req,res)=>{const page=Math.max(1,Number(req.query.page)||1);const q='%'+String(req.query.q||'').slice(0,100)+'%';res.json({items:db.prepare('SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? ORDER BY id DESC LIMIT 30 OFFSET ?').all(q,q,(page-1)*30).map(p=>({...p,retail:p.retail/100,wholesale:p.wholesale/100})),total:db.prepare('SELECT count(*) n FROM products WHERE name LIKE ? OR sku LIKE ?').get(q,q).n,page});});
const fields=['sku','name','brand','category','description','retail','wholesale','stock','min_qty','image','featured','active'];
function normalizeProduct(row){
  const out={};for(const key of ['sku','name','brand','category','description','image'])out[key]=String(row[key]??'').trim();
  if(!out.sku||out.sku.length>80||!out.name||out.name.length>180||!out.brand||out.brand.length>100||!categories.includes(out.category)||out.description.length>3000)throw new Error('SKU, nombre, marca o categoría inválidos.');
  if(out.image && !(/^https:\/\//.test(out.image)||/^\/(assets|uploads)\/[a-zA-Z0-9._-]+$/.test(out.image)))throw new Error('La imagen debe ser una URL HTTPS o un archivo cargado en el panel.');
  for(const key of ['retail','wholesale']){const n=Number(row[key]);if(!Number.isFinite(n)||n<0||n>100000000||row[key]===''||row[key]==null)throw new Error('Los precios deben ser números positivos o cero.');out[key]=Math.round(n*100);}
  for(const key of ['stock','min_qty']){const n=Number(row[key]??(key==='stock'?0:1));if(!Number.isInteger(n)||n<(key==='stock'?0:1)||n>1000000)throw new Error('Stock y mínimo mayorista deben ser enteros válidos.');out[key]=n;}
  out.featured=Number(row.featured??0);out.active=Number(row.active??1);if(![0,1].includes(out.featured)||![0,1].includes(out.active))throw new Error('Destacado y activo deben ser 0 o 1.');return out;
}
const upsert=db.prepare(`INSERT INTO products(${fields.join(',')}) VALUES(${fields.map(()=>'?').join(',')}) ON CONFLICT(sku) DO UPDATE SET ${fields.filter(k=>k!=='sku').map(k=>`${k}=excluded.${k}`).join(',')}`);
app.post('/api/admin/products',(req,res)=>{try{const p=normalizeProduct(req.body);upsert.run(...fields.map(k=>p[k]));res.json({ok:true});}catch(e){fail(res,400,e.message);}});
app.delete('/api/admin/products/:id',(req,res)=>{db.prepare('UPDATE products SET active=0 WHERE id=?').run(Number(req.params.id));res.json({ok:true});});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1}});
app.post('/api/admin/image',upload.single('image'),(req,res)=>{
  const f=req.file;if(!f)return fail(res,400,'Seleccioná una imagen.');const b=f.buffer;
  const type=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':b[0]===255&&b[1]===216&&b[2]===255?'jpg':b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'?'webp':null;
  if(!type)return fail(res,400,'Usá una imagen JPG, PNG o WebP.');const name=randomBytes(16).toString('hex')+'.'+type;writeFileSync(path.join(root,'public/uploads',name),b);res.json({url:'/uploads/'+name});
});
const columns=[['sku','SKU'],['name','Nombre'],['brand','Marca'],['category','Categoria'],['description','Descripcion'],['retail','Precio minorista'],['wholesale','Precio mayorista'],['stock','Stock'],['min_qty','Minimo mayorista'],['image','Imagen URL'],['featured','Destacado'],['active','Activo']];
app.get('/api/admin/excel',async(req,res)=>{
  const wb=new ExcelJS.Workbook();wb.creator='Acuarelas Distribuidora';const ws=wb.addWorksheet('Productos');ws.columns=columns.map(([key,header])=>({key,header,width:['name','description','image'].includes(key)?42:20}));
  const rows=req.query.template==='1'?[{sku:'EJEMPLO-001',name:'Producto de ejemplo',brand:'Marca',category:'Escolar',description:'Reemplazar antes de importar',retail:1000,wholesale:750,stock:10,min_qty:1,image:'',featured:0,active:1}]:db.prepare('SELECT * FROM products ORDER BY sku').all().map(p=>({...p,retail:p.retail/100,wholesale:p.wholesale/100}));
  ws.addRows(rows);ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter={from:'A1',to:'L1'};ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF5B3265'}};ws.getColumn('retail').numFmt='"$" #,##0.00';ws.getColumn('wholesale').numFmt='"$" #,##0.00';
  const help=wb.addWorksheet('Instrucciones');help.getColumn(1).width=115;['Acuarelas Distribuidora · Catálogo','Una fila por SKU. Los SKU existentes se actualizan; los nuevos se agregan.','Categorías permitidas: Escolar, Comercio, Agendas, Papelera.','Precios numéricos en pesos argentinos, sin símbolos ni separadores escritos como texto.','Stock: entero >= 0. Mínimo mayorista: entero >= 1. Destacado y Activo: 0 o 1.','Imagen URL: URL HTTPS pública o ruta de una imagen cargada desde el panel.','La importación primero valida y muestra un resumen; confirmar para guardar.','Nunca compartir esta planilla con clientes: contiene precios mayoristas.'].forEach(t=>help.addRow([t]));
  res.set('Content-Disposition',`attachment; filename="acuarelas-${req.query.template==='1'?'plantilla':'catalogo'}.xlsx"`);res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(await wb.xlsx.writeBuffer()));
});
app.post('/api/admin/import/preview',upload.single('file'),async(req,res)=>{
  if(!req.file||!req.file.originalname.toLowerCase().endsWith('.xlsx'))return fail(res,400,'Seleccioná una planilla .xlsx de hasta 10 MB.');
  try{const wb=new ExcelJS.Workbook();await wb.xlsx.load(req.file.buffer);const ws=wb.getWorksheet('Productos')||wb.worksheets[0];if(!ws||ws.rowCount>10001)return fail(res,400,'La planilla admite hasta 10.000 artículos.');
    const headers=ws.getRow(1).values;const indexes=columns.map(([,h])=>headers.indexOf(h));if(indexes.some(i=>i<1))return fail(res,400,'Las columnas no coinciden. Descargá la plantilla de Excel.');
    const rows=[],errors=[],seen=new Set();let added=0,updated=0;
    for(let i=2;i<=ws.rowCount;i++){const r=ws.getRow(i);if(!r.hasValues)continue;try{const obj={};columns.forEach(([k],j)=>{const c=r.getCell(indexes[j]);if(c.type===ExcelJS.ValueType.Formula)throw new Error('Usá valores, no fórmulas.');obj[k]=c.value?.text??c.value??'';});const p=normalizeProduct(obj);if(seen.has(p.sku))throw new Error('SKU duplicado dentro de la planilla.');seen.add(p.sku);if(db.prepare('SELECT id FROM products WHERE sku=?').get(p.sku))updated++;else added++;rows.push(p);}catch(e){errors.push({row:i,error:e.message});}}
    if(!rows.length&&!errors.length)return fail(res,400,'La planilla no contiene productos.');
    const token=errors.length?null:randomBytes(24).toString('hex');if(token)db.prepare('INSERT INTO import_previews VALUES(?,?,?,?)').run(token,req.user.id,JSON.stringify(rows),Date.now()+900000);res.json({token,added,updated,total:rows.length,errors:errors.slice(0,100),errorCount:errors.length});
  }catch{return fail(res,400,'No se pudo leer el Excel. Usá un archivo .xlsx válido.');}
});
app.post('/api/admin/import/confirm',(req,res)=>{
  const preview=db.prepare('SELECT * FROM import_previews WHERE token=? AND user_id=? AND expires>?').get(String(req.body.token||''),req.user.id,Date.now());if(!preview)return fail(res,400,'La vista previa venció. Volvé a cargar la planilla.');
  db.exec('BEGIN IMMEDIATE');try{const rows=JSON.parse(preview.payload);for(const p of rows)upsert.run(...fields.map(k=>p[k]));db.prepare('DELETE FROM import_previews WHERE token=?').run(preview.token);db.exec('COMMIT');res.json({ok:true,count:rows.length});}catch(e){db.exec('ROLLBACK');throw e;}
});
app.use('/api',(req,res)=>fail(res,404,'Recurso no encontrado.'));
app.use(express.static(path.join(root,'public'),{maxAge:process.env.NODE_ENV==='production'?'1h':0}));
app.get('/{*path}',(req,res)=>res.sendFile(path.join(root,'public/index.html')));
app.use((err,req,res,next)=>{console.error(err.message);fail(res,err.status||400,err.code==='LIMIT_FILE_SIZE'?'El archivo supera el límite de 10 MB.':'No se pudo completar la operación. Revisá los datos e intentá nuevamente.');});
const port=process.env.PORT===undefined?3000:Number(process.env.PORT);
const server=app.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Acuarelas disponible en http://localhost:${server.address().port}`));
export {app,db,server,normalizeProduct};
