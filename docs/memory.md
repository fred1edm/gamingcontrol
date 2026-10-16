# Memoria persistente del proyecto

## agent_removed_temporarily

El agente Windows .NET 10 se retiró temporalmente del producto activo porque la operación actual no lo utiliza. Se eliminaron el proyecto `apps/agent`, el servicio `GamingControlAgent`, sus scripts de instalación y las rutas/API de heartbeat y comandos. También se eliminó `AGENT_SHARED_KEY` de la configuración y se añadió la migración `202610150006_remove_agent_phase8` para retirar su tabla exclusiva sin afectar usuarios, estaciones, sesiones, ventas ni auditoría. La función podrá recuperarse más adelante desde el historial de Git si se necesita control directo de PCs.

El sistema actual queda compuesto por el panel React/Vite, la API Fastify/Node.js, PostgreSQL, Socket.IO y el instalador Tauri del panel.

Actualización visual: navegación compactada con desplazamiento en pantallas bajas. Cuenta anclada al pie del menú y botón visible «Cerrar sesión», con adaptación a la barra móvil y etiquetas accesibles para navegación. El detalle de estación separa resumen y acciones en dos columnas en escritorio para mostrar reloj, consumo, duración, extras y productos sin desplazamiento; en pantallas estrechas conserva desplazamiento vertical.

Inventario: la vista consulta `/inventory` y muestra debajo de productos un historial de movimientos con producto, entrada/venta/ajuste, cantidad, stock anterior/nuevo, costo y fecha. Después de registrar stock se refrescan productos e historial juntos.

Inventario también permite a ADMIN eliminar un producto mediante desactivación (`DELETE /products/:id`): deja de aparecer entre los productos activos y conserva sus ventas y movimientos históricos.

Estaciones: ADMIN puede desactivar una estación desde su tarjeta (`DELETE /stations/:id`) cuando no tiene una sesión abierta; se conserva su historial. El panel refresca estaciones, caja, inventario, sesiones y ajustes al recibir eventos Socket.IO, con sondeo REST de respaldo cada cinco segundos.

UX operativa: las acciones autenticadas muestran una capa de procesamiento; las eliminaciones de productos y estaciones usan modal visual con cancelación y conservación explícita del historial. Se eliminaron referencias visibles a «servidor local» de los textos del panel.

Si el panel recibe una respuesta de una API antigua con `Route ... not found`, la interfaz ahora muestra un mensaje claro solicitando reiniciar el servidor, sin exponer la ruta técnica.

El login quedó más limpio: se retiraron los textos «Vista ilustrativa · Los datos reales se cargan al iniciar sesión» y «Acceso seguro»; el bundle y el staging fueron regenerados.

`serve-local.mjs` comprueba que el preview esté disponible y abre automáticamente `http://localhost:5173` en Windows al iniciar el sistema.

El detalle de sesión ahora muestra cada producto vendido con nombre, cantidad y subtotal dentro del recibo. `SessionView` expone las ventas y sus líneas; PCs y consolas comparten el registro de snacks.

Trabajadores: ADMIN puede editar nombre, correo y rol mediante `PATCH /users/:id`, y restablecer la contraseña mediante `PUT /users/:id/password`; ambas operaciones validan, usan transacción e incluyen auditoría. La UI ofrece botones y modales para editar y cambiar contraseña sin exponer la contraseña anterior.

El menú de trabajadores ahora oculta Reportes y la vista redirige a Estaciones si un EMPLOYEE intenta abrirla directamente; la API ya protegía `/reports/:period` con rol ADMIN.

Inventario: ADMIN puede abrir el modal Editar de cada producto y actualizar precio de venta, costo y stock mínimo mediante `PATCH /products/:id`; el stock actual y los snapshots históricos permanecen intactos.

## Actualización prioritaria: instalación corregida

