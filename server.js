const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mi-plan-estudio-secret-key-2026';

// Render usa /tmp para archivos temporales que sobreviven reinicios cortos
// Pero para SQLite en Free tier, usamos el directorio actual (persiste durante la vida del contenedor)
const DATA_DIR = process.env.RENDER ? './data' : '.';
const UPLOADS_DIR = process.env.RENDER ? './uploads' : 'uploads';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Crear directorios necesarios
[DATA_DIR, UPLOADS_DIR, `${UPLOADS_DIR}/planes`, `${UPLOADS_DIR}/materiales`, `${UPLOADS_DIR}/evidencias`, `${UPLOADS_DIR}/temp`].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// BASE DE DATOS - SQLite en archivo local (persiste en Render mientras no redeployes)
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        rol TEXT NOT NULL CHECK(rol IN ('hijo', 'padre')),
        activo INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS plan_semanal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        semana_inicio DATE,
        semana_fin DATE,
        dia TEXT,
        hora_inicio TEXT,
        hora_fin TEXT,
        asignatura TEXT,
        actividad TEXT,
        material TEXT,
        evaluacion TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS evaluaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha DATE,
        asignatura TEXT,
        tipo TEXT,
        titulo TEXT,
        descripcion TEXT,
        estado TEXT DEFAULT 'pendiente',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS materiales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asignatura TEXT,
        titulo TEXT,
        archivo_path TEXT,
        contenido_extraido TEXT,
        resumen TEXT,
        tipo TEXT,
        subido_por INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (subido_por) REFERENCES usuarios(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS tareas_hogar (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT,
        emoji TEXT,
        horario TEXT,
        requiere_foto INTEGER DEFAULT 0,
        dia_semana TEXT,
        orden INTEGER,
        activa INTEGER DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS tareas_completadas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tarea_id INTEGER,
        hijo_id INTEGER,
        fecha DATE,
        completada INTEGER DEFAULT 0,
        foto_path TEXT,
        aprobada_padre INTEGER DEFAULT 0,
        comentario_padre TEXT,
        revisado_por INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tarea_id) REFERENCES tareas_hogar(id),
        FOREIGN KEY (hijo_id) REFERENCES usuarios(id),
        FOREIGN KEY (revisado_por) REFERENCES usuarios(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS estrellitas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hijo_id INTEGER,
        asignatura TEXT,
        cantidad INTEGER DEFAULT 0,
        fecha DATE,
        motivo TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (hijo_id) REFERENCES usuarios(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS actividad_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hijo_id INTEGER,
        tipo TEXT,
        descripcion TEXT,
        asignatura TEXT,
        duracion_minutos INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (hijo_id) REFERENCES usuarios(id)
    )`);

    // Insertar usuarios por defecto si no existen
    db.get("SELECT COUNT(*) as count FROM usuarios", (err, row) => {
        if (row.count === 0) {
            const hashPadre = bcrypt.hashSync('padre2026', 10);
            const hashHijo = bcrypt.hashSync('hija2026', 10);

            db.run(`INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)`,
                ['Papá/Mamá', 'padres@familia.cl', hashPadre, 'padre']);
            db.run(`INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)`,
                ['Hija', 'hija@familia.cl', hashHijo, 'hijo']);
        }
    });

    // Tareas por defecto
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

    db.get("SELECT COUNT(*) as count FROM tareas_hogar", (err, row) => {
        if (row.count === 0) {
            const stmt = db.prepare(`INSERT INTO tareas_hogar (titulo, emoji, horario, requiere_foto, dia_semana, orden) VALUES (?, ?, ?, ?, ?, ?)`);
            tareasDefault.forEach(t => stmt.run(t));
            stmt.finalize();
        }
    });
});

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
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM usuarios WHERE email = ? AND activo = 1`, [email], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
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
    });
});

