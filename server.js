require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(__dirname));

// --- SEGURIDAD: JWT + control de acceso por rol ---
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { JWT_SECRET = require('crypto').randomBytes(32).toString('hex'); console.warn('⚠️  Define JWT_SECRET en .env (las sesiones se cierran al reiniciar el servidor).'); }
const auth = (req, res, next) => {
    try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET); next(); }
    catch (e) { res.status(401).json({ error: 'Sesión inválida o expirada' }); }
};
const soloRol = (...roles) => (req, res, next) => roles.includes(req.user.rol) ? next() : res.status(403).json({ error: 'No autorizado' });
const soloYo = (req, res, next) => (String(req.params.id || req.params.id_cliente) === String(req.user.id) || req.user.rol === 'admin') ? next() : res.status(403).json({ error: 'No autorizado' });
const miRest = (req, res, next) => String(req.params.id_rest || req.params.id) === String(req.user.id_restaurante) ? next() : res.status(403).json({ error: 'No autorizado' });

process.on('uncaughtException', (err) => {
    console.error('🛡️ [Auto-Shield] Excepción no capturada interceptada:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('🛡️ [Auto-Shield] Rechazo no manejado interceptado:', reason);
});

app.use(['/api/login', '/api/registro'], rateLimit({ windowMs: 15 * 60 * 1000, limit: parseInt(process.env.LIMITE_AUTH) || 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos. Espera unos minutos.' } }));
app.use('/api', (req, res, next) => ['/login', '/registro'].includes(req.path) ? next() : auth(req, res, next));
app.use('/api/admin', soloRol('admin'));
app.use(['/api/restaurante', '/api/publicar', '/api/stats/restaurante', '/api/pedidos/restaurante', '/api/pedidos/responder', '/api/pedidos/cancelar-restaurante'], soloRol('restaurante'));
app.use(['/api/pedidos/solicitar', '/api/pedidos/cancelar', '/api/strikes'], soloRol('cliente'));

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME || 'rescate_comida',
    waitForConnections: true,
    connectionLimit: 40,
    queueLimit: 250,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});
const MINUTOS_RECLAMO = parseInt(process.env.MINUTOS_RECLAMO) || 30; // tiempo límite configurable
const MAX_POR_PEDIDO = parseInt(process.env.MAX_POR_PEDIDO) || 3;

// --- AUTO-REPARADOR DE BASE DE DATOS ---
// Esto inyecta las columnas faltantes si tu DB es de una versión anterior
async function autoRepararDB() {
    const reparaciones = [
        "ALTER TABLE restaurantes ADD COLUMN categoria VARCHAR(50) DEFAULT 'Comida Rápida'",
        "ALTER TABLE pedidos ADD COLUMN id_platillo INT",
        "ALTER TABLE pedidos ADD COLUMN estado VARCHAR(50) DEFAULT 'activo'",
        "ALTER TABLE pedidos ADD COLUMN solicitud_entrega VARCHAR(50) DEFAULT 'ninguna'",
        "ALTER TABLE pedidos ADD COLUMN motivo_cancelacion VARCHAR(255) NULL",
        "ALTER TABLE usuarios ADD COLUMN is_premium BOOLEAN DEFAULT FALSE",
        "ALTER TABLE usuarios ADD COLUMN cooldown_premium DATETIME NULL",
        "ALTER TABLE pedidos MODIFY COLUMN estado VARCHAR(50) DEFAULT 'activo'",
        "ALTER TABLE pedidos MODIFY COLUMN solicitud_entrega VARCHAR(50) DEFAULT 'ninguna'",
        "ALTER TABLE usuarios ADD COLUMN strikes INT DEFAULT 0",
        "ALTER TABLE pedidos ADD COLUMN cantidad INT DEFAULT 1",
        "ALTER TABLE pedidos ADD UNIQUE KEY uq_codigo (codigo_unico)",
        "ALTER TABLE resenas ADD UNIQUE KEY uq_resena (id_pedido, rol_autor)",
        "ALTER TABLE restaurantes ADD COLUMN ultima_actividad DATETIME DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE usuarios MODIFY COLUMN estado_verificacion VARCHAR(20) NOT NULL DEFAULT 'pendiente'"
    ];
    for (let sql of reparaciones) {
        try { await pool.query(sql); } catch (e) { /* Si la columna ya existe, ignora el error */ }
    }
    const tablasNuevas = [
        "CREATE TABLE IF NOT EXISTS solicitudes_premium (id INT AUTO_INCREMENT PRIMARY KEY, id_usuario INT NOT NULL, nombre_solicitante VARCHAR(100), estado ENUM('pendiente', 'aprobado', 'rechazado') DEFAULT 'pendiente', fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE IF NOT EXISTS premium_keys (id INT AUTO_INCREMENT PRIMARY KEY, key_code VARCHAR(20) UNIQUE NOT NULL, is_used BOOLEAN DEFAULT FALSE, id_usuario_asignado INT)",
        "CREATE TABLE IF NOT EXISTS apelaciones_premium (id INT AUTO_INCREMENT PRIMARY KEY, id_usuario INT NOT NULL, motivo_revocacion VARCHAR(255), texto_apelacion TEXT, estado ENUM('pendiente', 'aprobada', 'rechazada') DEFAULT 'pendiente', fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE IF NOT EXISTS apelaciones_strikes (id INT AUTO_INCREMENT PRIMARY KEY, id_usuario INT NOT NULL, texto_apelacion TEXT, estado ENUM('pendiente', 'aprobada', 'rechazada') DEFAULT 'pendiente', fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    ];
    for (let tabla of tablasNuevas) {
        try { await pool.query(tabla); } catch (e) { }
    }
    console.log("🛠️ Base de datos verificada y auto-reparada.");
}
autoRepararDB();

function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
    const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function generarCodigoUnico() {
    for (let i = 0; i < 20; i++) {
        const c = Math.random().toString(36).substring(2, 8).toUpperCase();
        const [x] = await pool.query('SELECT id FROM pedidos WHERE codigo_unico = ?', [c]);
        if (x.length === 0) return c;
    }
    return Date.now().toString(36).toUpperCase().slice(-8);
}

// Expira pedidos vencidos EN EL SERVIDOR: devuelve stock, +1 strike y notifica
async function expirarPedidos() {
    try {
        const [vencidos] = await pool.query("SELECT id, id_cliente, id_platillo, COALESCE(cantidad, 1) AS cantidad FROM pedidos WHERE estado = 'activo' AND fecha_expiracion < NOW()");
        for (const p of vencidos) {
            const [u] = await pool.query("UPDATE pedidos SET estado = 'expirado' WHERE id = ? AND estado = 'activo'", [p.id]);
            if (u.affectedRows === 0) continue;
            await pool.query('UPDATE platillos SET disponibles = disponibles + ? WHERE id = ?', [p.cantidad, p.id_platillo]);
            await pool.query('UPDATE usuarios SET strikes = strikes + 1 WHERE id = ?', [p.id_cliente]);
            await pool.query('INSERT INTO notificaciones (id_usuario, titulo, mensaje, icono) VALUES (?, ?, ?, ?)', [p.id_cliente, 'Drop expirado', 'No reclamaste a tiempo: recibiste 1 strike (3 strikes = bloqueo).', 'fa-clock']);
        }
    } catch (e) { console.error('expirarPedidos:', e.message); }
}

// --- AUTENTICACIÓN ---
app.post('/api/login', async (req, res) => {
    try {
        const { correo, password } = req.body;
        const [results] = await pool.query('SELECT * FROM usuarios WHERE correo = ?', [correo]);
        if (results.length === 0 || !(await bcrypt.compare(password, results[0].password_hash))) return res.status(400).json({ error: "Credenciales inválidas" });
        const user = results[0]; delete user.password_hash;
        let id_restaurante = null;
        if (user.rol === 'restaurante') { const [r] = await pool.query('SELECT id FROM restaurantes WHERE id_usuario = ?', [user.id]); id_restaurante = r.length > 0 ? r[0].id : null; }
        const token = jwt.sign({ id: user.id, rol: user.rol, id_restaurante }, JWT_SECRET, { expiresIn: '12h' });
        res.json({ success: true, usuario: { ...user, id_restaurante, token } });
    } catch (e) { res.status(500).json({ error: "Error de servidor" }); }
});

app.post('/api/registro', async (req, res) => {
    const { nombre, correo, password, nombre_comercial, direccion, lat, lng } = req.body;
    const rol = req.body.rol === 'restaurante' ? 'restaurante' : 'cliente'; // el registro público nunca crea admins
    if (!nombre || !correo || !password || password.length < 6 || !/^\S+@\S+\.\S+$/.test(correo)) return res.status(400).json({ error: "Datos inválidos: correo válido y contraseña de mínimo 6 caracteres." });
    try {
        const hash = await bcrypt.hash(password, 10);
        const estado = rol === 'restaurante' ? 'pendiente' : 'aprobado';
        const [result] = await pool.query('INSERT INTO usuarios (nombre, correo, password_hash, rol, estado_verificacion) VALUES (?, ?, ?, ?, ?)', [nombre, correo, hash, rol, estado]);

        if (rol === 'restaurante') {
            const [resRest] = await pool.query('INSERT INTO restaurantes (id_usuario, nombre_comercial, direccion, latitud, longitud) VALUES (?, ?, ?, ?, ?)', [result.insertId, nombre_comercial, direccion, lat, lng]);
            await pool.query('INSERT INTO inventario (id_restaurante) VALUES (?)', [resRest.insertId]);
        }
        res.json({ success: true, mensaje: "Cuenta creada." });
    } catch (error) { res.status(400).json({ error: "Correo ya registrado" }); }
});

app.get('/api/usuario/:id', soloYo, async (req, res) => {
    const [r] = await pool.query('SELECT estrellas, puntaje, rango, strikes, estado_verificacion, is_premium, cooldown_premium FROM usuarios WHERE id = ?', [req.params.id]);
    res.json(r[0] || {});
});

// --- SISTEMA PREMIUM ---
app.post('/api/premium/solicitar', async (req, res) => {
    const { nombre_solicitante } = req.body; const id_usuario = req.user.id;
    const [user] = await pool.query('SELECT is_premium, cooldown_premium FROM usuarios WHERE id = ?', [id_usuario]);

    if (user[0].is_premium) return res.status(400).json({ error: "Ya eres usuario Premium." });
    if (user[0].cooldown_premium && new Date() < new Date(user[0].cooldown_premium)) return res.status(400).json({ error: "Debes esperar 48 horas tras tu último rechazo." });

    const [pendientes] = await pool.query("SELECT * FROM solicitudes_premium WHERE id_usuario = ? AND estado = 'pendiente'", [id_usuario]);
    if (pendientes.length > 0) return res.status(400).json({ error: "Ya tienes una solicitud en revisión." });

    await pool.query('INSERT INTO solicitudes_premium (id_usuario, nombre_solicitante) VALUES (?, ?)', [id_usuario, nombre_solicitante]);
    res.json({ success: true });
});

app.post('/api/premium/activar', async (req, res) => {
    const { key_code } = req.body; const id_usuario = req.user.id;
    const [keys] = await pool.query('SELECT * FROM premium_keys WHERE key_code = ? AND is_used = FALSE AND (id_usuario_asignado IS NULL OR id_usuario_asignado = ?)', [key_code, id_usuario]);
    if (keys.length === 0) return res.status(400).json({ error: "KEY inválida o ya utilizada." });

    await pool.query('UPDATE premium_keys SET is_used = TRUE WHERE id = ?', [keys[0].id]);
    await pool.query('UPDATE usuarios SET is_premium = TRUE WHERE id = ?', [id_usuario]);
    res.json({ success: true });
});

app.post('/api/premium/apelar', async (req, res) => {
    const { texto, motivo } = req.body; const id_usuario = req.user.id;
    await pool.query('INSERT INTO apelaciones_premium (id_usuario, motivo_revocacion, texto_apelacion) VALUES (?, ?, ?)', [id_usuario, motivo, texto]);
    res.json({ success: true });
});

// --- ADMIN ---
app.get('/api/admin/pendientes', async (req, res) => {
    const [results] = await pool.query(`SELECT u.id as id_usuario, r.nombre_comercial, r.direccion, u.correo FROM usuarios u JOIN restaurantes r ON u.id = r.id_usuario WHERE u.estado_verificacion = 'pendiente'`);
    res.json(results);
});
app.post('/api/admin/verificar', async (req, res) => {
    await pool.query('UPDATE usuarios SET estado_verificacion = ? WHERE id = ?', [req.body.accion, req.body.id_usuario]);
    res.json({ success: true });
});
app.get('/api/admin/premium/solicitudes', async (req, res) => {
    const [results] = await pool.query(`SELECT s.*, u.correo FROM solicitudes_premium s JOIN usuarios u ON s.id_usuario = u.id WHERE s.estado = 'pendiente'`);
    res.json(results);
});
app.post('/api/admin/premium/aprobar', async (req, res) => {
    const { id_solicitud, id_usuario, accion } = req.body;
    await pool.query('UPDATE solicitudes_premium SET estado = ? WHERE id = ?', [accion, id_solicitud]);
    if (accion === 'aprobado') {
        const key = Math.random().toString(36).substring(2, 10).toUpperCase();
        await pool.query('INSERT INTO premium_keys (key_code, id_usuario_asignado) VALUES (?, ?)', [key, id_usuario]);
        await pool.query('INSERT INTO notificaciones (id_usuario, titulo, mensaje, icono) VALUES (?, ?, ?, ?)', [id_usuario, '¡Bienvenido a Premium!', `Tu solicitud fue aceptada. Tu KEY es: ${key}`, 'fa-crown']);
    } else if (accion === 'rechazado') {
        await pool.query('INSERT INTO notificaciones (id_usuario, titulo, mensaje, icono) VALUES (?, ?, ?, ?)', [id_usuario, 'Solicitud Denegada', `Tu solicitud para ser Premium fue rechazada por el administrador.`, 'fa-xmark']);
    }
    res.json({ success: true });
});
app.get('/api/admin/premium/usuarios', async (req, res) => {
    const [results] = await pool.query(`SELECT id, nombre, correo, estrellas FROM usuarios WHERE is_premium = TRUE`);
    res.json(results);
});
app.post('/api/admin/premium/revocar', async (req, res) => {
    const { id_usuario, motivo } = req.body;
    await pool.query('UPDATE usuarios SET is_premium = FALSE, cooldown_premium = DATE_ADD(NOW(), INTERVAL 48 HOUR) WHERE id = ?', [id_usuario]);
    await pool.query('INSERT INTO notificaciones (id_usuario, titulo, mensaje, icono) VALUES (?, ?, ?, ?)', [id_usuario, 'Licencia Revocada', `Tu suscripción Premium fue revocada por: ${motivo}. Puedes apelar desde tu perfil.`, 'fa-ban']);
    res.json({ success: true });
});
app.get('/api/admin/premium/apelaciones', async (req, res) => {
    const [results] = await pool.query(`SELECT a.*, u.nombre, u.correo FROM apelaciones_premium a JOIN usuarios u ON a.id_usuario = u.id WHERE a.estado = 'pendiente'`);
    res.json(results);
});
app.post('/api/admin/premium/apelacion/resolver', async (req, res) => {
    const { id_apelacion, id_usuario, accion } = req.body;
    await pool.query('UPDATE apelaciones_premium SET estado = ? WHERE id = ?', [accion, id_apelacion]);
    if (accion === 'aprobada') {
        await pool.query('UPDATE usuarios SET cooldown_premium = NULL WHERE id = ?', [id_usuario]);
        const key = Math.random().toString(36).substring(2, 10).toUpperCase();
        await pool.query('INSERT INTO premium_keys (key_code, id_usuario_asignado) VALUES (?, ?)', [key, id_usuario]);
        await pool.query('INSERT INTO notificaciones (id_usuario, titulo, mensaje, icono) VALUES (?, ?, ?, ?)', [id_usuario, 'Apelación Exitosa', `Hemos revisado tu caso. Tu nueva KEY es: ${key}`, 'fa-gavel']);
    } else {
        await pool.query('UPDATE usuarios SET cooldown_premium = DATE_ADD(NOW(), INTERVAL 48 HOUR) WHERE id = ?', [id_usuario]);
        await pool.query('INSERT INTO notificaciones (id_usuario, titulo, mensaje, icono) VALUES (?, ?, ?, ?)', [id_usuario, 'Apelación Rechazada', `Tu apelación no fue justificada. Bloqueado por 48 horas exactas.`, 'fa-clock']);
    }
    res.json({ success: true });
});

// --- RESTAURANTE ---
app.post('/api/restaurante/menu/crear', async (req, res) => {
    const { nombre, descripcion, categoria, disponibles } = req.body; const id_restaurante = req.user.id_restaurante;
    const img_default = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&q=80";
    await pool.query('INSERT INTO platillos (id_restaurante, nombre, descripcion, categoria_alimento, imagen_url, disponibles) VALUES (?, ?, ?, ?, ?, ?)', [id_restaurante, nombre, descripcion, categoria, img_default, disponibles]);
    await pool.query('UPDATE restaurantes SET ultima_actividad = NOW() WHERE id = ?', [id_restaurante]);
    res.json({ success: true });
});
app.get('/api/restaurante/menu/:id_rest', miRest, async (req, res) => {
    const [results] = await pool.query('SELECT * FROM platillos WHERE id_restaurante = ?', [req.params.id_rest]);
    res.json(results);
});
async function platilloEsMio(u, id) { const [r] = await pool.query('SELECT id FROM platillos WHERE id = ? AND id_restaurante = ?', [id, u.id_restaurante]); return r.length > 0; }
app.post('/api/publicar', async (req, res) => {
    if (!(await platilloEsMio(req.user, req.body.id_platillo))) return res.status(403).json({ error: 'No autorizado' });
    await pool.query('UPDATE platillos SET disponibles = disponibles + ? WHERE id = ?', [req.body.cantidad, req.body.id_platillo]);
    await pool.query('UPDATE restaurantes SET ultima_actividad = NOW() WHERE id = (SELECT id_restaurante FROM platillos WHERE id = ?)', [req.body.id_platillo]);
    res.json({ success: true });
});
app.get('/api/pedidos/restaurante/:id_rest', miRest, async (req, res) => {
    const [results] = await pool.query(`SELECT p.id, p.codigo_unico, p.id_cliente, u.nombre, u.is_premium, u.estrellas, p.solicitud_entrega, COALESCE(p.cantidad, 1) AS cantidad, pl.nombre as platillo FROM pedidos p JOIN usuarios u ON p.id_cliente = u.id JOIN platillos pl ON p.id_platillo = pl.id WHERE p.id_restaurante = ? AND p.estado = 'activo' AND p.solicitud_entrega = 'pendiente'`, [req.params.id_rest]);
    res.json(results);
});

// --- FEED Y BÚSQUEDA ---
app.get('/api/restaurantes', async (req, res) => {
    try {
        const [rests] = await pool.query(`SELECT r.id, r.nombre_comercial as nombre, r.direccion, r.categoria, r.latitud as lat, r.longitud as lng, u.estrellas FROM restaurantes r JOIN usuarios u ON r.id_usuario = u.id WHERE u.estado_verificacion = 'aprobado'`);
        res.json(rests);
    } catch (e) {
        res.status(500).json({ error: "Error al obtener restaurantes" });
    }
});

app.get('/api/restaurantes/:id/menu', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) return res.status(400).json({ error: 'ID de restaurante inválido' });

    try {
        const [rests] = await pool.query(
            "SELECT r.id, r.nombre_comercial as nombre, r.direccion, r.categoria, r.latitud as lat, r.longitud as lng, u.estrellas, u.puntaje FROM restaurantes r JOIN usuarios u ON r.id_usuario = u.id WHERE r.id = ? AND u.estado_verificacion = 'aprobado'",
            [id]
        );
        if (rests.length === 0) return res.status(404).json({ error: 'Restaurante no encontrado o no disponible' });

        const [platillos] = await pool.query(
            "SELECT id, nombre, descripcion, categoria_alimento, imagen_url, disponibles, precio_original FROM platillos WHERE id_restaurante = ? ORDER BY disponibles DESC, id ASC",
            [id]
        );

        res.json({
            restaurante: rests[0],
            platillos: platillos
        });
    } catch (e) {
        console.error('Error al obtener menú del restaurante:', e.message);
        res.status(500).json({ error: 'Error al consultar menú del restaurante' });
    }
});

app.post('/api/feed', async (req, res) => {
    const { latUsuario, lngUsuario, transporte, busqueda, categoria } = req.body;
    const uLat = parseFloat(latUsuario) || 23.7369;
    const uLng = parseFloat(lngUsuario) || -99.1411;

    let radio = 1.5;
    if (transporte === 'bici') radio = 4.0;
    if (transporte === 'bus') radio = 7.0;
    if (transporte === 'moto') radio = 10.0;
    if (transporte === 'auto') radio = 15.0;

    const [rests] = await pool.query(`SELECT r.id, r.nombre_comercial as nombre, r.direccion, r.categoria, r.latitud as lat, r.longitud as lng, u.estrellas FROM restaurantes r JOIN usuarios u ON r.id_usuario = u.id WHERE u.estado_verificacion = 'aprobado'`);

    // Calcular distancia real a cada restaurante y ordenar de más cercano a más lejano
    const conDistancia = rests.map(r => ({
        ...r,
        distancia: parseFloat(calcularDistanciaKm(uLat, uLng, Number(r.lat), Number(r.lng)).toFixed(2))
    })).sort((a, b) => a.distancia - b.distancia);

    let cercanos = conDistancia.filter(r => r.distancia <= radio);

    // REQUISITO CRÍTICO: Garantizar que en cualquier punto de Ciudad Victoria haya mínimo 2 restaurantes cerca
    if (cercanos.length < 2 && conDistancia.length >= 2) {
        cercanos = conDistancia.slice(0, Math.min(2, conDistancia.length));
    }

    if (cercanos.length === 0) return res.json({ restaurantes: [], platillos: [] });

    let restIds = cercanos.map(r => r.id);
    let q = `SELECT p.*, r.nombre_comercial as rest_nombre, r.direccion as rest_direccion, r.latitud as rest_lat, r.longitud as rest_lng FROM platillos p JOIN restaurantes r ON p.id_restaurante = r.id WHERE p.disponibles > 0`;
    let params = [];

    if (categoria || busqueda) {
        q += ` AND r.id_usuario IN (SELECT id FROM usuarios WHERE estado_verificacion = 'aprobado')`;
        if (categoria) {
            q += ` AND (r.categoria = ? OR p.categoria_alimento = ?)`;
            params.push(categoria, categoria);
        }
        if (busqueda) {
            q += ` AND (p.nombre LIKE ? OR p.categoria_alimento LIKE ? OR r.nombre_comercial LIKE ?)`;
            params.push(`%${busqueda}%`, `%${busqueda}%`, `%${busqueda}%`);
        }
    } else {
        q += ` AND p.id_restaurante IN (?)`;
        params.push(restIds);
    }

    const [platillos] = await pool.query(q, params);

    // Adjuntar distancia calculada a cada platillo para mostrar en la interfaz y ordenar de más cercano a más lejano
    const platillosConDist = platillos.map(p => {
        const dist = calcularDistanciaKm(uLat, uLng, Number(p.rest_lat), Number(p.rest_lng));
        return { ...p, distancia: parseFloat(dist.toFixed(2)) };
    }).sort((a, b) => a.distancia - b.distancia);

    let restaurantesRespuesta = cercanos;
    if (categoria || busqueda) {
        const matchRestIds = new Set(platillosConDist.map(p => p.id_restaurante));
        const matchedRests = conDistancia.filter(r => matchRestIds.has(r.id));
        restaurantesRespuesta = matchedRests.length > 0 ? matchedRests : cercanos;
    }

    res.json({ restaurantes: restaurantesRespuesta, platillos: platillosConDist });
});

// --- PEDIDOS (BLINDADOS CONTRA ESTRÉS Y CONDICIONES DE CARRERA) ---
app.post('/api/pedidos', soloRol('cliente'), async (req, res) => {
    const id_cliente = req.user.id;
    const id_restaurante = parseInt(req.body.id_restaurante, 10);
    const id_platillo = parseInt(req.body.id_platillo, 10);
    const cantidad = Math.min(MAX_POR_PEDIDO, Math.max(1, parseInt(req.body.cantidad, 10) || 1));

    if (!id_restaurante || !id_platillo || isNaN(id_restaurante) || isNaN(id_platillo)) {
        return res.status(400).json({ error: "Datos del restaurante o platillo inválidos." });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // 1. Bloqueo de fila del usuario FOR UPDATE para evitar carreras concurrentes en múltiples pestañas
        const [cli] = await conn.query('SELECT strikes FROM usuarios WHERE id = ? FOR UPDATE', [id_cliente]);
        if (!cli.length) {
            await conn.rollback();
            return res.status(404).json({ error: "Usuario no encontrado." });
        }
        if (cli[0].strikes >= 3) {
            await conn.rollback();
            return res.status(403).json({ error: "Cuenta bloqueada: 3 strikes por pedidos no reclamados." });
        }

        // 2. Verificar pedidos activos bajo bloqueo
        const [act] = await conn.query("SELECT id FROM pedidos WHERE id_cliente = ? AND estado = 'activo' FOR UPDATE", [id_cliente]);
        if (act.length > 0) {
            await conn.rollback();
            return res.status(400).json({ error: "Ya tienes un pedido activo en curso. Debes recogerlo o cancelarlo primero." });
        }

        // 3. Descontar stock de forma estrictamente atómica
        const [up] = await conn.query(
            'UPDATE platillos SET disponibles = disponibles - ? WHERE id = ? AND id_restaurante = ? AND disponibles >= ?',
            [cantidad, id_platillo, id_restaurante, cantidad]
        );
        if (up.affectedRows === 0) {
            await conn.rollback();
            return res.status(400).json({ error: "Platillo agotado o sin el stock solicitado." });
        }

        const codigo = await generarCodigoUnico();
        const [r] = await conn.query(
            `INSERT INTO pedidos (id_cliente, id_restaurante, id_platillo, codigo_unico, fecha_expiracion, estado, solicitud_entrega, cantidad) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${MINUTOS_RECLAMO} MINUTE), "activo", "ninguna", ?)`,
            [id_cliente, id_restaurante, id_platillo, codigo, cantidad]
        );

        await conn.commit();
        res.json({ success: true, codigo, id_pedido: r.insertId, segundos: MINUTOS_RECLAMO * 60 });
    } catch (e) {
        await conn.rollback().catch(() => { });
        console.error("Error crítico al procesar pedido:", e.message);
        res.status(500).json({ error: "Error interno al procesar el pedido. Intenta nuevamente." });
    } finally {
        conn.release();
    }
});

// --- CANCELACIÓN POR EL CLIENTE (SIN STRIKES, AJUSTE LEVE DE REPUTACIÓN) ---
app.post('/api/pedidos/cancelar', soloRol('cliente'), async (req, res) => {
    const id_cliente = req.user.id;
    const id_pedido = parseInt(req.body.id_pedido, 10);
    const motivo = String(req.body.motivo || 'No puedo llegar a tiempo').trim().slice(0, 100);
    const detalle = String(req.body.detalle || '').trim().slice(0, 200);
    const motivoFinal = detalle ? `${motivo}: ${detalle}` : motivo;

    if (!id_pedido || isNaN(id_pedido)) return res.status(400).json({ error: 'ID de pedido inválido' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // 1. Obtener y bloquear el pedido
        const [pedidos] = await conn.query(
            "SELECT p.id, p.id_platillo, p.id_restaurante, p.codigo_unico, COALESCE(p.cantidad, 1) AS cantidad, rt.id_usuario AS id_usuario_rest, rt.nombre_comercial FROM pedidos p JOIN restaurantes rt ON p.id_restaurante = rt.id WHERE p.id = ? AND p.id_cliente = ? AND p.estado = 'activo' FOR UPDATE",
            [id_pedido, id_cliente]
        );

        if (pedidos.length === 0) {
            await conn.rollback();
            return res.status(400).json({ error: 'El pedido ya no está activo o ya fue procesado.' });
        }

        const pedido = pedidos[0];

        // 2. Marcar pedido como cancelado_cliente
        const [up] = await conn.query(
            "UPDATE pedidos SET estado = 'cancelado_cliente', motivo_cancelacion = ? WHERE id = ? AND estado = 'activo'",
            [motivoFinal, id_pedido]
        );

        if (up.affectedRows === 0) {
            await conn.rollback();
            return res.status(400).json({ error: 'No se pudo cancelar el pedido (cambio de estado concurrente).' });
        }

        // 3. Restaurar stock al platillo
        if (pedido.id_platillo) {
            await conn.query(
                "UPDATE platillos SET disponibles = disponibles + ? WHERE id = ?",
                [pedido.cantidad, pedido.id_platillo]
            );
        }

        // 4. Ajustar reputación levemente (-0.1 estrellas y -3 puntos) SIN aplicar strikes
        await conn.query(
            "UPDATE usuarios SET estrellas = GREATEST(1.0, ROUND(estrellas - 0.1, 1)), puntaje = GREATEST(0, puntaje - 3) WHERE id = ?",
            [id_cliente]
        );

        // 5. Notificar al restaurante
        if (pedido.id_usuario_rest) {
            await conn.query(
                "INSERT INTO notificaciones (id_usuario, titulo, mensaje, icono) VALUES (?, ?, ?, ?)",
                [
                    pedido.id_usuario_rest,
                    'Drop Cancelado por Cliente',
                    `El cliente canceló el pedido #${pedido.codigo_unico}. Motivo: "${motivoFinal}". El stock ha sido devuelto a tu menú.`,
                    'fa-ban'
                ]
            );
        }

        // 6. Notificar al cliente confirmando cancelación sin strikes
        await conn.query(
            "INSERT INTO notificaciones (id_usuario, titulo, mensaje, icono) VALUES (?, ?, ?, ?)",
            [
                id_cliente,
                'Pedido Cancelado a Tiempo',
                `Cancelaste el pedido #${pedido.codigo_unico}. Tu inventario fue liberado. No recibiste strikes (tu reputación se ajustó -0.1⭐).`,
                'fa-check-circle'
            ]
        );

        await conn.commit();
        res.json({ success: true, mensaje: 'Pedido cancelado con éxito sin strikes.' });
    } catch (e) {
        await conn.rollback().catch(() => { });
        console.error("Error al cancelar pedido:", e.message);
        res.status(500).json({ error: "Error al cancelar el pedido." });
    } finally {
        conn.release();
    }
});

// --- CANCELACIÓN POR EL RESTAURANTE (MOTIVO POR ESCRITO OBLIGATORIO) ---
app.post('/api/pedidos/cancelar-restaurante', soloRol('restaurante'), async (req, res) => {
    const id_restaurante = req.user.id_restaurante;
    const id_pedido = parseInt(req.body.id_pedido, 10);
    const motivo = String(req.body.motivo || '').trim().slice(0, 255);

    if (!id_pedido || isNaN(id_pedido)) return res.status(400).json({ error: 'ID de pedido inválido' });
    if (!motivo || motivo.length < 4) return res.status(400).json({ error: 'Debes explicar el motivo de la cancelación por escrito (mínimo 4 caracteres).' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [pedidos] = await conn.query(
            "SELECT p.id, p.id_cliente, p.id_platillo, p.codigo_unico, COALESCE(p.cantidad, 1) AS cantidad, rt.nombre_comercial FROM pedidos p JOIN restaurantes rt ON p.id_restaurante = rt.id WHERE p.id = ? AND p.id_restaurante = ? AND p.estado = 'activo' FOR UPDATE",
            [id_pedido, id_restaurante]
        );

        if (pedidos.length === 0) {
            await conn.rollback();
            return res.status(400).json({ error: 'El pedido no pertenece a este local o ya no está activo.' });
        }

        const pedido = pedidos[0];

        const [up] = await conn.query(
            "UPDATE pedidos SET estado = 'cancelado_restaurante', motivo_cancelacion = ? WHERE id = ? AND estado = 'activo'",
            [motivo, id_pedido]
        );

        if (up.affectedRows === 0) {
            await conn.rollback();
            return res.status(400).json({ error: 'El pedido ya no está activo.' });
        }

        // Restablecer stock al platillo
        if (pedido.id_platillo) {
            await conn.query(
                "UPDATE platillos SET disponibles = disponibles + ? WHERE id = ?",
                [pedido.cantidad, pedido.id_platillo]
            );
        }

        // Notificar al cliente con la explicación por escrito (SIN STRIKES)
        await conn.query(
            "INSERT INTO notificaciones (id_usuario, titulo, mensaje, icono) VALUES (?, ?, ?, ?)",
            [
                pedido.id_cliente,
                'Pedido Cancelado por el Restaurante',
                `${pedido.nombre_comercial} canceló tu drop #${pedido.codigo_unico}. Motivo: "${motivo}". Esta acción no afecta tus strikes.`,
                'fa-store-slash'
            ]
        );

        await conn.commit();
        res.json({ success: true, mensaje: 'Pedido cancelado por el restaurante.' });
    } catch (e) {
        await conn.rollback().catch(() => { });
        console.error("Error al cancelar por restaurante:", e.message);
        res.status(500).json({ error: "Error al cancelar el pedido." });
    } finally {
        conn.release();
    }
});

app.post('/api/pedidos/solicitar', async (req, res) => {
    const id_pedido = parseInt(req.body.id_pedido, 10);
    if (!id_pedido) return res.status(400).json({ error: 'ID de pedido inválido' });
    await pool.query('UPDATE pedidos SET solicitud_entrega = "pendiente" WHERE id = ? AND id_cliente = ? AND estado = "activo"', [id_pedido, req.user.id]);
    res.json({ success: true });
});

app.get('/api/pedidos/activo/:id_cliente', soloYo, async (req, res) => {
    const [r] = await pool.query(
        "SELECT p.id, p.codigo_unico, p.id_restaurante, p.id_platillo, p.solicitud_entrega, p.estado, p.motivo_cancelacion, rt.nombre_comercial AS restaurante, GREATEST(TIMESTAMPDIFF(SECOND, NOW(), p.fecha_expiracion), 0) AS segundos_restantes FROM pedidos p JOIN restaurantes rt ON p.id_restaurante = rt.id WHERE p.id_cliente = ? AND p.estado = 'activo' ORDER BY p.id DESC LIMIT 1",
        [req.params.id_cliente]
    );
    res.json(r[0] || {});
});

app.get('/api/pedidos/estado/:id_pedido', async (req, res) => {
    const id = parseInt(req.params.id_pedido, 10);
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const [r] = await pool.query(
        'SELECT solicitud_entrega, estado, motivo_cancelacion, GREATEST(TIMESTAMPDIFF(SECOND, NOW(), fecha_expiracion), 0) AS segundos_restantes FROM pedidos WHERE id = ? AND id_cliente = ?',
        [id, req.user.id]
    );
    res.json(r[0] || {});
});

app.post('/api/pedidos/responder', async (req, res) => {
    const { id_pedido, accion, motivo } = req.body;
    if (!['aceptada', 'rechazada'].includes(accion)) return res.status(400).json({ error: 'Acción inválida' });
    const [mio] = await pool.query('SELECT id_cliente, id_platillo, codigo_unico FROM pedidos WHERE id = ? AND id_restaurante = ?', [id_pedido, req.user.id_restaurante]);
    if (mio.length === 0) return res.status(403).json({ error: 'No autorizado' });
    const { id_cliente, id_platillo, codigo_unico } = mio[0];
    const est = accion === 'aceptada' ? 'entregado' : 'cancelado_restaurante';
    const motivoTexto = accion === 'rechazada' ? String(motivo || 'Cancelado por el restaurante al momento de entrega').trim().slice(0, 255) : null;

    const [up] = await pool.query("UPDATE pedidos SET solicitud_entrega = ?, estado = ?, motivo_cancelacion = ? WHERE id = ? AND estado = 'activo'", [accion, est, motivoTexto, id_pedido]);
    if (up.affectedRows === 0) return res.status(400).json({ error: "El pedido ya no está activo (expiró o ya fue atendido)." });

    if (accion !== 'aceptada') {
        await pool.query('UPDATE platillos SET disponibles = disponibles + (SELECT COALESCE(cantidad, 1) FROM pedidos WHERE id = ?) WHERE id = ?', [id_pedido, id_platillo]);
        await pool.query(
            "INSERT INTO notificaciones (id_usuario, titulo, mensaje, icono) VALUES (?, ?, ?, ?)",
            [id_cliente, 'Entrega Cancelada por el Restaurante', `El restaurante no pudo completar la entrega del pedido #${codigo_unico}. ${motivoTexto ? 'Motivo: ' + motivoTexto : ''}`, 'fa-store-slash']
        );
    }

    if (accion === 'aceptada') {
        await pool.query('UPDATE usuarios SET puntaje = puntaje + 10 WHERE id = ?', [id_cliente]);
        await pool.query('UPDATE usuarios SET rango = CASE WHEN puntaje >= 150 THEN "Héroe" WHEN puntaje >= 50 THEN "Rescatista" ELSE "Novato" END WHERE id = ?', [id_cliente]);
    }
    res.json({ success: true });
});

// --- RESEÑAS Y NOTIFICACIONES ---
app.post('/api/resena', async (req, res) => {
    const cal = parseInt(req.body.calificacion), comentario = String(req.body.comentario || '').trim().slice(0, 500);
    if (!(cal >= 1 && cal <= 5)) return res.status(400).json({ error: "La calificación debe ser de 1 a 5 estrellas." });
    const [p] = await pool.query('SELECT p.id_cliente, p.estado, p.id_restaurante, rt.id_usuario AS usuario_rest, rt.nombre_comercial FROM pedidos p JOIN restaurantes rt ON rt.id = p.id_restaurante WHERE p.id = ?', [req.body.id_pedido]);
    if (p.length === 0 || p[0].estado !== 'entregado') return res.status(400).json({ error: "Solo puedes calificar pedidos entregados." });
    let rol, receptor;
    if (req.user.rol === 'cliente' && p[0].id_cliente === req.user.id) { rol = 'cliente'; receptor = p[0].usuario_rest; }
    else if (req.user.rol === 'restaurante' && p[0].id_restaurante === req.user.id_restaurante) { rol = 'restaurante'; receptor = p[0].id_cliente; }
    else return res.status(403).json({ error: "No participaste en este pedido." });
    const [dup] = await pool.query('SELECT id FROM resenas WHERE id_pedido = ? AND rol_autor = ?', [req.body.id_pedido, rol]);
    if (dup.length > 0) return res.status(400).json({ error: "Ya calificaste este pedido." });
    await pool.query('INSERT INTO resenas (id_autor, id_receptor, id_pedido, rol_autor, calificacion, comentario) VALUES (?, ?, ?, ?, ?, ?)', [req.user.id, receptor, req.body.id_pedido, rol, cal, comentario]);
    const [avg] = await pool.query('SELECT AVG(calificacion) AS promedio FROM resenas WHERE id_receptor = ?', [receptor]);
    await pool.query('UPDATE usuarios SET estrellas = ? WHERE id = ?', [parseFloat(avg[0].promedio).toFixed(1), receptor]);
    const msj = rol === 'cliente' ? `Un cliente calificó tu comida con ${cal} estrellas.` : `${p[0].nombre_comercial} te calificó con ${cal} estrellas.`;
    await pool.query('INSERT INTO notificaciones (id_usuario, titulo, mensaje, icono) VALUES (?, ?, ?, ?)', [receptor, 'Nueva Reseña', msj, 'fa-star']);
    res.json({ success: true });
});
// Opiniones que recibí (cliente: de restaurantes / restaurante: de clientes)
app.get('/api/resenas/recibidas', async (req, res) => {
    const [rows] = await pool.query('SELECT r.id, r.calificacion, r.comentario, r.fecha, COALESCE(rt.nombre_comercial, a.nombre) AS autor FROM resenas r LEFT JOIN usuarios a ON a.id = r.id_autor LEFT JOIN restaurantes rt ON rt.id_usuario = a.id WHERE r.id_receptor = ? ORDER BY r.fecha DESC, r.id DESC LIMIT 50', [req.user.id]);
    const [u] = await pool.query('SELECT estrellas FROM usuarios WHERE id = ?', [req.user.id]);
    res.json({ promedio: u[0] ? Number(u[0].estrellas) : 5, total: rows.length, resenas: rows });
});
// Pedidos entregados (última semana) que todavía no califiqué
app.get('/api/resenas/pendientes', async (req, res) => {
    const base = "AND p.estado = 'entregado' AND p.fecha_creacion > DATE_SUB(NOW(), INTERVAL 7 DAY) AND NOT EXISTS (SELECT 1 FROM resenas r WHERE r.id_pedido = p.id AND r.rol_autor = ?) ORDER BY p.id DESC LIMIT 10";
    if (req.user.rol === 'cliente') {
        const [r] = await pool.query("SELECT p.id AS id_pedido, rt.nombre_comercial AS con, pl.nombre AS platillo, COALESCE(p.cantidad, 1) AS cantidad FROM pedidos p JOIN restaurantes rt ON rt.id = p.id_restaurante LEFT JOIN platillos pl ON pl.id = p.id_platillo WHERE p.id_cliente = ? " + base, [req.user.id, 'cliente']);
        return res.json(r);
    }
    if (req.user.rol === 'restaurante') {
        const [r] = await pool.query("SELECT p.id AS id_pedido, u.nombre AS con, pl.nombre AS platillo, COALESCE(p.cantidad, 1) AS cantidad FROM pedidos p JOIN usuarios u ON u.id = p.id_cliente LEFT JOIN platillos pl ON pl.id = p.id_platillo WHERE p.id_restaurante = ? " + base, [req.user.id_restaurante, 'restaurante']);
        return res.json(r);
    }
    res.json([]);
});
app.get('/api/notificaciones/:id', soloYo, async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM notificaciones WHERE id_usuario = ? ORDER BY fecha DESC LIMIT 10', [req.params.id]);
    res.json(rows);
});
app.post('/api/notificaciones/leer/:id', soloYo, async (req, res) => {
    await pool.query('UPDATE notificaciones SET leida = TRUE WHERE id_usuario = ?', [req.params.id]);
    res.json({ success: true });
});


// --- STOCK, STATS Y APELACIÓN DE STRIKES ---
app.post('/api/restaurante/stock', async (req, res) => {
    if (!(await platilloEsMio(req.user, req.body.id_platillo))) return res.status(403).json({ error: 'No autorizado' });
    const n = Math.max(0, parseInt(req.body.disponibles) || 0);
    await pool.query('UPDATE platillos SET disponibles = ? WHERE id = ?', [n, req.body.id_platillo]);
    await pool.query('UPDATE restaurantes SET ultima_actividad = NOW() WHERE id = (SELECT id_restaurante FROM platillos WHERE id = ?)', [req.body.id_platillo]);
    res.json({ success: true });
});
app.get('/api/stats/restaurante/:id', miRest, async (req, res) => {
    const id = req.params.id;
    const [[d]] = await pool.query('SELECT COALESCE(SUM(disponibles), 0) AS disponibles FROM platillos WHERE id_restaurante = ?', [id]);
    const [[e]] = await pool.query("SELECT COALESCE(SUM(COALESCE(cantidad, 1)), 0) AS n FROM pedidos WHERE id_restaurante = ? AND estado = 'entregado'", [id]);
    const [[p]] = await pool.query("SELECT COUNT(*) AS n FROM pedidos WHERE id_restaurante = ? AND estado = 'activo'", [id]);
    res.json({ disponibles: Number(d.disponibles), entregados: Number(e.n), pendientes: p.n });
});
app.get('/api/admin/stats', async (req, res) => {
    const one = async (sql) => { const [[r]] = await pool.query(sql); return Number(r.n); };
    res.json({
        clientes: await one("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'cliente'"),
        restaurantes: await one("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'restaurante' AND estado_verificacion = 'aprobado'"),
        disponibles: await one("SELECT COALESCE(SUM(disponibles), 0) AS n FROM platillos"),
        entregados: await one("SELECT COALESCE(SUM(COALESCE(cantidad, 1)), 0) AS n FROM pedidos WHERE estado = 'entregado'"),
        expirados: await one("SELECT COUNT(*) AS n FROM pedidos WHERE estado = 'expirado'"),
        strikes: await one("SELECT COALESCE(SUM(strikes), 0) AS n FROM usuarios"),
        bloqueados: await one("SELECT COUNT(*) AS n FROM usuarios WHERE strikes >= 3"),
        premium: await one("SELECT COUNT(*) AS n FROM usuarios WHERE is_premium = TRUE")
    });
});

app.post('/api/strikes/apelar', async (req, res) => {
    const { texto } = req.body; const id_usuario = req.user.id;
    if (!texto || !texto.trim()) return res.status(400).json({ error: "Escribe el motivo de tu apelación." });
    const [u] = await pool.query('SELECT strikes FROM usuarios WHERE id = ?', [id_usuario]);
    if (!u.length || u[0].strikes < 3) return res.status(400).json({ error: "Tu cuenta no está bloqueada." });
    const [p] = await pool.query("SELECT id FROM apelaciones_strikes WHERE id_usuario = ? AND (estado = 'pendiente' OR (estado = 'rechazada' AND fecha > DATE_SUB(NOW(), INTERVAL 48 HOUR)))", [id_usuario]);
    if (p.length > 0) return res.status(400).json({ error: "Ya tienes una apelación en revisión o fue rechazada hace menos de 48 horas." });
    await pool.query('INSERT INTO apelaciones_strikes (id_usuario, texto_apelacion) VALUES (?, ?)', [id_usuario, texto.trim()]);
    res.json({ success: true });
});
app.get('/api/admin/strikes/apelaciones', async (req, res) => {
    const [r] = await pool.query("SELECT a.id, a.id_usuario, a.texto_apelacion, u.nombre, u.correo, u.strikes FROM apelaciones_strikes a JOIN usuarios u ON a.id_usuario = u.id WHERE a.estado = 'pendiente' ORDER BY a.fecha");
    res.json(r);
});
app.post('/api/admin/strikes/resolver', async (req, res) => {
    const { id_apelacion, id_usuario, accion } = req.body;
    await pool.query('UPDATE apelaciones_strikes SET estado = ? WHERE id = ?', [accion, id_apelacion]);
    if (accion === 'aprobada') {
        await pool.query('UPDATE usuarios SET strikes = 0 WHERE id = ?', [id_usuario]);
        await pool.query('INSERT INTO notificaciones (id_usuario, titulo, mensaje, icono) VALUES (?, ?, ?, ?)', [id_usuario, 'Cuenta desbloqueada', 'Tu apelación fue aprobada. Tus strikes se reiniciaron y ya puedes pedir de nuevo.', 'fa-unlock']);
    } else {
        await pool.query('INSERT INTO notificaciones (id_usuario, titulo, mensaje, icono) VALUES (?, ?, ?, ?)', [id_usuario, 'Apelación rechazada', 'Tu bloqueo se mantiene. Podrás apelar de nuevo en 48 horas.', 'fa-ban']);
    }
    res.json({ success: true });
});

// --- ADMIN: CRUD DE USUARIOS Y RESTAURANTES ---
app.get('/api/admin/usuarios', async (req, res) => {
    const [r] = await pool.query('SELECT u.id, u.nombre, u.correo, u.rol, u.estado_verificacion, u.strikes, u.is_premium, rt.id AS id_restaurante, rt.nombre_comercial, rt.direccion, rt.latitud, rt.longitud FROM usuarios u LEFT JOIN restaurantes rt ON rt.id_usuario = u.id ORDER BY u.id DESC');
    res.json(r);
});
app.post('/api/admin/usuarios', async (req, res) => {
    const { nombre, correo, password, rol, nombre_comercial, direccion, lat, lng } = req.body;
    if (!nombre || !correo || !password || password.length < 6) return res.status(400).json({ error: "Nombre, correo y contraseña (mín. 6) son obligatorios." });
    if (!['cliente', 'restaurante', 'admin'].includes(rol)) return res.status(400).json({ error: "Rol inválido." });
    try {
        const hash = await bcrypt.hash(password, 10);
        const [u] = await pool.query('INSERT INTO usuarios (nombre, correo, password_hash, rol, estado_verificacion) VALUES (?, ?, ?, ?, "aprobado")', [nombre, correo, hash, rol]);
        if (rol === 'restaurante') {
            const [r] = await pool.query('INSERT INTO restaurantes (id_usuario, nombre_comercial, direccion, latitud, longitud) VALUES (?, ?, ?, ?, ?)', [u.insertId, nombre_comercial || nombre, direccion || '', lat || 23.7369, lng || -99.1411]);
            await pool.query('INSERT INTO inventario (id_restaurante) VALUES (?)', [r.insertId]);
        }
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: "Correo ya registrado." }); }
});
app.put('/api/admin/usuarios/:id', async (req, res) => {
    const { nombre, correo, estado, strikes, nombre_comercial, direccion, password } = req.body;
    try {
        await pool.query('UPDATE usuarios SET nombre = ?, correo = ?, estado_verificacion = ?, strikes = ? WHERE id = ?', [nombre, correo, estado, Math.max(0, parseInt(strikes) || 0), req.params.id]);
        if (password && password.length >= 6) await pool.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 10), req.params.id]);
        if (nombre_comercial !== undefined) await pool.query('UPDATE restaurantes SET nombre_comercial = ?, direccion = ?' + (estado === 'aprobado' ? ', ultima_actividad = NOW()' : '') + ' WHERE id_usuario = ?', [nombre_comercial, direccion, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: "No se pudo actualizar (¿correo duplicado?)." }); }
});
app.delete('/api/admin/usuarios/:id', async (req, res) => {
    const id = req.params.id;
    const [u] = await pool.query('SELECT rol FROM usuarios WHERE id = ?', [id]);
    if (!u.length) return res.status(404).json({ error: "Usuario no encontrado." });
    if (u[0].rol === 'admin') return res.status(400).json({ error: "No se puede eliminar a un administrador." });
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [rs] = await conn.query('SELECT id FROM restaurantes WHERE id_usuario = ?', [id]);
        for (const r of rs) {
            await conn.query('DELETE FROM resenas WHERE id_pedido IN (SELECT id FROM pedidos WHERE id_restaurante = ?)', [r.id]);
            await conn.query('DELETE FROM pedidos WHERE id_restaurante = ?', [r.id]);
            await conn.query('DELETE FROM platillos WHERE id_restaurante = ?', [r.id]);
            await conn.query('DELETE FROM inventario WHERE id_restaurante = ?', [r.id]);
            await conn.query('DELETE FROM restaurantes WHERE id = ?', [r.id]);
        }
        await conn.query('DELETE FROM resenas WHERE id_pedido IN (SELECT id FROM pedidos WHERE id_cliente = ?)', [id]);
        for (const [t, c] of [['resenas', 'id_autor'], ['resenas', 'id_receptor'], ['pedidos', 'id_cliente'], ['notificaciones', 'id_usuario'], ['solicitudes_premium', 'id_usuario'], ['apelaciones_premium', 'id_usuario'], ['apelaciones_strikes', 'id_usuario'], ['premium_keys', 'id_usuario_asignado']]) {
            await conn.query(`DELETE FROM ${t} WHERE ${c} = ?`, [id]);
        }
        await conn.query('DELETE FROM usuarios WHERE id = ?', [id]);
        await conn.commit();
        res.json({ success: true });
    } catch (e) { await conn.rollback(); console.error(e.message); res.status(400).json({ error: "No se pudo eliminar: " + e.message }); }
    finally { conn.release(); }
});

// Baja automática de restaurantes sin actividad en 2 meses
async function bajaInactivos() {
    try { await pool.query("UPDATE usuarios u JOIN restaurantes r ON r.id_usuario = u.id SET u.estado_verificacion = 'baja' WHERE u.rol = 'restaurante' AND u.estado_verificacion = 'aprobado' AND r.ultima_actividad < DATE_SUB(NOW(), INTERVAL 2 MONTH)"); }
    catch (e) { console.error('bajaInactivos:', e.message); }
}
setInterval(bajaInactivos, 3600000);

setInterval(expirarPedidos, 30000);
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Error interno del servidor' }); });
app.listen(process.env.PORT || 3000, () => console.log(`🚀 Servidor Acorazado con Auto-Fix encendido`));