El usuario creó el clúster PostgreSQL 18.4 correctamente. El bloqueo posterior se debía a Start-Process -Wait: esperaba también al servidor postgres descendiente. Corregidos setup-local.ps1 y start-local.ps1 para esperar solo pg_ctl con WaitForExit(). Scripts analizados sin errores sintácticos; no se reinició ni borró el clúster para probar la rama de arranque.

Se completó la instalación usando la conexión local ya disponible: bases gaming_control y gaming_control_test creadas, migración aplicada en ambas y seed ejecutado. La cuenta admin existe y conserva la contraseña configurada. Suite PostgreSQL real aprobada: 9 subpruebas + contenedor, 10/10 resultados. Incluye login, permisos, S/10→S/18, snapshots, idempotencia, rollback, concurrencia, finalización y tiempo libre. Esto reemplaza los pendientes de migración/seed/integración que figuran en el registro anterior. UI autenticada completa aún pendiente de validación visual.

El launcher no pudo ejecutarse en Windows PowerShell del sandbox por su política de scripts; no se cambió esa política. Se inició directamente npm run serve. La sesión PowerShell del usuario sí admitió scripts. Fuente del comportamiento de espera: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-5.1

Leer antes de cambios relevantes. Actualizar después de cada bloque. El historial de conversación no sustituye este archivo.

## phase_2_update

Fase 2 implementada. Prisma ahora incluye Product, Sale, SaleItem e InventoryMovement. Productos soportan precio venta, costo opcional, stock actual/mínimo y activo. Movimientos PURCHASE/SALE/ADJUSTMENT/LOSS/RETURN usan stockBefore/stockAfter; no hay mutación directa. `POST /sales` crea venta rápida; `POST /sessions/:id/products` vincula venta a sesión. Venta y descuento de stock son una transacción Serializable con idempotencia y auditoría. SaleItem conserva snapshots. Venta queda OPEN hasta fase 3 de pagos.

La UI incluye navegación Inventario, listado de productos, creación (ADMIN), entradas de stock (ADMIN), precios, mínimos y selector para agregar productos desde la sesión. Empleados pueden consultar productos y agregar productos a sesiones, sin modificar catálogo o stock manual.

Migración `202609070002_phase2` aplicada a `gaming_control` y `gaming_control_test`; seed añade Gaseosa, Keke y Agua con stock inicial cero. Suite de integración ampliada: venta vinculada descuenta stock, registra dos movimientos (PURCHASE + SALE) y conserva nombre/precio snapshot.

## phase_3_update

Fase 3 implementada. Prisma añade Payment, CashRegister y CashMovement; SaleStatus incluye PAID. `POST /cash/open` crea una caja con apertura, `GET /cash/current` calcula efectivo esperado, `POST /cash/movements` registra ingresos/retiros/ajustes y `POST /cash/close` guarda cierre y diferencia. `POST /sessions/:id/pay` cobra una sesión TIME_FINISHED, marca sesión CLOSED, marca ventas vinculadas PAID y libera Station a AVAILABLE. `POST /sales/:id/pay` cobra ventas rápidas sin estación. Métodos: CASH, YAPE, PLIN, CARD, TRANSFER, OTHER. Cada pago y movimiento usa transacción Serializable, auditoría e idempotencia; no hay doble pago.

UI: navegación Caja, apertura/cierre, movimientos manuales y selección de método de pago en sesiones pendientes. La estación solo se libera tras pago. Suite PostgreSQL integrada: apertura, cobro, liberación, doble pago, cierre con esperado y venta rápida Yape; 12 resultados aprobados. Migración `202609070003_phase3` aplicada en ambas bases.

## phase_4_update

Fase 4 implementada en código. Se añadió `Setting` y migración `202609070004_phase4`; los valores `ALERT_FIRST_MINUTES` y `ALERT_SECOND_MINUTES` tienen defaults 10/5 y solo ADMIN puede consultarlos o cambiarlos mediante `GET/PUT /settings`, con idempotencia y auditoría.