app.post('/api/auth/registro', authMiddleware, requirePadre, (req, res) => {
    const { nombre, email, password, rol } = req.body;
    if (!['hijo', 'padre'].includes(rol)) {
        return res.status(400).json({ error: 'Rol debe ser hijo o padre' });
    }

    const hash = bcrypt.hashSync(password, 10);
    db.run(`INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)`,
        [nombre, email, hash, rol],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, success: true });
        }
    );
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
        const lineas = texto.split('\n');
        const planItems = [];
        let diaActual = '';

        lineas.forEach(linea => {
            const diaMatch = linea.match(/(LUNES|MARTES|MIERCOLES|JUEVES|VIERNES)/i);
            if (diaMatch) diaActual = diaMatch[1];
            const horaMatch = linea.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
            const asigMatch = linea.match(/(MATEMATICA|LENGUAJE|CIENCIAS|HISTORIA|INGLES|ALEMAN|RELIGION|ARTE|EDUCACION FISICA|TECNOLOGIA)/i);
            if (horaMatch && asigMatch && diaActual) {
                planItems.push({
                    dia: diaActual,
                    hora_inicio: horaMatch[1],
                    hora_fin: horaMatch[2],
                    asignatura: asigMatch[1],
                    actividad: linea.substring(linea.indexOf(asigMatch[1]) + asigMatch[1].length).trim()
                });
            }
        });

        const stmt = db.prepare(`INSERT INTO plan_semanal (semana_inicio, semana_fin, dia, hora_inicio, hora_fin, asignatura, actividad) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        planItems.forEach(item => {
            stmt.run(req.body.semana_inicio, req.body.semana_fin, item.dia, item.hora_inicio, item.hora_fin, item.asignatura, item.actividad);
        });
        stmt.finalize();

        res.json({ success: true, items: planItems.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/plan/hoy', authMiddleware, (req, res) => {
    const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const hoy = dias[new Date().getDay()].toUpperCase();
    db.all(`SELECT * FROM plan_semanal WHERE dia = ? ORDER BY hora_inicio`, [hoy], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ===== API ROUTES - EVALUACIONES =====
app.get('/api/evaluaciones', authMiddleware, (req, res) => {
    db.all(`SELECT * FROM evaluaciones WHERE fecha >= date('now') ORDER BY fecha`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/evaluaciones', authMiddleware, requirePadre, (req, res) => {
    const { fecha, asignatura, tipo, titulo, descripcion } = req.body;
    db.run(`INSERT INTO evaluaciones (fecha, asignatura, tipo, titulo, descripcion) VALUES (?, ?, ?, ?, ?)`,
        [fecha, asignatura, tipo, titulo, descripcion],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, success: true });
        }
    );
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

        db.run(`INSERT INTO materiales (asignatura, titulo, archivo_path, contenido_extraido, resumen, tipo, subido_por) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.body.asignatura, req.body.titulo, filePath, texto.substring(0, 5000), resumen.resumen, ext.replace('.', ''), req.user.id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ id: this.lastID, resumen: resumen, success: true });
            }
        );
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/materiales/:asignatura', authMiddleware, (req, res) => {
    db.all(`SELECT id, asignatura, titulo, resumen, created_at FROM materiales WHERE asignatura = ?`, [req.params.asignatura], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ===== API ROUTES - TAREAS DEL HOGAR =====
app.get('/api/tareas/hoy', authMiddleware, (req, res) => {
    const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const diaSemana = dias[new Date().getDay()];
    const hijoId = req.user.rol === 'hijo' ? req.user.id : req.query.hijo_id || 1;

    db.all(`SELECT * FROM tareas_hogar WHERE (dia_semana = ? OR dia_semana = 'todos') AND activa = 1 ORDER BY orden`, 
        [diaSemana], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const hoy = new Date().toISOString().split('T')[0];
        db.all(`SELECT * FROM tareas_completadas WHERE fecha = ? AND hijo_id = ?`, [hoy, hijoId], (err2, completadas) => {
            if (err2) return res.status(500).json({ error: err2.message });
            const tareasConEstado = rows.map(t => {
                const comp = completadas.find(c => c.tarea_id === t.id);
                return { ...t, completada: comp ? comp.completada : 0, foto_path: comp ? comp.foto_path : null, aprobada: comp ? comp.aprobada_padre : 0 };
            });
            res.json(tareasConEstado);
        });
    });
});

app.post('/api/tareas/completar', authMiddleware, requireHijo, upload.single('foto'), (req, res) => {
    const { tarea_id, completada } = req.body;
    const hijoId = req.user.id;
    const hoy = new Date().toISOString().split('T')[0];
    const fotoPath = req.file ? req.file.path : null;

    db.run(`INSERT OR REPLACE INTO tareas_completadas (tarea_id, hijo_id, fecha, completada, foto_path) VALUES (?, ?, ?, ?, ?)`,
        [tarea_id, hijoId, hoy, completada, fotoPath],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (completada == 1) {
                db.run(`INSERT INTO estrellitas (hijo_id, asignatura, cantidad, fecha, motivo) VALUES (?, ?, 1, ?, ?)`,
                    [hijoId, 'hogar', hoy, 'Tarea completada: ' + tarea_id]);
            }
            res.json({ success: true, estrellita: completada == 1 });
        }
    );
});

