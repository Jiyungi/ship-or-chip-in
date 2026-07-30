import { Auth0Client } from "@auth0/nextjs-auth0/server";

export function isAuth0Configured() {
  return Boolean(
    process.env.AUTH0_DOMAIN &&
      process.env.AUTH0_CLIENT_ID &&
      process.env.AUTH0_CLIENT_SECRET &&
      process.env.AUTH0_SECRET,
  );
}

export const auth0 = new Auth0Client({
  enableAccessTokenEndpoint: false,
});
