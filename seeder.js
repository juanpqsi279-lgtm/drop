const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const restaurantesVictoria = [
    // --- 1. ZONA CENTRO HISTÓRICO & 17 ---
    { nombre: "Tacos El Huasteco", dir: "17 Hidalgo y Juárez 402, Zona Centro", lat: 23.7368, lng: -99.1412, cat: "Tacos" },
    { nombre: "Pizzería Di Roma Centro", dir: "16 Morelos 320, Zona Centro", lat: 23.7381, lng: -99.1435, cat: "Pizzería" },
    { nombre: "Gorditas La Coma Centro", dir: "17 Carrera Torres 512, Zona Centro", lat: 23.7431, lng: -99.1422, cat: "Fondita" },
    { nombre: "Café Alameda 17", dir: "17 Allende y Bravo, Zona Centro", lat: 23.7348, lng: -99.1408, cat: "Cafetería" },
    { nombre: "Lonchería El Recreo", dir: "15 Matamoros 214, Zona Centro", lat: 23.7395, lng: -99.1448, cat: "Fondita" },
    { nombre: "Hamburguesas El Chino Centro", dir: "13 Juárez y Zaragoza, Zona Centro", lat: 23.7358, lng: -99.1458, cat: "Rápida" },
    { nombre: "Ensaladas Green & Co Centro", dir: "18 Hidalgo 402, Zona Centro", lat: 23.7374, lng: -99.1395, cat: "Saludable" },
    { nombre: "Tacos de Barbacoa El Güero", dir: "17 González y Abasolo, Zona Centro", lat: 23.7335, lng: -99.1415, cat: "Tacos" },
    { nombre: "La Cevichera del Centro", dir: "14 Ocampo y Guerrero, Zona Centro", lat: 23.7410, lng: -99.1452, cat: "Mariscos" },
    { nombre: "Pizza Crust 16", dir: "16 Zaragoza 108, Zona Centro", lat: 23.7352, lng: -99.1430, cat: "Pizzería" },

    // --- 2. CORREDOR CALLE 8 (BLVD. TAMAULIPAS) ---
    { nombre: "Hamburguesas Sonora 8", dir: "Blvd. Tamaulipas y Berriozábal 201", lat: 23.7478, lng: -99.1478, cat: "Rápida" },
    { nombre: "Gorditas Doña Tota Calle 8", dir: "Blvd. Tamaulipas 410, Fracc. Tamaulipas", lat: 23.7512, lng: -99.1482, cat: "Fondita" },
    { nombre: "Taquería El Borrado Calle 8", dir: "Blvd. Tamaulipas y López Mateos", lat: 23.7545, lng: -99.1485, cat: "Tacos" },
    { nombre: "Pizza & Pasta Forno 8", dir: "Blvd. Tamaulipas 820, Fracc. San José", lat: 23.7588, lng: -99.1488, cat: "Pizzería" },
    { nombre: "Green Bowl & Salad 8", dir: "Blvd. Tamaulipas y Michoacán", lat: 23.7615, lng: -99.1490, cat: "Saludable" },
    { nombre: "Mariscos El Caimán", dir: "Blvd. Tamaulipas frente a Plaza Crystal", lat: 23.7642, lng: -99.1492, cat: "Mariscos" },
    { nombre: "Coffee Spot 8", dir: "Blvd. Tamaulipas 1240, Fracc. Valle de Aguayo", lat: 23.7660, lng: -99.1494, cat: "Cafetería" },
    { nombre: "Smash Burger Victoria", dir: "Blvd. Tamaulipas y Av. del Valle", lat: 23.7685, lng: -99.1496, cat: "Rápida" },
    { nombre: "Tacos de Sirloin El 8", dir: "Blvd. Tamaulipas 1610, Residencial Campestre", lat: 23.7715, lng: -99.1498, cat: "Tacos" },
    { nombre: "Pizzería Bella Napoli", dir: "Blvd. Tamaulipas y Calle Del Parque", lat: 23.7745, lng: -99.1501, cat: "Pizzería" },

    // --- 3. ZONA NORTE: CAMPESTRE, LOS ARCOS, LA SALLE, LIBRAMIENTO NORTE ---
    { nombre: "Bistro Campestre", dir: "Av. Los Pinos 302, Fracc. Campestre", lat: 23.7725, lng: -99.1540, cat: "Saludable" },
    { nombre: "Pizza Nostra Campestre", dir: "Calle Pirul 312, Fracc. Campestre", lat: 23.7705, lng: -99.1520, cat: "Pizzería" },
    { nombre: "The Burger Lab Campestre", dir: "Paseo de los Cedros, Fracc. Campestre", lat: 23.7738, lng: -99.1565, cat: "Rápida" },
    { nombre: "Tacos La Salle Norte", dir: "Av. San Antonio frente a ULSA", lat: 23.7875, lng: -99.1570, cat: "Tacos" },
    { nombre: "Fondita Doña Carmen Los Arcos", dir: "Fracc. Los Arcos 210", lat: 23.7760, lng: -99.1430, cat: "Fondita" },
    { nombre: "Pollo Grill Los Arcos", dir: "Av. José Sulaimán Chagnón y Los Arcos", lat: 23.7785, lng: -99.1415, cat: "Rápida" },
    { nombre: "La Barra Marina Norte", dir: "Libramiento Naciones Unidas Norte 410", lat: 23.7840, lng: -99.1525, cat: "Mariscos" },
    { nombre: "Café Misión Del Palmar", dir: "Fracc. Misión del Palmar 105", lat: 23.7802, lng: -99.1625, cat: "Cafetería" },
    { nombre: "Tortas & Gorditas Las Palmas", dir: "Fracc. Las Palmas 514", lat: 23.7755, lng: -99.1610, cat: "Fondita" },
    { nombre: "Woodfire Pizza Norte", dir: "Libramiento Naciones Unidas Norte 890", lat: 23.7910, lng: -99.1530, cat: "Pizzería" },

    // --- 4. ZONA SUR: TAMATÁN, CALZADA LUIS CABALLERO, SAN MARCOS, LA PRESITA ---
    { nombre: "Gorditas de la Calzada Tamatán", dir: "Calzada Gral. Luis Caballero 602", lat: 23.7250, lng: -99.1620, cat: "Fondita" },
    { nombre: "Taquería El Paisano Tamatán", dir: "Calzada Luis Caballero y Río Frío", lat: 23.7225, lng: -99.1665, cat: "Tacos" },
    { nombre: "Mariscos La Palapa Tamatán", dir: "Entrada a Parque Tamatán 104", lat: 23.7188, lng: -99.1715, cat: "Mariscos" },
    { nombre: "Pizzería San Marcos Sur", dir: "Av. San Marcos 412, Col. San Marcos", lat: 23.7020, lng: -99.1765, cat: "Pizzería" },
    { nombre: "Antojitos Doña Lety Américo Villarreal", dir: "Col. Américo Villarreal 304", lat: 23.7115, lng: -99.1770, cat: "Fondita" },
    { nombre: "Burger Station Calzada", dir: "Calzada Luis Caballero 1120", lat: 23.7205, lng: -99.1740, cat: "Rápida" },
    { nombre: "Lonchería Sierra Ventana", dir: "Fracc. Sierra Ventana 118", lat: 23.7055, lng: -99.1735, cat: "Fondita" },
    { nombre: "Tacos al Pastor La Presita", dir: "Calzada San Marcos y La Presita", lat: 23.6890, lng: -99.1810, cat: "Tacos" },
    { nombre: "Green Bowl Tamatán", dir: "Calzada Luis Caballero y Av. del Maestro", lat: 23.7268, lng: -99.1590, cat: "Saludable" },
    { nombre: "Pizza Express Américo", dir: "Calle Principal Col. Américo Villarreal", lat: 23.7090, lng: -99.1820, cat: "Pizzería" },

    // --- 5. ZONA PONIENTE: PEDRO J. MÉNDEZ, SAN LUISITO, MODERNA, LIBERTAD ---
    { nombre: "Carnitas & Tacos San Luisito", dir: "Calle Alberto Carrera Torres 1405", lat: 23.7442, lng: -99.1585, cat: "Tacos" },
    { nombre: "Gorditas La Abuela Pedro J. Méndez", dir: "Col. Pedro J. Méndez 320", lat: 23.7485, lng: -99.1705, cat: "Fondita" },
    { nombre: "Pizzería Moderna Poniente", dir: "Col. Moderna Calle 4", lat: 23.7495, lng: -99.1625, cat: "Pizzería" },
    { nombre: "Burgers & Wings Libertad", dir: "Av. Libertad 804, Col. Libertad", lat: 23.7645, lng: -99.1715, cat: "Rápida" },
    { nombre: "Fondita Casera Linda Vista", dir: "Fracc. Linda Vista Calle 2", lat: 23.7575, lng: -99.1748, cat: "Fondita" },
    { nombre: "Tacos El Compadre López Portillo", dir: "Col. López Portillo 512", lat: 23.7610, lng: -99.1645, cat: "Tacos" },
    { nombre: "Asador Teocaltiche", dir: "Libramiento Naciones Unidas Pte y Teocaltiche", lat: 23.7515, lng: -99.1835, cat: "Rápida" },
    { nombre: "Mariscos Bahía Moderna", dir: "Calle 5 y Av. México, Col. Moderna", lat: 23.7470, lng: -99.1650, cat: "Mariscos" },
    { nombre: "Pizza Rústica Pedro J. Méndez", dir: "Av. Pedro J. Méndez 810", lat: 23.7460, lng: -99.1750, cat: "Pizzería" },
    { nombre: "Ensaladas Frescas Poniente", dir: "Calle 2 y Berriozábal Poniente", lat: 23.7420, lng: -99.1605, cat: "Saludable" },

    // --- 6. ZONA ORIENTE: LAS FLORES, FOVISSSTE, MARTE R. GÓMEZ, TECNOLÓGICO ITCV ---
    { nombre: "Tacos de Humo Las Flores", dir: "Av. Las Flores 308, Fracc. Las Flores", lat: 23.7418, lng: -99.1225, cat: "Tacos" },
    { nombre: "Pizza & Cheese Fovissste", dir: "Fracc. Fovissste Calle 3", lat: 23.7475, lng: -99.1265, cat: "Pizzería" },
    { nombre: "Antojitos Doña Chela Estadio", dir: "Puerta Norte del Estadio Marte R. Gómez", lat: 23.7428, lng: -99.1355, cat: "Fondita" },
    { nombre: "Burgers Portes Gil", dir: "Libramiento Emilio Portes Gil y Carrera Torres", lat: 23.7455, lng: -99.1165, cat: "Rápida" },
    { nombre: "Tacos Universitarios ITCV", dir: "Frente al Tecnológico de Cd. Victoria", lat: 23.7522, lng: -99.1220, cat: "Tacos" },
    { nombre: "Mariscos El Chivo Oriente", dir: "Blvd. Emilio Portes Gil 802", lat: 23.7380, lng: -99.1180, cat: "Mariscos" },
    { nombre: "Fondita Doña Mary Las Flores", dir: "Calle Jazmín, Fracc. Las Flores", lat: 23.7445, lng: -99.1195, cat: "Fondita" },
    { nombre: "Healthy Spot Oriente", dir: "Av. Las Flores y Paseo de los Olivos", lat: 23.7405, lng: -99.1140, cat: "Saludable" },
    { nombre: "Pizza Napolitana Estadio", dir: "Calle 19 y Carrera Torres", lat: 23.7435, lng: -99.1380, cat: "Pizzería" },
    { nombre: "Café Don Pedro Fovissste", dir: "Plaza Fovissste Local 4", lat: 23.7490, lng: -99.1280, cat: "Cafetería" },

    // --- 7. ZONA NORORIENTE: HOSPITALES, BICENTENARIO, POLYFORUM ---
    { nombre: "Cafetería & Deli Bicentenario", dir: "Frente a Polyforum Victoria", lat: 23.7625, lng: -99.1125, cat: "Cafetería" },
    { nombre: "Tacos Médicos HRAE", dir: "Zona Hospital Regional de Alta Especialidad", lat: 23.7678, lng: -99.1085, cat: "Tacos" },
    { nombre: "Comida Casera Doña Elena Hospital", dir: "Frente a Hospital General Dr. Treviño Zapata", lat: 23.7535, lng: -99.1155, cat: "Fondita" },
    { nombre: "Pizzería Bicentenario", dir: "Av. América Española 410", lat: 23.7660, lng: -99.1150, cat: "Pizzería" },
    { nombre: "Salad Bar Zona Médica", dir: "Hospital Infantil / Hospital General", lat: 23.7565, lng: -99.1185, cat: "Saludable" },
    { nombre: "Burgers & Fries Framboyanes", dir: "Fracc. Framboyanes Calle Jacaranda", lat: 23.7645, lng: -99.1235, cat: "Rápida" },
    { nombre: "Taquería El Portón Nororiente", dir: "Libramiento Naciones Unidas Oriente", lat: 23.7725, lng: -99.1160, cat: "Tacos" },
    { nombre: "Mariscos La Bocana Oriente", dir: "Blvd. Fidel Velázquez y Av. América Española", lat: 23.7595, lng: -99.1110, cat: "Mariscos" },

    // --- 8. ZONA SUR-CENTRAL: UAT, PASEO MÉNDEZ, MAINERO, UNIDAD MODELO ---
    { nombre: "Tacos El Estudiante UAT", dir: "Av. del Estudiante 214, Campus UAT", lat: 23.7225, lng: -99.1525, cat: "Tacos" },
    { nombre: "Fondita Doña Lupita Paseo Méndez", dir: "17 Rosales y Paseo Méndez", lat: 23.7292, lng: -99.1375, cat: "Fondita" },
    { nombre: "Pizzería Jaguar UAT", dir: "Frente a Facultad de Derecho UAT", lat: 23.7205, lng: -99.1505, cat: "Pizzería" },
    { nombre: "Burgers El Güero Mainero", dir: "Calle Matamoros y Paseo Méndez, Col. Mainero", lat: 23.7265, lng: -99.1395, cat: "Rápida" },
    { nombre: "Green Life UAT", dir: "Av. Del Estudiante y Gimnasio Multidisciplinario", lat: 23.7185, lng: -99.1475, cat: "Saludable" },
    { nombre: "Tacos Mañaneros Niños Héroes", dir: "Col. Niños Héroes 412", lat: 23.7145, lng: -99.1425, cat: "Tacos" },
    { nombre: "Lonchería La Bendición Unidad Modelo", dir: "Col. Unidad Modelo 518", lat: 23.7088, lng: -99.1488, cat: "Fondita" },
    { nombre: "Mariscos El Veracruzano Paseo Méndez", dir: "16 Doblado 310", lat: 23.7315, lng: -99.1390, cat: "Mariscos" },
    { nombre: "Pizzería La Tradición Mainero", dir: "Calle 20 Rosales, Col. Mainero", lat: 23.7245, lng: -99.1350, cat: "Pizzería" },
    { nombre: "Café Gourmet Alameda", dir: "Paseo Méndez Sur", lat: 23.7280, lng: -99.1385, cat: "Cafetería" },

    // --- 9. ZONA SURORIENTE: HORACIO TERÁN, AZTECA, SATÉLITE, EL PALMAR ---
    { nombre: "Gorditas & Barbacoa Horacio Terán", dir: "Av. Horacio Terán 410", lat: 23.7215, lng: -99.1245, cat: "Fondita" },
    { nombre: "Taquería La Azteca", dir: "Col. Azteca Calle 5", lat: 23.7142, lng: -99.1175, cat: "Tacos" },
    { nombre: "Pizzería Satélite", dir: "Col. Satélite Manzana 12", lat: 23.7082, lng: -99.1125, cat: "Pizzería" },
    { nombre: "Hamburguesas El Asador El Palmar", dir: "Fracc. El Palmar 215", lat: 23.7025, lng: -99.1220, cat: "Rápida" },
    { nombre: "Lonchería Doña Juana Azteca Sur", dir: "Col. Azteca Etapa 2", lat: 23.7110, lng: -99.1195, cat: "Fondita" },
    { nombre: "Tacos de Pastor Soto La Marina", dir: "Salida a Soto La Marina Km 1", lat: 23.7315, lng: -99.1025, cat: "Tacos" },
    { nombre: "Mariscos El Costeño Horacio Terán", dir: "Calle 20 de Noviembre, Col. Horacio Terán", lat: 23.7185, lng: -99.1265, cat: "Mariscos" },
    { nombre: "Pizza Fiesta El Palmar", dir: "Calle Palmeras, Fracc. El Palmar", lat: 23.7045, lng: -99.1255, cat: "Pizzería" }
];

