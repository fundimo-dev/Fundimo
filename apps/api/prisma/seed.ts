import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AccountType, Provider } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@fundimo.local';
const DEMO_PASSWORD = 'Password123!';

/** Default categories for mobile contract (idempotent upsert by name). */
const DEFAULT_CATEGORIES = [
  { name: 'Groceries', group: 'Essentials' },
  { name: 'Gas', group: 'Essentials' },
  { name: 'Rent', group: 'Essentials' },
  { name: 'Utilities', group: 'Essentials' },
  { name: 'Dining', group: 'Discretionary' },
  { name: 'Entertainment', group: 'Discretionary' },
  { name: 'Shopping', group: 'Discretionary' },
  { name: 'Fees', group: 'Financial' },
  { name: 'Interest', group: 'Financial' },
  { name: 'Transfer', group: 'Other' },
  { name: 'Uncategorized', group: 'Other' },
];

function seededRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
}

async function main() {
  const now = new Date();
  for (const { name, group } of DEFAULT_CATEGORIES) {
    const existing = await prisma.category.findFirst({ where: { name } });
    if (!existing) {
      await prisma.category.create({ data: { name, group } });
    }
  }
  const categories = await prisma.category.findMany();
  const groceries = categories.find((c) => c.name === 'Groceries')!;
  const dining = categories.find((c) => c.name === 'Dining')!;
  const rent = categories.find((c) => c.name === 'Rent')!;
  const transfer = categories.find((c) => c.name === 'Transfer')!;
  const uncategorized = categories.find((c) => c.name === 'Uncategorized')!;
  const utilities = categories.find((c) => c.name === 'Utilities')!;

  const password_hash = await argon2.hash(DEMO_PASSWORD);
  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: DEMO_EMAIL,
        password_hash,
        include_pending_in_budget: true,
        notify_on_pending: true,
      },
    });
    console.log('Created demo user:', DEMO_EMAIL);
  } else {
    await prisma.user.update({
      where: { email: DEMO_EMAIL },
      data: { password_hash },
    });
    console.log('Demo user exists; password hash updated.');
  }

  const seedAccounts = [
    { provider: Provider.CHASE, name: 'Chase Checking', type: AccountType.CHECKING },
    { provider: Provider.SOFI, name: 'SoFi Money', type: AccountType.CHECKING },
    { provider: Provider.DISCOVER, name: 'Discover It', type: AccountType.CREDIT },
  ];
  const accounts: { id: string; provider: Provider; name: string; type: AccountType }[] = [];
  for (const a of seedAccounts) {
    let acc = await prisma.connectedAccount.findFirst({
      where: { user_id: user.id, provider: a.provider, name: a.name },
    });
    if (!acc) {
      acc = await prisma.connectedAccount.create({
        data: { user_id: user.id, provider: a.provider, name: a.name, type: a.type },
      });
      console.log('Created account:', a.name);
    }
    accounts.push(acc);
  }
  if (accounts.length === 3) console.log('3 demo accounts ready.');

  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  await prisma.transaction.deleteMany({
    where: {
      user_id: user.id,
      effective_date: { gte: ninetyDaysAgo },
      provider_transaction_id: { startsWith: 'SEED_' },
    },
  });
  const existingSeedCount = await prisma.transaction.count({
    where: { user_id: user.id, provider_transaction_id: { startsWith: 'SEED_' } },
  });
  if (existingSeedCount === 0) {
    const rng = seededRandom(42);
    const merchants = [
      "Trader Joe's",
      'Whole Foods',
      'Shell',
      'Netflix',
      'Amazon',
      'Target',
      'Uber',
      'Starbucks',
      'Electric Co',
      'Rent Payment',
      'Payroll Deposit',
      'Venmo',
      'Spotify',
    ];
    const gas = categories.find((c) => c.name === 'Gas')!;
    const entertainment = categories.find((c) => c.name === 'Entertainment')!;
    const shopping = categories.find((c) => c.name === 'Shopping')!;
    const fees = categories.find((c) => c.name === 'Fees')!;
    let inserted = 0;
    for (let i = 0; i < 90; i++) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);
      const isRecentWeek = i <= 7;
      for (const account of accounts) {
        const n = 1 + Math.floor(rng() * 2);
        for (let j = 0; j < n; j++) {
          const merchant = merchants[Math.floor(rng() * merchants.length)];
          const amount = Math.floor(rng() * 20000) + 500;
          const isIncome = merchant === 'Payroll Deposit';
          const signed = isIncome ? amount : -amount;
          const effective = new Date(day);
          effective.setHours(8 + Math.floor(rng() * 10), Math.floor(rng() * 60), 0, 0);
          const isPending = isRecentWeek && rng() < 0.35;
          const isTransfer = merchant === 'Venmo' && rng() < 0.5;
          const category =
            merchant === 'Whole Foods' || merchant === "Trader Joe's"
              ? groceries
              : merchant === 'Starbucks'
                ? dining
                : merchant === 'Shell'
                  ? gas
                  : merchant === 'Electric Co' || merchant === 'Rent Payment'
                    ? rent
                    : merchant === 'Netflix' || merchant === 'Spotify'
                      ? entertainment
                      : merchant === 'Amazon' || merchant === 'Target'
                        ? shopping
                        : merchant === 'Payroll Deposit'
                          ? transfer
                          : rng() < 0.15
                            ? undefined
                            : uncategorized;

          await prisma.transaction.create({
            data: {
              user_id: user.id,
              account_id: account.id,
              amount_cents: signed,
              currency: 'USD',
              effective_date: effective,
              posted_at: isPending ? null : effective,
              merchant_name: merchant,
              description: `${merchant}`,
              status: isPending ? 'PENDING' : 'POSTED',
              category_id: category?.id ?? null,
              is_excluded: isTransfer,
              provider: account.provider,
              provider_transaction_id: `SEED_${account.id}_${i}_${j}`,
            },
          });
          inserted++;
        }
      }
    }
    console.log('Created', inserted, 'seed transactions (90 days).');
  }

  const currentMonth = now.toISOString().slice(0, 7);
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
  const budgetCategories = [groceries, dining, rent, utilities, uncategorized];
  const limits = [60000, 30000, 180000, 30000, 40000];
  for (const month of [prevMonth, currentMonth]) {
    for (let k = 0; k < budgetCategories.length; k++) {
      await prisma.budget.upsert({
        where: {
          user_id_category_id_month: {
            user_id: user.id,
            category_id: budgetCategories[k].id,
            month,
          },
        },
        create: {
          user_id: user.id,
          category_id: budgetCategories[k].id,
          month,
          limit_cents: limits[k],
        },
        update: {},
      });
    }
  }
  console.log('Created budgets for current and previous month.');

  const rulesCount = await prisma.rule.count({ where: { user_id: user.id } });
  if (rulesCount === 0) {
    await prisma.rule.createMany({
      data: [
        { user_id: user.id, match_type: 'MERCHANT_CONTAINS', match_value: 'UBER', category_id: uncategorized.id, priority: 1 },
        { user_id: user.id, match_type: 'MERCHANT_CONTAINS', match_value: 'STARBUCKS', category_id: dining.id, priority: 2 },
        { user_id: user.id, match_type: 'MERCHANT_CONTAINS', match_value: 'WHOLE', category_id: groceries.id, priority: 3 },
      ],
    });
    console.log('Created 3 rules.');
  }

  const notifCount = await prisma.notification.count({ where: { user_id: user.id } });
  if (notifCount === 0) {
    await prisma.notification.createMany({
      data: [
        { user_id: user.id, type: 'WELCOME', title: 'Welcome to Fundimo', body: 'Your demo data is ready.' },
        { user_id: user.id, type: 'INFO', title: 'Budgets created', body: 'Sample budgets are set for the last two months.' },
      ],
    });
    console.log('Created 2 notifications.');
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
