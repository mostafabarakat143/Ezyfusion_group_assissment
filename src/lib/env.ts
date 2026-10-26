function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

export function getPublicEnv() {
  return {
    supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
    supabasePublishableKey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}

export function getServerEnv() {
  return {
    ...getPublicEnv(),
    supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
    databaseUrl: required("DATABASE_URL"),
    gatewaySignatureKey: required("GATEWAY_X_SIGNATURE_KEY"),
  };
}
