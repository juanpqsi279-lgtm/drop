let miMapa = null;
let marcadores = [];
let temporizadorInterval = null;
let usuarioActivo = null; // Guardará los datos del usuario que inició sesión

// --- SISTEMA DE NOTIFICACIONES ---
function mostrarToast(mensaje, tipo = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const color = tipo === 'success' ? 'bg-emerald-500' : 'bg-red-500';
    toast.className = `${color} text-white px-6 py-3 rounded-lg shadow-lg transform transition-all duration-300 translate-x-full opacity-0 font-medium text-sm flex items-center gap-2`;
    toast.innerHTML = `<i class="fa-solid ${tipo === 'success' ? 'fa-check-circle' : 'fa-circle-exclamation'}"></i> ${mensaje}`;
    container.appendChild(toast);
    
    setTimeout(() => { toast.classList.remove('translate-x-full', 'opacity-0'); }, 10);
    setTimeout(() => { 
        toast.classList.add('translate-x-full', 'opacity-0'); 
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- AUTENTICACIÓN ---
function toggleFormularios() {
    document.getElementById('form-login-container').classList.toggle('hidden');
    document.getElementById('form-registro-container').classList.toggle('hidden');
}

async function procesarRegistro(e) {
    e.preventDefault();
    const nombre = document.getElementById('reg-nombre').value;
    const correo = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    const res = await fetch('http://localhost:3000/api/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, correo, password })
    });
    const data = await res.json();

    if (data.error) {
        mostrarToast(data.error, "error");
    } else {
        mostrarToast("Cuenta creada. Ya puedes iniciar sesión.", "success");
        toggleFormularios();
        document.getElementById('form-registro').reset();
    }
}

async function procesarLogin(e) {
    e.preventDefault();
    const correo = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const res = await fetch('http://localhost:3000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo, password })
    });
    const data = await res.json();

    if (data.error) {
        mostrarToast(data.error, "error");
    } else {
        usuarioActivo = data.usuario;
        prepararInterfazUsuario();
    }
}

function prepararInterfazUsuario() {
    document.getElementById('vista-login').style.transform = 'translateY(-100%)';
    setTimeout(() => {
        document.getElementById('vista-login').classList.add('hidden');
        
        if (usuarioActivo.rol === 'cliente') {
            document.getElementById('vista-cliente').classList.remove('hidden');
            // Personalizar vista cliente
            document.querySelector('#vista-cliente h2').innerText = `Hola, ${usuarioActivo.nombre}`;
            document.getElementById('ui-strikes').innerText = `Strikes: ${usuarioActivo.strikes}/3`;
            inicializarMapa();
        } else {
            document.getElementById('sidebar').classList.remove('hidden');
            document.getElementById('sidebar').classList.add('flex');
            document.getElementById('area-trabajo').classList.remove('hidden');
            
            if (usuarioActivo.rol === 'restaurante') {
                document.getElementById('vista-restaurante').classList.remove('hidden');
                document.getElementById('titulo-panel').innerText = `Panel: ${usuarioActivo.nombre}`;
                cargarStatsRestaurante();
            } else if (usuarioActivo.rol === 'admin') {
                document.getElementById('vista-admin').classList.remove('hidden');
                document.getElementById('titulo-panel').innerText = "Dashboard Administrador";
                cargarStatsAdmin();
            }
        }
    }, 500);
}

function cerrarSesion() {
    usuarioActivo = null;
    window.location.reload();
}

// --- CLIENTE: MAPA Y PEDIDOS ---
function inicializarMapa() {
    if (miMapa) return;
    miMapa = L.map('mapa', { zoomControl: false }).setView([23.7369, -99.1411], 14);
    L.control.zoom({ position: 'bottomright' }).addTo(miMapa);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
    }).addTo(miMapa);
    dibujarMarcadores();
}

