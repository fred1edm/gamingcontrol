# Arquitectura

La estación es la entidad central: PC, PS4, PS5, Xbox, Nintendo Switch u otra consola. El servidor es independiente del panel.

```text
React / Vite (futuro contenedor Tauri 2)
                 | HTTP REST autenticado
Fastify / Node.js 24 / TypeScript estricto
                 | Prisma 7 + adaptador pg
            PostgreSQL 18 local
```

El panel no calcula cobros: presenta importes recibidos del servidor. Convierte entradas de precios a céntimos para enviar tarifas, pero no computa facturas. El reloj visible parte de `serverTime` y utiliza `performance.now()` para mostrar el paso del tiempo; se resincroniza cada cinco segundos. La persistencia está en timestamps UTC del servidor, nunca en el contador del navegador.

PostgreSQL usa transacciones serializables. Se reintentan conflictos de serialización; una clave de idempotencia durable conserva la respuesta de cada mutación. Un índice parcial prohíbe dos sesiones no cerradas para una estación. No se usan mutexes locales que fallen al reiniciar el proceso.

Autenticación: scrypt con salt aleatorio por contraseña, JWT con expiración a ocho horas. El rol y estado activo se vuelven a consultar en base de datos en cada petición autenticada. ADMIN administra tarifas, usuarios y estaciones; EMPLOYEE opera sesiones. Cada mutación exitosa incorpora auditoría dentro de la misma transacción. No se registran hashes de contraseñas en auditoría.

El token se conserva en sessionStorage de la pestaña y se elimina al salir. La LAN no se considera confiable por defecto: el despliegue inicial escucha solo en loopback. El despliegue multi-PC requerirá TLS local, origen CORS explícito y reglas de firewall acotadas, sin exponer PostgreSQL a clientes.

Socket.IO opera en fase 4 para avisos y sincronización del panel; el sondeo REST sigue siendo el respaldo y la fuente de estado. Recharts y Tauri 2 están implementados.

Las bibliotecas de desarrollo deepmerge-ts y mysql2 se fijan mediante overrides a versiones corregidas por avisos detectados en dependencias de la CLI Prisma. La aplicación utiliza exclusivamente PostgreSQL. Mantener lockfile y repetir auditoría al actualizar.

Referencias verificadas: [Prisma 7 y configuración de adaptador](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7), [Tailwind con Vite](https://tailwindcss.com/docs/installation/using-vite).
