import nodemailer from 'nodemailer';

let installed = false;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const WEB_BASE = (process.env.PUBLIC_WEB_URL || 'https://saidhere.app').replace(/\/$/, '');

function orderReference(value) {
  const compact = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return compact ? `TW-${compact.slice(0, 10)}` : '';
}

function preserveAdminRecipients(message) {
  if (!String(message.subject || '').startsWith('New The Wall order')) return;
  if (typeof message.to !== 'string') return;

  // The commerce email polish layer suppresses an admin recipient when it exactly
  // matches the purchaser address. We intentionally want both emails during normal
  // operation and testing, even when the purchaser is also the admin. Supplying the
  // same mailbox as a normal display-address keeps delivery unchanged while making
  // the admin notification distinct from the customer-recipient comparison.
  message.to = message.to
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.includes('<') ? value : `The Wall Admin <${value}>`)
    .join(', ');
}

function clarifyFirstTimeActivation(message) {
  const textNeedsActivation = typeof message.text === 'string' && message.text.includes('Activate My Walls:');
  const htmlNeedsActivation = typeof message.html === 'string' && message.html.includes('>Activate My Walls</a>');
  if (!textNeedsActivation && !htmlNeedsActivation) return;

  if (textNeedsActivation) {
    message.text = message.text.replace(
      '\n\nActivate My Walls:',
      '\n\nCREATE YOUR MY WALLS PASSWORD\nYou do not have a My Walls login yet. Use the secure link below to create your password. After that, you can sign in normally and manage this Wall and any future Walls you buy.\n\nCreate My Walls password:',
    );
  }

  if (htmlNeedsActivation) {
    message.html = message.html
      .replace(
        '<p style="margin:28px 0 18px"><a ',
        '<div style="margin:24px 0 16px;padding:16px;background:#f1e8da;border-left:4px solid #171411"><div style="font-size:11px;letter-spacing:1.5px;font-weight:800;margin-bottom:7px">CREATE YOUR MY WALLS PASSWORD</div><p style="margin:0;color:#5f584f;font-size:13px;line-height:1.55"><strong>You do not have a My Walls login yet.</strong> Use the button below to create your password. After that, you can sign in normally and manage this Wall and any future Walls you buy.</p></div><p style="margin:28px 0 18px"><a ',
      )
      .replace('>Activate My Walls</a>', '>Create My Walls password</a>');
  }
}

export function installOrderReferenceEmailPatch() {
  if (installed) return;
  installed = true;
  const previousCreateTransport = nodemailer.createTransport.bind(nodemailer);
  nodemailer.createTransport = (...args) => {
    const transport = previousCreateTransport(...args);
    const previousSendMail = transport.sendMail.bind(transport);
    transport.sendMail = async (message = {}) => {
      preserveAdminRecipients(message);

      const subject = String(message.subject || '');
      const uuid = subject.match(UUID_RE)?.[0] || '';
      const ref = orderReference(uuid);

      if (subject.startsWith('The Wall order confirmed')) {
        clarifyFirstTimeActivation(message);
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
