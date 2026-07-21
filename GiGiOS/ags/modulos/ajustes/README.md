# Ajustes

El módulo se organiza por dominios para que cada sección, su lógica y sus
componentes específicos vivan juntos:

- `panel/`: navegación y registro de secciones del panel.
- `componentes/`: piezas visuales reutilizables entre secciones.
- `estado/`: preferencias compartidas y persistencia general.
- `accesibilidad/`, `barra/`, `cuenta/`, `dispositivos/`, `energia/`,
  `fecha-idioma/`, `juegos/`, `pantalla/`, `personalizacion/`, `seguridad/` y
  `sistema/`: implementación de cada dominio.

`SettingsPanel.tsx` es el punto de entrada de la ventana. Los archivos
`preferences.ts`, `ProfileAvatar.tsx`, `trayApps.ts` y `AutoDndSetting.tsx`
son fachadas públicas mantenidas para no romper consumidores externos; la
implementación nueva debe importarse directamente desde su dominio cuando el
consumidor pertenezca a este módulo.

Al añadir una sección, registra su metadato y su fábrica en
`panel/secciones.tsx`. Coloca cada componente con responsabilidad propia en un
archivo separado y conserva en `componentes/` únicamente elementos realmente
compartidos por varios dominios.
