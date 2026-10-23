import nodemailer from 'nodemailer';

let installed = false;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const WEB_BASE = (process.env.PUBLIC_WEB_URL || 'https://saidhere.app').replace(/\/$/, '');

function orderReference(value) {
  const compact = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return compact ? `TW-${compact.slice(0, 10)}` : '';
}

export function installOrderReferenceEmailPatch() {
  if (installed) return;
  installed = true;
  const previousCreateTransport = nodemailer.createTransport.bind(nodemailer);
  nodemailer.createTransport = (...args) => {
    const transport = previousCreateTransport(...args);
    const previousSendMail = transport.sendMail.bind(transport);
    transport.sendMail = async (message = {}) => {
      const subject = String(message.subject || '');
      const uuid = subject.match(UUID_RE)?.[0] || '';
      const ref = orderReference(uuid);

      if (subject.startsWith('The Wall order confirmed')) {
        if (uuid && ref) {
          message.subject = `Order ${ref} confirmed`;
          if (typeof message.text === 'string') message.text = message.text.replaceAll(uuid, ref);
          if (typeof message.html === 'string') message.html = message.html.replaceAll(uuid, ref);
        }
        if (typeof message.text === 'string') {
          message.text = message.text.replaceAll('https://nfc.saidhere.app/my-walls', `${WEB_BASE}/my-walls`);
        }
        if (typeof message.html === 'string') {
          message.html = message.html
            .replaceAll('https://nfc.saidhere.app/my-walls', `${WEB_BASE}/my-walls`)
            .replace(
              '<div style="background:#171411;color:#f7f0e5;padding:28px;border-radius:14px 14px 0 0"><div style="font-size:11px;letter-spacing:3px;font-weight:700">THE WALL</div><h1 style="margin:8px 0 0;font-size:30px">Order confirmed.</h1></div>',
              '<div style="background:#171411;color:#f7f0e5;padding:15px 20px;border-radius:14px 14px 0 0;font-size:11px;letter-spacing:2px;font-weight:800">THE WALL · ORDER CONFIRMED</div>',
            );
        }
      } else if (subject.startsWith('New The Wall order') && uuid && ref) {
        message.subject = subject.replaceAll(uuid, ref);
        if (typeof message.text === 'string') message.text = message.text.replaceAll(uuid, ref);
      }

      return previousSendMail(message);
    };
    return transport;
  };
}