La API monta Socket.IO sobre el servidor Fastify. La conexión exige un JWT válido y usuario activo; las mutaciones REST emiten eventos del catálogo compartido únicamente después del commit. Un scheduler de un segundo revisa sesiones fijas, emite `session:ending-soon` y `notification:new` una vez por umbral, y al vencer marca la sesión `TIME_FINISHED` y la estación `FINISHED` de forma idempotente. El panel usa `socket.io-client`, refresca datos al recibir eventos, muestra bandeja de notificaciones y reproduce un tono corto si el navegador lo permite; el sondeo REST de 5 segundos permanece como respaldo.

Validación de fase 4: migración aplicada en ambas bases, 13/13 pruebas de integración, typecheck, lint y Prettier pasan.

## phase_5_update

Fase 5 implementada sin migración adicional. `GET /reports/daily`, `/weekly` y `/monthly` agregan pagos confirmados por periodo local America/Lima: ingresos totales, PC, PlayStation, mandos, snacks, métodos de pago, sesiones, promedio por sesión, estación líder, productos más vendidos, demanda por hora y totales diarios. El promedio usa únicamente cobros de sesiones; las ventas rápidas cuentan en ingresos y snacks. La UI añade navegación Reportes, filtros Hoy/Esta semana/Este mes y gráficos Recharts. Integración PostgreSQL: 14/14 pruebas aprobadas.

## phase_6_update

Fase 6 implementada sin migración adicional. `GET /audit` acepta filtros por acción, entidad, usuario, rango de fechas y límite de resultados; devuelve el usuario asociado sin hashes. La UI añade Auditoría para ADMIN con búsqueda de acciones y detalle expandible de estado anterior/nuevo. EMPLOYEE no puede acceder a auditoría, configuración, reportes ni operaciones administrativas de catálogo/stock. Integración PostgreSQL: 15/15 pruebas aprobadas.

## production_preparation_update

Se ejecutó `scripts/reset-local-operational-data.mjs --confirm` sobre la base aislada local. Se conservaron usuarios y recursos (estaciones, tarifas, productos, extra y ajustes); se eliminaron sesiones, ventas, pagos, caja, movimientos, auditoría e idempotencias, se dejaron estaciones AVAILABLE y stock en cero. Resultado verificado: 2 usuarios, 5 estaciones, 4 productos, 1 extra, 2 ajustes y cero registros operativos. Se añadió `scripts/prepare-production.ps1`, que compila y genera `.production` con app, config, data, backups y logs sin secretos. No es todavía un instalador Tauri.

La limpieza se repitió después de las últimas pruebas y quedó verificada con 0 sesiones, ventas, pagos, movimientos de inventario, cajas, auditoría e idempotencias. El catálogo activo conservado es Agua, CANCHITA, Gaseosa y Keke, con el extra Mando adicional, las cinco estaciones AVAILABLE y los dos usuarios existentes. La suite de integración ahora incluye la desactivación segura de productos y estaciones con historial y la regla PC/consola para mandos (17/17); el borrado lógico evita errores de integridad y mantiene snapshots de ventas. `npm run prepare:production` se ejecutó de nuevo y `.production` contiene la compilación actual.

## project_overview

Gaming & Cyber Control, negocio LAN de PC y consolas. Interfaz española, PEN y America/Lima. Alcance autorizado: fases 0 a 6 del prompt maestro proporcionado. Proyecto creado en outputs/gaming-control. Usuario eligió explícitamente recibir script PowerShell para instalación local de PostgreSQL; no pidió conectar ni alterar su servicio existente.

## architecture

Monorepo npm: apps/admin (React/Vite), apps/api (Fastify), packages/shared (Zod/contratos/eventos), prisma, tests, docs, scripts. Separación de servidor, cliente, base y futuro agente. Node 24 nativo ejecuta TypeScript compatible con borrado de tipos; no tsx. TypeScript strict, ESLint, Prettier. Tauri 2 y .NET 10 no se implementan en este bloque.

