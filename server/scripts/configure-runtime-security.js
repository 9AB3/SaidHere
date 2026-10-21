import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimePath = path.resolve(here, '..', 'src', 'index.runtime.js');

let source = fs.readFileSync(runtimePath, 'utf8');
const defaultHelmet = 'app.use(helmet());';
const stripeCheckoutHelmet = `app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'form-action': ["'self'", 'https://checkout.stripe.com'],
    },
  },
}));`;

if (source.includes(defaultHelmet)) {
  source = source.replace(defaultHelmet, stripeCheckoutHelmet);
} else if (!source.includes(stripeCheckoutHelmet)) {
  throw new Error('Could not find the Helmet security middleware marker.');
}

fs.writeFileSync(runtimePath, source, 'utf8');
console.log('Configured runtime CSP to allow redirecting the purchase form to Stripe Checkout.');
