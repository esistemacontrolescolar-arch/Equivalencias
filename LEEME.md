# Predictamen de Equivalencias IUV

En línea: **https://predictamen-equivalencias.netlify.app**

También funciona sin internet: abre `app/index.html` con doble clic (Chrome, Edge o Safari). Todo se procesa en el navegador; los kárdex no se envían a ningún servidor.

## Cómo se usa

1. **Alumno y carrera:** escribe el nombre y busca la carrera IUV destino (por nombre o RVOE).
2. **Materias que ya cursó:** arrastra el kárdex (Excel, CSV o PDF), pega la lista o, si viene de otro plan IUV, elige ese plan y captura las calificaciones.
   - Si mandan boletas por separado, arrastra todos los PDF a la vez o súbelos conforme lleguen: se suman. Una materia repetida se queda una sola vez con la calificación más alta.
   - **PDF escaneados (fotos o escáner):** se leen solos con OCR, sin internet. Tarda unos 15 segundos por página.
     - También acepta **fotos y capturas de pantalla** (PNG/JPG) y endereza solo las hojas que vienen giradas.
     - Encuentra la columna de calificaciones aunque no se lea el encabezado, y no la confunde con la de créditos.
     - Entiende calificaciones de 0 a 100 (93 = 9.3).
     - Descarta lo que hay fuera de la tabla (sellos, fotos, franjas de texto).
     - Cada calificación la lee de varias maneras y se queda con la que más coincide.
     - Revisa lo que leyó: si no pudo leer una calificación, la casilla queda en rojo para que la escribas.
   - **Kárdex con columnas extra** (créditos, tipo, periodo, como "COMPUTACION BASICA 6 T 201601"): se quitan del nombre y el periodo (2016-01) se pone en su columna. Los nombres largos partidos en dos renglones se unen solos ("HABILIDADES DEL PENSAMIENTO CRITICO" + "CREATIVO").
   - **Reincorporación / cambio de carrera:** al cargar el kárdex, la app reconoce de qué programa IUV son las materias. Si aún no eliges carrera, te sugiere el programa (con un clic lo elige, marca "Reincorporación" y pone "IUV Universidad"). Si el trámite dice "Equivalencia", te avisa que parece reincorporación. Las materias con 0 (sin calificar o reprobadas) salen como no acreditadas.
   - También puedes arrastrar el Excel del sistema anterior (`Sistema de Predictamen...xlsx`) y elegir un expediente.
3. **Revisión:** el sistema empareja las materias solo. Revisa las marcadas con **Revisar** (confírmalas con ✓). Para cambiar o agregar una materia usa **Elegir materia…**: tiene buscador y sugiere primero las más parecidas. Con **+ Integrar otra** juntas varias materias de origen en una (se promedian) y con **×** quitas una.
4. **Dictamen:** elige el periodo de inicio y luego **Imprimir / PDF**, **Descargar Excel** o **Guardar expediente**.

## Reglas (las mismas del Apps Script del Sheets)

- **Comparación de nombres:** es la misma idea que `similitudTextos()` del Sheets (misma limpieza de nombres, mismos umbrales y misma regla de materias seriadas: Amparo II ↔ Amparo II = 90%, ↔ Amparo III = 70%, ↔ Amparo I = 30%), con mejoras de precisión:
  - Cada palabra pesa según qué tan distintiva es dentro del plan IUV. Por ejemplo, "educación física" se repite en casi todo ese plan y pesa poco.
  - Si a uno de los nombres le sobra una parte importante, la equivalencia nunca es automática, queda en "Revisar". Por ejemplo: "Economía" / "Economía de la salud", "Base de datos" / "Base de datos avanzadas", "Taller de radio" / "Taller de radio I".
  - Cuentan como la misma palabra los plurales, el género y las erratas u OCR ("coporal" = "corporal"). "Informática" y "Computación" = "Tecnologías de la información".
  - **Por área de conocimiento:** materias con nombres distintos pero del mismo tema se proponen como "Revisar" (nunca automáticas). Por ejemplo: "Computación básica" ↔ "Sistemas y tecnologías de la información", "Lectura y redacción…" ↔ "Estrategias para el estudio y la comunicación", "Inglés II" ↔ "Lengua extranjera", "Habilidades del pensamiento crítico y creativo" ↔ "Pensamiento crítico". Áreas: idiomas, cómputo, lectura/redacción, pensamiento, estadística, investigación, ética, desarrollo personal, emprendimiento, contabilidad, economía, mercadotecnia, cálculo, amparo, globalización, sociología y psicología.
  - Resultado contra los dictámenes reales del Excel: 0 equivalencias automáticas incorrectas. En todo el catálogo, los pares de materias distintas aceptadas como equivalentes bajaron de 730 a 189, y los que quedan son erratas, plurales u orden de palabras.
- **Umbrales (hoja CONFIGURACION):**
  - 85% o más: se marca como equivalente automáticamente.
  - Entre 60% y 85%: queda "por revisar" y **no cuenta** hasta que la confirmes con ✓.
- **Equivalencia integrada:** cada materia acreditada se propone a su materia IUV más parecida. Si varias caen en la misma, se promedian. También se integran solas cuando juntas cubren el nombre IUV: "Cálculo diferencial" + "Cálculo integral" = "Cálculo diferencial e integral" (9.1 y 10 → 9.55).
- **Calificaciones:** menor a la mínima = no acreditada. En reincorporación y cambio de carrera, las materias sin calificación se ignoran.
- **Periodo sugerido:** avanza ciclo por ciclo mientras lo que adeuda de ciclos anteriores cumpla con todo esto:
  - 6 materias o menos
  - 2 o menos del mismo ciclo
  - 30% del plan o menos

  Si no puede pasar del 1er ciclo, el resultado es **NO CUMPLE**.

## Aprende de las equivalencias que confirmas

Las equivalencias con nombre distinto (ej. "Informática I" → "Sistemas y tecnologías de la información I") se toman de los dictámenes que ya existían en el Excel. Además, cada expediente que guardas enseña al sistema las equivalencias que confirmaste. Todo se guarda en este navegador.

## Actualizar planes de estudio

Si cambian los planes en el Excel:

```
pip install openpyxl
python3 herramientas/actualizar_catalogo.py "Sistema de Predictamen de Equivalencias IUV.xlsx"
```

## Conexión con la plataforma

El botón **Exportar JSON** genera un archivo con los datos del alumno, el resultado y la tabla completa del dictamen. Ese archivo es el que se conectaría con la plataforma de la escuela.

## Publicar cambios en Netlify

Lo que se sube es solo la carpeta `app/`. Desde la carpeta `equivalencias`:

```
npx netlify-cli deploy --dir app --prod
```
