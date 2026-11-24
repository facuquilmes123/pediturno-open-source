# Política de Seguridad (Security Policy)

## Diseño de Seguridad Zero-Trust

Este repositorio está diseñado bajo principios estrictos de seguridad en profundidad:

1. **Firestore & Storage cerrados al acceso directo de clientes (`firestore.rules`):** Todas las lecturas y escrituras pasan por endpoints del servidor validados con Firebase Admin SDK.
2. **Validación Criptográfica de Webhooks (Mercado Pago HMAC & Google Play RTDN OIDC):** Ningún cambio de estado de pago o suscripción se procesa sin verificar criptográficamente la firma del proveedor o el estado autoritativo en la API oficial.
3. **Cifrado en Reposo (AES-256-GCM):** Los tokens OAuth de comercios vinculados se almacenan cifrados con claves de 32 bytes y etiquetas de autenticación.
4. **Cero Secretos en Código Fuente:** Ningún archivo del repositorio contiene claves privadas, tokens ni credenciales reales. Utilizá siempre `.env` locales (excluidos por `.gitignore`) a partir de `.env.example`.

## Reportar una Vulnerabilidad

Si detectás algún problema de seguridad o posible mejora criptográfica, por favor abrí un Issue o Pull Request detallando el vector de ataque y la mitigación propuesta sin exponer credenciales reales.
