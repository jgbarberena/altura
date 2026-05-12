/**
 * mapa-sanfermin-2026.js  v5
 *
 * Cambios v5:
 * - Tooltip propio en el DOM (div fuera del mapa), no L.popup()
 *   → sale del contenedor sin overflow issues
 * - Eventos recurrentes idénticos: un único registro, "todos los días HH–HH"
 * - Eventos con variación diaria: descripción base + variaciones[{fecha, detalle}]
 * - Coordenadas corregidas (Corralillos del Gas, Apartado, Ayuntamiento)
 * - Puntos del Ayuntamiento ligeramente separados
 * - Altura mapa 70vh
 */

/* ── CATEGORÍAS ──────────────────────────────────────────── */
const CAT = {
  toros:     { color:'#c0392b', emoji:'🐂', label:'Toros' },
  unicos:    { color:'#7d3c98', emoji:'⭐', label:'Eventos únicos' },
  tradicion: { color:'#c07000', emoji:'🎭', label:'Tradición callejera' },
  conciertos:{ color:'#2471a3', emoji:'🎵', label:'Conciertos' },
  cultura:   { color:'#1e8449', emoji:'🎪', label:'Ocio y cultura' },
  fuegos:    { color:'#d4ac0d', emoji:'✨', label:'Fuegos' },
};

/* ── PÁGINAS PROPIAS ─────────────────────────────────────── */
const EVENT_PAGES = {
  encierro:            { href:'../experiencias/encierro/',    label:'Ver experiencia del encierro',    img:'../img/cards/card-encierro-balcon-premium_mobile.jpg' },
  chupinazo:           { href:'../experiencias/chupinazo/',   label:'Ver experiencia del chupinazo',   img:'../img/cards/card-chupinazo-san-fermin-premium_mobile.jpg' },
  procesion:           { href:'../experiencias/procesion/',   label:'Ver experiencia de la procesión', img:'../img/cards/card-procesion-san-fermin-pamplona_mobile.jpg' },
  'despedida-gigantes':{ href:'../experiencias/gigantes/',    label:'Ver experiencia de los gigantes', img:'../img/cards/card-despedida-gigantes-balcon_mobile.jpg' },
  'pobre-de-mi':       { href:'../experiencias/pobre-de-mi/',label:'Ver experiencia del Pobre de Mí', img:'../img/cards/card-pobredemi-balcon-premium_mobile.jpg' },
};

