# Emisor Para ti preparado localmente

El workflow conserva la publicación existente. Los push a main publican sin avisar.
Para avisar se ejecuta manualmente «Publicar portafolio en GitHub Pages», desde main,
marcando avisar_para_ti. El valor por defecto es falso. No ejecutar hasta autorizar
una prueba real: el tema llega a todos los dispositivos suscritos, no solo al emulador.

Después del despliegue se comprueba que catálogo, página e imagen publicados coinciden
con esta revisión. Se envían solo detalles visibles con notificación habilitada y un ID
de anuncio que todavía no figure en el registro. Texto editado con el mismo ID no reanuncia.
Publicar sin avisar no registra esos IDs: podrán enviarse en una ejecución manual posterior.

El registro vive en registro.json de la rama para-ti-envios del mismo repositorio,
creada automáticamente en la primera ejecución autorizada. No contiene credenciales.
El secreto FIREBASE_SERVICE_ACCOUNT existente se usa solo en el paso de envío.
El permiso contents:write está limitado al trabajo del emisor; las reglas del repositorio
deben permitir escribir en esa rama. Si no lo permiten, el envío falla antes de FCM.

Cada anuncio se reserva antes de llamar a FCM. Aceptado_fcm significa que FCM aceptó
el mensaje, no que el teléfono lo recibió. Una reserva pendiente_revision se omite
en ejecuciones posteriores y requiere revisar el resultado antes de eliminarla para
reintentar. No cambiar el ID del anuncio para resolver un error de transporte.
La entrega exactamente una vez no puede garantizarse entre GitHub y FCM; la reserva
evita reintentos ciegos y la app también deduplica por ID.

Sin polling ni servidor permanente. Payload solo data, prioridad normal, TTL 24 horas.
No se han realizado envíos reales ni publicado estos cambios.

Comprobación local sin red ni secretos, desde la raíz del portafolio:

    node --check scripts/enviar-para-ti.mjs
    node scripts/enviar-para-ti.mjs --comprobar

Pruebas reales pendientes: publicación efectiva, permisos del registro, autenticación
del secreto, recepción FCM y recorrido en dispositivo de prueba autorizado.
