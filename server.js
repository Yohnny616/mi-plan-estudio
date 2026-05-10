const express = require('express');
const { Pool } = require('pg');

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mi-plan-estudio-secret-key-2026';
const UPLOADS_DIR = process.env.RENDER ? './uploads' : 'uploads';
const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Crear directorios necesarios
[UPLOADS_DIR, `${UPLOADS_DIR}/planes`, `${UPLOADS_DIR}/materiales`, `${UPLOADS_DIR}/evidencias`, `${UPLOADS_DIR}/temp`].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// BASE DE DATOS - INICIALIZACIÓN
async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (
            id SERIAL PRIMARY KEY,
            nombre TEXT NOT NULL,
            email TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            rol TEXT NOT NULL CHECK(rol IN ('hijo', 'padre')),
            activo INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS plan_semanal (
            id SERIAL PRIMARY KEY,
            semana_inicio DATE,
            semana_fin DATE,
            dia TEXT,
            hora_inicio TEXT,
            hora_fin TEXT,
            asignatura TEXT,
            actividad TEXT,
            material TEXT,
            evaluacion TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS evaluaciones (
            id SERIAL PRIMARY KEY,
            fecha DATE,
            asignatura TEXT,
            tipo TEXT,
            titulo TEXT,
            descripcion TEXT,
            estado TEXT DEFAULT 'pendiente',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS materiales (
            id SERIAL PRIMARY KEY,
            asignatura TEXT,
            titulo TEXT,
            archivo_path TEXT,
            contenido_extraido TEXT,
            resumen TEXT,
            tipo TEXT,
            subido_por INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (subido_por) REFERENCES usuarios(id)
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS tareas_hogar (
            id SERIAL PRIMARY KEY,
            titulo TEXT,
            emoji TEXT,
            horario TEXT,
            requiere_foto INTEGER DEFAULT 0,
            dia_semana TEXT,
            orden INTEGER,
            activa INTEGER DEFAULT 1
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS tareas_completadas (
            id SERIAL PRIMARY KEY,
            tarea_id INTEGER,
            hijo_id INTEGER,
            fecha DATE,
            completada INTEGER DEFAULT 0,
            foto_path TEXT,
            aprobada_padre INTEGER DEFAULT 0,
            comentario_padre TEXT,
            revisado_por INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tarea_id) REFERENCES tareas_hogar(id),
            FOREIGN KEY (hijo_id) REFERENCES usuarios(id),
            FOREIGN KEY (revisado_por) REFERENCES usuarios(id)
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS estrellitas (
            id SERIAL PRIMARY KEY,
            hijo_id INTEGER,
            asignatura TEXT,
            cantidad INTEGER DEFAULT 0,
            fecha DATE,
            motivo TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (hijo_id) REFERENCES usuarios(id)
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS actividad_log (
            id SERIAL PRIMARY KEY,
            hijo_id INTEGER,
            tipo TEXT,
            descripcion TEXT,
            asignatura TEXT,
            duracion_minutos INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (hijo_id) REFERENCES usuarios(id)
        )`);

        // Usuarios por defecto
        const userCount = await pool.query("SELECT COUNT(*) FROM usuarios");
        if (parseInt(userCount.rows[0].count) === 0) {
            const hashPadre = bcrypt.hashSync('padre2026', 10);
            const hashHijo = bcrypt.hashSync('hija2026', 10);
            await pool.query(`INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4)`,
                ['Papá/Mamá', 'padres@familia.cl', hashPadre, 'padre']);
            await pool.query(`INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4)`,
                ['Hija', 'hija@familia.cl', hashHijo, 'hijo']);
        }

        // Tareas por defecto
        const taskCount = await pool.query("SELECT COUNT(*) FROM tareas_hogar");
        if (parseInt(taskCount.rows[0].count) === 0) {
            const tareasDefault = [
                ['Tender la cama', '🛏️', 'Al levantarse', 0, 'todos', 1],
                ['Limpiar cuarto (10 min)', '🧹', 'Después de la tarea', 1, 'todos', 2],
                ['Ordenar mi lugar en la mesa', '🍽️', 'Después de almorzar', 1, 'todos', 3],
                ['Preparar mochila para mañana', '🎒', 'Antes de dormir', 1, 'todos', 4],
                ['Lavar dientes y pijama en su lugar', '🪥', 'Antes de dormir', 0, 'todos', 5],
                ['Sacar la basura', '🗑️', 'Después de almuerzo', 1, 'martes', 6],
                ['Regar las plantas', '🌱', 'Después de la escuela', 1, 'miercoles', 7],
                ['Ordenar zapatos en la entrada', '👟', 'Al llegar del colegio', 0, 'todos', 8]
            ];
            for (let t of tareasDefault) {
                await pool.query(`INSERT INTO tareas_hogar (titulo, emoji, horario, requiere_foto, dia_semana, orden) VALUES ($1, $2, $3, $4, $5, $6)`, t);
            }
        }
    } catch (err) {
        console.error("Error inicializando DB:", err);
    }
}
initDB();

// MULTER - Usar directorio de uploads configurable
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const folder = req.params.tipo || 'temp';
        cb(null, `${UPLOADS_DIR}/${folder}`);
    },
    filename: (req, file, cb) => {
        const unique = uuidv4() + path.extname(file.originalname);
        cb(null, unique);
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ===== MIDDLEWARE DE AUTENTICACIÓN =====
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido' });
    }
}

function requirePadre(req, res, next) {
    if (req.user.rol !== 'padre') {
        return res.status(403).json({ error: 'Solo padres pueden realizar esta acción' });
    }
    next();
}

function requireHijo(req, res, next) {
    if (req.user.rol !== 'hijo') {
        return res.status(403).json({ error: 'Solo hijos pueden realizar esta acción' });
    }
    next();
}

// ===== AUTH ROUTES =====
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query(`SELECT * FROM usuarios WHERE email = $1 AND activo = 1`, [email]);
        const user = result.rows[0];
        if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

        const valid = bcrypt.compareSync(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Contraseña incorrecta' });

        const token = jwt.sign(
            { id: user.id, nombre: user.nombre, rol: user.rol, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: { id: user.id, nombre: user.nombre, rol: user.rol, email: user.email }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/registro', authMiddleware, requirePadre, async (req, res) => {
    const { nombre, email, password, rol } = req.body;
    if (!['hijo', 'padre'].includes(rol)) {
        return res.status(400).json({ error: 'Rol debe ser hijo o padre' });
    }

    const hash = bcrypt.hashSync(password, 10);
    try {
        const result = await pool.query(`INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING id`,
            [nombre, email, hash, rol]);
        res.json({ id: result.rows[0].id, success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json(req.user);
});

// ===== FUNCIONES AUXILIARES =====
function extraerTextoPDF(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    return pdfParse(dataBuffer).then(data => data.text);
}

function extraerTextoDOCX(filePath) {
    return mammoth.extractRawText({ path: filePath }).then(result => result.value);
}

function generarResumenIA(texto, asignatura) {
    const lineas = texto.split('\n').filter(l => l.trim().length > 10);
    const puntosClave = lineas.slice(0, 8).map(l => `• ${l.trim().substring(0, 120)}...`);
    return {
        resumen: puntosClave.join('\n'),
        tiempo_lectura: Math.ceil(puntosClave.length * 0.5)
    };
}

// ===== API ROUTES - PLAN SEMANAL =====
app.post('/api/plan/subir', authMiddleware, requirePadre, upload.single('plan'), async (req, res) => {
    try {
        const filePath = req.file.path;
        const texto = await extraerTextoPDF(filePath);
        
        const prompt = `Actúa como un asistente escolar. Extrae el horario de clases del siguiente texto de un plan semanal.
        Identifica para cada bloque de clases: dia (LUNES, MARTES, MIERCOLES, JUEVES o VIERNES), hora_inicio (HH:MM), hora_fin (HH:MM), asignatura (ej: Matemática, Lenguaje) y actividad (breve descripción o tema).
        Devuelve ÚNICAMENTE un array JSON válido con esos campos.
        Texto: ${texto}`;

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let jsonStr = response.text().replace(/```json|```/g, '').trim();
        const planItems = JSON.parse(jsonStr);

        for (let item of planItems) {
            await pool.query(
                `INSERT INTO plan_semanal (semana_inicio, semana_fin, dia, hora_inicio, hora_fin, asignatura, actividad) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [req.body.semana_inicio, req.body.semana_fin || req.body.semana_inicio, item.dia, item.hora_inicio, item.hora_fin, item.asignatura, item.actividad || 'Clase regular']
            );
        }

        fs.unlinkSync(filePath);
        res.json({ success: true, items: planItems.length });
    } catch (err) {
        console.error("Error IA Plan:", err);
        res.status(500).json({ error: 'Error procesando plan: ' + err.message });
    }
});