## business_rules

Céntimos enteros; el tiempo fijo y el libre usan bloques de 15 minutos, con precio congelado al inicio. Tiempo libre cobra un bloque mínimo y redondea hacia arriba. Mando ONE_TIME_PER_SESSION; cantidad 1–4, índice único (sessionId,extraId). S/8 + S/2 + S/8 = S/18. Extensiones de 15/30/60/120 desde endsAt anterior, filas separadas. Finalizar congela tiempo y conserva TIME_FINISHED, pendiente de pago. No cerrar ni liberar estación sin pago; caja fase 3. UTC en servidor; reloj visible derivado de serverTime y performance.now.

## database

Prisma 7.10.0 + adapter-pg, PostgreSQL 18. User, Role enum, Station, StationRate, Session, SessionExtension, Extra, SessionExtra, AuditLog, Idempotency. UUID, TIMESTAMPTZ(3), Int céntimos. Migraciones de las fases 1–4 aplicadas a las bases locales gaming_control y gaming_control_test. No sustituir migrate deploy por db push.

## backend

Login JWT 8h, scrypt con salt por usuario, validación Zod, rate limit, rol/active leídos por petición. Todas las mutaciones usan transacción Serializable, auditoría y registro durable de idempotencia; conflictos reintentados hasta cuatro intentos. Respuestas de error centralizadas sin exposición de SQL/credenciales. Endpoints detallados en docs/api.md, incluidos reportes diarios, semanales y mensuales solo para ADMIN.

## frontend

React 19, Vite 7, Tailwind 4, patrón shadcn/ui/CVA/Radix, Tabler Icons y Recharts. Login, estaciones, inventario, caja, usuarios, reportes, notificaciones y sesiones. Reportes ofrecen filtros diarios/semanales/mensuales y gráficos de categorías/demanda. Precios y agregaciones financieras provienen del backend. Token en sessionStorage. Se retiró del panel la tarjeta visible de estado de fase.

## realtime

Socket.IO activo en fase 4 con autenticación JWT, eventos posteriores al commit y scheduler de alertas 10/5 minutos configurable. El panel conserva REST como respaldo y no usa eventos como persistencia financiera.

## desktop / pc_agent

Pendientes fases 7/8. Tauri 2 y .NET 10 Worker Service. No hay agente, comandos de apagado/reinicio ni aplicación Windows instalada.

## inventory / cash_register / reports

Inventario, caja/pagos, reportes y auditoría están implementados en fases 2/3/5/6. Reportes usan únicamente pagos confirmados y agregaciones del backend; Recharts presenta categorías y demanda por hora.

## audit

Desde fase 1: usuarios, estaciones, tarifas, extras, inicio/extensión/final de sesión. Estado anterior/nuevo, autor, IP y UTC. No passwords/hashes. Auditoría y cambio confirman juntos. GET /audit solo ADMIN con filtros y vista detallada.

## technical_decisions — no cambiar sin justificación

- Station central, no PC como entidad exclusiva.
- Dinero en céntimos, backend autoridad, no precios recurrentes para mandos.
- Finalizar distinto de cobrar/cerrar. La estación queda FINISHED hasta registrar el pago.
- Tarifas, extras y extensiones históricos; no borrar finanzas.
- Paquetes types/config/validation se consolidan en shared; no carpetas vacías.
- Reintentos financieros durables en PostgreSQL, no caché en memoria.
- Ejecución Node 24 nativa y Vite configLoader native, para evitar errores de herramientas en sandbox.
- Overrides deepmerge-ts ^8 y mysql2 ^3.24 corrigen auditoría transitoria de CLI Prisma. Lockfile generado, npm audit cero vulnerabilidades.

## pending_tasks

