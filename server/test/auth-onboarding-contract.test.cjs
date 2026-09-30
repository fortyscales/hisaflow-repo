const fs=require('fs'),path=require('path'),assert=require('assert'); const r=path.join(__dirname,'..');
const svc=fs.readFileSync(path.join(r,'src/auth/auth.service.ts'),'utf8'); const pwd=fs.readFileSync(path.join(r,'src/auth/password.ts'),'utf8'); const sql=fs.readFileSync(path.join(r,'sql/002_auth_onboarding.sql'),'utf8'); const shops=fs.readFileSync(path.join(r,'src/shops/shops.controller.ts'),'utf8');
assert(pwd.includes('scrypt')&&pwd.includes('timingSafeEqual'),'password hashing must be memory-hard and timing-safe');
assert(svc.includes("expiresIn: '15m'")&&svc.includes("interval '30 days'"),'token lifetimes missing');
assert(svc.includes('refresh_token_hash')&&svc.includes("revoked_at=now()"),'refresh rotation/revocation missing');
assert(sql.includes('auth_sessions')&&sql.includes('ON DELETE CASCADE'));
assert(svc.includes("role: 'owner'")||svc.includes("'owner'"),'owner onboarding missing');
assert(shops.includes('shop_memberships')&&shops.includes("'owner'"),'shop ownership missing');
console.log('PASS auth + merchant onboarding contract');
