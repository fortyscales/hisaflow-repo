export type RuntimeConfig = {
  nodeEnv: string; port: number; databaseUrl: string; jwtSecret: string;
  corsOrigins: string[]; trustProxy: boolean; authRateLimit: number; requestBodyLimit: string;
};

function required(name:string){ const v=String(process.env[name]||'').trim(); if(!v) throw new Error(`${name}_REQUIRED`); return v; }
function int(name:string, fallback:number, min:number, max:number){ const raw=String(process.env[name]||fallback); const n=Number(raw); if(!Number.isInteger(n)||n<min||n>max) throw new Error(`${name}_INVALID`); return n; }
export function loadConfig():RuntimeConfig {
  const nodeEnv=String(process.env.NODE_ENV||'development').trim();
  const port=int('PORT',3000,1,65535);
  const databaseUrl=required('DATABASE_URL');
  const jwtSecret=required('JWT_SECRET');
  if(nodeEnv==='production' && (jwtSecret.length<32 || /replace|change_me|secret/i.test(jwtSecret))) throw new Error('JWT_SECRET_WEAK');
  if(nodeEnv==='production' && /change_me/i.test(databaseUrl)) throw new Error('DATABASE_URL_UNSAFE');
  const corsOrigins=String(process.env.CORS_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(nodeEnv==='production' && !corsOrigins.length) throw new Error('CORS_ORIGINS_REQUIRED');
  return { nodeEnv, port, databaseUrl, jwtSecret, corsOrigins, trustProxy:process.env.TRUST_PROXY==='true', authRateLimit:int('AUTH_RATE_LIMIT_PER_MINUTE',30,5,1000), requestBodyLimit:String(process.env.REQUEST_BODY_LIMIT||'1mb') };
}