1. Verificar UI autenticada y tamaños 1366x768 / 1920x1080. La revisión visual hecha fue del login a ancho pequeño.
2. Completar validación LAN, instalación como servicio y comandos del agente Windows .NET 10.

## known_issues

- initdb en sandbox Windows falló por token restringido (87) y creación de ruta. No se relajó seguridad; usuario eligió script local.
- Vite dev: esbuild no pudo enumerar ancestros por permisos del sandbox. Build native y preview funcionan. start-local utiliza npm run serve sobre bundle compilado.
- La integración PostgreSQL ya fue ejecutada por el usuario; queda pendiente solo la validación visual completa del panel autenticado.
- Variables BUSINESS_NAME/TIMEZONE reservadas; UI utiliza valores iniciales, configuración global futura.

## verificación

17/17 tests de integración PostgreSQL y 12/12 tests unitarios/HTTP pasan. Typecheck, build, Prisma generate/validate, scripts PowerShell, ESLint y Prettier pasan. No hay migración nueva en fases 5/6.

## archivos modificados

Proyecto nuevo completo. Para la limpieza visual se actualizaron `apps/admin/src/App.tsx`, `apps/admin/src/styles.css`, `apps/admin/package.json` y el lockfile para usar Tabler Icons y retirar la tarjeta de fase. `.env` y `.local` ignorados por Git contienen configuración local; no distribuirlos.

## notification_audio

Las notificaciones en tiempo real reproducen el archivo `apps/admin/public/notification.mp3` (copiado desde el sonido proporcionado por el usuario) mediante `HTMLAudioElement`. Si el navegador bloquea la reproducción automática, el error se ignora hasta que exista interacción del usuario.

## session_extra_quantity

Al agregar un mando adicional a una sesión activa, el panel permite elegir de 1 a 4 mandos. La API ya recibía `quantity`; ahora la interfaz envía la cantidad elegida, conserva el precio unitario configurado y muestra el total calculado en el consumo de la sesión.

## session_action_spacing

Los controles de agregar producto y extra ocupan ahora todo el ancho de la columna de acciones del detalle de estación. El selector y el botón quedan separados; producto usa una distribución de dos columnas y extra una de tres columnas incluyendo cantidad.

## branding

Se incorporó el logo proporcionado de Gorilaz Gamer en `apps/admin/public/gorilaz-logo.png`, visible en login y navegación. La presentación usa acentos cian, azul y magenta derivados del logo, conservando contraste para estados y textos.

El login conserva su composición original compacta: logo pequeño junto a “gaming control”, sin bloque de logo grande ni fondo visual adicional.

El bloque de marca del login mantiene el logo en la esquina superior izquierda y aplica la paleta Gorilaz Gamer al texto destacado, iconos y barras decorativas mediante acentos cian, azul y magenta.

El login ahora muestra el logo Gorilaz Gamer en tamaño grande con “gaming control” debajo y elimina el eslogan, título promocional y descripción del bloque izquierdo.

La marca del login queda alineada al inicio superior izquierdo de su panel. Se aplican acentos de la paleta Gorilaz (cian y azul en la acción principal; cian y magenta en navegación activa) manteniendo los colores semánticos de estados.

## phase7_desktop

Se agregó `apps/admin/src-tauri` con Tauri 2, configuración de ventana, permisos `core:default`, icono Gorilaz y objetivos MSI/NSIS. Los comandos `desktop:dev` y `desktop:build` están disponibles. El frontend detecta el protocolo Tauri para conectar REST y Socket.IO con la API local en `127.0.0.1:3001`; CORS acepta localhost y los orígenes Tauri. La compilación Tauri queda pendiente de ejecutar en Windows con Rust/WebView2 instalados.

## phase8_agent

Se agregó `apps/agent` como Worker Service .NET 10. Envía heartbeat periódico con `GAMING_AGENT_KEY` a `POST /agents/heartbeat`, valida que la estación sea una PC activa y recibe hora/estado/comandos reservados. La API acepta `AGENT_SHARED_KEY` y orígenes Tauri. No se modifican cobros ni PostgreSQL desde el agente. Falta validar en una LAN real, registrar el servicio Windows y definir comandos de control.

