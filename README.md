# DocuLingua (translateActivity) — POC Translate

> **Traductor Inteligente de Libros y PDFs Técnicos con Superposición Visual In-Situ y Motor Google Lens OCR.**

DocuLingua es una aplicación bilingüe diseñada para la lectura y traducción interactiva de documentos PDF digitales y escaneados. Permite visualizar el documento original y su traducción al español en paralelo, o superponer recuadros con las palabras traducidas **exactamente encima del texto original en inglés**, preservando la diagramación visual, tipografía y estructura del documento.

---

## 🌟 Características Principales

### 1. Motor Híbrido de Extracción y Google Lens OCR
- **PDFs Digitales con capa de texto**: Extracción de coordenadas tipográficas exactas calculando la línea base (*baseline*) mediante la matriz de transformación del glifo (`[tx, ty - 0.22*fontSize, tx + w, ty + 0.88*fontSize]`).
- **PDFs Escaneados o con Dibujos/Bocetos**: Integración directa con la API gratuita de **Google Lens OCR** (`chrome-lens-ocr`). A diferencia de motores tradicionales como Tesseract, Google Lens no alucina caracteres sobre líneas de lápiz, sombras o sombreados artísticos, entregando coordenadas normalizadas por línea con precisión milimétrica.
- **Fallback Automático**: Si el servicio de Lens no está disponible o no hay conexión, el sistema recurre de forma transparente a **Tesseract.js** en el cliente.

### 2. Algoritmo de Coherencia Fonotáctica y Validación Léxica (`textCoherence.ts`)
- Filtro fonotáctico avanzado con diccionario integrado de más de 800 palabras en inglés.
- Análisis de densidad vocálica, límites de clusters consonánticos y detección de ruido tipográfico.
- Descarta artefactos de escaneo y trazos antes de enviarlos al traductor, garantizando traducciones limpias y sin basura textual.

### 3. Superposición Visual Ceñida (*In-Place Overlay*)
- **Alineación exacta sobre las palabras originales**: Cada frase o título se posiciona en las coordenadas absolutas (`left`, `top`, `minWidth`, `minHeight`) del texto original.
- **Sin recuadros gigantes fusionados**: El algoritmo `cleanAndGroupParagraphs` analiza variaciones de tamaño de letra (`heightRatio`), mayúsculas sostenidas (`isAllUpper`), sangrías y espaciado vertical (`verticalGap`), manteniendo títulos, autores y párrafos como bloques independientes.
- **Tipografía adaptativa (`getAdaptiveFontSize`)**: Escala dinámicamente el tamaño de la fuente traducida (de 8px a 32px) para que coincida armoniosamente con el peso visual del texto original en inglés.

### 4. Persistencia Local en Bóveda IndexedDB (`WebFileStore.ts`)
- Almacenamiento local mediante base de datos IndexedDB (`DocuLinguaVault_v1`).
- Permite reabrir documentos previamente cargados sin volver a seleccionarlos desde el explorador del sistema de archivos.

### 5. Traducción en Tiempo Real
- Soporte para traducción automática gratuita mediante Google Translate, OpenAI GPT o DeepL.
- Visualización de barra de progreso y traducción concurrente con reintentos automáticos.

---

## 📐 Arquitectura del Sistema

