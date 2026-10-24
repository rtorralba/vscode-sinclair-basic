# Guión de Presentación: Sinclair BASIC para VS Code

* **Duración estimada:** 8 - 10 minutos
* **Objetivo:** Presentar las capacidades del IDE dando prioridad absoluta al Sinclair BASIC tradicional (`.bas`) con números de línea para el público clásico, dejando las funciones avanzadas de `.jbas` como un extra moderno al final.

---

## Estructura General

1. **Introducción y el problema** (0:00 - 1:00)
2. **Sinclair BASIC clásico (`.bas`): Ergonomía y edición** (1:00 - 3:30)
3. **Compilación nativa a `.tap` y Emulador integrado 100% Offline** (3:30 - 5:30)
4. **La joya de la corona: Depuración interactiva en tiempo real (DAP)** (5:30 - 7:30)
5. **Compartir tu juego por URL web con un solo clic** (7:30 - 8:15)
6. **Para quien quiera ir más allá: `.jbas` (Modern Sinclair BASIC)** (8:15 - 9:30)
7. **Conclusión y cierre** (9:30 - 10:00)

---

## 1. Introducción y el problema (0:00 - 1:00)

**[Acción en pantalla]:** Plano del presentador o captura de pantalla de un emulador con la mítica cabecera:  
`© 1982 Sinclair Research Ltd` o un bloc de notas plano con un listado BASIC monocolor.

> **Locución:**  
> *"Programar en Sinclair BASIC para el ZX Spectrum sigue teniendo una magia irrepetible, pero seamos sinceros: picar código en el emulador clásico o en un editor de texto plano sin herramientas modernas puede llegar a ser muy tedioso.*  
>  
> *Hoy os quiero enseñar **Sinclair BASIC para Visual Studio Code**, una extensión creada para darle a la comunidad de desarrolladores del Spectrum un entorno de desarrollo profesional, ágil y moderno, **sin perder ni un ápice de la esencia y del sabor clásico**."*

---

## 2. Sinclair BASIC clásico (`.bas`): El paraíso del purista (1:00 - 3:30)

**[Acción en pantalla]:** Abrir un archivo `.bas` estándar con números de línea (ej. un bucle clásico con `PRINT`, `BORDER`, `BEEP`, `FOR..NEXT`).

> **Locución:**  
> *"Lo primero y más importante: **aquí el Sinclair BASIC con números de línea es un ciudadano de primera clase**. No necesitas aprender ningún lenguaje nuevo ni cambiar tus hábitos de programación si no quieres."*

### A. Coloreado sintáctico completo y formateo de mayúsculas
**[Acción en pantalla]:** Mostrar cómo resalta las keywords en minúsculas y pulsar `Shift+Alt+F` (Format Document). Todo pasa a MAYÚSCULAS instantáneamente respetando las cadenas de texto y los `REM`.

> **Locución:**  
> *"Fijaos en el coloreado sintáctico: reconoce absolutamente todas las sentencias, funciones matemáticas y de cadena (`VAL`, `CODE`, `CHR$`, `PEEK`, `INKEY$`), directivas de color (`INK`, `PAPER`, `FLASH`, `BRIGHT`) y notaciones binarias del Spectrum.*  
>  
> *Además, si te resulta más cómodo teclear en minúsculas, con un solo atajo (`Shift+Alt+F`), la extensión formatea todas las palabras clave a las mayúsculas oficiales de Sinclair BASIC, protegiendo escrupulosamente los textos entre comillas y los comentarios `REM`."*

### B. Navegación con `Ctrl+Click` (Go to Definition)
**[Acción en pantalla]:** Poner el cursor sobre un `GO SUB 500` o `GO TO 120`. Mantener pulsado `Ctrl`, hacer clic en el número de línea y saltar automáticamente a la línea de destino.