/* ── HELPERS TIEMPO ──────────────────────────────────────── */
function toMin(t) {
  if (t === '24:00' || t === '24:30' || t === '24:59') return 1439;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ¿El intervalo [s,e] se solapa con la ventana [wS,wE]?
// Maneja madrugada (e < s → cruza medianoche) y horas de madrugada
// que son continuación de la noche anterior (probamos también +1440).
function overlaps(hi, hf, wS, wE) {
  let s = toMin(hi);
  let e = toMin(hf);
  if (e <= s) e += 1440; // cruza medianoche
  // Variante "madrugada del día siguiente" (+1440)
  return (s < wE && e > wS) || (s + 1440 < wE && e + 1440 > wS);
}

const VENTANA = 2; // horas de ventana

/* ── FECHAS DE FIESTA ────────────────────────────────────── */
// arrays de fechas para reutilizar
const F7_14  = [7,8,9,10,11,12,13,14].map(d=>`2026-07-${String(d).padStart(2,'0')}`);
const F6_14  = [6,...[7,8,9,10,11,12,13,14]].map(d=>`2026-07-${String(d).padStart(2,'0')}`);
const F8_14  = [8,9,10,11,12,13,14].map(d=>`2026-07-${String(d).padStart(2,'0')}`);
const F6_13  = [6,7,8,9,10,11,12,13].map(d=>`2026-07-${String(d).padStart(2,'0')}`);

/* ── UBICACIONES ─────────────────────────────────────────── */
const LOCS = {

  /* TOROS */
  encierrillo_route:{id:'encierrillo_route',nombre:'Encierrillo — recorrido nocturno',tipo:'route',cat:'toros',lat:42.81993,lng:-1.64954,
    polyline:[[42.81993908798412,-1.6495463094469112],[42.820161351984794,-1.6488924205545386],[42.819562407169094,-1.6485734503631377],[42.82015199351668,-1.646142897504661]]},
  encierro_route:{id:'encierro_route',nombre:'Recorrido del Encierro',tipo:'route',cat:'toros',lat:42.82010,lng:-1.64612,
    polyline:[[42.82010754076424,-1.6461237591330171],[42.819351839244455,-1.6458334962588423],[42.81899153248184,-1.645450732029161],[42.81829430951897,-1.6440600219474382],[42.81851423975292,-1.6430106100177282],[42.817416521494835,-1.6420852140343989],[42.81600582225558,-1.6411369099816788],[42.81585835085191,-1.6408410391172301],[42.8157681518673,-1.6400744848281326],[42.815880300132456,-1.6394656234066476]]},
  plazatoros:{id:'plazatoros',nombre:'Plaza de Toros Monumental',tipo:'point',cat:'toros',lat:42.815880300132456,lng:-1.6394656234066476},
  apartado:{id:'apartado',nombre:'Apartado — sorteo de toros',tipo:'point',cat:'toros',
    // El apartado es en los corrales de la Plaza de Toros (junto a la entrada)
    lat:42.81637611107792,lng:-1.6396480136122025},
  salidapenas:{id:'salidapenas',nombre:'Salida de Peñas',tipo:'point',cat:'toros',lat:42.81577405440669,lng:-1.6401147179687319},

  /* EVENTOS ÚNICOS — puntos ligeramente separados en el Ayuntamiento */
  chupinazo_pt:{id:'chupinazo_pt',nombre:'Plaza Consistorial — Chupinazo',tipo:'point',cat:'unicos',
    lat:42.818408500937025,lng:-1.6441273025764847},
  pobre_pt:{id:'pobre_pt',nombre:'Plaza Consistorial — Pobre de Mí',tipo:'point',cat:'unicos',
    lat:42.81832,lng:-1.64430}, // ligeramente al sur-este
  despgig_pt:{id:'despgig_pt',nombre:'Plaza Consistorial — Despedida Gigantes',tipo:'point',cat:'unicos',
    lat:42.81825,lng:-1.64395}, // ligeramente al sur
  visperas_pt:{id:'visperas_pt',nombre:'Iglesia de San Lorenzo — Vísperas',tipo:'point',cat:'unicos',
    lat:42.81690166957449,lng:-1.6491608663220774},
  procesion_route:{id:'procesion_route',nombre:'Procesión de San Fermín',tipo:'route',cat:'unicos',lat:42.81830506681149,lng:-1.6440287896326378,
    polyline:[[42.81839885130254,-1.6441239895575783],[42.81826980749203,-1.643920998170776],[42.818537821258836,-1.6429421285944172],[42.8190936979607,-1.6423737527113702],[42.81953376347227,-1.6416339618794678],[42.81963633468276,-1.641999346375712],[42.81937825195761,-1.6429691941126576],[42.8187959074919,-1.6427256044484946],[42.81854774767234,-1.6429195739958835],[42.81827462964472,-1.643964505144064],[42.81815474878515,-1.6442598280749698],[42.81831191778543,-1.6446161907318013],[42.81833011627545,-1.6451800556951413],[42.817016453499,-1.649321936689006],[42.815668262258086,-1.6477879489563754],[42.81604995964712,-1.646575590446109],[42.81676416029819,-1.6452666724563836],[42.81731702069527,-1.6442045177299163],[42.81808629510321,-1.6437968219271895]]},

  /* TRADICIÓN CALLEJERA */
  dianas_route:{id:'dianas_route',nombre:'Dianas — La Pamplonesa',tipo:'route',cat:'tradicion',lat:42.818829039618144,lng:-1.6503719689872283,
    polyline:[[42.818829039618144,-1.6503719689872283],[42.8195496529375,-1.6471312318425926],[42.8203544838596,-1.6460212155765164],[42.820944062654334,-1.6436991125831162],[42.8211405876699,-1.6410070041676907],[42.81913787492622,-1.6398331938633344],[42.8182862344295,-1.6389783537503795],[42.81744394108244,-1.6390166301733473],[42.816058811520485,-1.6410325217830026],[42.81616176140659,-1.6425508198940721],[42.81488891441128,-1.646646397151663],[42.81557213701151,-1.6479477955325794],[42.818829039618144,-1.6503719689872283]]},
  gigantes_route:{id:'gigantes_route',nombre:'Comparsa de Gigantes y Cabezudos',tipo:'route',cat:'tradicion',lat:42.818829,lng:-1.650371,
    polyline:[[42.818829039618144,-1.6503719689872283],[42.8195496529375,-1.6471312318425926],[42.8203544838596,-1.6460212155765164],[42.820944062654334,-1.6436991125831162],[42.8211405876699,-1.6410070041676907],[42.81913787492622,-1.6398331938633344],[42.8182862344295,-1.6389783537503795],[42.81744394108244,-1.6390166301733473],[42.816058811520485,-1.6410325217830026],[42.81616176140659,-1.6425508198940721],[42.81488891441128,-1.646646397151663],[42.81557213701151,-1.6479477955325794],[42.818829039618144,-1.6503719689872283]]},
  alpargata:{id:'alpargata',nombre:'Baile de la Alpargata — Casino Principal',tipo:'point',cat:'tradicion',lat:42.81747593149328,lng:-1.6432421735870941},
  torico_route:{id:'torico_route',nombre:'Torico de Fuego — recorrido',tipo:'route',cat:'tradicion',lat:42.81879206438022,lng:-1.6446832420968196,
    polyline:[[42.81879206438022,-1.6446832420968196],[42.81867401912783,-1.644790530450951],[42.81826872871292,-1.6440556052251503],[42.81813185613356,-1.6442324844866198],[42.81800181169955,-1.6441913602465015],[42.817760822277386,-1.6442679130909559],[42.817256514834526,-1.6451734147267691]]},

  /* CONCIERTOS */
  castillo:{id:'castillo',nombre:'Plaza del Castillo',tipo:'point',cat:'conciertos',lat:42.816842405847424,lng:-1.6428076557444484},
  compania:{id:'compania',nombre:'Plaza de la Compañía',tipo:'point',cat:'conciertos',lat:42.818398989747024,lng:-1.6414632273762215},
  sarasate:{id:'sarasate',nombre:'Paseo de Sarasate — Jota navarra',tipo:'point',cat:'conciertos',lat:42.814911382691534,lng:-1.6461776637091425},
  antoniutti:{id:'antoniutti',nombre:'Parque de Antoniutti — Verbenas',tipo:'point',cat:'conciertos',lat:42.81533354723777,lng:-1.6533195459218997},
  fueros:{id:'fueros',nombre:'Plaza de los Fueros — Zona Joven / Sound Fermín',tipo:'point',cat:'conciertos',lat:42.81622753124601,lng:-1.6373876500617721},

  /* OCIO Y CULTURA */
  barracas:{id:'barracas',nombre:'Barracas — Parque de la Runa (Rochapea)',tipo:'point',cat:'cultura',lat:42.82066910553697,lng:-1.6483147950669121},
  corralillos:{id:'corralillos',nombre:'Corralillos del Gas — visita a los toros',tipo:'point',cat:'cultura',
    lat:42.81993138365361,lng:-1.6496101310130322}, // coordenada real de los corrales del Gas
  casetas:{id:'casetas',nombre:'Casetas Regionales',tipo:'point',cat:'cultura',lat:42.816375680877144,lng:-1.6495880167766666},

  /* FUEGOS */
  fuegos_area:{id:'fuegos_area',nombre:'Fuegos Artificiales — Ciudadela / Vuelta del Castillo',tipo:'route',cat:'fuegos',lat:42.8121355356781,lng:-1.6492906187663732,
    polyline:[[42.81372719107423,-1.6505044479538546],[42.81271988944591,-1.6468326146617227],[42.81200196832739,-1.6460512121222812],[42.81148439211878,-1.6466505402836005],[42.810488184859416,-1.64634708298673],[42.81041026853128,-1.6474698749851504],[42.80946969939779,-1.6481905860652175],[42.809959464991756,-1.6495940760632433],[42.8096310998515,-1.6505651394132288],[42.81030452478612,-1.6509899796288474],[42.81055497020542,-1.6525148525456212],[42.81169587539399,-1.652264500275703],[42.812296929177734,-1.6528486555920319],[42.8128645857189,-1.6518396600799379],[42.813638148499756,-1.6519534565662641],[42.8121355356781,-1.6492906187663732]]},
};

/* ── EVENTOS ─────────────────────────────────────────────────
   Estructura:
   - horaInicio / horaFin: franja diaria (para el filtro)
   - fechas: array ISO de días en que ocurre (para filtro por día)
   - descripcion: texto base
   - variaciones[]: [{fecha, detalle}] — solo para eventos con cambio diario
     Si no hay variaciones, el tooltip solo muestra descripcion + horario
   - tipo: 'diario' (mismo todos los días) | 'variado' | 'unico'
─────────────────────────────────────────────────────────────── */
const EVENTS = [

  /* ─── 🔴 TOROS ─── */
  {
    id:'encierrillo', location:'encierrillo_route', cat:'toros',
    titulo:'Encierrillo — traslado nocturno de toros',
    descripcion:'Los toros que correrán al día siguiente son trasladados desde los Corrales del Gas hasta los Corrales de Santo Domingo. Acto gratuito, tranquilo y poco conocido. Sale hacia las 23:30.',
    horaInicio:'23:30', horaFin:'24:00',
    fechas: F6_13, // la noche del 6 al 7, ..., del 13 al 14
    tipo:'diario',
    confirmado:true,
  },
  {
    id:'encierro', location:'encierro_route', cat:'toros',
    titulo:'Encierro',
    descripcion:'875 metros desde los corrales de Santo Domingo hasta la Plaza de Toros. Del 7 al 14 de julio a las 8:00. Dura entre 2 y 4 minutos.',
    horaInicio:'08:00', horaFin:'08:30',
    fechas: F7_14,
    tipo:'diario',
    confirmado:true,
  },
  {
    id:'apartado', location:'apartado', cat:'toros',
    titulo:'Apartado',
    descripcion:'Sorteo y asignación de los toros que ya corrieron esa mañana en el encierro a los toreros que los lidiarán esa tarde. En Pamplona tiene la gracia de que el público ya ha visto correr a esos toros. En los corrales de la Plaza de Toros, con acceso limitado (tribuna de pago).',
    horaInicio:'12:00', horaFin:'13:30',
    fechas: F7_14,
    tipo:'diario',
    confirmado:true,
  },
  {
    id:'novillada', location:'plazatoros', cat:'toros',
    titulo:'Novillada — Ganadería Pincha (Lodosa, Navarra)',
    descripcion:'Apertura del ciclo taurino, el domingo 5 de julio antes del primer encierro. Ganadería navarra de Pincha. Toreros pendientes de confirmar.',
    horaInicio:'18:30', horaFin:'21:00',
    fechas:['2026-07-05'],
    tipo:'unico',
    confirmado:true,
  },
  {
    id:'rejones', location:'plazatoros', cat:'toros',
    titulo:'Corrida de Rejones — El Capea / Carmen Lorenzo',
    descripcion:'Tarde de rejones el día del Chupinazo (6 de julio). Guillermo Hermoso de Mendoza, Roberto Armendáriz y un tercero por confirmar.',
    horaInicio:'18:30', horaFin:'21:00',
    fechas:['2026-07-06'],
    tipo:'unico',
    confirmado:true,
  },
  {
    id:'corridas', location:'plazatoros', cat:'toros',
    titulo:'Corrida de toros — Feria del Toro',
    descripcion:'Del 7 al 14 de julio a las 18:30. Tres toreros y una ganadería por tarde. Cartel completo pendiente de publicación oficial a finales de mayo.',
    horaInicio:'18:30', horaFin:'21:00',
    fechas: F7_14,
    tipo:'variado',
    confirmado:false,
    variaciones:[
      {fecha:'2026-07-07', detalle:'Ganadería: Fuente Ymbro · D. Luque, V. Hernández + pendiente'},
      {fecha:'2026-07-08', detalle:'Ganadería: por confirmar · Toreros pendientes'},
      {fecha:'2026-07-09', detalle:'Ganadería: Jandilla · A. Roca Rey + pendiente'},
      {fecha:'2026-07-10', detalle:'Ganadería: José Escolar · J. de Castilla + pendiente'},
      {fecha:'2026-07-11', detalle:'Ganadería: Cebada Gago · A. Ferrera + pendiente'},
      {fecha:'2026-07-12', detalle:'Ganadería: La Palmosilla · Fortes, F. Adrián + pendiente'},
      {fecha:'2026-07-13', detalle:'Ganadería: Victoriano del Río · A. Roca Rey (2ª tarde) + pendiente'},
      {fecha:'2026-07-14', detalle:'Ganadería: Álvaro Núñez / Miura · Morante, P. Moral, Escribano + pendiente'},
    ],
  },
  {
    id:'salidapenas', location:'salidapenas', cat:'toros',
    titulo:'Salida de Peñas desde la Plaza de Toros',
    descripcion:'Tras la corrida, las peñas salen en pasacalles con pancartas y charangas hacia el casco viejo. Uno de los momentos más fotogénicos de la tarde.',
    horaInicio:'21:00', horaFin:'22:30',
    fechas: F7_14,
    tipo:'diario',
    confirmado:true,
  },

  /* ─── ⭐ EVENTOS ÚNICOS ─── */
  {
    id:'chupinazo', location:'chupinazo_pt', cat:'unicos',
    titulo:'Chupinazo — inicio oficial de las fiestas',
    descripcion:'6 de julio a las 12:00. El cohete lanzado desde el balcón del Ayuntamiento da inicio a los nueve días de fiesta.',
    horaInicio:'12:00', horaFin:'13:00',
    fechas:['2026-07-06'],
    tipo:'unico',
    confirmado:true,
  },
  {
    id:'visperas', location:'visperas_pt', cat:'unicos',
    titulo:'Vísperas solemnes de San Fermín',
    descripcion:'La tarde del 6 de julio en la Capilla de San Fermín (Iglesia de San Lorenzo). Acto religioso de vísperas en honor al patrón de Pamplona.',
    horaInicio:'20:00', horaFin:'21:30',
    fechas:['2026-07-06'],
    tipo:'unico',
    confirmado:true,
  },
  {
    id:'procesion', location:'procesion_route', cat:'unicos',
    titulo:'Procesión de San Fermín',
    descripcion:'7 de julio, día grande. El santo recorre el casco viejo acompañado de autoridades, música y fieles. Las jotas espontáneas son uno de sus momentos más emocionantes.',
    horaInicio:'10:00', horaFin:'12:00',
    fechas:['2026-07-07'],
    tipo:'unico',
    confirmado:true,
  },
  {
    id:'despedida-gigantes', location:'despgig_pt', cat:'unicos',
    titulo:'Despedida de los Gigantes',
    descripcion:'14 de julio, último día. Los gigantes se despiden en la Plaza Consistorial en uno de los actos más emotivos del final de las fiestas.',
    horaInicio:'18:00', horaFin:'20:00',
    fechas:['2026-07-14'],
    tipo:'unico',
    confirmado:true,
  },
  {
    id:'pobre-de-mi', location:'pobre_pt', cat:'unicos',
    titulo:'Pobre de Mí — fin de las fiestas',
    descripcion:'14 de julio a medianoche. En la Plaza Consistorial, el pañuelo rojo baja del cuello mientras se entona el himno de la despedida.',
    horaInicio:'24:00', horaFin:'24:30',
    fechas:['2026-07-14'],
    tipo:'unico',
    confirmado:true,
  },

  /* ─── 🎭 TRADICIÓN CALLEJERA ─── */
  {
    id:'dianas', location:'dianas_route', cat:'tradicion',
    titulo:'Diana — La Pamplonesa',
    descripcion:'Cada mañana del 7 al 14, La Pamplonesa recorre el casco viejo desde las 7:00 para despertar a la ciudad. Desde los balcones es habitual que caiga agua sobre la calle.',
    horaInicio:'07:00', horaFin:'08:00',
    fechas: F7_14,
    tipo:'diario',
    confirmado:true,
  },
  {
    id:'comparsa', location:'gigantes_route', cat:'tradicion',
    titulo:'Comparsa de Gigantes y Cabezudos',
    descripcion:'Sale del Ayuntamiento cada mañana del 7 al 14 a las 9:30 y recorre el casco viejo. Los kilikis (cabezudos) reparten vergazos a los niños. Uno de los actos más queridos de San Fermín.',
    horaInicio:'09:30', horaFin:'11:00',
    fechas: F7_14,
    tipo:'diario',
    confirmado:true,
  },
  {
    id:'alpargata', location:'alpargata', cat:'tradicion',
    titulo:'Baile de la Alpargata',
    descripcion:'Después del encierro, cada mañana del 7 al 14, el Nuevo Casino Principal (Plaza del Castillo) acoge este baile tradicional sanferminero. Muy de aquí.',
    horaInicio:'09:00', horaFin:'11:00',
    fechas: F7_14,
    tipo:'diario',
    confirmado:true,
  },
  {
    id:'torico', location:'torico_route', cat:'tradicion',
    titulo:'Torico de Fuego',
    descripcion:'Cada noche del 6 al 14, un mozo conduce el Torico de Fuego desde la Plaza de Santiago recorriendo los alrededores de la Plaza Consistorial. Espectáculo breve y vistoso, muy querido por niños.',
    horaInicio:'21:45', horaFin:'22:15',
    fechas: F6_14,
    tipo:'diario',
    confirmado:true,
  },

  /* ─── 🎵 CONCIERTOS ─── */
  {
    id:'castillo-conciertos', location:'castillo', cat:'conciertos',
    titulo:'Conciertos Plaza del Castillo',
    descripcion:'Escenario principal de San Fermín. Del 6 al 13 de julio, a partir de las 21:30–23:45 según el día. En 2026 algunos conciertos adelantan a las 23:30 para reducir el impacto acústico.',
    horaInicio:'21:30', horaFin:'02:00',
    fechas:['2026-07-06','2026-07-07','2026-07-08','2026-07-09','2026-07-10','2026-07-11','2026-07-12','2026-07-13'],
    tipo:'variado',
    confirmado:true,
    variaciones:[
      {fecha:'2026-07-06', detalle:'21:30 Isabel Aaiún · 23:45 Boney M feat. Maizie Williams'},
      {fecha:'2026-07-07', detalle:'23:30 Bala · 00:40 Koma'},
      {fecha:'2026-07-08', detalle:'23:45 Motxila 21 · 00:50 Brigade Loco'},
      {fecha:'2026-07-09', detalle:'23:45 Neomak · 00:50 Shinova'},
      {fecha:'2026-07-10', detalle:'23:45 Marlena'},
      {fecha:'2026-07-11', detalle:'23:30 Ojete Calor'},
      {fecha:'2026-07-12', detalle:'23:30 Merina Gris · 00:50 La Txama'},
      {fecha:'2026-07-13', detalle:'23:30 Hofe · 00:40 Jarfaiter'},
    ],
  },
  {
    id:'compania-conciertos', location:'compania', cat:'conciertos',
    titulo:'Conciertos Plaza de la Compañía',
    descripcion:'Dos turnos: tarde a las 20:00 (artistas locales) y noche a las 23:30 (artistas internacionales). House, reggae dub, jazz, músicas africanas y latinas. Del 6 al 13 de julio.',
    horaInicio:'19:00', horaFin:'01:00',
    fechas:['2026-07-06','2026-07-07','2026-07-08','2026-07-09','2026-07-10','2026-07-11','2026-07-12','2026-07-13'],
    tipo:'variado',
    confirmado:true,
    variaciones:[
      {fecha:'2026-07-06', detalle:'19:00 Odd Signals · 20:30 CC:DISCO! · 22:30 Celia Carrera'},
      {fecha:'2026-07-07', detalle:'20:00 Puttaneska (de momento) · 23:30 Frente Cumbiero'},
      {fecha:'2026-07-08', detalle:'20:00 Burutik · 23:30 Tarta Relena'},
      {fecha:'2026-07-09', detalle:'20:00 La Mala Pekora · 23:30 The Zawose Queens'},
      {fecha:'2026-07-10', detalle:'20:00 Puntu Takoma · 23:30 Bibi Tanga & The Selenites'},
      {fecha:'2026-07-11', detalle:'20:00 Euskoprincess · 23:30 The Scientist feat. Shanique Marie'},
      {fecha:'2026-07-12', detalle:'20:00 Kumbia vs Salsa · 23:30 Instituto Mexicano del Sonido'},
      {fecha:'2026-07-13', detalle:'20:00 Sedientos de Cumbia · 23:30 Izo Fitzroy'},
    ],
  },
  {
    id:'jotas', location:'sarasate', cat:'conciertos',
    titulo:'Jota Navarra — Paseo de Sarasate',
    descripcion:'Conciertos de jota navarra y programación variada en el Paseo de Sarasate, en horario de tarde. Del 7 al 14 de julio. Programa exacto pendiente de confirmar.',
    horaInicio:'18:00', horaFin:'20:00',
    fechas: F7_14,
    tipo:'diario',
    confirmado:false,
  },
  {
    id:'antoniutti', location:'antoniutti', cat:'conciertos',
    titulo:'Verbenas — Parque de Antoniutti',
    descripcion:'Verbenas y ritmos latinos en el Parque de Antoniutti, hasta la madrugada. Del 6 al 14. Programa pendiente de confirmar.',
    horaInicio:'22:00', horaFin:'03:00',
    fechas: F6_14,
    tipo:'diario',
    confirmado:false,
  },
  {
    id:'zonajoven', location:'fueros', cat:'conciertos',
    titulo:'Zona Joven / Sound Fermín — Plaza de los Fueros',
    descripcion:'DJ y electrónica por la noche (23:45) y actuaciones de tarde en la Plaza de los Fueros. Del 6 al 14. Programa pendiente de confirmar.',
    horaInicio:'23:45', horaFin:'03:00',
    fechas: F6_14,
    tipo:'diario',
    confirmado:false,
  },

  /* ─── 🎪 OCIO Y CULTURA ─── */
  {
    id:'barracas', location:'barracas', cat:'cultura',
    titulo:'Barracas — Recinto Ferial Parque de la Runa',
    descripcion:'La feria de atracciones de San Fermín en el Parque de la Runa (Rochapea). Casi un centenar de atracciones: noria, autos de choque, montaña rusa, tómbolas y puestos de comida. Abiertas prácticamente las 24 horas durante todas las fiestas.',
    horaInicio:'11:00', horaFin:'04:00',
    fechas: F6_14,
    tipo:'diario',
    confirmado:true,
  },
  {
    id:'corralillos', location:'corralillos', cat:'cultura',
    titulo:'Corralillos del Gas — visita a los toros',
    descripcion:'Visita a los toros que correrán al día siguiente, en los Corrales del Gas. Una perspectiva completamente diferente del encierro. Entrada: 4 € (gratis menores de 12 acompañados). Disponible hasta el 11 de julio.',
    horaInicio:'11:00', horaFin:'13:15',
    fechas:['2026-07-06','2026-07-07','2026-07-08','2026-07-09','2026-07-10','2026-07-11'],
    tipo:'diario',
    confirmado:true,
  },
  {
    id:'corralillos-tarde', location:'corralillos', cat:'cultura',
    titulo:'Corralillos del Gas — visita (tarde)',
    descripcion:'Turno de tarde de la visita a los toros en los Corrales del Gas. Entrada: 4 € (gratis menores de 12 acompañados).',
    horaInicio:'16:30', horaFin:'20:30',
    fechas:['2026-07-06','2026-07-07','2026-07-08','2026-07-09','2026-07-10','2026-07-11'],
    tipo:'diario',
    confirmado:true,
  },
  {
    id:'deporterural', location:'fueros', cat:'cultura',
    titulo:'Deporte Rural — Herri Kirolak (Plaza de los Fueros)',
    descripcion:'Del 8 al 14 de julio a las 12:00. Campeonatos navarros y exhibiciones de aizkolaris, levantamiento de piedra, sokatira, tronzalaris y otras modalidades de deporte rural vasco. Entrada gratuita.',
    horaInicio:'12:00', horaFin:'14:00',
    fechas: F8_14,
    tipo:'diario',
    confirmado:true,
  },
  {
    id:'casetas', location:'casetas', cat:'cultura',
    titulo:'Casetas Regionales',
    descripcion:'Casetas de las distintas comarcas y regiones, con gastronomía y tradiciones propias. Del 6 al 14. Programa y horario pendientes de confirmar.',
    horaInicio:'11:00', horaFin:'02:00',
    fechas: F6_14,
    tipo:'diario',
    confirmado:false,
  },

  /* ─── ✨ FUEGOS ─── */
  {
    id:'fuegos', location:'fuegos_area', cat:'fuegos',
    titulo:'Fuegos Artificiales — Concurso Internacional de San Fermín',
    descripcion:'Cada noche a las 23:00 desde la Ciudadela. Uno de los concursos más prestigiosos del mundo. La mejor vista es sentado en la hierba de la Vuelta del Castillo.',
    horaInicio:'23:00', horaFin:'23:30',
    fechas: F6_14,
    tipo:'diario',
    confirmado:true,
  },
];

/* ── MAPA INIT ───────────────────────────────────────────── */
function initMapaSanFermin() {
  const mapEl = document.getElementById('mapa-sf');
  if (!mapEl || typeof L === 'undefined') return;

  // Referencias al panel lateral
  const panel      = document.getElementById('mapa-sf-panel');
  const panelEmpty = document.getElementById('mapa-sf-panel-empty');

  function showPanel(html) {
    if (!panel) return;
    panel.innerHTML = html;
    // Mobile: abrir drawer
    panel.classList.add('panel-open');
  }

  function clearPanel() {
    if (!panel || !panelEmpty) return;
    panel.innerHTML = '';
    panel.appendChild(panelEmpty);
    panel.classList.remove('panel-open');
  }

  // Cerrar panel al hacer click fuera del mapa y del panel
  document.addEventListener('click', e => {
    if (panel && !panel.contains(e.target) && !mapEl.contains(e.target)) {
      clearPanel();
    }
  });

  const map = L.map('mapa-sf', {
    center:[42.8168,-1.6440],
    zoom:16,
    zoomControl:true,
    scrollWheelZoom:false,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{
    attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains:'abcd', maxZoom:19,
  }).addTo(map);

  // Cerrar panel al mover el mapa
  map.on('movestart', () => clearPanel());

  // Estado
  let selDay  = 'all';
  let selHour = null;

  // Icono circular
  function makeIcon(cat, active) {
    const sz   = active ? 30 : 22;
    const col  = active ? CAT[cat].color : '#aaa';
    const em   = CAT[cat].emoji;
    const op   = active ? 1 : 0.35;
    const sh   = active ? `0 2px 10px ${CAT[cat].color}66` : 'none';
    const brd  = active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)';
    return L.divIcon({
      className:'',
      html:`<div style="width:${sz}px;height:${sz}px;background:${col};border:2px solid ${brd};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.44)}px;box-shadow:${sh};cursor:${active?'pointer':'default'};opacity:${op};">${em}</div>`,
      iconSize:[sz,sz], iconAnchor:[sz/2,sz/2],
    });
  }

  // Construir HTML del tooltip
  function buildTooltipHTML(loc, matchedEvents) {
    // matchedEvents: [{event, dias:[{fecha,horaInicio,horaFin}]}]
    // Para eventos variados: mostrar descripción + variaciones del día seleccionado
    const page = matchedEvents.reduce((p,{event}) => p || EVENT_PAGES[event.id], null);

    const imgHtml = page?.img
      ? `<div class="sfp-img"><img src="${page.img}" alt="" loading="lazy"></div>` : '';

    const dayLabel = f => {
      const ns=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
      const dt=new Date(f+'T12:00:00');
      return `${ns[dt.getDay()]} ${dt.getDate()}/07`;
    };

    let evHtml = '';
    matchedEvents.forEach(({event, diasActivos}) => {
      const pend = !event.confirmado ? '<span class="sfp-pend"> · pendiente</span>' : '';

      // Horario: si es diario o único, un solo "HH:MM – HH:MM"
      // Si es variado, listamos las variaciones de los días activos
      let schedHtml = '';
      if (event.tipo === 'diario') {
        const rango = event.fechas.length > 1
          ? `${event.horaInicio} – ${event.horaFin} · todos los días`
          : `${event.horaInicio} – ${event.horaFin}`;
        schedHtml = `<div class="sfp-dia"><span class="sfp-hora">${rango}</span></div>`;
      } else if (event.tipo === 'unico') {
        schedHtml = `<div class="sfp-dia"><span class="sfp-hora">${event.horaInicio} – ${event.horaFin}</span> ${dayLabel(event.fechas[0])}</div>`;
      } else {
        // variado: listamos los días activos con su variación
        const diasParaMostrar = selDay === 'all' ? event.fechas : [selDay];
        schedHtml = diasParaMostrar.map(f => {
          const v = event.variaciones?.find(x=>x.fecha===f);
          return `<div class="sfp-dia"><span class="sfp-hora">${dayLabel(f)} ${event.horaInicio}</span>${v?` · ${v.detalle}`:''}</div>`;
        }).join('');
      }

      evHtml += `<div class="sfp-ev">
        <div class="sfp-etit">${event.titulo}${pend}</div>
        <div class="sfp-edesc">${event.descripcion}</div>
        ${schedHtml}
      </div>`;
    });

    const linkHtml = page
      ? `<a class="sfp-link" href="${page.href}">${page.label} →</a>` : '';

    return `<div class="sfp-card">${imgHtml}<div class="sfp-body">
      <div class="sfp-loc">${loc.nombre}</div>
      ${evHtml}${linkHtml}
    </div></div>`;
  }

  // Capas activas
  const layers = {};

  function renderAll() {
    const wS = selHour !== null ? selHour * 60 : 0;
    const wE = selHour !== null ? (selHour + VENTANA) * 60 : 1440;

    // Por ubicación: agrupar eventos activos
    const byLoc = {};

    EVENTS.forEach(event => {
      const diasFiltrados = selDay === 'all'
        ? event.fechas
        : event.fechas.filter(f => f === selDay);

      if (!diasFiltrados.length) return;

      // ¿Hay al menos un día donde el horario es activo?
      const isActive = selHour === null
        || diasFiltrados.some(() => overlaps(event.horaInicio, event.horaFin, wS, wE));

      const locId = event.location;
      if (!byLoc[locId]) byLoc[locId] = {isActive:false, events:[]};
      byLoc[locId].isActive = byLoc[locId].isActive || isActive;
      byLoc[locId].events.push({event, diasActivos:diasFiltrados});
    });

    // Limpiar capas
    Object.values(layers).forEach(({marker,poly}) => {
      if (marker) map.removeLayer(marker);
      if (poly)   map.removeLayer(poly);
    });
    Object.keys(layers).forEach(k => delete layers[k]);

    // Dibujar
    Object.entries(byLoc).forEach(([locId, {isActive, events}]) => {
      const loc = LOCS[locId]; if (!loc) return;
      const cat = loc.cat;
      const color = isActive ? CAT[cat].color : '#bbb';
      const popHtml = buildTooltipHTML(loc, events);

      const onMarkerClick = () => {
        showPanel(popHtml);
      };

      if (loc.tipo === 'route') {
        // Ubicaciones que se renderizan como área rellena (polígono)
        const isArea = ['fuegos_area', 'gigantes_route', 'dianas_route'].includes(locId);
        const isDash = locId === 'procesion_route';
        const baseWeight  = isActive ? (isArea ? 2 : 5) : (isArea ? 1 : 3);
        const baseOpacity = isActive ? (isArea ? 0.6 : 0.88) : (isArea ? 0.15 : 0.22);
        const fillOpacity = isActive ? 0.15 : 0.04;

        const poly = isArea
          ? L.polygon(loc.polyline, {
              color, fillColor:color, fillOpacity,
              weight:baseWeight, opacity:baseOpacity, interactive:isActive,
            }).addTo(map)
          : L.polyline(loc.polyline, {
              color, weight:baseWeight, opacity:baseOpacity,
              dashArray:isDash?'8,6':null, interactive:isActive,
            }).addTo(map);

        if (isActive) {
          if (isArea) {
            poly.on('mouseover', () => poly.setStyle({fillOpacity: fillOpacity + 0.1, opacity: 1}));
            poly.on('mouseout',  () => poly.setStyle({fillOpacity, opacity: baseOpacity}));
          } else {
            poly.on('mouseover', () => poly.setStyle({weight: baseWeight + 3, opacity: 1}));
            poly.on('mouseout',  () => poly.setStyle({weight: baseWeight, opacity: baseOpacity}));
          }
          poly.on('click', onMarkerClick);
        }

        // Los fuegos no necesitan marcador separado: el área ya es visible
        // Para el resto de rutas/áreas, añadimos marcador en el punto de origen
        let marker = null;
        if (locId !== 'fuegos_area') {
          const icon = makeIcon(cat, isActive);
          marker = L.marker([loc.lat,loc.lng],{icon,interactive:isActive}).addTo(map);
          if (isActive) {
            const iconEl = () => marker.getElement()?.querySelector('div');
            marker.on('mouseover', () => { const el=iconEl(); if(el){ el.style.transform='scale(1.25)'; el.style.transition='transform .15s'; }});
            marker.on('mouseout',  () => { const el=iconEl(); if(el) el.style.transform='scale(1)'; });
            marker.on('click', onMarkerClick);
          }
        }

        layers[locId] = {marker, poly};
      } else {
        const icon   = makeIcon(cat, isActive);
        const marker = L.marker([loc.lat,loc.lng],{icon,interactive:isActive}).addTo(map);
        if (isActive) {
          const iconEl = () => marker.getElement()?.querySelector('div');
          marker.on('mouseover', () => { const el=iconEl(); if(el){ el.style.transform='scale(1.25)'; el.style.transition='transform .15s'; }});
          marker.on('mouseout',  () => { const el=iconEl(); if(el)  el.style.transform='scale(1)'; });
          marker.on('click', onMarkerClick);
        }
        layers[locId] = {marker, poly:null};
      }
    });
  }

  // Controles
  const daySelect  = document.getElementById('sf-day-select');
  const hourSlider = document.getElementById('sf-hour-slider');
  const hourLabel  = document.getElementById('sf-hour-label');

  function updateLabel() {
    const v = parseInt(hourSlider.value);
    if (v === -1) { hourLabel.textContent='Todo el día'; selHour=null; }
    else {
      selHour = v;
      const e = (v+VENTANA)%24;
      hourLabel.textContent=`${String(v).padStart(2,'0')}:00 – ${String(e).padStart(2,'0')}:00`;
    }
  }

  if (daySelect)  daySelect.addEventListener('change',  ()=>{ selDay=daySelect.value; clearPanel(); renderAll(); });
  if (hourSlider) hourSlider.addEventListener('input',   ()=>{ updateLabel(); clearPanel(); renderAll(); });

  // Auto-posicionar en hora actual si estamos en fiestas
  const now = new Date();
  if (now.getFullYear()===2026 && now.getMonth()===6 && now.getDate()>=5 && now.getDate()<=14) {
    const ds=`2026-07-${String(now.getDate()).padStart(2,'0')}`;
    if (daySelect)  { daySelect.value=ds; selDay=ds; }
    if (hourSlider) { hourSlider.value=now.getHours(); updateLabel(); }
  } else {
    if (hourSlider) { hourSlider.value=-1; updateLabel(); }
  }

  renderAll();
  setTimeout(()=>map.invalidateSize(),300);
}

if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',initMapaSanFermin);
else initMapaSanFermin();