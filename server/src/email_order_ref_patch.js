import nodemailer from 'nodemailer';

let installed = false;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

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
      if (subject.startsWith('The Wall order confirmed') || subject.startsWith('New The Wall order')) {
        const uuid = subject.match(UUID_RE)?.[0] || '';
        const ref = orderReference(uuid);
        if (uuid && ref) {
          message.subject = subject.replaceAll(uuid, ref);
          if (typeof message.text === 'string') message.text = message.text.replaceAll(uuid, ref);
          if (typeof message.html === 'string') message.html = message.html.replaceAll(uuid, ref);
        }
      }
      return previousSendMail(message);
    };
    return transport;
  };
}
