import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const JWT_ISSUER = 'edu-platform-api';
const JWT_AUDIENCE = 'edu-platform';

@Global()
@Module({
  imports: [
    JwtModule.register({
      privateKey: env.JWT_PRIVATE_KEY_B64,
      publicKey: env.JWT_PUBLIC_KEY_B64,
      signOptions: {
        algorithm: 'ES256',
        expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
      // Pin the algorithm: rejects "alg: none" and HS/RS confusion attacks.
      verifyOptions: { algorithms: ['ES256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
