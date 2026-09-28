# CardDex 0.20 — Supabase Ready

CardDex 0.20 prepara el salto de almacenamiento local a cuentas reales sincronizadas.

## Qué funciona ya
- Todo el prototipo anterior: expansiones, cartas, Pokédex, colección, deseados, objetivos, temas y avatares Pokémon.
- Detección automática de Supabase: si no está configurado, CardDex sigue funcionando localmente.
- Registro/inicio/cierre de sesión reales cuando se rellenan las credenciales públicas de Supabase.
- Sincronización de colección, deseados, objetivos, tema y avatar.
- Migración inicial: si la cuenta remota está vacía y este navegador tiene datos locales, CardDex los sube a la cuenta.

## Activar Supabase
1. Crea un proyecto de Supabase.
2. Ejecuta `supabase-schema.sql` en el SQL Editor.
3. Abre `supabase-config.js` y pega:
   - Project URL
   - Publishable key / anon key pública
4. No uses jamás la `service_role` key en la web.
5. Abre CardDex y crea una cuenta.

El esquema activa Row Level Security para que cada usuario solo pueda leer y escribir sus propios datos.

## Archivos nuevos
- `supabase-config.js`: configuración pública del cliente.
- `supabase-schema.sql`: tablas, trigger de perfil y políticas RLS.

## Datos de usuario
- `profiles`: nombre, avatar y tema.
- `collection_items`: cartas y copias.
- `wishlist_items`: deseados.
- `goals`: objetivos.
- `goal_cards`: cartas que forman parte de cada objetivo.

Los datos públicos de Pokémon/TCG siguen viniendo de TCGdex/PokéAPI; la base de datos solo almacena los datos personales del usuario.

## Optimización 0.19

Supabase ya no almacena `card_data` JSON en colección, deseados ni objetivos. Solo persiste identificadores, cantidades y fechas. CardDex reconstruye los datos visuales desde TCGdex al iniciar sesión en un dispositivo nuevo y los conserva en la caché/localStorage del navegador.

## Fallback de logos 0.20

Las expansiones usan logo oficial cuando existe, símbolo de set como segundo nivel y una tarjeta tipográfica con nombre + código como último recurso. El mismo sistema se usa en el catálogo y en la cabecera de la expansión.
