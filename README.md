# Gaming Control

Base local para cabinas, PlayStation y otras consolas. Panel en español, precios en céntimos de sol y datos en PostgreSQL 18. Incluye catálogo, inventario, cobros, caja, avisos de tiempo, sincronización en tiempo real, reportes, auditoría y empaquetado Tauri 2 para escritorio Windows.

**Estado:** monorepo preparado para GitHub. Incluye panel web, API, PostgreSQL, reportes, inventario, caja, fidelización y tiempo real. El instalador de escritorio requiere Rust, WebView2 y las herramientas de compilación de Windows.

Los secretos, bases locales, dependencias y compilaciones quedan fuera del repositorio mediante `.gitignore`. Copia `.env.example` a `.env` y reemplaza todos los valores de ejemplo antes de ejecutar el sistema.

## Empezar en Windows

Requisitos: Node.js 24 LTS, npm y PostgreSQL 18 instalado. Internet solo para descargar dependencias la primera vez. Después, la operación se realiza localmente.

Abre PowerShell en esta carpeta y ejecuta:

```powershell
.\scripts\setup-local.ps1
.\scripts\start-local.ps1
```

El instalador crea una instancia PostgreSQL **aislada en el puerto 55432**, aplica migraciones, carga el seed y ejecuta pruebas en `gaming_control_test`. No modifica el servicio PostgreSQL que ya tienes. Si tu política de Windows impide ejecutar scripts, utiliza una sesión con la política permitida por tu equipo; no se modifica automáticamente ninguna política.

Abre [el panel local](http://localhost:5173). Usuario: `admin@gaming.local`. Consulta `ADMIN_PASSWORD` en el archivo local `.env`; se generó aleatoriamente y no está publicada en la documentación. El seed no reemplaza usuarios ni contraseñas existentes. El correo también puede configurarse mediante `ADMIN_EMAIL` antes del primer seed.

El script muestra éxito solo cuando todos sus pasos pasan. Si falla, conserva el mensaje y revisa `docs/setup.md`.

Para detener la base aislada: `scripts/stop-local-db.ps1`. Ctrl+C en la terminal detiene el panel y la API, pero deja PostgreSQL encendido.

## Subir a GitHub

Este proyecto no incluye un repositorio remoto ni credenciales de GitHub. Desde esta carpeta:

```powershell
git init -b main
git add .
git status
git commit -m "Preparar Gaming Control"
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

Antes del primer `commit`, verifica que `git status` no muestre `.env`, `.local`, `.production`, `node_modules` ni archivos de contraseñas. Si Git todavía no tiene tu identidad configurada, establece `user.name` y `user.email` solo en tu equipo.

## Flujo de aceptación

1. Iniciar sesión; abrir PLAY 01 (PS5, S/8 por hora).
2. Iniciar una hora sin extras: S/8.
3. Agregar el mando adicional: S/10. También puede seleccionarse al iniciar.
4. Agregar una hora: **S/18**, nunca S/20.
5. Finalizar y confirmar. El registro conserva sesión, mando y extensión.
6. Finalizar, cobrar desde el detalle y consultar Historial.

**Finalizar no es cobrar:** la sesión queda `TIME_FINISHED` hasta que se registra el pago; entonces se libera la estación. Los avisos de sesiones fijas llegan por tiempo real a 10 y 5 minutos, con sonido cuando el navegador lo permite.

## Comandos

| Comando                               | Función                                                    |
| ------------------------------------- | ---------------------------------------------------------- |
| `npm ci`                              | Instalar versiones del lockfile                            |
| `npm run db:generate`                 | Generar cliente Prisma                                     |
| `npm run db:migrate`                  | Aplicar migraciones pendientes                             |
| `npm run db:seed`                     | Crear admin, cinco estaciones y mando, sin sobrescribir    |
| `npm run db:reset-local -- --confirm` | Limpiar actividad local y conservar usuarios/recursos      |
| `npm run dev`                         | API (3001) y Vite (5173)                                   |
| `npm run dev -w @gaming/api`          | Solo API                                                   |
| `npm run dev -w @gaming/admin`        | Solo panel                                                 |
| `npm run build`                       | Tipos, backend y panel de producción                       |
| `npm test`                            | Reglas financieras, contraseñas y seguridad HTTP sin base  |
| `npm run test:integration`            | Flujo real, concurrencia y rollback en `TEST_DATABASE_URL` |
| `npm run lint`                        | ESLint                                                     |
| `npm run format:check`                | Formato Prettier                                           |
| `npm run prepare:production`          | Compilar y crear staging `.production`                     |
| `npm run desktop:dev`                 | Ejecutar el panel dentro de Tauri en desarrollo            |
| `npm run desktop:build`               | Generar instaladores Tauri (`msi` y `nsis`)                |

Node 24 ejecuta el TypeScript del backend de forma nativa. No se requiere tsx. Para Tauri 2 instala Rust stable, Visual Studio Build Tools (C++), WebView2 y ejecuta `npm run desktop:build` desde Windows.

## Estructura

- `apps/admin`: React 19, Vite, Tailwind 4, componentes según patrón shadcn/ui, Tabler Icons y Recharts.
- `apps/api`: Fastify, autenticación, permisos, transacciones, auditoría, reglas financieras y Socket.IO.
- `packages/shared`: esquemas Zod, contratos públicos y catálogo de eventos.
- `prisma`: modelo, migración inicial y seed.
- `scripts`: preparación, inicio y parada local.
- `tests`: pruebas unitarias y suite de integración PostgreSQL.
- `docs`: arquitectura, memoria persistente, reglas, API, base de datos y verificación.

`db:reset-local` solo permite la base aislada `127.0.0.1:55432/gaming_control`. Borra sesiones,
ventas, pagos, caja, movimientos, auditoría e idempotencias; conserva usuarios, estaciones,
tarifas, productos, extras y configuración. `prepare:production` crea un staging con `app`,
`config`, `data`, `backups` y `logs`; el instalador Tauri todavía corresponde a la fase 7.

No se crean paquetes vacíos `types/config/validation`: tipos y validación viven juntos en `shared` hasta que exista una necesidad real de separarlos. La decisión está registrada en memoria.

## Documentación

[Instalación detallada](docs/setup.md) · [Arquitectura](docs/architecture.md) · [Reglas](docs/business-rules.md) · [Base de datos](docs/database.md) · [API](docs/api.md) · [Eventos](docs/socket-events.md) · [Memoria](docs/memory.md) · [Validación](docs/verification.md)