app.post('/api/tareas/aprobar', authMiddleware, requirePadre, (req, res) => {
    const { tarea_id, fecha, aprobada, comentario, hijo_id } = req.body;
    db.run(`UPDATE tareas_completadas SET aprobada_padre = ?, comentario_padre = ?, revisado_por = ? WHERE tarea_id = ? AND fecha = ? AND hijo_id = ?`,
        [aprobada, comentario, req.user.id, tarea_id, fecha, hijo_id || 1],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// ===== API ROUTES - QUIZZES =====
app.post('/api/quiz/resultado', authMiddleware, requireHijo, (req, res) => {
    const { asignatura, correctas, total } = req.body;
    const hijoId = req.user.id;
    const hoy = new Date().toISOString().split('T')[0];
    const estrellas = correctas >= 4 ? 2 : correctas >= 2 ? 1 : 0;
    if (estrellas > 0) {
        db.run(`INSERT INTO estrellitas (hijo_id, asignatura, cantidad, fecha, motivo) VALUES (?, ?, ?, ?, ?)`,
            [hijoId, asignatura, estrellas, hoy, `Quiz ${correctas}/${total}`]);
    }
    res.json({ estrellitas: estrellas, success: true });
});

app.get('/api/estrellitas', authMiddleware, (req, res) => {
    const hijoId = req.user.rol === 'hijo' ? req.user.id : req.query.hijo_id || 1;
    db.all(`SELECT asignatura, SUM(cantidad) as total FROM estrellitas WHERE hijo_id = ? GROUP BY asignatura`, [hijoId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/actividad', authMiddleware, (req, res) => {
    const { tipo, descripcion, asignatura, duracion } = req.body;
    const hijoId = req.user.rol === 'hijo' ? req.user.id : req.query.hijo_id || 1;
    db.run(`INSERT INTO actividad_log (hijo_id, tipo, descripcion, asignatura, duracion_minutos) VALUES (?, ?, ?, ?, ?)`,
        [hijoId, tipo, descripcion, asignatura, duracion],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// ===== PANEL PADRES =====
app.get('/api/padres/dashboard', authMiddleware, requirePadre, (req, res) => {
    const hijoId = req.query.hijo_id || 1;
    const hoy = new Date().toISOString().split('T')[0];
    const hace7dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    db.all(`
        SELECT 
            (SELECT json_group_array(json_object('asignatura', asignatura, 'total', total)) 
             FROM (SELECT asignatura, SUM(cantidad) as total FROM estrellitas WHERE hijo_id = ? GROUP BY asignatura)) as estrellitas,
            (SELECT json_group_array(json_object('fecha', fecha, 'tipo', tipo, 'descripcion', descripcion, 'asignatura', asignatura))
             FROM actividad_log WHERE hijo_id = ? AND created_at >= datetime('now', '-7 days') ORDER BY created_at DESC) as actividad,
            (SELECT json_group_array(json_object('tarea_id', tarea_id, 'fecha', fecha, 'foto_path', foto_path, 'aprobada', aprobada_padre, 'hijo_id', hijo_id))
             FROM tareas_completadas WHERE hijo_id = ? AND fecha >= ? ORDER BY fecha DESC) as evidencias,
            (SELECT COUNT(*) FROM actividad_log WHERE hijo_id = ? AND tipo = 'quiz' AND created_at >= ?) as quizzes_semana,
            (SELECT COUNT(*) FROM tareas_completadas WHERE hijo_id = ? AND fecha >= ? AND completada = 1) as tareas_semana
    `, [hijoId, hijoId, hijoId, hace7dias, hijoId, hace7dias, hijoId, hace7dias], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const data = rows[0];
        res.json({
            estrellitas: JSON.parse(data.estrellitas || '[]'),
            actividad: JSON.parse(data.actividad || '[]'),
            evidencias: JSON.parse(data.evidencias || '[]'),
            quizzes_semana: data.quizzes_semana,
            tareas_semana: data.tareas_semana
        });
    });
});

// CRON JOBS
cron.schedule('0 7 * * *', () => {
    const manana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    db.all(`SELECT * FROM evaluaciones WHERE fecha = ?`, [manana], (err, rows) => {
        rows.forEach(ev => {
            console.log(`RECORDATORIO: Mañana tienes ${ev.asignatura} - ${ev.titulo}`);
        });
    });
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
