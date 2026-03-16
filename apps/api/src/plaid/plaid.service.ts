import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Provider, RuleMatchType, TransactionStatus } from '@prisma/client';
import {
  PlaidApi,
  Configuration,
  PlaidEnvironments,
  Products,
  CountryCode,
  LinkTokenCreateRequest,
} from 'plaid';
import { PrismaService } from '../prisma/prisma.service';
import { PlaidConfig, getMissingPlaidEnvKeys } from './plaid.config';
import { decrypt, encrypt, deserializePayload, serializePayload } from '../common/crypto/crypto.util';
import { AccountType } from '@prisma/client';

const PLAID_ACCOUNT_TYPE_MAP: Record<string, AccountType> = {
  depository: AccountType.CHECKING,
  credit: AccountType.CREDIT,
  loan: AccountType.CREDIT,
  other: AccountType.DEBIT,
};

function toAccountType(subtype: string | undefined): AccountType {
  if (!subtype) return AccountType.CHECKING;
  const lower = subtype.toLowerCase();
  if (lower.includes('credit')) return AccountType.CREDIT;
  if (lower.includes('debit')) return AccountType.DEBIT;
  return PLAID_ACCOUNT_TYPE_MAP[lower] ?? AccountType.CHECKING;
}

function toSafePlaidError(err: unknown): never {
  const ax = err as { response?: { data?: { error_message?: string; error_code?: string } } };
  const msg = ax?.response?.data?.error_message ?? (err instanceof Error ? err.message : 'Plaid request failed');
  throw new BadRequestException({ code: 'PLAID_ERROR', message: msg });
}

