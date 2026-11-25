# Ares

Ares es un asistente de escritorio para Windows, **supervisado y pensado para la voz**. Tiene una interfaz con un orbe reactivo (un HUD vertical de 480 x 740) y un solo botón de micrófono: hablas, Ares interpreta lo que pediste, te pide confirmación cuando la acción lo requiere y responde en español con frases cortas. Fue construido para un curso de diseño de interfaces.

## Descarga

| | Enlace |
| --- | --- |
| Página del release | <https://github.com/Juls2212/Ares/releases/tag/v1.0.0> |
| Instalador directo | <https://github.com/Juls2212/Ares/releases/latest/download/Ares-Setup.exe> |

**Instalación**

1. Descarga y ejecuta `Ares-Setup.exe`.
2. El instalador no está firmado, así que Windows SmartScreen puede mostrar «Windows protegió su PC». Elige **Más información** y luego **Ejecutar de todas formas**.
3. No necesita permisos de administrador: se instala solo para tu usuario y crea accesos directos llamados Ares en el Escritorio y en el menú Inicio.
4. Ares se abre al terminar. No necesita servidor de base de datos y funciona sin ninguna clave, en modo local.

Alternativa portable: si el release incluye el zip, descomprímelo y ejecuta `ares-desktop.exe`.

Para desinstalar: Configuración de Windows, Aplicaciones, Aplicaciones instaladas, Ares, Desinstalar. Tus datos quedan en `%APPDATA%\ares-desktop`; borra esa carpeta para una eliminación completa.

## Primer uso y claves

Sin claves, Ares responde en **modo local** los comandos comunes sin conexión (abrir aplicaciones, buscar archivos, hora y fecha, agenda, estado del equipo) y puedes escribir con `Ctrl+K`.

Para activar la voz, la interpretación más inteligente, las respuestas habladas y Spotify, crea un archivo de texto llamado `ares.env` en `%APPDATA%\ares-desktop` y reinicia Ares. Cada línea es `NOMBRE=valor`; una línea que empieza con `#` es un comentario. Los nombres que acepta:

- `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TRANSCRIPTION_MODEL`
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (opcionales; se necesitan los dos)
- `SPOTIFY_CLIENT_ID` (opcional)
- `DATABASE_URL` (opcional; solo si quieres usar tu propio PostgreSQL en lugar de la base de datos integrada)

Las variables de entorno de Windows con los mismos nombres tienen prioridad sobre el archivo. Mantén el archivo en privado y nunca lo compartas.

## Qué puede hacer Ares

Son 44 acciones en ocho dominios. La lista completa y su clase de aprobación están en [docs/CAPABILITIES.md](docs/CAPABILITIES.md).

| Dominio | Qué hace | Ejemplo en español |
| --- | --- | --- |
| Agenda y tareas | Crea, actualiza, completa y elimina tareas y eventos; crea recordatorios; lee la agenda de hoy o de la semana; dice fecha y hora | «¿qué hora es?», «qué tengo hoy en la agenda» |
| Aplicaciones | Abre aplicaciones registradas y registra nuevas | «abre la calculadora» |
| Web | Abre o busca en tres sitios aprobados: Google, YouTube y Spotify | |
| Archivos | Busca en seis carpetas conocidas, muestra o abre resultados, crea carpetas, renombra, mueve u organiza, y envía un resultado a la Papelera | «busca mis recibos» |
| Mensajes | Guarda contactos, prepara y edita borradores y abre un chat de WhatsApp con el borrador. Ares nunca envía el mensaje: lo envías tú | |
| Música | Conecta Spotify, reproduce, pausa, reanuda, cambia de canción, ajusta el volumen y dice qué suena | |
| Clima | Clima actual o pronóstico de hasta seis días para un lugar | |
| Equipo | Espacio libre en disco, memoria, procesador y tiempo encendido, con un aviso si algo está bajo | «dime cómo está mi equipo» |