Se añadió la referencia `Microsoft.Extensions.Http` al agente para habilitar `AddHttpClient` en la inyección de dependencias.

El Worker valida `GAMING_AGENT_KEY` y `GAMING_STATION_ID` al iniciar y se detiene con un error claro si faltan, evitando reintentos continuos con HTTP 401.

El cliente del agente registra ahora el cuerpo de error de heartbeat para distinguir configuración inválida (400), estación inexistente (404) y clave incorrecta (401).

Se agregó `scripts/list-pc-stations.mjs` y `npm run stations:list` para mostrar los UUID de estaciones PC activas sin consultas SQL manuales.

Se agregaron `scripts/install-agent-service.ps1` y `scripts/uninstall-agent-service.ps1`. El instalador publica el agente self-contained win-x64, configura variables de entorno a nivel de equipo y registra/inicia el servicio automático `GamingControlAgent`; la ejecución del instalador queda para la PC Windows del usuario.

El canal de comandos de fase 8 ya está implementado. Un administrador crea comandos `LOCK`, `UNLOCK` o `STATUS` mediante `POST /agents/commands`; quedan persistidos en `AgentCommand`, auditados y se entregan una sola vez en el siguiente heartbeat de la PC. El agente confirma cada comando en `POST /agents/commands/:id/ack`. `LOCK` solicita el bloqueo de Windows, `STATUS` confirma que el agente está activo y `UNLOCK` devuelve un resultado fallido porque Windows exige desbloqueo manual. La migración `202609080001_phase8_agent_commands` está aplicada en la base local.

El instalador del servicio detiene ahora `GamingControlAgent` antes de publicar para evitar que el proceso anterior bloquee `GamingControl.Agent.dll` durante una actualización.

La preparación de distribución añade `scripts/build-installer.ps1` y `npm run installer:build`. El script comprueba Node.js y Rust/Cargo, genera el instalador Tauri MSI/NSIS y muestra sus rutas. La guía de despliegue está en `docs/deployment.md`; la API y PostgreSQL siguen siendo servicios del equipo servidor y el agente se instala por separado en cada PC cliente.

La regla de cobro fue ajustada a bloques de 15 minutos. `priceForBlocks` calcula PC/PS4 a S/1 por bloque con tarifa S/4 y PS5 a S/1.50, S/2.50, S/4 y S/5 para los cuatro bloques de la hora. El panel permite duración personalizada entre 1 y 1440 minutos; la API calcula el importe en servidor y conserva el snapshot de tarifa.

El modo Tiempo libre conserva la tarifa de cada hora completa y aplica una tolerancia comercial de 10 minutos al sobrante de cada hora. Por ejemplo, una PC a S/4 cuesta S/4 hasta 1 h 09 min, S/5 desde 1 h 10 min, S/8 hasta 2 h 09 min y S/9 desde 2 h 10 min. Las sesiones fijas mantienen la regla anterior.

El importe del modo libre usa minutos completos para no adelantar bloques: durante la primera hora conserva los bloques normales de 15 minutos (24:47 = S/2 en PC/PS4 a S/4). La tolerancia de 10 minutos se aplica únicamente después de una hora completa (1:02 = S/4; 1:10 = S/5).

La cabecera de la página Estaciones se dejó compacta: se retiraron el rótulo "GAMING & CYBER CONTROL", el título promocional y la descripción para liberar espacio sobre las estaciones.

La misma limpieza se extendió a todos los apartados: se retiraron los encabezados promocionales, títulos y descripciones repetidos. Solo permanecen los controles de acción necesarios.

El formulario de inventario ya no muestra ni envía el campo SKU opcional; la creación y edición se enfocan en nombre, precio, costo y stock mínimo.