const catalogoPlatillos = {
    'Pizzería': {
        img: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&q=80',
        items: [
            { nombre: 'Pizza Pepperoni Artesanal', desc: 'Masa madre crujiente, queso mozzarella fundido y pepperoni selecto.', precio: 159 },
            { nombre: 'Pizza Cuatro Quesos Clásica', desc: 'Mozzarella, parmesano, gorgonzola y provolone dorados.', precio: 175 },
            { nombre: 'Pizza Hawaiana Caramelizada', desc: 'Jamón horneado, piña asada y abundante queso.', precio: 149 },
            { nombre: 'Pizza Mexicana con Jalapeño', desc: 'Chorizo norteño, frijoles refritos, cebolla y rodajas de jalapeño.', precio: 165 },
            { nombre: 'Calzone Relleno Italiano', desc: 'Relleno de jamón, champiñones, salsa pomodoro y queso fundido.', precio: 120 }
        ]
    },
    'Rápida': {
        img: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80',
        items: [
            { nombre: 'Burger Doble Carne Sonora', desc: 'Doble carne de res 100% selecta, queso cheddar y tocino crujiente.', precio: 135 },
            { nombre: 'Hamburguesa Pollo Crispy', desc: 'Pechuga crujiente empanizada, pepinillos, aderezo ranch y lechuga.', precio: 125 },
            { nombre: 'Smash Burger con Tocino BBQ', desc: 'Carne sellada a la plancha, cebolla caramelizada y salsa BBQ especial.', precio: 140 },
            { nombre: 'Orden de Alitas BBQ (10 pzas)', desc: 'Alitas glaseadas en salsa barbacoa ahumada con apio y aderezo.', precio: 145 },
            { nombre: 'Boneless Bañados Red Hot', desc: 'Trocitos de pechuga crujiente bañados en salsa búfalo picante.', precio: 130 }
        ]
    },
    'Saludable': {
        img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&q=80',
        items: [
            { nombre: 'Bowl de Quinoa y Salmón Fresco', desc: 'Quinoa tibia, cubos de salmón, aguacate, edamames y aderezo sésamo.', precio: 155 },
            { nombre: 'Ensalada César con Pollo Grill', desc: 'Lechuga romana, pechuga a la parrilla, crutones y parmesano.', precio: 115 },
            { nombre: 'Bowl Mediterráneo con Falafel', desc: 'Falafel casero, garbanzos tostados, pepino, tomate cherry y hummus.', precio: 125 },
            { nombre: 'Wrap de Atún y Aguacate', desc: 'Atún fresco con vegetales crujientes, espinaca y aguacate en tortilla integral.', precio: 95 },
            { nombre: 'Ensalada de Frutos Rojos y Nuez', desc: 'Mix de hojas verdes, fresas, arándanos, queso de cabra y nuez garapiñada.', precio: 120 }
        ]
    },
    'Fondita': {
        img: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=80',
        items: [
            { nombre: 'Milanesa de Res con Arroz y Frijoles', desc: 'Milanesa empanizada al momento, servida con guarnición y tortillas de maíz.', precio: 110 },
            { nombre: 'Enchiladas Verdes Gratinadas', desc: 'Tres enchiladas rellenas de pollo con salsa verde cremosa y queso gouda.', precio: 98 },
            { nombre: 'Cortadillo Norteño con Papas', desc: 'Carne de res suavecita guisada con jitomate, cebolla y chile serrano.', precio: 115 },
            { nombre: 'Gorditas de Guisado Surtidas (3 pzas)', desc: 'Masa de maíz rellenas de chicharrón prensado, deshebrada y picadillo.', precio: 85 },
            { nombre: 'Sopa de Tortilla Tradicional', desc: 'Caldo de jitomate con tiras de tortilla frita, aguacate, queso y crema.', precio: 75 }
        ]
    },
    'Tacos': {
        img: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=600&q=80',
        items: [
            { nombre: 'Orden de Tacos al Pastor con Piña (5 pzas)', desc: 'Carne adobada al carbón, cebolla, cilantro y rebanadas de piña miel.', precio: 85 },
            { nombre: 'Gringa de Bistec con Queso', desc: 'Tortilla de harina grande rellena de bistec de res y queso asadero fundido.', precio: 65 },
            { nombre: 'Tacos de Barbacoa Estilo Victoria (4 pzas)', desc: 'Barbacoa de res jugosa acompañada de cilantro, cebolla y salsa verde.', precio: 95 },
            { nombre: 'Tacos de Sirloin en Tortilla de Harina (3 pzas)', desc: 'Corte fino de sirloin asado a la parrilla con cebollitas cambray.', precio: 120 },
            { nombre: 'Orden de Tacos de Trompo (5 pzas)', desc: 'Tacos tradicionales de trompo rojo con salsa tatemada al molcajete.', precio: 85 }
        ]
    },
    'Cafetería': {
        img: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&q=80',
        items: [
            { nombre: 'Combo Café Americano & Dona', desc: 'Café de grano recién molido más dona artesanal glaseada.', precio: 60 },
            { nombre: 'Capuchino Vainilla & Rebanada Pastel', desc: 'Espresso doble con leche espumada y porción de pastel de chocolate.', precio: 85 },
            { nombre: 'Bagel de Pavo y Queso Crema', desc: 'Pan bagel tostado con pechuga de pavo, espinaca y aderezo.', precio: 75 },
            { nombre: 'Croissant Mantequilla Jamón y Queso', desc: 'Hojaldre francés crujiente horneado relleno de jamón de pierna y queso.', precio: 68 },
            { nombre: 'Cold Brew con Espuma Dulce', desc: 'Café de extracción en frío con crema avainillada batida.', precio: 65 }
        ]
    },
    'Mariscos': {
        img: 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=600&q=80',
        items: [
            { nombre: 'Cóctel de Camarón Especial', desc: 'Camarones frescos en salsa cóctel tradicional con aguacate y galletas saladas.', precio: 135 },
            { nombre: 'Tostadas de Ceviche de Pescado (2 pzas)', desc: 'Pescado curado en limón con pico de gallo y rebanadas de aguacate.', precio: 90 },
            { nombre: 'Filete de Pescado Empanizado', desc: 'Filete dorado crujiente con ensalada fresca, arroz blanco y papas fritas.', precio: 125 },
            { nombre: 'Tacos de Camarón al Ajillo (3 pzas)', desc: 'Camarones salteados con ajo y chile guajillo sobre tortillas de maíz.', precio: 110 },
            { nombre: 'Caldo de Mariscos Mixto', desc: 'Caldo reconfortante con camarón, pescado y jaiba sazonado con epazote.', precio: 140 }
        ]
    }
};

