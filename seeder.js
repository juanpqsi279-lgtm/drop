const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function inyectarDatos() {
    const db = await mysql.createPool({ host: 'localhost', user: 'root', password: '', database: 'rescate_comida' });
    const passwordHash = await bcrypt.hash('123456', 10);
    
    console.log("🚀 Inyectando Menús Estilo SuperApp (Sweetgreen UI)...");
    await db.query('DELETE FROM usuarios WHERE rol = "restaurante"');

    const menus = {
        'Pizzería': { cat: 'Pizza', img: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500&q=80', items: ['Hawaiana', 'Pepperoni', 'Cuatro Quesos', 'Mexicana', 'Orilla Rellena'] },
        'Rápida': { cat: 'Hamburguesa', img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&q=80', items: ['Clásica', 'Doble Carne', 'Pollo Crujiente', 'BBQ Bacon', 'Vegetariana'] },
        'Saludable': { cat: 'Ensalada', img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=500&q=80', items: ['César', 'Mediterránea', 'Bowl de Quinoa', 'Frutos Rojos', 'Atún Fresco'] },
        'Fondita': { cat: 'Guiso', img: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=500&q=80', items: ['Milanesa', 'Enchiladas Rojas', 'Sopa de Tortilla', 'Chiles Rellenos', 'Tacos Dorados'] }
    };
    const categorias = Object.keys(menus);

    for (let i = 0; i < 30; i++) {
        const lat = 23.73 + (Math.random() * 0.04 - 0.02);
        const lng = -99.14 + (Math.random() * 0.04 - 0.02);
        const tipo = categorias[i % categorias.length];
        
        const [u] = await db.query('INSERT INTO usuarios (nombre, correo, password_hash, rol, estado_verificacion) VALUES (?, ?, ?, "restaurante", "aprobado")', [`Local ${tipo} ${i}`, `rest${i}@app.com`, passwordHash]);
        const [r] = await db.query('INSERT INTO restaurantes (id_usuario, nombre_comercial, direccion, latitud, longitud, categoria) VALUES (?, ?, ?, ?, ?, ?)', [u.insertId, `Sabor ${tipo} ${i}`, `Calle ${i}, Centro`, lat, lng, tipo]);
        
        for(let key of categorias) {
            for(let variante of menus[key].items) {
                await db.query('INSERT INTO platillos (id_restaurante, nombre, descripcion, categoria_alimento, imagen_url, disponibles) VALUES (?, ?, ?, ?, ?, ?)', 
                [r.insertId, `${menus[key].cat} ${variante}`, `Excelente estado, sobrante del turno.`, key, menus[key].img, Math.floor(Math.random() * 5)]);
            }
        }
    }
    console.log("✅ Menús listos. Cuentas: rest0@app.com a rest29@app.com | Clave: 123456");
    process.exit();
}
inyectarDatos();