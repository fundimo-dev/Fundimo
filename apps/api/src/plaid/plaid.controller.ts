import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { User } from '../common/decorators/user.decorator';
import { JwtPayload } from '../common/types/request-with-user';
import { JwtAuthGuard } from '../auth/auth.guard';
import { PlaidService } from './plaid.service';
import { ExchangePublicTokenDto } from './dto/exchange-public-token.dto';

@Controller('plaid') // sets the base route for all Plaid endpoints
export class PlaidController {
  constructor(private readonly plaidService: PlaidService) {} // injects the PlaidService into the controller

  @UseGuards(JwtAuthGuard)
  @Post('link-token')
  async createLinkToken(@User() user: JwtPayload): Promise<{ link_token: string }> {
    return this.plaidService.createLinkToken(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('exchange')
  async exchange(@User() user: JwtPayload, @Body() dto: ExchangePublicTokenDto) {
    return this.plaidService.exchangePublicToken(user.sub, dto.public_token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sync')
  async sync(@User() user: JwtPayload): Promise<{ added: number; modified: number; removed: number }> {
    return this.plaidService.syncTransactions(user.sub);
  }

  @Get('oauth-redirect')
  oauthRedirect(
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const continueUri = this.plaidService.getOAuthContinueUri();
    if (!continueUri) {
      return res.status(200).json({
        ok: true,
        message:
          'OAuth callback received. Set PLAID_OAUTH_CONTINUE_URI to automatically redirect back to the iOS app.',
      });
    }

    const url = new URL(continueUri);
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'string') url.searchParams.set(key, value);
    }
    return res.redirect(url.toString());
  }
}
