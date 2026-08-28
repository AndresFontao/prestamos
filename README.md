# Préstamos — puesta en marcha

Son tres pasos, una sola vez. Después la app se abre como cualquier otra, en la
computadora y en el celular.

Lo que hay en esta entrega:

| | |
|---|---|
| `app-prestamos/` | el código de la app (esto se publica en internet) |
| `prestamos.json` | **tus datos** — 173 personas y 638 préstamos (esto va a tu OneDrive, **nunca** al repositorio) |

---

## Paso 1 · Publicar la app

1. Creá una cuenta en **github.com** si no tenés (3 minutos, gratis, no pide tarjeta).
2. Arriba a la derecha, **+ → New repository**. Nombre: `prestamos`. Dejalo en **Public**
   y tildá *Add a README file*. **Create repository**.
3. En el repo: **Add file → Upload files**. Arrastrá **el contenido** de la carpeta
   `app-prestamos` (los 11 archivos sueltos, no la carpeta). **Commit changes**.
4. **Settings → Pages**. En *Source* elegí **Deploy from a branch**, rama `main`,
   carpeta `/ (root)`. **Save**.
5. Esperá un minuto y recargá esa página: te va a mostrar la dirección, del estilo
   **`https://TUUSUARIO.github.io/prestamos/`**. Anotala, la vas a usar en el paso 2.

> El repositorio es público: cualquiera puede ver el código, y está bien, no hay
> nada secreto ahí. **Lo que nunca tiene que subir es `prestamos.json`**, que son
> los datos de las personas.

---

## Paso 2 · Registrar la app en tu cuenta Microsoft

Esto es lo que le da permiso a la app para leer y escribir *tu* OneDrive.

1. Entrá a **portal.azure.com** con tu cuenta **andresfontao@gmail.com**.
2. Buscá **Microsoft Entra ID** → en el menú de la izquierda, **App registrations**
   → **New registration**.
3. Completá:
   - **Name**: `Prestamos`
   - **Supported account types**: *Accounts in any organizational directory and
     personal Microsoft accounts* (la tercera opción, la más amplia)
   - **Redirect URI**: elegí la plataforma **Single-page application (SPA)** y pegá
     la dirección del paso 1, **con la barra final**:
     `https://TUUSUARIO.github.io/prestamos/`
4. **Register**.
5. En la pantalla que aparece, copiá el **Application (client) ID**. Es un código
   con guiones, tipo `3f5c1a92-...`. Ese es el que te pide la app.

No hace falta tocar permisos ni agregar nada más: los permisos se piden solos
cuando iniciás sesión, y podés revocarlos cuando quieras desde
*account.microsoft.com → Privacidad → Aplicaciones y servicios*.

---

## Paso 3 · Poner los datos en OneDrive

Copiá **`prestamos.json`** a tu carpeta **OneDrive\PRÉSTAMOS**, al lado del Excel.
(Si estás leyendo esto, probablemente ya lo dejé ahí.)

Esperá a que OneDrive termine de sincronizarlo — el ícono tiene que quedar con la
tilde verde.

---

## Listo: abrir la app

1. Entrá a `https://TUUSUARIO.github.io/prestamos/`
2. Pegá el **Application (client) ID** del paso 2 y dale **Guardar y conectar**.
3. Iniciá sesión con tu cuenta Microsoft y aceptá el permiso.
4. Debería aparecer tu tablero con los 638 préstamos.

### Instalarla como app

- **Android / Chrome**: menú ⋮ → *Instalar aplicación* (o *Agregar a pantalla de inicio*).
- **iPhone / Safari**: botón compartir → *Agregar a pantalla de inicio*.
- **Windows / Edge o Chrome**: el ícono de instalar en la barra de direcciones.

Queda con ícono propio y se abre sin barra del navegador.

---

## Cómo funciona el guardado

- Los datos están en **un solo archivo** en tu OneDrive. La app lo lee al abrir y
  lo reescribe cada vez que das de alta algo.
- Antes de escribir, compara la versión del archivo con la que cargó. Si cambió
  (por ejemplo, cargaste algo desde el celular y después desde la compu sin
  refrescar), te avisa en vez de pisar el otro cambio.
- OneDrive guarda el **historial de versiones**: si algo sale mal, clic derecho en
  el archivo → *Historial de versiones* → restaurar. Es tu red de seguridad.
- El **cierre de mes** puede escribir los dos xlsx directamente en
  `Liquidaciones Descuentos` y `Liquidaciones Gerencias`, o descargarlos, como prefieras.

## Sin internet

La app abre igual (queda guardada en el dispositivo), pero **los datos necesitan
conexión**, porque siempre se leen de OneDrive. No se guarda una copia local: es
a propósito, para que no existan dos versiones de la verdad.

## Si algo falla

| Síntoma | Qué mirar |
|---|---|
| "No se pudo iniciar sesión" | La URI de redirección del paso 2 tiene que ser **idéntica** a la dirección de la app, con la barra final incluida, y estar cargada como **SPA**. |
| "No encuentro el archivo" | Revisá que `prestamos.json` esté en `OneDrive\PRÉSTAMOS` y ya sincronizado. La ruta se puede cambiar en la pantalla **Conexión**. |
| Quedó a medias y no arranca | Entrá a `.../prestamos/#/conexion` y revisá el ID de aplicación. |
| Cambiaste la dirección de la app | Hay que actualizar la URI de redirección en Azure. |
