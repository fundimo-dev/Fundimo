import * as path from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { CategoriesModule } from './categories/categories.module';
import { SettingsModule } from './settings/settings.module';
import { AccountsModule } from './accounts/accounts.module';
import { TransactionsModule } from './transactions/transactions.module';
import { BudgetsModule } from './budgets/budgets.module';
import { RulesModule } from './rules/rules.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SyncModule } from './sync/sync.module';
import { PlaidModule } from './plaid/plaid.module';

// Resolve .env from api app dir (works when run from repo root or from apps/api)
const envFilePath = path.join(__dirname, '..', '.env');

@Module({ // @Module decorator is used to define a NestJS module
  imports: [ // imports other modules to be used in the app
    ConfigModule.forRoot({ // provides a global configuration for the app
      isGlobal: true,
      envFilePath, // loads the .env file into the environment
    }),
    PrismaModule, // provides PrismaService for database access
    AuthModule, // provides authentication and authorization services
    CategoriesModule, // provides category management services
    SettingsModule, // provides settings management services
    AccountsModule, // provides account management services
    TransactionsModule, // provides transaction management services
    BudgetsModule, // provides budget management services
    RulesModule, // provides rule management services
    NotificationsModule,
    SyncModule, // provides sync management services
    PlaidModule,
  ], // provides Plaid integration services
})
export class AppModule {} // exports the AppModule to be used in the main.ts file

