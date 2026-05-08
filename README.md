# 📚 Mi Plan de Estudio - 6° SA Santa Úrsula de Maipú

App personalizada para ayudar a estudiar, con resúmenes automáticos por IA, quizzes, planificador de evaluaciones, tareas del hogar con evidencia fotográfica, y panel de control para mamá.

## ✨ Características

- 📅 **Planificador escolar**: Lee PDFs del plan semanal y cronograma de evaluaciones
- 🤖 **Resúmenes con IA**: Sube textos del MINEDUC y genera resúmenes automáticos
- 🎮 **Quizzes interactivos**: 5 preguntas por materia con retroalimentación inmediata
- 🏠 **Tareas del hogar**: Checklist diario con evidencia fotográfica
- 👩 **Panel Mamá**: Control parental con estadísticas en tiempo real
- ⭐ **Sistema de estrellitas**: Recompensas unificadas (estudio + hogar)

## 🚀 Instalación

### Requisitos
- Node.js 18+ (descargar de https://nodejs.org)

### Pasos

1. **Descomprime el archivo** en tu computador

2. **Abre la terminal** en la carpeta del proyecto:
   ```bash
   cd mi-plan-estudio
   ```

3. **Instala dependencias**:
   ```bash
   npm install
   ```

4. **Inicia el servidor**:
   ```bash
   npm start
   ```

5. **Abre en el navegador**:
   - En el celular de tu hija: `http://TU-IP:3000`
   - Para ver tu IP: en la terminal escribe `ipconfig` (Windows) o `ifconfig` (Mac/Linux)

## 📱 Uso diario

### Para tu hija:
1. Abre la app en su celular
2. Ve "Hoy" para ver clases y tareas
3. Completa tareas del hogar (con foto si aplica)
4. Estudia en "Estudiar" → elige materia → lee resumen → haz quiz
5. Gana estrellitas 🌟

### Para ti (mamá):
1. Toca "👩 Panel Mamá" arriba a la derecha
2. Revisa evidencias de tareas y aprueba/rechaza
3. Ve progreso de estudio y estrellitas
4. Sube nuevos materiales del MINEDUC en "Estudiar"

## 🔧 Configuración inicial

### Subir evaluaciones (hazlo una vez):
Envía una petición POST a `/api/evaluaciones` con:
```json
{
  "fecha": "2026-05-15",
  "asignatura": "aleman",
  "tipo": "Klassenarbeit",
  "titulo": "Hilfe, ich muss aufräumen",
  "descripcion": "Verbos separables y vocabulario del hogar"
}
```

### Subir plan semanal:
En "Estudiar" → sube el PDF del plan semanal. La app lo parsea automáticamente.

## 🗂️ Estructura del proyecto

```
mi-plan-estudio/
├── package.json          # Dependencias
├── server.js             # Backend (Express + SQLite)
├── database.sqlite       # Base de datos (se crea automáticamente)
├── uploads/              # Archivos subidos
│   ├── planes/           # Planes semanales
│   ├── materiales/       # Textos del MINEDUC
│   └── evidencias/       # Fotos de tareas
└── public/
    └── index.html        # Frontend completo
```

## 🔮 Próximas mejoras

- [ ] Notificaciones push para recordatorios
- [ ] Integración con WhatsApp (avisos a mamá)
- [ ] IA avanzada para resúmenes más precisos
- [ ] Reporte semanal automático por email
- [ ] Modo oscuro

## 💝 Hecho con amor

Para una estudiante de 6° básico con TDAH y autismo, del Colegio Santa Úrsula de Maipú.
