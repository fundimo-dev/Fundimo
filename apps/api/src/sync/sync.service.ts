import { Inject, Injectable } from '@nestjs/common';
import { Provider, RuleMatchType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { reconcile } from '../domain/reconciliation';
import { FINANCIAL_DATA_PROVIDER, FinancialDataProvider } from '../providers/financial-data.provider';

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FINANCIAL_DATA_PROVIDER) private readonly provider: FinancialDataProvider,
  ) {}

  async sync(userId: string) {
    const accounts = await this.prisma.connectedAccount.findMany({
      where: { user_id: userId },
    });
    if (accounts.length === 0) {
      return { accountsSynced: 0, transactionsCreated: 0, transactionsUpdated: 0 };
    }

    const oldestSync = accounts.reduce<Date | null>((acc, a) => {
      if (!a.last_sync_at) return acc;
      return !acc || a.last_sync_at < acc ? a.last_sync_at : acc;
    }, null);
    const since = oldestSync ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const until = new Date();

    const { transactions: incoming } = await this.provider.sync(userId, accounts, { since, until });

    const existing = await this.prisma.transaction.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        account_id: true,
        amount_cents: true,
        effective_date: true,
        merchant_name: true,
        status: true,
        provider_transaction_id: true,
        provider_pending_id: true,
      },
    });

    const { toCreate, toUpdate } = reconcile(
      existing.map((e) => ({ ...e, status: e.status })),
      incoming,
    );

    await this.prisma.$transaction(async (tx) => {
      if (toCreate.length > 0) {
        await tx.transaction.createMany({
          data: toCreate.map((t) => ({
            user_id: userId,
            account_id: t.account_id,
            amount_cents: t.amount_cents,
            currency: t.currency,
            authorized_at: t.authorized_at,
            posted_at: t.posted_at,
            effective_date: t.effective_date,
            merchant_name: t.merchant_name,
            description: t.description,
            status: t.status,
            provider: Provider.MOCK,
            provider_transaction_id: t.provider_transaction_id,
            provider_pending_id: t.provider_pending_id,
            metadata: (t.metadata ?? undefined) as Prisma.InputJsonValue,
          })),
        });
      }
      for (const u of toUpdate) {
        await tx.transaction.update({
          where: { id: u.id },
          data: {
            ...(u.status && { status: u.status as any }),
            ...(u.provider_transaction_id !== undefined && { provider_transaction_id: u.provider_transaction_id }),
            ...(u.merchant_name && { merchant_name: u.merchant_name }),
          },
        });
      }
      await tx.connectedAccount.updateMany({
        where: { id: { in: accounts.map((a) => a.id) } },
        data: { last_sync_at: until },
      });

      const rules = await tx.rule.findMany({
        where: { user_id: userId, is_active: true },
        orderBy: { priority: 'asc' },
      });
      if (rules.length > 0) {
        const uncategorized = await tx.transaction.findMany({
          where: { user_id: userId, category_id: null, is_excluded: false },
        });
        for (const t of uncategorized) {
          const merchant = (t.merchant_name ?? '').toUpperCase();
          const rule = rules.find(
            (r) => r.match_type === RuleMatchType.MERCHANT_CONTAINS && merchant.includes(r.match_value.toUpperCase()),
          );
          if (rule) {
            await tx.transaction.update({
              where: { id: t.id },
              data: { category_id: rule.category_id },
            });
          }
        }
      }
    });

    return {
      accountsSynced: accounts.length,
      transactionsCreated: toCreate.length,
      transactionsUpdated: toUpdate.length,
    };
  }
}
