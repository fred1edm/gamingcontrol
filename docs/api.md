# API — fases 1 a 6

Servidor por defecto: `http://127.0.0.1:3001`. Vite reenvía `/api/*` al backend sin prefijo. Todo salvo health/login requiere `Authorization: Bearer <token>`. Todos los POST/PATCH operativos requieren `Idempotency-Key: <UUID>` nuevo por intención, repetido exactamente al reintentar la misma operación.

Errores JSON: `{message, issues?}`; 400 datos inválidos, 401 autenticación, 403 rol, 404 ausente, 409 conflicto/duplicado, 429 límite de peticiones, 500 error no expuesto. No se envían errores internos PostgreSQL al usuario.

| Método/ruta               | Permiso           | Entrada                                                                           |
| ------------------------- | ----------------- | --------------------------------------------------------------------------------- |
| GET /health               | Público           | Estado de conexión a DB y serverTime                                              |
| POST /auth/login          | Público, 8/min/IP | email, password; devuelve token y user                                            |
| GET /auth/me              | Autenticado       | Usuario actual                                                                    |
| GET /users                | ADMIN             | Lista sin hashes                                                                  |
| POST /users               | ADMIN             | name, email, password (12–128), role                                              |
| GET /stations             | Autenticado       | stations y serverTime, sesión y consumos incluidos                                |
| POST /stations            | ADMIN             | name, type, hourlyCents                                                           |
| POST /stations/:id/rates  | ADMIN             | hourlyCents; conserva tarifas previas                                             |
| GET /extras               | Autenticado       | Extras activos                                                                    |
| POST /extras              | ADMIN             | name, priceCents, active opcional                                                 |
| PATCH /extras/:id         | ADMIN             | name, priceCents, active                                                          |
| GET /sessions             | Autenticado       | stationId opcional, limit 1–100, por defecto 50                                   |
| GET /sessions/:id         | Autenticado       | Detalle y total calculado por servidor                                            |
| POST /sessions            | Autenticado       | stationId, mode FIXED/OPEN, minutes si FIXED, extraId opcional, extraQuantity 1–4 |
| POST /sessions/:id/extend | Autenticado       | minutes: 15,30,60,120                                                             |
| POST /sessions/:id/extras | Autenticado       | extraId, quantity 1–4; PS4/PS5, acumulable hasta 4 mandos por sesión              |
| POST /sessions/:id/move   | Autenticado       | stationId; estación disponible del mismo tipo, conserva tiempo y consumos         |
| POST /sessions/:id/cancel | Autenticado       | reason (3–240 caracteres); cancela sin cobro y conserva el motivo en historial |
| PATCH /loyalty/cards/:id  | Autenticado       | customerName; edita el nombre de una tarjeta activa                              |
| DELETE /loyalty/cards/:id | Autenticado       | Desactiva la tarjeta y conserva sellos, canjes e historial                       |
| POST /sessions/:id/finish | Autenticado       | {}; termina tiempo, queda pendiente de pago                                       |
| GET /audit                | ADMIN             | Últimas acciones; filtros `action`, `entityType`, `userId`, `from`, `to`, `limit` |

Fase 4 agrega `GET /settings` y `PUT /settings` para los umbrales `ALERT_FIRST_MINUTES` y `ALERT_SECOND_MINUTES` (1–120 minutos, solo ADMIN). La API publica el catálogo de `docs/socket-events.md` por Socket.IO; la conexión exige el JWT en `handshake.auth.token`. El panel se actualiza al recibir eventos y conserva el sondeo REST como respaldo. Un scheduler interno revisa sesiones fijas cada segundo, emite avisos a los umbrales configurados y finaliza automáticamente las sesiones vencidas.

Fase 5 agrega `GET /reports/daily`, `GET /reports/weekly` y `GET /reports/monthly` (ADMIN). Cada respuesta devuelve periodo UTC, ingresos cobrados, categorías PC/PlayStation/mandos/snacks, métodos de pago, sesiones y promedio, estación líder, productos más vendidos, demanda por hora y totales por día. Los periodos se calculan en `America/Lima` y las cifras permanecen en céntimos.

Fase 6 amplía `GET /audit` con filtros y devuelve el usuario que ejecutó cada acción, sin hashes ni credenciales. El panel de Auditoría es exclusivo de ADMIN; EMPLOYEE conserva las operaciones de turno permitidas (sesiones, productos vinculados y cobros), pero no puede modificar configuración, catálogo, stock manual, usuarios, reportes ni auditoría.

Tarjetas agrega `GET /loyalty/cards`, `POST /loyalty/cards`, `POST /loyalty/cards/:id/stamps` y `POST /loyalty/cards/:id/redeem`. Las tarjetas manejan 12 sellos: en el sexto se habilita una hora gratis y en el duodécimo un kit de snacks. El canje de hora recibe `stationId`, crea automáticamente una sesión fija de 60 minutos con total S/0 y marca la estación como ocupada; esa sesión se cierra automáticamente al terminar sin pasar por Caja. El canje del kit reinicia la tarjeta. Cada canje queda auditado. El panel incluye el apartado Tarjetas y permite canjear la hora desde el detalle de una estación disponible.

Las rutas de fase 2 incluyen `GET /products`, `POST /products`, `PATCH /products/:id`, `DELETE /products/:id` (desactivación conservando historial), `POST /products/:id/stock`, `GET /inventory`, `POST /sales` para venta rápida y `POST /sessions/:id/products` para venta vinculada. Todas las acciones de negocio devuelven 200 al confirmar y la misma respuesta al repetir la clave. La petición repetida no genera auditoría adicional. Las estaciones tienen el mismo patrón con `DELETE /stations/:id`, que las desactiva solo si no tienen una sesión abierta.

Las sesiones incluyen arrays de extras, extensiones y ventas de productos. `totalAmount`, `baseAmount`, `unitPrice`, `hourlyCents` y `amount` están expresados en céntimos, nunca en soles decimales. Una venta guarda snapshots de nombre/precio; descuento de stock y movimiento `SALE` ocurren en una única transacción.

Fase 3 añade `GET /cash/current`, `POST /cash/open` (openingAmount), `POST /cash/movements` (INCOME, WITHDRAWAL o ADJUSTMENT), `POST /cash/close` (closingAmount), `POST /sessions/:id/pay` y `POST /sales/:id/pay` (method CASH, YAPE, PLIN, CARD, TRANSFER u OTHER). Cobrar una sesión exige TIME_FINISHED, cierra la sesión, marca sus ventas PAID y libera la estación. Cobrar una venta rápida exige que no esté vinculada a sesión. La caja debe estar abierta y cada destino solo puede recibir un pago.
