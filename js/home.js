// Gestiona el vídeo de fondo del hero de la home.
// Solo en desktop. Flujo: contenido oculto → vídeo → fade-out vídeo → contenido aparece.

(function () {

    const ES_MOVIL = window.matchMedia('(max-width: 768px)').matches;
    if (ES_MOVIL) return;

    const video    = document.getElementById('hero-video');
    const btnAudio = document.getElementById('hero-audio-btn');
    const contenido = document.querySelector('#hero .hero-content');

    if (!video || !btnAudio || !contenido) return;

    // Ocultar contenido del hero hasta que termine el vídeo
    contenido.style.opacity = '0';
    contenido.style.transition = 'opacity 0.8s ease';

    // Cargar vídeo
    video.preload = 'auto';
    video.load();

    video.addEventListener('canplaythrough', function handler() {
        video.removeEventListener('canplaythrough', handler);
        video.play().then(() => {
            video.style.opacity = '1';
            btnAudio.hidden = false;
        }).catch(() => {
            // Autoplay bloqueado: mostrar contenido directamente
            contenido.style.opacity = '1';
        });
    });

    // Botón de audio
    btnAudio.addEventListener('click', () => {
        video.muted = !video.muted;
        btnAudio.textContent = video.muted ? '🔇' : '🔊';
    });

    // Al terminar: parar el vídeo, fade-out, mostrar contenido y botón de audio
    video.addEventListener('ended', () => {
        video.pause();
        video.style.opacity = '0';
        // Botón de audio se queda visible con opción de quitar sonido
        btnAudio.hidden = true;
        // Mostrar contenido del hero
        contenido.style.opacity = '1';
    });

    // Timeout de seguridad: si el vídeo tarda más de 4s en arrancar, mostrar contenido
    setTimeout(() => {
        if (video.paused && contenido.style.opacity === '0') {
            contenido.style.opacity = '1';
        }
    }, 4000);

})();