> **Locución:**  
> *"¿Cuántas veces os habéis perdido en un listado largo buscando a dónde apuntaba un `GO TO` o un `GO SUB`? Aquí tenemos **navegación Go to Definition**: haces `Ctrl+Click` (o pulsas `F12`) en cualquier número de salto —incluso en saltos múltiples como `ON x GO SUB 100, 200, 300`— y el editor te transporta de inmediato a esa línea del código."*

### C. Plegado semántico de subrutinas (`Code Folding`)
**[Acción en pantalla]:** Hacer clic en la flechita del lateral del editor para plegar una subrutina que va desde el número de inicio hasta su sentencia `RETURN`.

> **Locución:**  
> *"Para mantener el código organizado, la extensión detecta automáticamente las subrutinas llamadas con `GO SUB` y nos permite plegar y desplegar el bloque completo en el lateral de VS Code hasta su sentencia `RETURN`."*

### D. Renumerador inteligente integrado (`Ctrl+Alt+R`)
**[Acción en pantalla]:** Pulsar `Ctrl+Alt+R`, pedir renumerar de 10 en 10 desde la línea 10. Mostrar cómo se actualizan automáticamente todos los destinos de salto (`GO TO`, `GO SUB`, `RESTORE`, `RUN`, `LINE`, `THEN`). Luego pulsar `Ctrl+Z` para deshacer.

> **Locución:**  
> *"Y por supuesto, el renumerador inteligente: pulsas `Ctrl+Alt+R`, eliges la línea de inicio y el incremento, y el motor actualiza automáticamente todos los saltos del programa sin tocar los números que estén dentro de cadenas o comentarios. Si quieres revisar el cambio, con un simple `Ctrl+Z` deshaces la operación al instante."*

---

## 3. Compilación nativa a cinta `.tap` y Emulador 100% Offline (3:30 - 5:30)

**[Acción en pantalla]:** Pulsar `Ctrl+Shift+B` (Build TAP). Se genera la cinta en `dist/` en milisegundos sin requerir herramientas externas instaladas en el sistema.

> **Locución:**  
> *"Olvídate de configurar herramientas externas, ejecutables `.exe` o scripts de Python. La extensión incluye un **generador de cintas `.tap` nativo en JavaScript puro** que compila directamente con autostart automático.*  
>  
> *Soporta además comodines de atributos como `{PAPER n}`, `{INK n}`, `{AT y, x}` y `{CODE n}`, y de forma paralela te genera siempre un archivo `.sinclair.bas` con los códigos `CHR$` estándar si quieres portarlo a otros entornos."*

### El emulador integrado (Turbo80)
**[Acción en pantalla]:** Pulsar `Ctrl+F5`. Se abre un panel lateral dentro de VS Code ejecutando el juego en Turbo80 con sonido auténtico y scanlines CRT.

> **Locución:**  
> *"Y ahora la magia de la inmediatez: pulsas `Ctrl+F5` y tu programa arranca **dentro del propio Visual Studio Code**.*  
>  
> *Lleva integrado **Turbo80** (el emulador web de José Enrique García / Incinerator), empaquetado de forma **100% local y offline**, sin depender de conexión a internet. Soporta modelos 48K y 128K, sonido real, teclado en pantalla y shader CRT con curvatura de televisor clásico."*

---

## 4. La joya de la corona: Depuración interactiva paso a paso (5:30 - 7:30)

**[Acción en pantalla]:** Poner un breakpoint en una línea con `F9`. En una línea con varias sentencias separadas por dos puntos (`LET a=1: LET b=2`), poner un breakpoint en la segunda sentencia (`Shift+F9`). Pulsar `F5` para iniciar depuración.

> **Locución:**  
> *"Esto que vais a ver es único: **depurador interactivo integrado con los paneles nativos de depuración de VS Code (DAP)**.*  
>  
> *Interviniendo el despachador de sentencias de la ROM del 48K (`0x1B3D`), el Spectrum corre a 50 FPS sin ralentizaciones hasta alcanzar el punto marcado:*
>  
> 1. *La ejecución se congela y VS Code resalta exactamente la línea y sentencia actual.*  
> 2. *En el panel **Variables** de VS Code puedes inspeccionar la memoria RAM en tiempo real: números en coma flotante de 5 bytes decodificados, bucles `FOR` y cadenas de texto con visor carácter a carácter.*  
> 3. *Controlas todo desde la barra nativa: avanzar sentencia a sentencia con `F11` (Step Into), saltar de línea con `F10` (Step Over), pausar con `F6` o reanudar con `F5`.*  
> 4. *Soporta **Inline Breakpoints** en sentencias individuales dentro de la misma línea."*

