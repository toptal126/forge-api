import { TokenAnalysisPrompt } from '../templates/solana-spl-analytics.template';
import {
  SolanaFMTokenInfoResponse,
  SolscanTokenInfoResponse,
} from '@modules/web3/interfaces/web3.interface';
import {
  MoralisTokenHoldersResponse,
  MoralisTokenAnalyticsResponse,
  MoralisTokenMetadataResponse,
} from '@modules/web3/third-party-api/moralis.types';
import { BondingStatus } from '@modules/web3/third-party-api/pumpfun.api.service';

export interface TokenPairStatsResponse {
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

// Type for raw API data that will be transformed into TokenAnalysisPrompt
export interface TokenAnalysisRawData {
  solanaFmTokenInfo: SolanaFMTokenInfoResponse | null;
  solscanTokenInfo: SolscanTokenInfoResponse | null;
  moralisTokenMetadata: MoralisTokenMetadataResponse | null;
  tokenHolders: MoralisTokenHoldersResponse;
  tokenAnalytics: MoralisTokenAnalyticsResponse;
  tokenPairStats: TokenPairStatsResponse;
  bondingStatus?: BondingStatus;
}

// Type for the transformed token data
export type TokenAnalysisData = TokenAnalysisPrompt['tokenData'];

// Helper type for market data transformation
export interface MarketDataTransformation {
  price: number;
  priceChange24h: number;
  highPrice24h: number;
  lowPrice24h: number;
  volume24h: number;
  buyVolume24h: number;
  sellVolume24h: number;
  totalBuys24h: number;
  totalSells24h: number;
  totalBuyers24h: number;
  totalSellers24h: number;
  liquidityUSD: number;
  fullyDilutedValuation: number;
  marketCapRank?: number;
  bondingProgress?: number;
  dexInfo: {
    activePairs: number;
    activeDexes: number;
  };
  volumeSources: {
    solscan: number;
    moralis: number;
    pairStats: number;
  };
}

// Helper type for holder metrics transformation
export interface HolderMetricsTransformation {
  total: number;
  top10Percentage: number;
  top50Percentage: number;
  distribution: {
    whales: number;
    sharks: number;
    dolphins: number;
    fish: number;
    octopus: number;
    crabs: number;
    shrimps: number;
  };
  acquisition: {
    swap: number;
    transfer: number;
    airdrop: number;
  };
  change: {
    '5min': { change: number; changePercent: number };
    '1h': { change: number; changePercent: number };
    '6h': { change: number; changePercent: number };
    '24h': { change: number; changePercent: number };
  };
}

// Helper type for activity metrics transformation
export interface ActivityMetricsTransformation {
  transactions24h: number;
  largeTransactions24h: number;
  newHolders24h: number;
  priceCandles: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

// Helper type for security metrics transformation
export interface SecurityMetricsTransformation {
  verifiedCreator: boolean;
  contractVerified: boolean;
  warnings?: string[];
}

// Type for the transformation function
export type TransformTokenData = (
  rawData: TokenAnalysisRawData,
) => TokenAnalysisData;
