import { Module } from '@nestjs/common';
import { InventoryReconciliationController } from './inventory-reconciliation.controller';
import { InventoryReconciliationService } from './inventory-reconciliation.service';
@Module({ controllers:[InventoryReconciliationController], providers:[InventoryReconciliationService], exports:[InventoryReconciliationService] })
export class InventoryModule {}
