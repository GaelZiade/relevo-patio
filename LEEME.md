# Relevo de Patio

Inventario físico del patio desde el celular. Sacás una foto a la etiqueta del parabrisas o al número grabado en el cristal, el celular lee el chasis (código de barras + texto), lo confirmás y queda en una planilla de Google compartida.

- La lectura se hace **en el celular**: las fotos no se mandan a ningún lado.
- Sin señal sigue funcionando: lo cargado queda en el celular y se sube solo cuando vuelve la señal.
- Un mismo auto leído por la etiqueta (7 caracteres) o por el cristal (8) cuenta una sola vez: se compara por los últimos 7.

## Conectar la planilla (una sola vez, ~10 minutos)

1. Creá una planilla nueva en [sheets.new](https://sheets.new) y ponele de nombre "Relevo de Patio".
2. En la planilla: **Extensiones → Apps Script**.
3. Borrá lo que aparece y pegá todo el contenido de [`apps-script/Codigo.gs`](apps-script/Codigo.gs).
4. En la línea `const CLAVE_EQUIPO = "cambiar-esta-clave";` poné una clave para el equipo (ej. `patio2026`). Guardá (ícono de disquete).
5. **Implementar → Nueva implementación**. En el engranaje elegí **Aplicación web**.
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
6. **Implementar**. Google pide autorizar: elegí tu cuenta → "Configuración avanzada" → "Ir a Relevo de Patio (no seguro)" → Permitir. (Dice "no seguro" porque el script es tuyo y no está verificado por Google; solo escribe en esta planilla.)
7. Copiá la **URL de la aplicación web** (termina en `/exec`) y pegala en `config.js`, en `api: "..."`.

Si después cambiás el script, usá **Implementar → Gestionar implementaciones → editar → Nueva versión** para que la URL siga siendo la misma.

## Actualizar el script (cuando cambia `Codigo.gs`)

1. Anotá tu clave (la línea `const CLAVE_EQUIPO = ...` del script actual).
2. Reemplazá todo el código por el nuevo `Codigo.gs` y volvé a poner tu clave. Guardá.
3. **Implementar → Gestionar implementaciones** → lápiz → Versión: **Nueva versión** → **Implementar**. La URL no cambia.
4. Si la hoja quedó con repetidos o el encabezado fuera de lugar: arriba, en el desplegable de funciones, elegí **ordenarYLimpiar** y tocá **Ejecutar**. Deja un auto por renglón (el más reciente), arregla meses y claves, y guarda antes una copia en una pestaña "Relevamiento (respaldo …)".

## Uso

1. Abrí la página en el celular, poné tu nombre y la clave del equipo (se pide una vez).
2. **Sacar foto** → revisá el número → **Confirmar y seguir**.
3. Si leyó mal, tocá el correcto en "¿Era otro?" o corregilo a mano.
4. Para cruzar con el stock del sistema: pestaña **Cruce con stock**, pegá la lista y guardala.

Para instalarla como app: en Chrome, menú ⋮ → **Agregar a pantalla de inicio**; en iPhone, Compartir → **Agregar a inicio**. La primera vez baja ~30 MB (los modelos de lectura); conviene hacerlo con WiFi.

## Cómo lee

1. Busca códigos de barras y QR (zxing-wasm). Si encuentra un VIN completo, lo toma tal cual.
2. Si no, lee el texto con PaddleOCR (PP-OCRv4 sobre onnxruntime-web), limitado a letras y números.
3. Se queda con los grupos de 7 u 8 caracteres, prioriza el texto más grande y usa los códigos de barras para corregir caracteres dudosos.

Con las 34 fotos de prueba: 32 bien en primera opción. Las otras dos: una etiqueta muy borrosa, y un cristal donde el 5 grabado parece S (se ofrece la corrección como opción).
