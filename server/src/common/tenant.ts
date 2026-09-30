import { ForbiddenException } from '@nestjs/common';
export function assertShopAccess(principal: { shopIds?: string[] }, shopId: string) {
  if (!principal?.shopIds?.includes(shopId)) throw new ForbiddenException('SHOP_ACCESS_DENIED');
}
