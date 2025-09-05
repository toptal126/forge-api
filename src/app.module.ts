import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { Web3Module } from './modules/web3/web3.module';
import { AdminModule } from './modules/admin/admin.module';
import { UserModule } from './modules/user/user.module';
import { NewsModule } from './modules/news/news.module';
import { CronModule } from './modules/cron/cron.module';
import { BundlerModule } from './modules/bundler/bundler.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    ChatModule,
    Web3Module,
    AdminModule,
    UserModule,
    NewsModule,
    CronModule,
    BundlerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
