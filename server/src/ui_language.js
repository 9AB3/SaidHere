import nodemailer from 'nodemailer';

function replaceWallTerms(value) {
  return String(value)
    .replace(/\bPlaques\b/g, 'Walls')
    .replace(/\bplaques\b/g, 'Walls')
    .replace(/\bPlaque\b/g, 'Wall')
    .replace(/\bplaque\b/g, 'Wall');
}

function replaceHtmlTextNodes(html) {
  const tokens = String(html).split(/(<[^>]+>)/g);
  let protectedBlock = null;

  return tokens.map((token) => {
    if (token.startsWith('<')) {
      const open = token.match(/^<(script|style)\b/i);
      if (open) protectedBlock = open[1].toLowerCase();
      const close = token.match(/^<\/(script|style)\b/i);
      if (close && protectedBlock === close[1].toLowerCase()) protectedBlock = null;
      return token;
    }
    if (protectedBlock) return token;
    return replaceWallTerms(token);
  }).join('');
}

function replaceQuantityControl(html) {
  return html.replace(
    /<select\s+name="quantity">[\s\S]*?<\/select>/i,
    '<input name="quantity" type="number" inputmode="numeric" min="1" max="10" step="1" value="1" required aria-label="Quantity">',
  );
}

function rewriteHtml(html) {
  let output = replaceQuantityControl(String(html));
  output = replaceHtmlTextNodes(output);
  output = output
    .replace(/alt="The Wall NFC plaque"/g, 'alt="The Wall"')
    .replace(/alt="The Wall plaque"/g, 'alt="The Wall"');
  return output;
}

function rewriteJson(value) {
  if (typeof value === 'string') return replaceWallTerms(value);
  if (Array.isArray(value)) return value.map(rewriteJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteJson(item)]));
  }
  return value;
}

// Nodemailer is a shared module object. Wrapping createTransport here lets the
// product wording stay consistent in customer/admin emails without renaming any
// internal database or fulfilment identifiers.
const emailPatchKey = Symbol.for('saidhere.wall-wording-email-patch');
try {
  if (!nodemailer[emailPatchKey]) {
    const originalCreateTransport = nodemailer.createTransport.bind(nodemailer);
    nodemailer.createTransport = (...args) => {
      const transport = originalCreateTransport(...args);
      const originalSendMail = transport.sendMail.bind(transport);
      transport.sendMail = (message, ...rest) => {
        const nextMessage = {
          ...message,
          subject: typeof message?.subject === 'string' ? replaceWallTerms(message.subject) : message?.subject,
          text: typeof message?.text === 'string' ? replaceWallTerms(message.text) : message?.text,
          html: typeof message?.html === 'string' ? rewriteHtml(message.html) : message?.html,
        };
        return originalSendMail(nextMessage, ...rest);
      };
      return transport;
    };
    nodemailer[emailPatchKey] = true;
  }
} catch (error) {
  console.warn('[wall-wording-email]', error?.message || error);
}

export function wallUiLanguage(req, res, next) {
  const originalSend = res.send.bind(res);
  const originalJson = res.json.bind(res);

  res.send = (body) => {
    if (typeof body === 'string' && /<html\b|<!doctype\s+html/i.test(body)) {
      return originalSend(rewriteHtml(body));
    }
    return originalSend(body);
  };

  res.json = (body) => originalJson(rewriteJson(body));

  return next();
}
