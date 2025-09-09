import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  MoralisTokenHoldersResponse,
  MoralisTokenAnalyticsResponse,
  MoralisTokenMetadataResponse,
} from './moralis.types';

/**
 * Response interface for token pair statistics from Moralis API
 */
interface TokenPairStatsResponse {
  totalLiquidityUsd: number;
  totalActivePairs: number;
  totalActiveDexes: number;
  totalBuyers: {
    '5min': number;
    '1h': number;
    '4h': number;
    '24h': number;
  };
  totalBuyVolume: {
    '5min': number;
    '1h': number;
    '4h': number;
    '24h': number;
  };
  totalSellers: {
    '5min': number;
    '1h': number;
    '4h': number;
    '24h': number;
  };
  totalSellVolume: {
    '5min': number;
    '1h': number;
    '4h': number;
    '24h': number;
  };
  totalSwaps: {
    '5min': number;
    '1h': number;
    '4h': number;
    '24h': number;
  };
  totalVolume: {
    '5min': number;
    '1h': number;
    '4h': number;
    '24h': number;
  };
}

/**
 * Service for interacting with Moralis API endpoints
 * Provides methods to fetch Solana token pair statistics, trading data, and holder information
 */
@Injectable()
export class MoralisApiService {
  private readonly solBaseUrl = 'https://solana-gateway.moralis.io';
  private readonly deepIndexUrl = 'https://deep-index.moralis.io/api/v2.2';
  private readonly apiKey: string;

  /**
   * Creates an instance of MoralisApiService
   * @param configService - NestJS ConfigService for accessing environment variables
   * @param httpService - NestJS HttpService for making HTTP requests
   * @throws Error if MORALIS_API_KEY is not configured
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    const key = this.configService.get<string>('MORALIS_API_KEY');
    if (!key) {
      throw new Error('MORALIS_API_KEY is not configured');
    }
    this.apiKey = key;
  }

  /**
   * Fetches token pair statistics from Moralis API
   * @param tokenAddress - The Solana token address to query
   * @returns Promise containing token pair statistics including liquidity, volume, and trading activity
   * @throws Error if the API request fails
   * @example
   * const stats = await moralisApiService.getTokenPairStats('6r6v8qC5GPwj1vYrgDzYCJei9ko3BYfd14j24atspump');
   * console.log(stats.totalLiquidityUsd); // 8767.668217442
   */
  async getTokenPairStats(
    tokenAddress: string,
  ): Promise<TokenPairStatsResponse> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<TokenPairStatsResponse>(
          `${this.solBaseUrl}/token/mainnet/${tokenAddress}/pairs/stats`,
          {
            headers: {
              accept: 'application/json',
              'X-API-Key': this.apiKey,
            },
          },
        ),
      );

      return data;
    } catch (error) {
      throw new Error(
        `Failed to get token pair stats from Moralis: ${error.message}`,
      );
    }
  }

  /**
   * Fetches token holder information from Moralis API
   * @param tokenAddress - The Solana token address to query
   * @returns Promise containing token holder statistics including distribution and changes
   * @throws Error if the API request fails
   * @example
   * const holders = await moralisApiService.getTokenHolders('DrYycgh9zji24sT39tpWWtKw99CFQFEV8M9Tx5scpump');
   * console.log(holders.totalHolders); // 3
   */
  async getTokenHolders(
    tokenAddress: string,
  ): Promise<MoralisTokenHoldersResponse> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<MoralisTokenHoldersResponse>(
          `${this.solBaseUrl}/token/mainnet/holders/${tokenAddress}`,
          {
            headers: {
              accept: 'application/json',
              'X-API-Key': this.apiKey,
            },
          },
        ),
      );

      return data;
    } catch (error) {
      throw new Error(
        `Failed to get token holders from Moralis: ${error.message}`,
      );
    }
  }

  /**
   * Fetches detailed token analytics from Moralis API
   * @param tokenAddress - The Solana token address to query
   * @returns Promise containing detailed token analytics including volume, buyers, sellers, and liquidity
   * @throws Error if the API request fails
   * @example
   * const analytics = await moralisApiService.getTokenAnalytics('DrYycgh9zji24sT39tpWWtKw99CFQFEV8M9Tx5scpump');
   * console.log(analytics.totalLiquidityUsd); // "10620.278514306"
   */
  async getTokenAnalytics(
    tokenAddress: string,
  ): Promise<MoralisTokenAnalyticsResponse> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<MoralisTokenAnalyticsResponse>(
          `${this.deepIndexUrl}/tokens/${tokenAddress}/analytics`,
          {
            params: {
              chain: 'solana',
            },
            headers: {
              accept: 'application/json',
              'X-API-Key': this.apiKey,
            },
          },
        ),
      );

      return data;
    } catch (error) {
      throw new Error(
        `Failed to get token analytics from Moralis: ${error.message}`,
      );
    }
  }

  /**
   * Fetches token metadata from Moralis API
   * @param tokenAddress - The Solana token address to query
   * @returns Promise containing token metadata including name, symbol, logo, description, and social links
   * @throws Error if the API request fails
   * @example
   * const metadata = await moralisApiService.getTokenMetadata('DPK6kar7f76W9Xoqn9HMDqAWf4H9bJ3Cgopj8HkRpump');
   * console.log(metadata.name); // "Clark's Controversy"
   */
  async getTokenMetadata(
    tokenAddress: string,
  ): Promise<MoralisTokenMetadataResponse> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<MoralisTokenMetadataResponse>(
          `${this.solBaseUrl}/token/mainnet/${tokenAddress}/metadata`,
          {
            headers: {
              accept: 'application/json',
              'X-API-Key': this.apiKey,
            },
          },
        ),
      );

      return data;
    } catch (error) {
      throw new Error(
        `Failed to get token metadata from Moralis: ${error.message}`,
      );
    }
  }
}