## Cómo se usa

- **Hablar:** haz clic en el orbe o en el botón del micrófono, o usa el atajo global `Ctrl+Alt+Space`. Una segunda pulsación detiene la grabación y envía lo grabado. `Escape` cancela.
- **Escribir:** `Ctrl+K` abre el campo de texto, que está oculto el resto del tiempo. Es la forma de usar Ares en modo local.
- **Tema:** el botón de bombilla del encabezado alterna entre el tema oscuro y el claro «gris menta». El menú de la bandeja también permite elegir Automático, Claro u Oscuro.
- **Minimizar** mantiene Ares en segundo plano (icono de bandeja, atajo global y recordatorios). El botón **X** de la ventana cierra la aplicación por completo.

## Seguridad

- **Todo es supervisado.** Las acciones de riesgo medio piden confirmación, y las destructivas (eliminar una tarea, un evento, un contacto o enviar un archivo a la Papelera) piden una confirmación reforzada que empieza en Cancelar. No hay borrado permanente.
- **No ejecuta comandos arbitrarios.** Solo corren acciones de una lista cerrada; el modelo se trata como no confiable y Main valida cada propuesta. No abre URL ni rutas arbitrarias.
- **Las credenciales viven solo en el proceso principal.** La interfaz nunca ve claves, archivos, red ni base de datos.
- **Historial y registros privados.** Se guardan frases genéricas y códigos, nunca nombres, textos de mensajes, rutas, consultas ni lo que dijiste.

Detalle completo en [docs/SECURITY.md](docs/SECURITY.md).

## Tecnología

Electron, React, TypeScript, Vite, Drizzle ORM, base de datos integrada PGlite (o PostgreSQL con `DATABASE_URL`), OpenAI para transcripción, interpretación y voz, y ElevenLabs como voz opcional.

La arquitectura es por capas: la interfaz (React) solo puede llamar los métodos con nombre de `window.ares`; el preload los expone por canales IPC con lista cerrada, y los servicios del proceso principal hacen el trabajo real. Más en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Para desarrolladores

Requisitos: Windows, Node.js y npm. PostgreSQL con Docker solo si quieres usar un servidor propio en desarrollo.

```powershell
npm install
npm run db:up        # opcional: PostgreSQL con Docker Compose
npm run db:migrate   # solo con PostgreSQL
npm start            # ejecutar en desarrollo
```

En desarrollo se lee un `.env` copiado de `.env.example` (nunca se sube al repositorio).

| Script | Qué hace |
| --- | --- |
| `npm start` | Ejecuta Ares en desarrollo (Electron Forge) |
| `npm test` | Pruebas con Vitest |
| `npm run typecheck` | Revisión de tipos con `tsc` |
| `npm run package` | Empaqueta la aplicación en `out\` |
| `npm run make` | Genera el instalador `Ares-Setup.exe` y el zip portable |

Antes de `npm run make`, cierra Ares y borra la carpeta `out`.

Documentación: [Resumen](docs/OVERVIEW.md), [Arquitectura](docs/ARCHITECTURE.md), [Configuración y base de datos](docs/SETUP.md), [Despliegue](docs/DEPLOYMENT.md), [Seguridad](docs/SECURITY.md), [Capacidades](docs/CAPABILITIES.md), [Pruebas](docs/TESTING.md) y [Kits compartidos](docs/KITS.md).

## Estado del proyecto y límites conocidos

- El instalador y el ejecutable no están firmados, por eso SmartScreen advierte la primera vez.
- Usan el icono predeterminado de Electron.
- No hay actualización automática.
- El instalador es solo para Windows de 64 bits.
- La base de datos integrada es de un solo proceso: solo una copia de Ares puede estar abierta.
- La primera apertura es un poco más lenta porque se inicia la base de datos integrada.

Más detalle en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#known-limits).

## Licencia

`UNLICENSED` (campo `license` de `package.json`): todos los derechos reservados.
