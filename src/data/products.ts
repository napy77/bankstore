import { Product } from '../types';

export const PRODUCTS: Product[] = [
  {
    id: 'prod-1',
    name: 'Smart TV Samsung 65" Neo QLED 8K',
    description: 'Experimentá la máxima definición con tecnología Quantum Matrix Pro, sonido tridimensional Dolby Atmos y escalado inteligente con IA. Diseño Infinity One ultra delgado.',
    price: 1899999,
    originalPrice: 2299999,
    category: 'electrohogar',
    rating: 4.8,
    reviewsCount: 124,
    image: 'bg-gradient-to-tr from-slate-900 to-indigo-950 border border-indigo-500/20 text-indigo-400',
    specs: [
      'Resolución 8K Real (7680 x 4320)',
      'Frecuencia de actualización: 120Hz',
      'Procesador Neural 8K con Inteligencia Artificial',
      'Sonido de 70W con 4.2.2 canales',
      '4 puertos HDMI 2.1 y 3 puertos USB'
    ],
    stock: 8,
    bankOffers: [
      { bankId: 'ciudad', maxCuotas: 24, discountPercent: 10 },
      { bankId: 'provincia', maxCuotas: 24, discountPercent: 15 },
      { bankId: 'bna', maxCuotas: 12, discountPercent: 10 }
    ],
    features: ['Envío Gratis', 'Garantía 24 meses', 'Instalación Premium']
  },
  {
    id: 'prod-2',
    name: 'iPhone 15 Pro Max 256GB Titanium',
    description: 'Forjado en titanio de calidad aeroespacial. Revolucionario chip A17 Pro para un rendimiento gráfico de nivel superior. Sistema de cámaras pro más potente y zoom óptico de 5x.',
    price: 2149999,
    originalPrice: 2499999,
    category: 'tecnologia',
    rating: 4.9,
    reviewsCount: 86,
    image: 'bg-gradient-to-tr from-stone-900 to-neutral-700 border border-neutral-600/20 text-neutral-300',
    specs: [
      'Pantalla Super Retina XDR de 6.7"',
      'Chip A17 Pro con GPU de 6 núcleos',
      'Cámara principal de 48 MP con ultra gran angular',
      'Conector USB-C compatible con USB 3',
      'Batería con hasta 29 horas de reproducción de video'
    ],
    stock: 12,
    bankOffers: [
      { bankId: 'bna', maxCuotas: 18, discountPercent: 15 },
      { bankId: 'macro', maxCuotas: 12, discountPercent: 12 },
      { bankId: 'galicia', maxCuotas: 9, discountPercent: 15 }
    ],
    features: ['Envío Gratis', 'Garantía Oficial Apple', 'Funda de Silicona Incluida']
  },
  {
    id: 'prod-3',
    name: 'Notebook ASUS ROG Zephyrus G16',
    description: 'Llevá el gaming al extremo con la pantalla OLED de alta fidelidad, procesador Intel Core Ultra 9 y placa de video NVIDIA RTX 4070. Diseño de aluminio refinado ultra portátil.',
    price: 3450000,
    originalPrice: 3890000,
    category: 'tecnologia',
    rating: 4.7,
    reviewsCount: 42,
    image: 'bg-gradient-to-tr from-gray-950 to-slate-800 border border-red-500/20 text-red-400',
    specs: [
      'Procesador Intel Core Ultra 9 185H',
      'Placa NVIDIA GeForce RTX 4070 8GB GDDR6',
      'Memoria RAM 32GB LPDDR5X',
      'Almacenamiento 1TB SSD NVMe PCIe 4.0',
      'Pantalla 16" ROG Nebular Display OLED 240Hz'
    ],
    stock: 5,
    bankOffers: [
      { bankId: 'galicia', maxCuotas: 9, discountPercent: 15 },
      { bankId: 'macro', maxCuotas: 12, discountPercent: 12 },
      { bankId: 'bna', maxCuotas: 18, discountPercent: 15 }
    ],
    features: ['Envío Gratis', 'Mochila ROG Original', 'Suscripción 3 meses Game Pass']
  },
  {
    id: 'prod-4',
    name: 'Cafetera Expreso Automática Philips Serie 2200',
    description: 'Disfrutá del exquisito sabor y aroma del café de grano fresco a la temperatura perfecta. Sistema de leche clásico espumador que te permite crear cappuccinos perfectos.',
    price: 849999,
    originalPrice: 999999,
    category: 'electrohogar',
    rating: 4.6,
    reviewsCount: 195,
    image: 'bg-gradient-to-tr from-slate-900 to-amber-950 border border-amber-600/20 text-amber-500',
    specs: [
      'Presión de la bomba: 15 bares',
      'Pantalla táctil intuitiva',
      'Molinillo de cerámica ajustable con 12 niveles',
      'Filtro AquaClean para hasta 5000 tazas sin descalcificar',
      'Capacidad del depósito de agua: 1.8 Litros'
    ],
    stock: 15,
    bankOffers: [
      { bankId: 'provincia', maxCuotas: 24, discountPercent: 15 },
      { bankId: 'ciudad', maxCuotas: 24, discountPercent: 10 },
      { bankId: 'bna', maxCuotas: 12, discountPercent: 10 }
    ],
    features: ['Retiro Gratis', 'Garantía 12 meses', 'Kit de limpieza de regalo']
  },
  {
    id: 'prod-5',
    name: 'Acondicionador de Aire BGH Silent Air 3500W',
    description: 'Tecnología Inverter que ahorra hasta un 50% de energía comparado con sistemas tradicionales. Extremadamente silencioso con filtros purificadores de aire activos.',
    price: 799999,
    originalPrice: 949999,
    category: 'electrohogar',
    rating: 4.5,
    reviewsCount: 68,
    image: 'bg-gradient-to-tr from-zinc-800 to-sky-950 border border-sky-400/20 text-sky-400',
    specs: [
      'Capacidad de enfriamiento: 3010 Frigorías / 3500W',
      'Tecnología Gold Fin anticorrosiva',
      'Control inteligente por Wi-Fi',
      'Gas refrigerante ecológico R410A',
      'Función deshumidificador y ventilación'
    ],
    stock: 20,
    bankOffers: [
      { bankId: 'ciudad', maxCuotas: 24, discountPercent: 10 },
      { bankId: 'provincia', maxCuotas: 24, discountPercent: 15 },
      { bankId: 'macro', maxCuotas: 9, discountPercent: 10 }
    ],
    features: ['Envío Bonificado', 'Garantía 3 años oficial', 'Ahorro Energético Clase A++']
  },
  {
    id: 'prod-6',
    name: 'Paquete de Viaje Bariloche Imperial: 5 Días',
    description: 'Volá a la joya patagónica. Incluye aéreos, traslados, alojamiento en hotel 5 estrellas frente al Lago Nahuel Huapi y excursiones guiadas al Circuito Chico.',
    price: 1250000,
    originalPrice: 1500000,
    category: 'turismo',
    rating: 4.9,
    reviewsCount: 37,
    image: 'bg-gradient-to-tr from-teal-900 to-emerald-950 border border-emerald-500/20 text-emerald-400',
    specs: [
      'Vuelos ida y vuelta con equipaje de mano y bodega',
      'Hotel Llao Llao / Huinid 5 estrellas con desayuno buffet',
      'Traslados Aeropuerto - Hotel - Aeropuerto incluidos',
      'Excursión de medio día a Circuito Chico y Punto Panorámico',
      'Asistencia médica de viaje premium'
    ],
    stock: 14,
    bankOffers: [
      { bankId: 'macro', maxCuotas: 9, discountPercent: 10 },
      { bankId: 'galicia', maxCuotas: 9, discountPercent: 15 },
      { bankId: 'bna', maxCuotas: 6, discountPercent: 10 }
    ],
    features: ['Cancelación Flexible', 'Puntos Extra Club', 'Asistencia 24/7']
  },
  {
    id: 'prod-7',
    name: 'Bicicleta Mountain Bike rodado 29 Carbono',
    description: 'Estructura ultraligera de fibra de carbono de alta densidad. Transmisión Shimano Deore de 12 velocidades y frenos de disco hidráulicos para un control absoluto en terrenos difíciles.',
    price: 980000,
    originalPrice: 1150000,
    category: 'deportes',
    rating: 4.7,
    reviewsCount: 29,
    image: 'bg-gradient-to-tr from-slate-900 to-cyan-950 border border-cyan-500/20 text-cyan-400',
    specs: [
      'Cuadro de Fibra de Carbono Monocasco 29er',
      'Horquilla de suspensión neumática RockShox con bloqueo remoto',
      'Grupo de transmisión Shimano Deore 1x12 velocidades',
      'Frenos a disco hidráulicos Shimano MT200',
      'Neumáticos Maxxis Icon Tubeless Ready'
    ],
    stock: 7,
    bankOffers: [
      { bankId: 'bna', maxCuotas: 6, discountPercent: 20 },
      { bankId: 'galicia', maxCuotas: 6, discountPercent: 15 },
      { bankId: 'ciudad', maxCuotas: 12, discountPercent: 5 }
    ],
    features: ['Envío Gratis', 'Service de armado incluido', 'Garantía del cuadro de por vida']
  },
  {
    id: 'prod-8',
    name: 'Smartwatch Garmin Fenix 7X Pro Solar',
    description: 'El reloj multideporte definitivo con carga de batería solar, linterna LED integrada, mapas topográficos detallados de todo el continente y métricas de rendimiento avanzadas.',
    price: 1120000,
    originalPrice: 1300000,
    category: 'deportes',
    rating: 4.9,
    reviewsCount: 54,
    image: 'bg-gradient-to-tr from-zinc-900 to-slate-950 border border-amber-500/20 text-amber-500',
    specs: [
      'Lente Power Sapphire resistente a rayones y carga solar',
      'Pantalla táctil y botones físicos de acceso rápido',
      'Autonomía de hasta 37 días en modo smartwatch',
      'Sensores integrados de ritmo cardíaco, saturación O2 y GPS multibanda',
      'Navegación GPS offline con mapas preinstalados'
    ],
    stock: 9,
    bankOffers: [
      { bankId: 'bna', maxCuotas: 6, discountPercent: 20 },
      { bankId: 'galicia', maxCuotas: 6, discountPercent: 15 },
      { bankId: 'macro', maxCuotas: 12, discountPercent: 12 }
    ],
    features: ['Envío Gratis', 'Garantía Oficial Garmin 12 meses', 'Malla extra deportiva']
  },
  {
    id: 'prod-9',
    name: 'Saco Sastrero Premium Loro Piana Lana',
    description: 'Elaborado con lana pura italiana super 130s importada de Loro Piana. Corte italiano modern fit impecable con forrería interna Jacquard y botones de asta natural.',
    price: 490000,
    originalPrice: 620000,
    category: 'moda',
    rating: 4.8,
    reviewsCount: 22,
    image: 'bg-gradient-to-tr from-neutral-900 to-amber-950 border border-yellow-800/20 text-yellow-500',
    specs: [
      '100% Lana pura Super 130s Loro Piana',
      'Forro interno completo de viscosa de seda con diseño jacquard',
      'Estructura semi-entallada (Modern Fit)',
      'Detalle de picado a mano en solapas y bolsillos',
      'Bolsillos internos funcionales y puerto de auriculares secreto'
    ],
    stock: 11,
    bankOffers: [
      { bankId: 'galicia', maxCuotas: 6, discountPercent: 25 },
      { bankId: 'macro', maxCuotas: 6, discountPercent: 10 },
      { bankId: 'ciudad', maxCuotas: 9, discountPercent: 5 }
    ],
    features: ['Envío Gratis', 'Ajuste de talle sin cargo', 'Portatrajes de viaje premium']
  }
];