```
translateActivity/
├── scripts/
│   └── lens-ocr-server.js        # Microservicio local de Google Lens OCR (Puerto 5055)
├── metro.config.js               # Middleware de Metro con endpoint integrado (/api/lens-ocr)
├── src/
│   ├── modules/
│   │   ├── pdf/
│   │   │   ├── PdfExtractor.ts       # Extractor web, cálculo de baselines y pipeline OCR
│   │   │   └── PdfWebViewExtractor.tsx # Bridge nativo WebView para Android
│   │   └── translator/
│   │       └── TranslationService.ts # Motor concurrente de traducción con streaming
│   ├── screens/
│   │   ├── DualViewer/
│   │   │   └── DualViewerScreen.tsx  # Visor interactivo dual con modo Overlay y Split
│   │   ├── Library/
│   │   │   └── LibraryScreen.tsx     # Gestión de biblioteca y selector de documentos
│   │   └── Settings/
│   │       └── SettingsScreen.tsx    # Configuración de proveedores (Google, OpenAI, DeepL)
│   ├── storage/
│   │   └── WebFileStore.ts           # Bóveda persistente IndexedDB para PDFs en Web
│   └── utils/
│       └── textCoherence.ts          # Validador léxico y filtro de ruido fonotáctico
├── App.tsx                       # Orquestador principal de navegación
└── package.json                  # Dependencias y scripts de ejecución
```

---

## 🚀 Requisitos Previos

- **Node.js**: v18.0.0 o superior (recomendado v20 LTS).
- **npm**: v9.0.0 o superior.
- Navegador web moderno (Chrome, Edge, Firefox, Brave) o dispositivo Android con Expo Go.

---

## 📦 Instalación

1. Clona el repositorio y sitúate en la raíz del proyecto:
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd translateActivity
   ```

2. Cambia a la rama de desarrollo:
   ```bash
   git checkout POCTranslate
   ```

3. Instala las dependencias:
   ```bash
   npm install
   ```

---

## 💻 Instrucciones de Ejecución

### Opción 1: Ejecución en Entorno Web (Recomendada)

Para disfrutar de la máxima precisión de **Google Lens OCR** junto con la interfaz web:

1. **Iniciar el servidor Google Lens OCR** (en una terminal):
   ```bash
   npm run ocr:server
   ```
   *El servidor quedará a la escucha en `http://localhost:5055`.*

2. **Iniciar la aplicación web Expo** (en una segunda terminal):
   ```bash
   npm run web
   ```
   *La aplicación se abrirá automáticamente en tu navegador en `http://localhost:8081`.*

> **Nota:** `metro.config.js` también incluye el middleware `/api/lens-ocr`, por lo que el OCR funcionará directamente incluso si solo ejecutas `npm run web`.

---

### Opción 2: Ejecución en Dispositivo o Emulador Android

1. Asegúrate de tener configurado Android Studio o un dispositivo con **Expo Go**.
2. Ejecuta:
   ```bash
   npm run android
   ```

---

## 📖 Flujo de Uso

1. **Cargar un PDF**:
   - En la pantalla de Biblioteca, pulsa **"Abrir Documento PDF"** y selecciona cualquier archivo PDF (libro técnico, manual o documento escaneado).
2. **Visualizar el documento**:
   - El visor abrirá automáticamente la página 1 en modo **Dual**.
   - En la columna izquierda verás la página original. En la derecha, la traducción en tiempo real.
3. **Modo Superposición en Imagen (*Overlay*)**:
   - Pulsa el botón **"Ver en Imagen"** en la columna de traducción para activar la superposición.
   - Las palabras en español cubrirán exactamente los textos en inglés sobre la imagen original.
4. **Re-analizar o Refrescar**:
   - Si una página fue escaneada, puedes pulsar el icono **🔄** en el encabezado para re-ejecutar el análisis OCR y traducción.
5. **Navegación**:
   - Usa los botones anterior/siguiente o pulsa sobre **"Pág. X de Y ▾"** para saltar directamente a cualquier página.

---

## 🛠️ Tecnologías Empleadas

- **Frontend Core**: React 19, React Native 0.86, Expo 57, React Native Web.
- **Procesamiento de PDFs**: `pdfjs-dist` (renderizado canvas y matrices de transformación de texto).
- **OCR Avanzado**: `chrome-lens-ocr` (Google Lens Vision API sin cuotas ni API keys) + `tesseract.js` (fallback local).
- **Traducción**: Integración directa con Google Translate API, DeepL y OpenAI.
- **Persistencia**: IndexedDB para Web y sandboxed caching para Android.