@Injectable()
export class PlaidService {
  private readonly logger = new Logger(PlaidService.name);
  private readonly plaidClient: PlaidApi | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly plaidConfig: PlaidConfig,
  ) {
    const clientId = config.get<string>('PLAID_CLIENT_ID');
    const secret = config.get<string>('PLAID_SECRET');
    const encryptionKeyRaw = config.get<string>('APP_ENCRYPTION_KEY');
    const hasEncryptionKey =
      encryptionKeyRaw &&
      (() => {
        try {
          return Buffer.from(encryptionKeyRaw, 'base64').length === 32;
        } catch {
          return false;
        }
      })();
    if (clientId && secret && hasEncryptionKey) {
      const configuration = new Configuration({
        basePath: this.getBasePath(plaidConfig.env),
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': plaidConfig.clientId,
            'PLAID-SECRET': plaidConfig.secret,
          },
        },
      });
      this.plaidClient = new PlaidApi(configuration);
    }
  }

  private throwPlaidNotConfigured(): never {
    const get = (key: string) => this.config.get<string>(key);
    const missing = getMissingPlaidEnvKeys(get);
    const message =
      missing.length > 0
        ? `Plaid is not configured. Set these in apps/api/.env: ${missing.join(', ')}. See README for Plaid Sandbox.`
        : 'Plaid is not configured (APP_ENCRYPTION_KEY must be 32 bytes base64). Set required keys in apps/api/.env.';
    throw new BadRequestException({ code: 'PLAID_NOT_CONFIGURED', message });
  }

  private getBasePath(env: string): string {
    switch (env) {
      case 'production':
        return PlaidEnvironments.production;
      case 'development':
        return PlaidEnvironments.development;
      default:
        return PlaidEnvironments.sandbox;
    }
  }

  getOAuthContinueUri(): string | undefined {
    return this.plaidConfig.oauthContinueUri;
  }

  async createLinkToken(userId: string): Promise<{ link_token: string }> {
    if (!this.plaidClient) this.throwPlaidNotConfigured();
    this.logger.log({ userId, msg: 'Creating link token' });
    try {
      const request: LinkTokenCreateRequest = {
        client_name: 'Fundimo',
        language: 'en',
        country_codes: [CountryCode.Us],
        user: { client_user_id: userId },
        products: [Products.Transactions],
      };
      const redirectUri = this.plaidConfig.redirectUri;
      if (redirectUri) request.redirect_uri = redirectUri;
      const response = await this.plaidClient.linkTokenCreate(request);
      const linkToken = response.data.link_token;
      if (!linkToken) throw new Error('Plaid did not return a link_token');
      return { link_token: linkToken };
    } catch (e) {
      toSafePlaidError(e);
    }
  }

  async exchangePublicToken(userId: string, publicToken: string): Promise<{ accounts: Array<{ id: string; provider: string; name: string; type: string; created_at: string }> }> {
    if (!this.plaidClient) this.throwPlaidNotConfigured();
    this.logger.log({ userId, msg: 'Exchanging public token' });
    try {
      const exchangeResponse = await this.plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;
    if (!accessToken || !itemId) throw new Error('Plaid exchange did not return access_token or item_id');

    const key = this.plaidConfig.encryptionKey;
    const payload = encrypt(accessToken, key);
    const ciphertext = serializePayload(payload);

    const existingItem = await this.prisma.plaidItem.findUnique({
      where: { item_id: itemId },
      include: { accounts: true },
    });
    if (existingItem && existingItem.user_id !== userId) {
      throw new Error('This bank item is already linked to another user');
    }

    const accountsResponse = await this.plaidClient.accountsGet({ access_token: accessToken });
    const plaidAccounts = accountsResponse.data.accounts ?? [];

    await this.prisma.$transaction(async (tx) => {
      if (existingItem) {
        await tx.plaidItem.update({
          where: { id: existingItem.id },
          data: { access_token_ciphertext: ciphertext, updated_at: new Date() },
        });
        for (const acc of plaidAccounts) {
          const existing = existingItem.accounts.find((a) => a.plaid_account_id === acc.account_id);
          if (!existing) {
            await tx.connectedAccount.create({
              data: {
                user_id: userId,
                provider: Provider.PLAID,
                name: acc.name ?? acc.account_id,
                type: toAccountType(acc.subtype ?? acc.type),
                plaid_item_id: existingItem.id,
                plaid_account_id: acc.account_id,
              },
            });
          }
        }
      } else {
        const item = await tx.plaidItem.create({
          data: {
            user_id: userId,
            item_id: itemId,
            access_token_ciphertext: ciphertext,
          },
        });
        for (const acc of plaidAccounts) {
          await tx.connectedAccount.create({
            data: {
              user_id: userId,
              provider: Provider.PLAID,
              name: acc.name ?? acc.account_id,
              type: toAccountType(acc.subtype ?? acc.type),
              plaid_item_id: item.id,
              plaid_account_id: acc.account_id,
            },
          });
        }
      }
    });

    const accounts = await this.prisma.connectedAccount.findMany({
      where: { user_id: userId, provider: Provider.PLAID },
      orderBy: { name: 'asc' },
      select: { id: true, provider: true, name: true, type: true, created_at: true },
    });
    return {
      accounts: accounts.map((a) => ({
        id: a.id,
        provider: a.provider,
        name: a.name,
        type: a.type,
        created_at: a.created_at.toISOString(),
      })),
    };
    } catch (e) {
      toSafePlaidError(e);
    }
  }

  async syncTransactions(userId: string): Promise<{ added: number; modified: number; removed: number }> {
    if (!this.plaidClient) this.throwPlaidNotConfigured();
    try {
    const items = await this.prisma.plaidItem.findMany({
      where: { user_id: userId },
      include: { accounts: true },
    });
    if (items.length === 0) {
      return { added: 0, modified: 0, removed: 0 };
    }

    const key = this.plaidConfig.encryptionKey;
    let totalAdded = 0;
    let totalModified = 0;
    let totalRemoved = 0;
    const accountIdByPlaidId = new Map<string, string>();
    for (const item of items) {
      for (const acc of item.accounts) {
        if (acc.plaid_account_id) accountIdByPlaidId.set(acc.plaid_account_id, acc.id);
      }
    }

    for (const item of items) {
      const accessToken = decrypt(deserializePayload(item.access_token_ciphertext), key);
      let cursor = item.cursor ?? undefined;
      let hasMore = true;
      while (hasMore) {
        const response = await this.plaidClient.transactionsSync({
          access_token: accessToken,
          cursor: cursor,
        });
        const data = response.data;
        cursor = data.next_cursor ?? undefined;
        hasMore = data.has_more ?? false;

        for (const tx of data.added ?? []) {
          const accountId = tx.account_id ? accountIdByPlaidId.get(tx.account_id) : undefined;
          if (!accountId) continue;
          const existingTx = await this.prisma.transaction.findFirst({
            where: { user_id: userId, provider_transaction_id: tx.transaction_id ?? undefined },
          });
          if (existingTx) continue;
          const amountCents = this.plaidAmountToCents(tx.amount);
          const effectiveDate = this.plaidDateToDate(tx.authorized_date ?? tx.date);
          const postedAt = tx.pending ? null : (tx.date ? new Date(tx.date + 'T00:00:00Z') : null);
          const merchantName = (tx.merchant_name ?? tx.name ?? 'Unknown').trim().slice(0, 255);
          await this.prisma.transaction.create({
            data: {
              user_id: userId,
              account_id: accountId,
              amount_cents: amountCents,
              currency: tx.iso_currency_code ?? 'USD',
              effective_date: effectiveDate,
              posted_at: postedAt,
              merchant_name: merchantName,
              description: tx.name ?? null,
              status: tx.pending ? 'PENDING' : 'POSTED',
              provider: Provider.PLAID,
              provider_transaction_id: tx.transaction_id,
              provider_pending_id: tx.pending ? tx.transaction_id : null,
            },
          });
          totalAdded++;
        }

        for (const tx of data.modified ?? []) {
          const existing = await this.prisma.transaction.findFirst({
            where: { provider_transaction_id: tx.transaction_id, user_id: userId },
          });
          if (!existing) continue;
          const updates: { status?: TransactionStatus; posted_at?: Date | null; merchant_name?: string } = {};
          if (tx.pending !== undefined) {
            updates.status = tx.pending ? TransactionStatus.PENDING : TransactionStatus.POSTED;
            updates.posted_at = tx.pending ? null : (tx.date ? new Date(tx.date + 'T00:00:00Z') : existing.posted_at ?? null);
          }
          if (tx.merchant_name !== undefined || tx.name !== undefined) {
            updates.merchant_name = (tx.merchant_name ?? tx.name ?? existing.merchant_name).trim().slice(0, 255);
          }
          if (Object.keys(updates).length > 0) {
            await this.prisma.transaction.update({
              where: { id: existing.id },
              data: updates,
            });
            totalModified++;
          }
        }

        for (const rem of data.removed ?? []) {
          const txId = typeof rem === 'string' ? rem : (rem as { transaction_id?: string }).transaction_id ?? (rem as { id?: string }).id;
          if (!txId) continue;
          const deleted = await this.prisma.transaction.deleteMany({
            where: { user_id: userId, provider_transaction_id: txId },
          });
          totalRemoved += deleted.count;
        }

        await this.prisma.plaidItem.update({
          where: { id: item.id },
          data: { cursor: cursor ?? null, updated_at: new Date() },
        });
      }

      await this.prisma.connectedAccount.updateMany({
        where: { plaid_item_id: item.id },
        data: { last_sync_at: new Date() },
      });
    }

    if (totalAdded > 0 || totalModified > 0) {
      await this.applyRulesForUser(userId);
    }

      this.logger.log({ userId, added: totalAdded, modified: totalModified, removed: totalRemoved });
      return { added: totalAdded, modified: totalModified, removed: totalRemoved };
    } catch (e) {
      toSafePlaidError(e);
    }
  }

  private plaidAmountToCents(amount: number | null | undefined): number {
    if (amount == null) return 0;
    const cents = Math.round(amount * 100);
    return -cents;
  }

  private plaidDateToDate(dateStr: string | null | undefined): Date {
    if (!dateStr) return new Date();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return new Date(dateStr + 'T00:00:00Z');
    return new Date(dateStr);
  }

  private async applyRulesForUser(userId: string): Promise<void> {
    const rules = await this.prisma.rule.findMany({
      where: { user_id: userId, is_active: true },
      orderBy: { priority: 'asc' },
    });
    if (rules.length === 0) return;
    const uncategorized = await this.prisma.transaction.findMany({
      where: { user_id: userId, category_id: null },
      select: { id: true, merchant_name: true },
    });
    for (const t of uncategorized) {
      const merchant = (t.merchant_name ?? '').toUpperCase();
      const rule = rules.find(
        (r) => r.match_type === RuleMatchType.MERCHANT_CONTAINS && merchant.includes(r.match_value.toUpperCase()),
      );
      if (rule) {
        await this.prisma.transaction.update({
          where: { id: t.id },
          data: { category_id: rule.category_id },
        });
      }
    }
  }
}
