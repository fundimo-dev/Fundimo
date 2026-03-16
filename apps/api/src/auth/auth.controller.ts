import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { User } from '../common/decorators/user.decorator';
import { JwtAuthGuard } from './auth.guard';
import { JwtPayload } from '../common/types/request-with-user';
import { AUTH_COOKIE_NAME } from './auth.constants';
import { AuthService, SafeUser } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function cookieOptions(clear = false) {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: isProduction,
    path: '/',
    ...(clear ? { maxAge: 0 } : { maxAge: SEVEN_DAYS_MS }),
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SafeUser> {
    const { user, token } = await this.authService.signup(dto);
    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
    return user;
  }
  
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SafeUser> {
    const { user, token } = await this.authService.login(dto);
    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
    return user;
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): { success: boolean } {
    res.clearCookie(AUTH_COOKIE_NAME, cookieOptions(true));
    return { success: true };
  }
}

@Controller()
export class MeController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@User() user: JwtPayload): Promise<SafeUser> {
    return this.authService.getMe(user.sub);
  }
}
