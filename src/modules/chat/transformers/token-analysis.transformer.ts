import {
  TokenAnalysisRawData,
  TokenAnalysisData,
  MarketDataTransformation,
} from '../types/token-analysis.types';
import { BondingStatus } from '../../web3/third-party-api/pumpfun.api.service';
import {
  SolscanTokenInfoResponse,
  SolanaFMTokenInfoResponse,
} from '../../web3/interfaces/web3.interface';
import { MoralisTokenMetadataResponse } from '../../web3/third-party-api/moralis.types';

function getBondingProgress(bondingStatus?: BondingStatus): number | undefined {
  if (!bondingStatus) return undefined;

  // If it's a graduated token, return 100%
  if (bondingStatus.graduatedAt) {
    return 100;
  }

  // If it's a progress-based status, return the progress
  return bondingStatus.progress;
}

function getTokenMetadata(
  moralisMetadata: MoralisTokenMetadataResponse | null,
  solscanInfo: SolscanTokenInfoResponse | null,
  solanaFmInfo: SolanaFMTokenInfoResponse | null,
): TokenAnalysisData['metadata'] {
  // At least one of them must be non-null due to the check in transformTokenData
  if (!moralisMetadata && !solscanInfo && !solanaFmInfo) {
    throw new Error('Token info is required for metadata');
  }

  // Prioritize Moralis metadata, fallback to Solscan, then SolanaFM
  const social = {
    twitter: moralisMetadata?.links?.twitter || solscanInfo?.metadata?.twitter,
    website: moralisMetadata?.links?.website || solscanInfo?.metadata?.website,
  };
  // Only include social if at least one link exists
  const socialLinks = social.twitter || social.website ? { social } : undefined;

  return {
    name:
      moralisMetadata?.name ||
      solscanInfo?.name ||
      solanaFmInfo?.tokenName ||
      '',
    symbol:
      moralisMetadata?.symbol ||
      solscanInfo?.symbol ||
      solanaFmInfo?.symbol ||
      '',
    decimals:
      parseInt(moralisMetadata?.decimals || '0') ||
      solscanInfo?.decimals ||
      solanaFmInfo?.decimals ||
      0,
    totalSupply: moralisMetadata?.totalSupply || solscanInfo?.supply || '0',
    creator: solscanInfo?.creator, // Moralis doesn't provide creator info
    description:
      moralisMetadata?.description || solscanInfo?.metadata?.description,
    logo: moralisMetadata?.logo || solscanInfo?.icon,
    tags: [], // TODO: Add tags if available
    verified:
      moralisMetadata?.isVerifiedContract ||
      solscanInfo?.mint_authority === null ||
      solanaFmInfo?.verified === 'true',
    ...socialLinks,
  };
}

