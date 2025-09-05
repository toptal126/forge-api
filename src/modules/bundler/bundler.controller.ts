import {
  Controller,
  Get,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { BundlerService } from './bundler.service';
import { MemecoinMetadata } from './interfaces/memecoin.interface';

@Controller('bundler')
export class BundlerController {
  constructor(private readonly bundlerService: BundlerService) {}

  @Get('memecoin')
  async generateMemecoinMetadata(
    @Query('keyword') keyword: string,
  ): Promise<MemecoinMetadata> {
    if (!keyword || keyword.trim().length === 0) {
      throw new HttpException(
        'Keyword parameter is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    return await this.bundlerService.generateMemecoinMetadata(keyword.trim());
  }
}
