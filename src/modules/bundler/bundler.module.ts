import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { BundlerController } from './bundler.controller';
import { BundlerService } from './bundler.service';
import { NewsModule } from '../news/news.module';

@Module({
  imports: [HttpModule, ConfigModule, NewsModule],
  controllers: [BundlerController],
  providers: [BundlerService],
  exports: [BundlerService],
})
export class BundlerModule {}