## session_controls_update

Se añadieron controles operativos para sesiones fijas y libres: pausar el reloj durante actualizaciones, cancelar antes del cobro, cobrar opcionalmente al inicio, guardar el tiempo restante y reanudarlo. Las sesiones pausadas conservan la estación operativa y visible, con el tiempo congelado; las horas guardadas liberan la estación y conservan un código numérico de validación de cuatro dígitos. Reanudar usa el botón sin exigir el código y elige la estación original o una disponible del mismo tipo. Una sesión ya pagada no permite agregar tiempo, extras ni productos; al finalizar se cierra y libera sin cobrar dos veces. Las operaciones se auditan y se guardan en PostgreSQL con la migración `202610140002_session_controls`.

En una sesión libre pausada se congela el importe acumulado hasta el instante de la pausa; al reanudar se desplaza el inicio para excluir todo el tiempo detenido y se conserva el modo libre sin crear una duración fija.

Los controles visuales de agente “Consultar estado” y “Bloquear PC” se retiraron temporalmente del detalle de estación para mantener la operación diaria enfocada; las rutas internas del agente siguen disponibles para una futura activación.

La UI muestra las horas guardadas en Estaciones, con cliente, estación original, tiempo restante, código de validación y botón Reanudar. El detalle de una sesión activa muestra Pausar, Cancelar, Cobrar ahora y Guardar hora restante según corresponda.

Validación de esta actualización: migración aplicada en `gaming_control` y `gaming_control_test`; integración PostgreSQL 19/19, typecheck, ESLint y build de API/panel aprobados.

## session_controller_additions

Los mandos adicionales se pueden usar en PS4 y PS5. Una sesión activa permite agregarlos en varias tandas hasta cuatro mandos acumulados; cada operación suma únicamente el importe incremental y conserva el precio unitario snapshot del primer agregado. PC sigue rechazando mandos y las sesiones pagadas no aceptan nuevos consumos. La interfaz muestra la cantidad actual, limita las opciones disponibles y mantiene el selector mientras aún queda capacidad.

## loyalty_cards

Se agregó el apartado Tarjetas para la tarjeta física de Gorilaz Gamer: cada tarjeta tiene 12 sellos; los seis primeros habilitan una hora gratis y los seis siguientes habilitan un kit de snacks compuesto por una gaseosa y un piqueo. ADMIN y EMPLOYEE pueden crear tarjetas, agregar sellos y registrar canjes. La hora canjeada conserva los seis sellos para que el cliente avance al segundo premio; el kit canjeado reinicia la tarjeta. Cada acción usa transacción, idempotencia y auditoría. La migración `202610150001_loyalty_cards` se aplicó en las bases local y de pruebas. El panel muestra el progreso visual, estados de premio y últimos canjes, y se refresca por REST y por el evento `loyalty:updated`.

Al canjear la hora, el encargado selecciona una estación disponible desde Tarjetas o desde el detalle de Estaciones; la API crea automáticamente una sesión fija de 60 minutos con total S/0, ocupa esa estación y la cierra al terminar sin pasar por Caja. Al canjear el kit, el encargado entrega una gaseosa y un piqueo y los descuenta del inventario mediante el flujo normal de productos.

La vista Tarjetas se reorganizó para mostrar Nueva tarjeta en una franja horizontal superior y Tarjetas activas debajo a todo el ancho. En pantallas pequeñas el formulario vuelve a una sola columna para conservar la legibilidad.

## render_preview_allowed_hosts

La vista de despliegue en Render usa `vite preview`; para evitar `Blocked request` se agregaron a `preview.allowedHosts` los hosts explícitos `gamingcontrol.onrender.com`, `www.gamingcontrol.fpsystemlab.com` y `gamingcontrol.fpsystemlab.com`. Build local completo y typecheck aprobados. Falta publicar esta rama para que Render despliegue el arreglo.
