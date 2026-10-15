# Base de datos

Migraciones activas: `202609070001_phase1` a `202609070004_phase4`, `202610140001_saved_sessions`, `202610140002_session_controls`, `202610150001_loyalty_cards` y `202610150006_remove_agent_phase8`. Generadas con Prisma y ampliadas con CHECKs e índices parciales. Usar `migrate deploy`; no reemplazar por `db push`, que no representa las restricciones SQL personalizadas.

| Entidad                     | Contenido                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| User                        | Nombre, correo único, hash, enum Role, active                                              |
| Station                     | Nombre único, tipo, estado, active                                                         |
| StationRate                 | Tarifas históricas de estación, ordenadas por creación                                     |
| Session                     | Autor, UTC de inicio/final, modo, estado, minutos e importes en céntimos, tarifa congelada |
| SessionExtension            | Cada extensión y su autor, sin sobrescribir tiempo original                                |
| Extra                       | Precio configurable, estado active, ONE_TIME_PER_SESSION                                   |
| SessionExtra                | Snapshot de nombre, cantidad, precio, total y tipo de cargo                                |
| AuditLog                    | Autor, acción, entidad, estado anterior/nuevo, IP y fecha                                  |
| Idempotency                 | Clave por usuario, huella de operación, respuesta confirmada                               |
| Product                     | Catálogo, precio de venta, costo opcional y stock actual/mínimo                            |
| Sale / SaleItem             | Venta rápida o vinculada a sesión, con snapshot de nombre/precio                           |
| InventoryMovement           | PURCHASE, SALE, ADJUSTMENT, LOSS o RETURN; stock antes/después                             |
| Payment                     | Cobros de sesiones y ventas rápidas, método e importe                                      |
| LoyaltyCard                 | Tarjeta de cliente y progreso de 0 a 12 sellos                                             |
| LoyaltyRedemption           | Canjes auditables de hora gratis o kit de snacks                                           |
| CashRegister / CashMovement | Caja abierta/cerrada y movimientos de efectivo de fase 3                                   |
| Setting                     | Umbrales de avisos `ALERT_FIRST_MINUTES` y `ALERT_SECOND_MINUTES`                          |

UUID para identidades, `TIMESTAMPTZ(3)` para fechas, `Int` para céntimos. Role es un enum en esta fase, no una tabla innecesaria. FK relacionales con borrado RESTRICT. Identificadores de autores se conservan como UUID de usuarios activos validados por API; no hay endpoint de eliminación de usuarios.

Restricciones SQL: una sesión no cerrada por estación; cantidades/precios no negativos; total de extra coherente con cantidad y precio; modo fijo/libre coherente con timestamps y minutos; unicidad de un tipo de extra por sesión.

La extensión y su actualización de sesión se confirman juntas. La auditoría y la respuesta de idempotencia se confirman en la misma transacción de la acción. Si falla un extra al iniciar, ni la sesión ni la estación quedan modificadas.

Product, InventoryMovement, Sale, SaleItem, Payment, CashRegister, CashMovement y Setting están implementadas.

Seed repetible: administrador configurado en entorno, PLAY 01/02 PS5 (800 céntimos), PLAY 03 PS4 (400), PC 01/02 (400), mando (200), Gaseosa/Keke/Agua con stock inicial cero. El stock se incrementa únicamente mediante movimientos de compra.
