/**
 * Configuração do electron-builder com assinatura opcional (Certum Open Source Code Signing via SimplySign).
 *
 * Sem certificado: gera o instalador sem assinatura (uso local).
 * Com certificado: defina CERTUM_CERT_SHA1 (thumbprint) com o SimplySign Desktop conectado.
 * Veja docs/assinatura-certum.md.
 */
const pkg = require('./package.json');

const base = pkg.build;
const sha1 = (process.env.CERTUM_CERT_SHA1 || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
const publisher = (process.env.CERTUM_PUBLISHER_NAME || '').trim();
const releasing = process.env.MONITOR_RELEASE === '1';

if (sha1 && sha1.length !== 40) {
  throw new Error(`CERTUM_CERT_SHA1 deve ter 40 caracteres hexadecimais (recebido: ${sha1.length}).`);
}
if (releasing && !sha1 && process.env.MONITOR_ALLOW_UNSIGNED !== '1') {
  throw new Error('Publicação sem assinatura bloqueada: defina CERTUM_CERT_SHA1 (ou MONITOR_ALLOW_UNSIGNED=1 para forçar).');
}

module.exports = {
  ...base,
  win: {
    ...base.win,
    // ícone e metadados no .exe sempre; assinatura só quando há certificado
    signAndEditExecutable: true,
    signExecutable: Boolean(sha1),
    ...(sha1
      ? {
          signtoolOptions: {
            certificateSha1: sha1,
            signingHashAlgorithms: ['sha256'],
            rfc3161TimeStampServer: 'http://time.certum.pl',
            // o atualizador só instala versões assinadas por este mesmo nome (CN do certificado)
            ...(publisher ? { publisherName: publisher } : {}),
          },
        }
      : {}),
  },
};
