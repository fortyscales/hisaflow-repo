import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool, PoolClient } from 'pg';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PG } from '../db/db.module';
import { hashPassword, verifyPassword } from './password';

@Injectable()
export class AuthService {
  constructor(@Inject(PG) private readonly db: Pool, private readonly jwt: JwtService) {}
  private normalizeEmail(v: string) { return String(v || '').trim().toLowerCase(); }
  private refreshHash(token: string) { return createHash('sha256').update(token).digest('hex'); }
  private async memberships(client: Pool | PoolClient, userId: string) {
    const r = await client.query('SELECT shop_id, role FROM shop_memberships WHERE user_id=$1 ORDER BY created_at', [userId]);
    return r.rows.map(x => ({ shopId: x.shop_id, role: x.role }));
  }
  private async issue(userId: string, meta: any = {}) {
    const memberships = await this.memberships(this.db, userId);
    const accessToken = await this.jwt.signAsync({ sub: userId, shopIds: memberships.map(x=>x.shopId), type: 'access' }, { expiresIn: '15m' });
    const refreshToken = randomBytes(48).toString('base64url');
    const sessionId = randomUUID();
    await this.db.query(`INSERT INTO auth_sessions(id,user_id,refresh_token_hash,user_agent,ip_address,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+interval '30 days')`, [sessionId,userId,this.refreshHash(refreshToken),meta.userAgent||null,meta.ip||null]);
    return { accessToken, refreshToken, expiresInSeconds: 900, memberships };
  }
  async register(body: any, meta: any) {
    const email = this.normalizeEmail(body.email); const password = String(body.password || '');
    if (!email || !email.includes('@')) throw new BadRequestException('VALID_EMAIL_REQUIRED');
    if (password.length < 8) throw new BadRequestException('PASSWORD_MIN_8');
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT 1 FROM users WHERE email=$1', [email]);
      if (exists.rowCount) throw new ConflictException('EMAIL_ALREADY_REGISTERED');
      const userId = randomUUID();
      const passwordHash = await hashPassword(password);
      await client.query('INSERT INTO users(id,email,password_hash,display_name,updated_at) VALUES($1,$2,$3,$4,now())', [userId,email,passwordHash,String(body.displayName||'').trim()||null]);
      let shop: any = null;
      if (String(body.businessName||'').trim()) {
        const requestedShopId=String(body.shopId||'').trim();
        if (requestedShopId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedShopId)) throw new BadRequestException('SHOP_ID_INVALID');
        const shopId = requestedShopId || randomUUID(); const name = String(body.businessName).trim();
        const collision=await client.query('SELECT 1 FROM shops WHERE id=$1',[shopId]);
        if(collision.rowCount) throw new ConflictException('SHOP_ID_ALREADY_EXISTS');
        await client.query('INSERT INTO shops(id,name) VALUES($1,$2)', [shopId,name]);
        await client.query("INSERT INTO shop_memberships(shop_id,user_id,role) VALUES($1,$2,'owner')", [shopId,userId]);
        shop = { id: shopId, name, role: 'owner' };
      }
      await client.query('COMMIT');
      const tokens = await this.issue(userId, meta);
      return { user: { id:userId,email,displayName:String(body.displayName||'').trim()||null }, shop, ...tokens };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async login(body: any, meta: any) {
    const email = this.normalizeEmail(body.email); const password = String(body.password || '');
    const r = await this.db.query('SELECT id,email,password_hash,display_name FROM users WHERE email=$1', [email]);
    const user = r.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) throw new UnauthorizedException('INVALID_CREDENTIALS');
    return { user:{id:user.id,email:user.email,displayName:user.display_name}, ...(await this.issue(user.id, meta)) };
  }
  async refresh(token: string, meta: any) {
    const hash = this.refreshHash(String(token || ''));
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(`SELECT id,user_id FROM auth_sessions WHERE refresh_token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`, [hash]);
      if (!r.rowCount) throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
      await client.query('UPDATE auth_sessions SET revoked_at=now(),last_used_at=now() WHERE id=$1', [r.rows[0].id]);
      await client.query('COMMIT');
      return await this.issue(r.rows[0].user_id, meta);
    } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async logout(token: string) {
    if (token) await this.db.query('UPDATE auth_sessions SET revoked_at=now() WHERE refresh_token_hash=$1 AND revoked_at IS NULL', [this.refreshHash(token)]);
    return { ok:true };
  }
}
