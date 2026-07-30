import Stripe from "stripe";

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Stripe Sandbox contributions are not configured");
  }
  return new Stripe(secretKey);
}

export const stripeCryptoProvider = Stripe.createSubtleCryptoProvider();
