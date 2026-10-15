# Preparación del instalador

La aplicación de escritorio se genera con Tauri 2. El script `scripts/build-installer.ps1` comprueba Node.js y Rust/Cargo, ejecuta la compilación y muestra los archivos MSI y NSIS generados.

Desde PowerShell en la raíz del proyecto:

```powershell
npm run installer:build
```

Los instaladores aparecen en `apps/admin/src-tauri/target/release/bundle`. El instalador contiene el panel de escritorio; la API y PostgreSQL deben ejecutarse en el equipo servidor. La base de datos no se expone a la LAN: solo la API recibe conexiones.

Antes de distribuir, configura la URL de la API del servidor, cambia los secretos de producción y realiza una instalación limpia en un equipo de prueba.