export function transformTokenData(
  rawData: TokenAnalysisRawData,
): TokenAnalysisData {
  const {
    moralisTokenMetadata,
    solscanTokenInfo,
    solanaFmTokenInfo,
    tokenHolders,
    tokenAnalytics,
    tokenPairStats,
    bondingStatus,
  } = rawData;

  if (!moralisTokenMetadata && !solscanTokenInfo && !solanaFmTokenInfo) {
    throw new Error('Token info is required for analysis');
  }

  // Get volume from multiple sources for comparison
  const volume24h = {
    solscan: solscanTokenInfo?.volume_24h || 0,
    moralis:
      tokenAnalytics.totalBuyVolume['24h'] +
      tokenAnalytics.totalSellVolume['24h'],
    pairStats: tokenPairStats.totalVolume['24h'],
  };

  // At least one of them must be non-null due to the check above
  const address =
    moralisTokenMetadata?.mint ||
    solscanTokenInfo?.address ||
    (solanaFmTokenInfo?.address as string);

  const marketData: MarketDataTransformation = {
    price: solscanTokenInfo?.price || 0,
    priceChange24h: solscanTokenInfo?.price_change_24h || 0,
    highPrice24h: 0, // TODO: Get from price history
    lowPrice24h: 0, // TODO: Get from price history
    volume24h: Math.max(
      volume24h.solscan,
      volume24h.moralis,
      volume24h.pairStats,
    ), // Use highest volume
    buyVolume24h: tokenPairStats.totalBuyVolume['24h'],
    sellVolume24h: tokenPairStats.totalSellVolume['24h'],
    totalBuys24h:
      tokenAnalytics.totalBuys['24h'] || tokenPairStats.totalSwaps['24h'],
    totalSells24h:
      tokenAnalytics.totalSells['24h'] || tokenPairStats.totalSwaps['24h'],
    totalBuyers24h:
      tokenAnalytics.totalBuyers['24h'] || tokenPairStats.totalBuyers['24h'],
    totalSellers24h:
      tokenAnalytics.totalSellers['24h'] || tokenPairStats.totalSellers['24h'],
    liquidityUSD: tokenPairStats.totalLiquidityUsd,
    fullyDilutedValuation:
      parseFloat(moralisTokenMetadata?.fullyDilutedValue || '0') ||
      solscanTokenInfo?.market_cap ||
      0,
    bondingProgress: getBondingProgress(bondingStatus),
    dexInfo: {
      activePairs: tokenPairStats.totalActivePairs,
      activeDexes: tokenPairStats.totalActiveDexes,
    },
    volumeSources: {
      solscan: volume24h.solscan,
      moralis: volume24h.moralis,
      pairStats: volume24h.pairStats,
    },
  };

  // Only include market cap rank if it exists
  if (solscanTokenInfo?.market_cap_rank) {
    marketData.marketCapRank = solscanTokenInfo.market_cap_rank;
  }

  return {
    address,
    metadata: getTokenMetadata(
      moralisTokenMetadata,
      solscanTokenInfo,
      solanaFmTokenInfo,
    ),
    marketData,
    onChainMetrics: {
      holders: {
        total: tokenHolders.totalHolders || 0,
        top10Percentage: parseFloat(
          tokenHolders.holderSupply?.top10?.supplyPercent?.toString() || '0',
        ),
        top50Percentage: parseFloat(
          tokenHolders.holderSupply?.top50?.supplyPercent?.toString() || '0',
        ),
        distribution: {
          whales: tokenHolders.holderDistribution?.whales || 0,
          sharks: tokenHolders.holderDistribution?.sharks || 0,
          dolphins: tokenHolders.holderDistribution?.dolphins || 0,
          fish: tokenHolders.holderDistribution?.fish || 0,
          octopus: tokenHolders.holderDistribution?.octopus || 0,
          crabs: tokenHolders.holderDistribution?.crabs || 0,
          shrimps: tokenHolders.holderDistribution?.shrimps || 0,
        },
        acquisition: {
          swap: tokenHolders.holdersByAcquisition?.swap || 0,
          transfer: tokenHolders.holdersByAcquisition?.transfer || 0,
          airdrop: tokenHolders.holdersByAcquisition?.airdrop || 0,
        },
        change: {
          '5min': tokenHolders.holderChange?.['5m'] || {
            change: 0,
            changePercent: 0,
          },
          '1h': tokenHolders.holderChange?.['1h'] || {
            change: 0,
            changePercent: 0,
          },
          '6h': tokenHolders.holderChange?.['6h'] || {
            change: 0,
            changePercent: 0,
          },
          '24h': tokenHolders.holderChange?.['24h'] || {
            change: 0,
            changePercent: 0,
          },
        },
      },
      activity: {
        transactions24h: tokenPairStats.totalSwaps['24h'],
        largeTransactions24h: 0, // TODO: Define and calculate large transactions
        newHolders24h: tokenHolders.holderChange?.['24h']?.change || 0,
        priceCandles: [], // TODO: Get from PumpFun API
      },
    },
    security: {
      verifiedCreator:
        moralisTokenMetadata?.isVerifiedContract ||
        solscanTokenInfo?.mint_authority === null ||
        solanaFmTokenInfo?.verified === 'true',
      contractVerified: moralisTokenMetadata?.isVerifiedContract || true, // Assuming verified if we can get data
      warnings: moralisTokenMetadata?.possibleSpam
        ? ['Possible spam token']
        : [], // TODO: Add more security checks
    },
  };
}
