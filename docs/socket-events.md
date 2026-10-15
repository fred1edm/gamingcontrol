# Catálogo central de eventos

Definido en `packages/shared/src/index.ts`. Desde fase 4 la API emite eventos Socket.IO después de confirmar la transacción; el panel se autentica con el JWT y recupera el estado completo por REST al conectar. El sondeo REST cada cinco segundos permanece como respaldo.

| Evento                       | Disparador                                |
| ---------------------------- | ----------------------------------------- |
| station:updated              | Cambio de disponibilidad/estado           |
| session:started              | Sesión confirmada                         |
| session:updated              | Consumo/estado actualizado                |
| session:extended             | Extensión confirmada                      |
| session:ending-soon          | Umbral configurable alcanzado             |
| session:finished             | Tiempo finalizado                         |
| sale:created                 | Venta confirmada                          |
| inventory:updated            | Movimiento de stock confirmado            |
| cash:updated                 | Cambio confirmado de caja                 |
| notification:new             | Aviso visual/sonoro                       |

Los eventos se emiten solo después del commit y no sustituyen la persistencia. Los avisos de tiempo se emiten por defecto a 10 y 5 minutos antes del vencimiento; ADMIN puede cambiar ambos umbrales desde Configuración. El navegador intenta reproducir un tono corto junto al aviso. El scheduler marca automáticamente la sesión vencida como `TIME_FINISHED` y la estación como `FINISHED`.
