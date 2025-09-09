import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import {
  Network,
  NetworkType,
  TokenHolderOptions,
  TokenHoldersResponse,
  TokenPriceResponse,
  TokenVolumeResponse,
} from '../interfaces/web3.interface';
import { Network as AlchemyNetwork } from 'alchemy-sdk';
import { AlchemyApiService } from '../third-party-api/alchemy.api.service';
import { SolscanApiService } from '../third-party-api/solscan.api.service';
import { PumpFunApiService } from '../third-party-api/pumpfun.api.service';
import { PublicKey } from '@solana/web3.js';

@Injectable()
export class SolanaService {
  private readonly SOLANA_RPC_URL = process.env.SOLANA_RPC_URL!;

  constructor(
    private alchemyApiService: AlchemyApiService,
    private solscanApiService: SolscanApiService,
    private pumpFunApiService: PumpFunApiService,
  ) {}

  /**
   * Get token price with fallback logic
   * @param token The token symbol or address
   * @param network The network name
   */
  async getTokenPrice(
    token: string,
    network: AlchemyNetwork,
  ): Promise<TokenPriceResponse> {
    try {
      if (network !== AlchemyNetwork.SOLANA_MAINNET) {
        throw new Error(`Unsupported network for Solana service: ${network}`);
      }

      // Check if it's a pump.fun token
      // if (token.toLowerCase().endsWith('pump')) {
      try {
        const price = await this.pumpFunApiService.getLatestTokenPrice(token);
        return {
          price,
          currency: 'USD',
          timestamp: Date.now(),
        };
      } catch (error) {
        console.log(`Pump.fun token error: ${error.message}`);
      }
      // }

      // Try Alchemy API first
      try {
        const prices = await this.alchemyApiService.getTokenPricesByAddresses([
          { network, address: token },
        ]);
        console.log(prices);

        if (prices[token] && prices[token] > 0) {
          return {
            price: prices[token],
            currency: 'USD',
            timestamp: Date.now(),
          };
        }
      } catch (error) {
        console.log('Alchemy API failed, trying Solscan...');
      }

      // Fallback to Solscan API
      const price = await this.solscanApiService.getTokenPrice(token);
      return {
        price,
        currency: 'USD',
        timestamp: Date.now(),
      };
    } catch (error) {
      console.log(error);
      throw new HttpException(
        `Failed to fetch token price: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get Solana token market data
   * @param tokenId The token address
   */
  async getTokenMarketData(tokenId: string): Promise<any> {
    try {
      if (tokenId.toLowerCase().endsWith('pump')) {
        return this.pumpFunApiService.get24hPriceStats(tokenId);
      }

      // For non-pump tokens, implement market data fetching from Solscan
      const price = await this.solscanApiService.getTokenPrice(tokenId);
      return {
        current_price: price,
        // Add other market data fields as needed
      };
    } catch (error) {
      throw new HttpException(
        `Failed to fetch token market data: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get token trading volume data
   * @param token The token symbol or address
   * @param network The network name
   */
  async getTokenVolume(
    token: string,
    network: Network,
  ): Promise<TokenVolumeResponse> {
    try {
      if (network.type !== NetworkType.SOLANA) {
        throw new Error(`Unsupported network for Solana service: ${network}`);
      }

      // if (token.toLowerCase().endsWith('pump')) {
      const stats = await this.pumpFunApiService.get24hPriceStats(token);
      return {
        volume24h: stats.volume24h,
        currency: 'USD',
        timestamp: Date.now(),
      };
      // }

      // For non-pump tokens, implement volume fetching from Solscan
      // TODO: Implement volume fetching from Solscan
      // throw new Error('Volume fetching not implemented for non-pump tokens');
    } catch (error) {
      throw new HttpException(
        `Failed to fetch token volume data: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get Solana account information
   * @param address The Solana account address
   */
  async getAccountInfo(address: string): Promise<any> {
    try {
      const response = await axios.post(this.SOLANA_RPC_URL, {
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [address, { encoding: 'jsonParsed' }],
      });

      if (response.data.error) {
        throw new HttpException(
          `RPC Error: ${response.data.error.message}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      return response.data.result;
    } catch (error) {
      throw new HttpException(
        `Failed to fetch account info: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get Solana transaction details
   * @param signature The transaction signature
   */
  async getTransaction(signature: string): Promise<any> {
    try {
      const response = await axios.post(this.SOLANA_RPC_URL, {
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [signature, { encoding: 'jsonParsed' }],
      });

      if (response.data.error) {
        throw new HttpException(
          `RPC Error: ${response.data.error.message}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      return response.data.result;
    } catch (error) {
      throw new HttpException(
        `Failed to fetch transaction: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get token holders using Solana RPC
   * @param token The token mint address
   * @param network The network object
   * @param options Optional parameters to filter holders
   */
  async getTokenHolders(
    token: string,
    network: Network,
    options: TokenHolderOptions = {},
  ): Promise<TokenHoldersResponse> {
    try {
      if (network.type !== NetworkType.SOLANA) {
        throw new Error(`Unsupported network for Solana service: ${network}`);
      }

      const { maxHolders = 1000, minAmount = 0 } = options;
      let page = 1;
      const allHolders = new Map<string, number>();

      while (true) {
        const response = await axios.post(this.SOLANA_RPC_URL, {
          jsonrpc: '2.0',
          id: 'helius-test',
          method: 'getTokenAccounts',
          params: {
            page,
            limit: 1000,
            displayOptions: {},
            mint: token,
          },
        });

        if (response.data.error) {
          throw new HttpException(
            `RPC Error: ${response.data.error.message}`,
            HttpStatus.BAD_REQUEST,
          );
        }

        const accounts = response.data.result?.token_accounts || [];
        if (accounts.length === 0) {
          break;
        }

        // Process accounts and aggregate balances by owner
        accounts.forEach((account: any) => {
          const amount = Number(account.amount);
          if (amount >= minAmount) {
            const currentBalance = allHolders.get(account.owner) || 0;
            allHolders.set(account.owner, currentBalance + amount);
          }
        });

        // Check if we've reached the desired number of holders
        if (allHolders.size >= maxHolders) {
          break;
        }

        page++;
      }

      // Convert to array and sort by balance
      const holders = Array.from(allHolders.entries())
        .map(([address, balance]) => ({
          address,
          balance,
          percentage: 0, // Will be calculated after sorting
        }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, maxHolders);

      // Calculate percentages based on total supply
      const totalSupply = holders.reduce((sum, h) => sum + h.balance, 0);
      holders.forEach((holder) => {
        holder.percentage = (holder.balance / totalSupply) * 100;
      });

      return {
        holders,
        totalHolders: allHolders.size,
        timestamp: Date.now(),
      };
    } catch (error) {
      throw new HttpException(
        `Failed to fetch token holders: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  public checkValidSolanaAddress(address: string): boolean {
    try {
      const _ = new PublicKey(address);
      return true;
    } catch (error) {
      return false;
    }
  }
}