app.post('/api/evaluaciones/subir', authMiddleware, requirePadre, upload.single('archivo'), async (req, res) => {
    try {
        const filePath = req.file.path;
        const texto = await extraerTextoPDF(filePath);
        
        const prompt = `Extrae TODAS las evaluaciones (pruebas, trabajos, controles) del siguiente texto de un cronograma escolar. 
        Para cada evaluación identifica: fecha (formato YYYY-MM-DD), asignatura, tipo (Prueba, Trabajo, etc) y título.
        Responde ÚNICAMENTE con un array JSON de objetos.
        Texto: ${texto}`;

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let jsonStr = response.text().replace(/```json|```/g, '').trim();
        const evaluaciones = JSON.parse(jsonStr);

        for (const ev of evaluaciones) {
            await pool.query(
                'INSERT INTO evaluaciones (fecha, asignatura, tipo, titulo, descripcion) VALUES ($1, $2, $3, $4, $5)',
                [ev.fecha, ev.asignatura, ev.tipo || 'Prueba', ev.titulo, '']
            );
        }

        fs.unlinkSync(filePath);
        res.json({ success: true, count: evaluaciones.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error procesando cronograma: ' + err.message });
    }
});

app.get('/api/plan/hoy', authMiddleware, async (req, res) => {

    const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const hoy = dias[new Date().getDay()].toUpperCase();
    try {
        const result = await pool.query(`SELECT * FROM plan_semanal WHERE dia = $1 ORDER BY hora_inicio`, [hoy]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ===== API ROUTES - EVALUACIONES =====
app.get('/api/evaluaciones', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM evaluaciones WHERE fecha >= CURRENT_DATE ORDER BY fecha`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/evaluaciones', authMiddleware, requirePadre, async (req, res) => {
    const { fecha, asignatura, tipo, titulo, descripcion } = req.body;
    try {
        const result = await pool.query(`INSERT INTO evaluaciones (fecha, asignatura, tipo, titulo, descripcion) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [fecha, asignatura, tipo, titulo, descripcion]);
        res.json({ id: result.rows[0].id, success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ===== API ROUTES - MATERIALES (SOLO PADRES) =====
app.post('/api/materiales/subir', authMiddleware, requirePadre, upload.single('material'), async (req, res) => {
    try {
        const filePath = req.file.path;
        const ext = path.extname(req.file.originalname).toLowerCase();
        let texto = '';
        if (ext === '.pdf') texto = await extraerTextoPDF(filePath);
        else if (ext === '.docx') texto = await extraerTextoDOCX(filePath);

        const resumen = generarResumenIA(texto, req.body.asignatura);

        const result = await pool.query(`INSERT INTO materiales (asignatura, titulo, archivo_path, contenido_extraido, resumen, tipo, subido_por) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [req.body.asignatura, req.body.titulo, filePath, texto.substring(0, 5000), resumen.resumen, ext.replace('.', ''), req.user.id]);
        res.json({ id: result.rows[0].id, resumen: resumen, success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/materiales/:asignatura', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, asignatura, titulo, resumen, created_at FROM materiales WHERE asignatura = $1`, [req.params.asignatura]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/materiales', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, asignatura, titulo, resumen, created_at FROM materiales ORDER BY created_at DESC`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ===== API ROUTES - TAREAS DEL HOGAR =====
app.get('/api/tareas/hoy', authMiddleware, async (req, res) => {
    const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const diaSemana = dias[new Date().getDay()];
    const hijoId = req.user.rol === 'hijo' ? req.user.id : req.query.hijo_id || 1;

    try {
        const tasksResult = await pool.query(`SELECT * FROM tareas_hogar WHERE (dia_semana = $1 OR dia_semana = 'todos') AND activa = 1 ORDER BY orden`, [diaSemana]);
        const hoy = new Date().toISOString().split('T')[0];
        const completadasResult = await pool.query(`SELECT * FROM tareas_completadas WHERE fecha = $1 AND hijo_id = $2`, [hoy, hijoId]);
        
        const tasks = tasksResult.rows;
        const completadas = completadasResult.rows;

        const tareasConEstado = tasks.map(t => {
            const comp = completadas.find(c => c.tarea_id === t.id);
            return { ...t, completada: comp ? comp.completada : 0, foto_path: comp ? comp.foto_path : null, aprobada: comp ? comp.aprobada_padre : 0 };
        });
        res.json(tareasConEstado);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// TAREAS DEL HOGAR (CONFIGURACIÓN)
app.get('/api/tareas/config', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tareas_hogar ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tareas/config', authMiddleware, requirePadre, async (req, res) => {
    const { titulo, emoji, horario, requiere_foto } = req.body;
    try {
        await pool.query(
            'INSERT INTO tareas_hogar (titulo, emoji, horario, requiere_foto) VALUES ($1, $2, $3, $4)',
            [titulo, emoji || '🏠', horario || 'Pendiente', requiere_foto ? 1 : 0]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/tareas/config/:id', authMiddleware, requirePadre, async (req, res) => {
    try {
        await pool.query('DELETE FROM tareas_hogar WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tareas/completar', authMiddleware, upload.single('foto'), async (req, res) => {

    const { tarea_id, completada } = req.body;
    const hijoId = req.user.id;
    const hoy = new Date().toISOString().split('T')[0];
    const fotoPath = req.file ? req.file.path : null;

    try {
        await pool.query(`INSERT INTO tareas_completadas (tarea_id, hijo_id, fecha, completada, foto_path) 
                         VALUES ($1, $2, $3, $4, $5) 
                         ON CONFLICT (tarea_id, hijo_id, fecha) DO UPDATE SET completada = EXCLUDED.completada, foto_path = EXCLUDED.foto_path`,
            [tarea_id, hijoId, hoy, completada, fotoPath]);
        
        if (completada == 1) {
            await pool.query(`INSERT INTO estrellitas (hijo_id, asignatura, cantidad, fecha, motivo) VALUES ($1, $2, 1, $3, $4)`,
                [hijoId, 'hogar', hoy, 'Tarea completada: ' + tarea_id]);
        }
        res.json({ success: true, estrellita: completada == 1 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/tareas/aprobar', authMiddleware, requirePadre, async (req, res) => {
    const { tarea_id, fecha, aprobada, comentario, hijo_id } = req.body;
    try {
        await pool.query(`UPDATE tareas_completadas SET aprobada_padre = $1, comentario_padre = $2, revisado_por = $3 WHERE tarea_id = $4 AND fecha = $5 AND hijo_id = $6`,
            [aprobada, comentario, req.user.id, tarea_id, fecha, hijo_id || 1]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== API ROUTES - QUIZZES =====
app.post('/api/quiz/resultado', authMiddleware, requireHijo, async (req, res) => {
    const { asignatura, correctas, total } = req.body;
    const hijoId = req.user.id;
    const hoy = new Date().toISOString().split('T')[0];
    const estrellas = correctas >= 4 ? 2 : correctas >= 2 ? 1 : 0;
    try {
        if (estrellas > 0) {
            await pool.query(`INSERT INTO estrellitas (hijo_id, asignatura, cantidad, fecha, motivo) VALUES ($1, $2, $3, $4, $5)`,
                [hijoId, asignatura, estrellas, hoy, `Quiz ${correctas}/${total}`]);
        }
        res.json({ estrellitas: estrellas, success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/quiz/generar', authMiddleware, async (req, res) => {
    const { texto } = req.body;
    try {
        const prompt = `Genera un quiz de 3 preguntas de opción múltiple basándote en este texto. 
        Debes devolver ÚNICAMENTE un array JSON válido con este formato exacto:
        [{"q": "Pregunta", "options": ["Opcion 1", "Opcion 2", "Opcion 3"], "correct": 0, "explanation": "Por qué es correcta"}]
        Texto: ${texto}`;

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let jsonStr = response.text().replace(/\`\`\`json|\`\`\`/g, '').trim();
        const quiz = JSON.parse(jsonStr);
        
        res.json({ success: true, quiz });
    } catch (err) {
        console.error("Error generando quiz:", err);
        res.status(500).json({ error: 'Error generando quiz: ' + err.message });
    }
});


app.get('/api/estrellitas', authMiddleware, async (req, res) => {
    const hijoId = req.user.rol === 'hijo' ? req.user.id : req.query.hijo_id || 1;
    try {
        const result = await pool.query(`SELECT asignatura, SUM(cantidad) as total FROM estrellitas WHERE hijo_id = $1 GROUP BY asignatura`, [hijoId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/actividad', authMiddleware, async (req, res) => {
    const { tipo, descripcion, asignatura, duracion } = req.body;
    const hijoId = req.user.rol === 'hijo' ? req.user.id : req.query.hijo_id || 1;
    try {
        await pool.query(`INSERT INTO actividad_log (hijo_id, tipo, descripcion, asignatura, duracion_minutos) VALUES ($1, $2, $3, $4, $5)`,
            [hijoId, tipo, descripcion, asignatura, duracion]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ===== PANEL PADRES =====
app.get('/api/padres/dashboard', authMiddleware, requirePadre, async (req, res) => {
    const hijoId = req.query.hijo_id || 1;
    const hace7dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    try {
        const result = await pool.query(`
            SELECT 
                (SELECT json_agg(json_build_object('asignatura', asignatura, 'total', total)) 
                 FROM (SELECT asignatura, SUM(cantidad) as total FROM estrellitas WHERE hijo_id = $1 GROUP BY asignatura) t) as estrellitas,
                (SELECT json_agg(json_build_object('fecha', created_at, 'tipo', tipo, 'descripcion', descripcion, 'asignatura', asignatura))
                 FROM actividad_log WHERE hijo_id = $1 AND created_at >= (CURRENT_TIMESTAMP - INTERVAL '7 days') ORDER BY created_at DESC) as actividad,
                (SELECT json_agg(json_build_object('tarea_id', tarea_id, 'fecha', fecha, 'foto_path', foto_path, 'aprobada', aprobada_padre, 'hijo_id', hijo_id))
                 FROM tareas_completadas WHERE hijo_id = $1 AND fecha >= $2::date ORDER BY fecha DESC) as evidencias,
                (SELECT COUNT(*) FROM actividad_log WHERE hijo_id = $1 AND tipo = 'quiz' AND created_at >= (CURRENT_TIMESTAMP - INTERVAL '7 days')) as quizzes_semana,
                (SELECT COUNT(*) FROM tareas_completadas WHERE hijo_id = $1 AND fecha >= $2::date AND completada = 1) as tareas_semana
        `, [hijoId, hace7dias]);
        
        const data = result.rows[0];
        res.json({
            estrellitas: data.estrellitas || [],
            actividad: data.actividad || [],
            evidencias: data.evidencias || [],
            quizzes_semana: parseInt(data.quizzes_semana),
            tareas_semana: parseInt(data.tareas_semana)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/usuarios', authMiddleware, requirePadre, async (req, res) => {
    try {
        const result = await pool.query(`SELECT id, nombre, email, rol, activo, created_at FROM usuarios ORDER BY id`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CRON JOBS
cron.schedule('0 7 * * *', async () => {
    const manana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    try {
        const result = await pool.query(`SELECT * FROM evaluaciones WHERE fecha = $1`, [manana]);
        result.rows.forEach(ev => {
            console.log(`RECORDATORIO: Mañana tienes ${ev.asignatura} - ${ev.titulo}`);
        });
    } catch (err) {
        console.error("Error en cron job:", err);
    }
});

// Health check para Render
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Mi Plan de Estudio corriendo en puerto ${PORT}`);
    console.log(`🔐 Credenciales por defecto:`);
    console.log(`   Padre: padres@familia.cl / padre2026`);
    console.log(`   Hijo:  hija@familia.cl / hija2026`);
    console.log(`👨‍👩‍👧 Panel Padres: disponible solo para usuarios con rol 'padre'`);
    if (process.env.RENDER) {
        console.log(`🌐 Running on Render.com`);
    }
});
