# Instalación local — fase 4

## Método recomendado en esta entrega

Abre PowerShell en la carpeta del proyecto. Ejecuta `scripts/setup-local.ps1` (sin elevar privilegios), después `scripts/start-local.ps1`. El primero genera secretos si no existe .env, inicializa una base exclusiva del proyecto, instala dependencias, migra dos bases, ejecuta seed, pruebas y compilación. El segundo sirve el panel compilado junto a la API. El puerto web es 5173 y la API usa 3001.

No se instala un servicio Windows, no se modifica el servicio PostgreSQL preexistente y no se requiere Docker. Los datos locales residen en `.local/pgdata`. No borres esta carpeta para reiniciar pruebas: usa la base separada `gaming_control_test`. Nunca compartas `.env`, `.local` ni el directorio de datos.

Si PostgreSQL está en otra ruta:

```powershell
.\scripts\setup-local.ps1 -PostgresBin 'D:\PostgreSQL\18\bin'
```

Si el puerto 55432 está ocupado por otro proceso, el script falla sin apropiarse de él. Usa la instalación manual o libera exclusivamente tu instancia anterior conocida.

Las credenciales del administrador se generan aleatoriamente en `.env`, variables `ADMIN_EMAIL` y `ADMIN_PASSWORD`. El seed no resetea una contraseña existente. Puedes editar esos valores antes del primer seed. No hay credenciales universales como admin/admin.

## Base PostgreSQL propia (alternativa)

Crea una base PostgreSQL 18 y un usuario con permisos sobre esa base. Copia `.env.example` a `.env` solo si este último no existe. Configura `DATABASE_URL`, un `JWT_SECRET` aleatorio de 32 caracteres o más, y credenciales de administrador. Luego:

```powershell
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm test
npm run build
npm run serve
```

Para integración, crea otra base cuyo nombre termine en `_test`. Aplica la misma migración apuntando `DATABASE_URL` a esa base y ejecuta la suite con `TEST_DATABASE_URL` configurada. El script local automatiza la configuración temporal y restaura las variables del proceso al terminar. No ejecutar la suite sobre datos de negocio.

## Preparar una instalación limpia

Para eliminar únicamente la actividad local de prueba y conservar los usuarios y recursos configurados, detén el panel y ejecuta:

```powershell
npm run db:reset-local -- --confirm
```

El comando está restringido a `127.0.0.1:55432/gaming_control`; no funciona contra otra URL. Deja las estaciones disponibles y el stock en cero, y conserva usuarios, tarifas, productos, extras y ajustes.

Para generar un staging de distribución:

```powershell
npm run prepare:production
```

Se crea `.production` con `app` (compilados y migraciones), `config` (plantilla sin secretos), `data`, `backups` y `logs`. El instalador de escritorio se genera en fase 7 con Tauri.

## Docker opcional

`compose.yaml` utiliza PostgreSQL 18 y volumen persistente. Define `POSTGRES_PASSWORD` en tu entorno y ejecuta `docker compose up -d`. El puerto publicado es 5432 en loopback. Ajusta DATABASE_URL al usuario gaming y base gaming_control. Docker no está instalado en el entorno usado para esta entrega; esta alternativa no fue ejecutada aquí.

## Variables

| Variable                     | Uso                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| DATABASE_URL                 | Conexión PostgreSQL                                                                          |
| JWT_SECRET                   | Firma JWT; obligatorio, mínimo 32 caracteres                                                 |
| API_HOST / API_PORT          | Bind backend; 127.0.0.1 / 3001 por defecto                                                   |
| CORS_ORIGIN                  | Origen permitido, http://localhost:5173                                                      |
| ADMIN_EMAIL / ADMIN_PASSWORD | Solo creación del administrador durante seed                                                 |
| TEST_DATABASE_URL            | Base aislada para pruebas de integración                                                     |
| BUSINESS_NAME / TIMEZONE     | Reservadas para configuración de negocio posterior; UI inicial Gaming Control / America/Lima |

`BUSINESS_NAME` y `TIMEZONE` no son aún ajustes operativos: quedan explícitamente reservados. La UI muestra America/Lima como solicita la primera fase. No hay menú de configuración global ficticio.

## Desarrollo y ejecución

`npm run dev` proporciona recarga del backend y Vite. `npm run serve` ejecuta el panel previamente compilado y backend; no es un empaquetado Tauri. Después de cambios de código ejecuta `npm run build` antes de servir.

En el entorno restringido de Codex, Vite/esbuild no pudo enumerar directorios superiores para precompilar dependencias en modo dev. La compilación con `--configLoader native` y el servidor de vista previa sí funcionaron. Esta restricción queda documentada; no se cambian permisos de Windows ni configuraciones de seguridad para eludirla.

PostgreSQL initdb también falló al crear un token restringido dentro del entorno de Codex. Por preferencia expresa del usuario, la inicialización y verificación PostgreSQL se entregan como script para ejecutar desde su PowerShell. No se afirma que esa ejecución ya haya ocurrido.

## Tauri 2 para escritorio

La carpeta `apps/admin/src-tauri` contiene el shell Tauri 2, permisos mínimos y la configuración de ventanas/instaladores. El panel detecta el protocolo Tauri y conecta la API local en `127.0.0.1:3001`; Socket.IO usa el mismo origen. En Windows, con Rust stable, WebView2 y las herramientas C++ instaladas, ejecuta:

```powershell
npm run desktop:dev
npm run desktop:build
```

Los instaladores MSI y NSIS quedan en `apps/admin/src-tauri/target/release/bundle`. La base PostgreSQL sigue siendo un servicio local separado.

## LAN y fases posteriores

La base funciona localmente sin servicios cloud después de instalar dependencias. Para clientes LAN, el despliegue requiere origen/TLS local, firewall y host configurados explícitamente; nunca publiques PostgreSQL. El control de las estaciones se realiza desde el panel y la API en esta versión.

La instalación aplica también 202609070004_phase4, que crea los umbrales de alertas. Al iniciar la API se habilita Socket.IO; el panel recibe cambios en tiempo real y conserva REST como respaldo. Si el clúster estaba detenido, vuelve a ejecutar .\scripts\setup-local.ps1 para aplicar la migración antes de .\scripts\start-local.ps1.
