# Capabilities, approval classes and confirmation

## The capability registry

`src/main/actions/capability-registry.ts` is the Main-only list of what Ares can do. An action name that is not in the registry is rejected before anything runs (`ACTION_UNSUPPORTED`), whatever the interpreter or the renderer sends. Each entry fixes the domain, the approval class, the executor category and a Spanish label. `ACTION_NAMES` in `src/shared/action-contracts.ts` equals the registry exactly.

Domains: `INTERNAL_MEMORY` (planner), `APPLICATIONS`, `WEB`, `FILES`, `MESSAGING`, `MUSIC`, `WEATHER`.

There are **43 enabled actions**. A test compares this table with the registry, name by name.

| Action | Domain | Approval | Risk | Label (Spanish) |
| --- | --- | --- | --- | --- |
| `CREATE_TASK` | INTERNAL_MEMORY | Direct | 1 | Crear tarea |
| `UPDATE_TASK` | INTERNAL_MEMORY | Direct | 1 | Actualizar tarea |
| `COMPLETE_TASK` | INTERNAL_MEMORY | Direct | 1 | Completar tarea |
| `DELETE_TASK` | INTERNAL_MEMORY | Reinforced confirmation | 3 | Eliminar tarea |
| `CREATE_EVENT` | INTERNAL_MEMORY | Direct | 1 | Crear evento |
| `UPDATE_EVENT` | INTERNAL_MEMORY | Direct | 1 | Actualizar evento |
| `DELETE_EVENT` | INTERNAL_MEMORY | Reinforced confirmation | 3 | Eliminar evento |
| `CREATE_REMINDER` | INTERNAL_MEMORY | Direct | 1 | Crear recordatorio |
| `GET_TODAY_SCHEDULE` | INTERNAL_MEMORY | Direct | 1 | Consultar agenda de hoy |
| `GET_WEEK_SCHEDULE` | INTERNAL_MEMORY | Direct | 1 | Consultar agenda semanal |
| `GET_CURRENT_DATE_TIME` | INTERNAL_MEMORY | Direct | 1 | Consultar fecha y hora |
| `OPEN_APPLICATION` | APPLICATIONS | Direct | 1 | Abrir aplicación registrada |
| `SEARCH_SPOTIFY_APP` | APPLICATIONS | Direct | 1 | Buscar en la aplicación de Spotify |
| `REGISTER_CATALOG_APPLICATION` | APPLICATIONS | Standard confirmation | 2 | Registrar aplicación aprobada |
| `REQUEST_CUSTOM_APPLICATION_REGISTRATION` | APPLICATIONS | Standard confirmation | 2 | Registrar aplicación propia |
| `OPEN_APPROVED_PAGE` | WEB | Direct | 1 | Abrir sitio aprobado |
| `SEARCH_APPROVED_SITE` | WEB | Direct | 1 | Buscar en sitio aprobado |
| `SEARCH_FILES` | FILES | Direct | 1 | Buscar archivos |
| `REVEAL_FOUND_FILE` | FILES | Direct | 1 | Mostrar archivo encontrado |
| `OPEN_FOUND_FILE` | FILES | Standard confirmation | 2 | Abrir archivo encontrado |
| `CREATE_FOLDER` | FILES | Standard confirmation | 2 | Crear carpeta |
| `RENAME_FOUND_ITEM` | FILES | Standard confirmation | 2 | Renombrar elemento encontrado |
| `MOVE_FOUND_ITEMS` | FILES | Standard confirmation | 2 | Mover elementos encontrados |
| `ORGANIZE_FOUND_ITEMS` | FILES | Standard confirmation | 2 | Organizar elementos encontrados |
| `DELETE_FOUND_ITEM` | FILES | Reinforced confirmation | 3 | Enviar elemento encontrado a la Papelera |
| `SAVE_CONTACT` | MESSAGING | Standard confirmation | 2 | Guardar contacto |
| `LIST_CONTACTS` | MESSAGING | Direct | 1 | Listar contactos |
| `DELETE_CONTACT` | MESSAGING | Reinforced confirmation | 3 | Eliminar contacto |
| `PREPARE_MESSAGE_DRAFT` | MESSAGING | Direct | 1 | Preparar borrador de mensaje |
| `EDIT_MESSAGE_DRAFT` | MESSAGING | Direct | 1 | Editar borrador de mensaje |
| `DISCARD_MESSAGE_DRAFT` | MESSAGING | Direct | 1 | Descartar borrador de mensaje |
| `OPEN_WHATSAPP_CHAT_WITH_DRAFT` | MESSAGING | Standard confirmation | 2 | Abrir chat de WhatsApp con el borrador |
| `CONNECT_SPOTIFY` | MUSIC | Standard confirmation | 2 | Conectar Spotify |
| `DISCONNECT_SPOTIFY` | MUSIC | Standard confirmation | 2 | Desconectar Spotify |
| `GET_SPOTIFY_STATUS` | MUSIC | Direct | 1 | Consultar conexión de Spotify |
| `PLAY_SPOTIFY_MUSIC` | MUSIC | Direct | 1 | Reproducir música en Spotify |
| `PAUSE_SPOTIFY` | MUSIC | Direct | 1 | Pausar Spotify |
| `RESUME_SPOTIFY` | MUSIC | Direct | 1 | Reanudar Spotify |
| `NEXT_SPOTIFY_TRACK` | MUSIC | Direct | 1 | Siguiente canción de Spotify |
| `PREVIOUS_SPOTIFY_TRACK` | MUSIC | Direct | 1 | Canción anterior de Spotify |
| `SET_SPOTIFY_VOLUME` | MUSIC | Direct | 1 | Ajustar volumen de Spotify |
| `WHAT_IS_PLAYING` | MUSIC | Direct | 1 | Consultar qué está sonando |
| `GET_WEATHER` | WEATHER | Direct | 1 | Consultar el clima |

## Approval classes

| Class | Risk | Behavior |
| --- | --- | --- |
| Direct | 1 | Runs as soon as Main has validated the proposal. |
| Standard confirmation | 2 | Main stores a pending proposal and returns a confirmation request; nothing runs until `actions.confirm`. |
| Reinforced confirmation | 3 | Same, for destructive actions (deleting a task, event or contact, sending a found item to the Recycle Bin). The review starts on Cancel. |

The class comes from the registry and is checked against the policy in `action-policy.ts`; a mismatch makes the action unsupported. Policy-only kinds (`DELETE_FILE`, `DELETE_FOLDER`, `MOVE_FOLDER`, `OPEN_REGISTERED_*`, `UPDATE_REGISTERED_*`) exist only as deny-by-default records and can never run.

## Confirmation tokens

- A `confirmationId` is an opaque UUID created by Main for one pending proposal. The renderer cannot create or alter one.
- A pending proposal lives for five minutes; confirming or cancelling twice, or after expiry, fails with a controlled error.
- Actions that prepare something first (a file selection, a contact form, a registration) hold a Main-side snapshot; the confirmation executes that snapshot, never new renderer input.
- Clarifications never open a confirmation dialog. A clarification is an interpreter result (`NEEDS_CLARIFICATION`) with a question; only a confirmation request that Main issued opens the review.