---

## 5. Compartir con el mundo en un solo clic (7:30 - 8:15)

**[Acción en pantalla]:** Clic derecho en el editor -> `Sinclair BASIC: Share on Turbo80.com`. Se ve la barra de progreso notificando: *"Subiendo archivo .tap..."* -> *"Verificando integridad..."* -> Aparece el diálogo con el enlace web listo y copiado al portapapeles. Abrirlo en el navegador.

> **Locución:**  
> *"¿Has programado un juego o una rutina y quieres que alguien la pruebe al instante en su móvil, tablet o PC sin instalar nada?*  
>  
> *Haces clic derecho, eliges **Compartir en Turbo80**, y la extensión compila la cinta, la aloja con comprobación de integridad y te genera un enlace web listo para jugar. Tu amigo abre el enlace en cualquier navegador moderno y está jugando a tu programa en segundos."*

---

## 6. Para los que quieren ir más allá: `.jbas` (8:15 - 9:30)

**[Acción en pantalla]:** Abrir un archivo con extensión `.jbas` (mostrando código estructurado con etiquetas `@bucle_principal:`, indentaciones y comentarios `'`).

> **Locución:**  
> *"Y para terminar, para aquellos programadores que quieran abordar proyectos de mayor envergadura, la extensión incluye soporte opcional para **`.jbas`**, un formato moderno que elimina las ataduras de los años 80:*
>  
> * **Sin números de línea obligatorios**: Escribe código limpio con indentación moderna.  
> * **Etiquetas legibles**: En lugar de `GO TO 340`, escribes `GO TO @game_over` o `GO SUB @pintar_marcador`.  
> * **Comentarios ágiles con comilla simple (`'`)**: Como en los lenguajes contemporáneos.  
> * **Compilación multi-versión**: Al compilar, genera automáticamente una versión compactada al máximo (1 en 1 sin comentarios y con compresión de espacios en operadores) para ahorrar cada byte de cinta y RAM del Spectrum, y otra documentada con comentarios `REM`.  
> * Y gracias a las tablas de correspondencia (*Source Mapping*), **puedes depurar paso a paso directamente sobre tu código `.jbas`**, viendo tus etiquetas y tus líneas sin números mientras el emulador ejecuta el BASIC compilado por debajo."*

---

## 7. Conclusión y llamada a la acción (9:30 - 10:00)

**[Acción en pantalla]:** Mostrar la ficha de la extensión en el Marketplace de Visual Studio Code y el repositorio en GitHub.

> **Locución:**  
> *"Tanto si eres un apasionado del Sinclair BASIC clásico de toda la vida que busca coloreado fiel, renumeración y emulación rápida, como si buscas crear un juego grande sin números de línea con `.jbas`, esta extensión reúne lo mejor de ambos mundos.*  
>  
> *La tenéis disponible gratis en el Marketplace de VS Code buscando **Sinclair BASIC**.*  
>  
> *¡Pruébalo, desempolva tus viejos listados y cuéntame qué te parece! Nos vemos en el próximo vídeo. ¡Larga vida al Spectrum!"*

---

### Consejos para la demo en vídeo
* **Archivo de prueba clásico:** Prepara un `.bas` corto pero vistoso con algún `BORDER`, `INK`, `PAPER` y un `BEEP` para que al pulsar `Ctrl+F5` entre por los ojos y por los oídos.
* **El momento clave:** La depuración interactiva con `F5` y la inspección de variables en RAM es la función más diferencial respecto a cualquier otro editor existente.
