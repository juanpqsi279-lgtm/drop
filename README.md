# drop. — Rescate de comida en Ciudad Victoria

## Instalación
1. `npm install`
2. Copia `.env.example` a `.env` y ajusta credenciales de MySQL y `JWT_SECRET`.
3. Crea la base: `mysql -u root < schema.sql` (luego crea un usuario admin).
4. `npm run dev` (o `npm start`) y abre `index.html`.

## Roles y seguridad
- Sesión con JWT (12 h). Cada endpoint valida el rol; las acciones usan la identidad del token, no ids enviados por el cliente.
- Registro público: solo clientes y restaurantes (estos quedan pendientes de aprobación).
- Parámetros: `MINUTOS_RECLAMO` (30) y `MAX_POR_PEDIDO` (3).

## Correr en otra computadora (Windows + Laragon)
1. Instala Node.js (LTS) y Laragon; inicia MySQL desde Laragon.
2. En HeidiSQL ejecuta `schema.sql` (crea la base y las tablas).
3. `npm install`, copia `.env.example` a `.env` y ejecuta `node seeder.js` **una sola vez** (crea admin, cliente demo y 30 restaurantes).
4. Doble clic en `iniciar.bat` (instala, abre `index.html` y arranca el servidor).

Cuentas demo (clave `123456`): `admin@drop.com`, `cliente@drop.com`, `rest0@app.com` … `rest29@app.com`.
