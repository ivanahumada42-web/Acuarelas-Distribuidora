export const categories = ['Escolar', 'Comercio', 'Agendas', 'Papelera'];
export const columns = [['sku','SKU'],['name','Nombre'],['brand','Marca'],['category','Categoria'],['description','Descripcion'],['retail','Precio minorista'],['wholesale','Precio mayorista'],['stock','Stock'],['min_qty','Minimo mayorista'],['image','Imagen URL'],['featured','Destacado'],['active','Activo'],['subcategory','Subcategoria']];
export const fields = columns.map(([key]) => key);
const fold = value => String(value).normalize('NFD').replace(/\p{M}/gu,'').trim().toLowerCase();
export class ProductValidationError extends Error {
  constructor(issues) { super(issues.map(issue => `${issue.field}: ${issue.error}`).join(' · ')); this.issues=issues; }
}
export function normalizeProduct(row) {
  const out={},issues=[];
  const issue=(key,error)=>issues.push({field:columns.find(([k])=>k===key)[1],value:String(row[key]??'').slice(0,200),error});
  for(const key of ['sku','name','brand','category','subcategory','description','image'])out[key]=String(row[key]??'').trim();
  for(const [key,max]of [['sku',80],['name',180],['brand',100]]) {
    if(!out[key])issue(key,'El campo está vacío. Completalo.');
    else if(out[key].length>max)issue(key,`Tiene ${out[key].length} caracteres; el máximo es ${max}.`);
  }
  const hierarchy=out.category.split('>').map(part=>part.trim());
  out.category=categories.find(category=>fold(category)===fold(hierarchy[0]))||hierarchy[0];
  if(hierarchy.length>2||hierarchy.some(part=>!part))issue('category','Usá Categoría > Subcategoría, con un solo nivel de subcategoría.');
  if(hierarchy[1]) {
    if(out.subcategory&&fold(out.subcategory)!==fold(hierarchy[1]))issue('subcategory',`No coincide con “${hierarchy[1]}”, indicada en Categoria. Usá el mismo nombre o separá ambas columnas.`);
    else out.subcategory=hierarchy[1];
  }
  if(!categories.includes(out.category))issue('category',`“${out.category||'(vacío)'}” no es una categoría válida. Usá Escolar, Comercio, Agendas o Papelera.`);
  if(out.subcategory.length>100||out.subcategory.includes('>'))issue('subcategory','Usá un nombre de hasta 100 caracteres, sin el símbolo >. Ejemplo: Bolígrafos.');
  if(out.description.length>3000)issue('description',`Tiene ${out.description.length} caracteres; el máximo es 3000.`);
  if(out.image) {
    let valid=/^\/(assets|uploads)\/[a-zA-Z0-9._-]+$/.test(out.image);
    try{const url=new URL(out.image);valid=url.protocol==='https:'&&Boolean(url.hostname)&&!url.username&&!url.password;}catch{}
    if(!valid)issue('image','Usá una URL HTTPS directa de una imagen o la URL obtenida en Administración → Imágenes. Podés dejarlo vacío.');
  }
  for(const key of ['retail','wholesale']) {
    const raw=row[key];let n=typeof raw==='number'?raw:NaN;
    if(typeof raw==='string') {
      const value=raw.trim();
      if(/^\d+(?:\.\d{1,2})?$/.test(value))n=Number(value);
      else if(/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(value))n=Number(value.replaceAll('.','').replace(',','.'));
    }
    if(!Number.isFinite(n)||n<0||n>100000000)issue(key,'Ingresá un número entre 0 y 100.000.000. Ejemplos: 5000, 5000,00 o 5.000,50. No uses fórmulas ni símbolos de moneda.');
    else out[key]=Math.round(n*100);
  }
  for(const key of ['stock','min_qty']) {
    const raw=row[key];const n=raw==null||raw===''?(key==='stock'?0:1):Number(raw);
    if(!Number.isInteger(n)||n<(key==='stock'?0:1)||n>1000000)issue(key,`Ingresá un número entero entre ${key==='stock'?0:1} y 1.000.000, sin decimales.`);
    else out[key]=n;
  }
  for(const key of ['featured','active']) {
    const raw=row[key];const text=fold(raw??'');
    const n=raw==null||raw===''?(key==='active'?1:0):['si','true','activo'].includes(text)?1:['no','false','inactivo'].includes(text)?0:Number(raw);
    if(![0,1].includes(n))issue(key,'Usá 1 o Sí para activar; 0 o No para desactivar.');
    else out[key]=n;
  }
  if(issues.length)throw new ProductValidationError(issues);
  return out;
}