async function inyectarDatos() {
    const db = await mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD ?? '',
        database: process.env.DB_NAME || 'rescate_comida'
    });

    const passwordHash = await bcrypt.hash('123456', 10);

    console.log("🚀 Limpiando restaurantes antiguos y sembrando red en TODA Ciudad Victoria...");

    // Eliminar restaurantes antiguos (los usuarios 'cliente' y 'admin' quedan intactos)
    await db.query('DELETE FROM usuarios WHERE rol = "restaurante"');

    console.log(`📍 Sembrando ${restaurantesVictoria.length} restaurantes distribuidos estratégicamente por todas las colonias de Cd. Victoria...`);

    let totalPlatillos = 0;

    for (let i = 0; i < restaurantesVictoria.length; i++) {
        const item = restaurantesVictoria[i];
        const email = `rest${i}@app.com`;

        // 1. Crear usuario de tipo restaurante
        const [u] = await db.query(
            'INSERT INTO usuarios (nombre, correo, password_hash, rol, estado_verificacion, estrellas, puntaje) VALUES (?, ?, ?, "restaurante", "aprobado", 4.9, 150)',
            [item.nombre, email, passwordHash]
        );
        const idUsuario = u.insertId;

        // 2. Crear ficha de restaurante
        const [r] = await db.query(
            'INSERT INTO restaurantes (id_usuario, nombre_comercial, direccion, latitud, longitud, categoria, ultima_actividad) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [idUsuario, item.nombre, item.dir, item.lat, item.lng, item.cat]
        );
        const idRestaurante = r.insertId;

        // 3. Crear registro de inventario
        await db.query(
            'INSERT INTO inventario (id_restaurante, platillos_disponibles, platillos_entregados) VALUES (?, ?, ?)',
            [idRestaurante, 15, 45]
        );

        // 4. Crear platillos para este restaurante
        const catData = catalogoPlatillos[item.cat] || catalogoPlatillos['Fondita'];
        for (const plato of catData.items) {
            // Garantizar disponibilidad activa (entre 2 y 5) para que siempre haya drop
            const disponibles = Math.floor(Math.random() * 4) + 2;
            await db.query(
                'INSERT INTO platillos (id_restaurante, nombre, descripcion, categoria_alimento, imagen_url, disponibles, precio_original) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [idRestaurante, plato.nombre, plato.desc, item.cat, catData.img, disponibles, plato.precio]
            );
            totalPlatillos++;
        }
    }

    console.log(`✅ ¡Éxito total!`);
    console.log(`✨ ${restaurantesVictoria.length} restaurantes activos en Ciudad Victoria.`);
    console.log(`🍲 ${totalPlatillos} platillos con stock inmediato listos para rescate.`);
    console.log(`🔑 Cuentas creadas: rest0@app.com hasta rest${restaurantesVictoria.length - 1}@app.com (clave: 123456)`);
    process.exit(0);
}

inyectarDatos().catch(err => {
    console.error("❌ Error al inyectar datos:", err);
    process.exit(1);
});