async function dibujarMarcadores() {
    marcadores.forEach(m => miMapa.removeLayer(m));
    marcadores = [];

    const respuesta = await fetch('http://localhost:3000/api/restaurantes');
    const restaurantes = await respuesta.json();

    restaurantes.forEach(rest => {
        const marker = L.marker([rest.lat, rest.lng]).addTo(miMapa);
        marcadores.push(marker);
        
        const popupContent = `
            <div class="text-center w-48">
                <h3 class="font-bold text-gray-800 text-base mb-1">${rest.nombre}</h3>
                <p class="text-xs text-gray-500 mb-3">Disponibles: <span class="font-bold text-emerald-600 text-sm">${rest.disponibles}</span></p>
                <button onclick="generarPedido(${rest.id}, '${rest.nombre}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg shadow w-full font-bold transition">Pedir Platillo</button>
            </div>
        `;
        marker.bindPopup(popupContent);
    });
}

window.generarPedido = async function(idRestaurante, nombreRest) {
    if (usuarioActivo.strikes >= 3) return mostrarToast("Cuenta bloqueada por strikes", "error");

    const res = await fetch('http://localhost:3000/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_cliente: usuarioActivo.id, id_restaurante: idRestaurante })
    });
    const data = await res.json();

    if (data.error) {
        mostrarToast(data.error, "error");
    } else {
        miMapa.closePopup();
        dibujarMarcadores(); 
        
        document.getElementById('txt-restaurante-pedido').innerText = nombreRest;
        document.getElementById('txt-codigo').innerText = data.codigo;
        document.getElementById('widget-pedido').classList.remove('hidden');
        mostrarToast("¡Pedido confirmado! Presenta el código.", "success");
        iniciarTemporizadorVisual();
    }
}

function iniciarTemporizadorVisual() {
    let segundosRestantes = 30 * 60;
    if (temporizadorInterval) clearInterval(temporizadorInterval);
    
    temporizadorInterval = setInterval(() => {
        segundosRestantes--;
        if (segundosRestantes <= 0) {
            clearInterval(temporizadorInterval);
            document.getElementById('widget-pedido').classList.add('hidden');
            mostrarToast("Tu pedido expiró.", "error");
            dibujarMarcadores();
        } else {
            let m = Math.floor(segundosRestantes / 60);
            let s = segundosRestantes % 60;
            document.getElementById('txt-temporizador').innerText = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
        }
    }, 1000);
}

// --- RESTAURANTE Y ADMIN: DASHBOARDS ---
async function cargarStatsRestaurante() {
    const res = await fetch(`http://localhost:3000/api/stats/restaurante/${usuarioActivo.id_restaurante}`);
    const stats = await res.json();
    document.getElementById('stat-disponibles').innerText = stats.platillos_disponibles;
    document.getElementById('stat-entregados').innerText = stats.platillos_entregados;
}

window.publicarComida = async function() {
    const cantidad = parseInt(document.getElementById('input-publicar').value);
    if (!cantidad || cantidad <= 0) return mostrarToast("Ingresa una cantidad válida", "error");

    await fetch('http://localhost:3000/api/publicar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_restaurante: usuarioActivo.id_restaurante, cantidad: cantidad })
    });
    
    document.getElementById('input-publicar').value = '';
    cargarStatsRestaurante();
    mostrarToast("Inventario actualizado", "success");
}

window.validarCodigo = async function() {
    const codigo = document.getElementById('input-validar').value.trim().toUpperCase();
    if (!codigo) return;

    const res = await fetch('http://localhost:3000/api/validar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: codigo, id_restaurante: usuarioActivo.id_restaurante })
    });
    const data = await res.json();

    if (data.error) {
        mostrarToast(data.error, "error");
    } else {
        document.getElementById('input-validar').value = '';
        cargarStatsRestaurante();
        mostrarToast("Código validado. ¡Comida entregada!", "success");
    }
}

async function cargarStatsAdmin() {
    const res = await fetch('http://localhost:3000/api/stats/admin');
    const stats = await res.json();
    document.getElementById('kpi-rescatados').innerText = stats.rescatados;
}