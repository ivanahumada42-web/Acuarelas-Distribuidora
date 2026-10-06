# Acuarelas Distribuidora

Tienda en español latinoamericano, construida con Node.js 24, Express, SQLite y ExcelJS. El catálogo público nunca entrega precios mayoristas. Los clientes autorizados reciben sus precios al iniciar sesión. Administración tiene permisos separados.

## Abrir la tienda

1. Instalar Node.js 24 o superior.
2. En esta carpeta ejecutar `npm install` y después `npm start`.
3. Abrir http://localhost:3000.
4. Para administrar, abrir http://localhost:3000/admin. Al primer inicio se genera un administrador con contraseña aleatoria; sus datos quedan en `data/ACCESO-LOCAL.txt`. Cambiar la contraseña desde **Mi cuenta**. No compartir ese archivo.

La base se guarda en `data/acuarelas.sqlite`. Reiniciar no borra productos, cuentas ni pedidos. Las imágenes cargadas se guardan en `public/uploads`. Copiar **ambas carpetas** en los respaldos; para un respaldo consistente, detener el servidor antes de copiar `data`.

## Funcionalidades

- Inicio con logo y banners aportados completos, carrusel automático cada 3 segundos, botones animados enlazados a cada categoría, marcas y productos destacados. Incluye selección manual y pausa del carrusel.
- Banners de marcas separados por categoría en un carrusel lateral compacto, con imágenes completas y enlaces al catálogo filtrado. En celular se muestran arriba de los productos. Para sincronizar cambios en `Imagenes/Banners de marcas`, ejecutar `node scripts/sync-category-banners.mjs`.
- Catálogo paginado, búsqueda indexada FTS5 por nombre/SKU/marca (ignora tildes y admite prefijos), filtros por categoría, marca, disponibilidad y orden por precio.
- Ficha de artículo, carrito persistente en el navegador y envío de pedidos.
- Registro, acceso, historial de pedidos y cambio de contraseña.
- Solicitud mayorista, revisión/aprobación/rechazo/revocación desde administración. Los precios se deciden en el servidor según los permisos actuales de cada sesión.
- Panel de artículos: alta, edición, desactivación, foto JPG/PNG/WebP y URL HTTPS.
- Importación y exportación `.xlsx`: valida todas las filas y muestra el resumen antes de confirmar. La confirmación es una transacción atómica. Actualiza por SKU. No elimina artículos omitidos.
- Gestión de pedidos, estados, cancelación con devolución de stock y bandeja de consultas.
- Precios almacenados en centavos. Pedido calculado y stock reservado en el servidor; nunca se confía en precios enviados por el navegador.

## Cargar el catálogo real

Los 12 productos iniciales son **ejemplos**, con precios, existencias e ilustraciones de demostración. No constituyen información comercial real. Los banners provienen de la carpeta `Imagenes`; los dibujos SVG son ilustraciones de muestra y se pueden reemplazar por fotos.

En Administración → Importar/exportar Excel, descargar la plantilla. Columnas obligatorias: `SKU`, `Nombre`, `Marca`, `Categoria`, `Descripcion`, `Precio minorista`, `Precio mayorista`, `Stock`, `Minimo mayorista`, `Imagen URL`, `Destacado`, `Activo`.

- Categorías exactas: **Escolar**, **Comercio**, **Agendas**, **Papelera**.
- Precios: celdas numéricas en ARS, sin fórmulas. Stock: entero >= 0. Mínimo: entero >= 1. Activo/destacado: 0 o 1.
- SKU único, estable. Los productos existentes se actualizan; los nuevos se agregan.
- La carga admite hasta 10.000 filas y 10 MB. Se validó un catálogo de 8.000 artículos mediante pruebas automatizadas.
- Imagen: enlace HTTPS público o ruta obtenida cargando una foto en el editor. La planilla referencia imágenes; no importa fotos incrustadas en Excel.
- Desactivar o reemplazar los SKU de muestra antes de usar comercialmente.

## Publicación

Esta entrega corre localmente. Para publicarla, usar un servidor con Node.js 24 y **disco persistente**, HTTPS y un proxy inverso. No subirla a un hosting exclusivamente estático. Variables:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
TRUST_PROXY=loopback
ADMIN_EMAIL=tu-email-administrador
ADMIN_PASSWORD=una-contraseña-larga-y-única
SEED_DEMO=false
DATA_DIR=ruta-absoluta-persistente
```

`ADMIN_EMAIL` y `ADMIN_PASSWORD` crean el administrador solamente cuando no hay uno. Si se migra la base local, cambiar su contraseña antes de publicar. Configurar el proxy para conservar el host y enviar `X-Forwarded-Proto: https`; `TRUST_PROXY=loopback` supone un proxy en la misma máquina. Si está en otra red, especificar solo su IP/subred confiable. El servidor exige el mismo origen para las escrituras. Las cookies son seguras en producción, de modo que HTTPS es obligatorio. Las fotografías deben persistir en `public/uploads`, aunque `DATA_DIR` esté ubicado en otro volumen.

La arquitectura consulta únicamente una página de productos por petición y utiliza índices y SQLite WAL. El volumen de 8.000 artículos se validó como catálogo; la capacidad de visitas simultáneas depende del servidor y requiere una prueba de carga antes de una campaña masiva.

## Alcance comercial pendiente

El cierre de compra **guarda un pedido pendiente y reserva stock**. El equipo confirma pago y entrega manualmente. No hay cobro online, facturación fiscal, cotización automática de envíos, email transaccional ni recuperación automática de contraseña. Las consultas se reciben en el panel, no por correo. Esos servicios necesitan las cuentas/proveedores y reglas comerciales de Acuarelas.

Antes de la apertura pública, completar datos comerciales reales, ubicación, medios de pago, condiciones de entrega e información legal definitiva. El texto actual evita inventar teléfonos, domicilios o servicios.

## Verificación

`npm test` ejecuta integración contra una base temporal: permisos minorista/mayorista, aprobación/revocación, precios y stock de pedidos, seguridad del administrador, importación/exportación Excel y paginación con 8.000 artículos. `node scripts/create-assets.mjs` regenera los dibujos de muestra.
