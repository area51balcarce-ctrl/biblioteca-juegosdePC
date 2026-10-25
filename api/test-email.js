// AREA 51 - Prueba temporal de Resend
// Ubicacion en GitHub: api/test-email.js
// Eliminar esta funcion una vez finalizada la prueba.

const DESTINATARIO = 'area51.balcarce@gmail.com';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Allow', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Metodo no permitido.' });
  }

  const secret = process.env.AREA51_EMAIL_TEST_SECRET;
  const apiKey = process.env.RESEND_API_KEY;

  if (!secret || !apiKey) {
    return res.status(503).json({ ok: false, error: 'Configuracion incompleta en Vercel.' });
  }

  const authorization = req.headers.authorization || '';
  if (authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'No autorizado.' });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'AREA 51 <onboarding@resend.dev>',
        to: [DESTINATARIO],
        subject: 'AREA 51 - Prueba de correo',
        text: 'Prueba de envio de correo de la tienda AREA 51. Si recibiste este mensaje, la integracion con Resend funciona.',
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      console.error('Resend test failed:', response.status);
      return res.status(502).json({ ok: false, error: 'Resend rechazo el envio.', providerStatus: response.status });
    }

    return res.status(200).json({ ok: true, message: 'Resend acepto el correo de prueba. Revisa tu bandeja de entrada.' });
  } catch (error) {
    console.error('Resend test error:', error?.message || 'Unknown error');
    return res.status(502).json({ ok: false, error: 'No se pudo completar el envio.' });
  }
}
