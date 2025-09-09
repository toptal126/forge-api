import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OpenAIService } from './openai.service';
import { IConversation } from './schemas/conversation.schema';
import { IMessage } from './schemas/message.schema';
import { Web3Service } from '../web3/web3.service';
import { MoralisApiService } from '../web3/third-party-api/moralis.api.service';
import { HeliusApiService } from '../web3/third-party-api/helius.api.service';
import { SolanaFMApiService } from '../web3/third-party-api/solanafm.api.service';
import { Network as AlchemyNetwork } from 'alchemy-sdk';
import { generateTokenAnalysisPrompt } from './templates/solana-spl-analytics.template';
import { transformTokenData } from './transformers/token-analysis.transformer';
import { TokenAnalysisRawData } from './types/token-analysis.types';
import { PumpFunApiService } from '../web3/third-party-api/pumpfun.api.service';
import { SolscanApiService } from '@modules/web3/third-party-api/solscan.api.service';
import { Types } from 'mongoose';
import * as solanaArticles from './templates/articles/solana-articles.json';
import { UserService } from '../user/user.service';
import { ConversationResponseDto } from './dto/conversation.dto';
import { CronService } from '../cron/cron.service';
import { Readable } from 'stream';

// Centralized prompts to avoid duplication
const TOKEN_ANALYST_PROMPT = `You are an expert Web3 financial analyst specializing in blockchain token analysis. Provide detailed, data-driven insights using market metrics, on-chain analytics, and security assessments. Format responses in professional markdown with clear sections and bullet points for key metrics. Include risk disclaimers and maintain objectivity in analysis.

Important: Even if a token shows poor fundamentals or bad reputation, experienced traders may still consider meme trading opportunities. Always mention that skilled traders can profit from volatility regardless of token quality, but emphasize the high-risk nature of such strategies.`;

// Performance timing utilities
class PerformanceTimer {
  private startTime: number;
  private checkpoints: Map<string, number> = new Map();

  constructor() {
    this.startTime = Date.now();
  }

  checkpoint(name: string): number {
    const now = Date.now();
    const duration = now - this.startTime;
    this.checkpoints.set(name, duration);
    return duration;
  }

  getDuration(): number {
    return Date.now() - this.startTime;
  }

  getCheckpoints(): Map<string, number> {
    return this.checkpoints;
  }

  logSummary(operation: string): void {
    const total = this.getDuration();
    console.log(
      `🎉 ${operation} completed in ${total}ms (${(total / 1000).toFixed(2)}s)`,
    );
    console.log(`📊 Performance breakdown:`);
    this.checkpoints.forEach((duration, name) => {
      console.log(`   - ${name}: ${duration}ms`);
    });
  }
}
interface TokenAnalysisDto {
  address: string;
  network?: AlchemyNetwork;
  conversationId?: string;
}

@Injectable()
export class ChatService {
  constructor(
    @InjectModel('Conversation')
    private conversationModel: Model<IConversation>,
    @InjectModel('Message') private messageModel: Model<IMessage>,
    private openaiService: OpenAIService,
    private readonly moralisApiService: MoralisApiService,
    private readonly heliusApiService: HeliusApiService,
    private readonly solanaFMApiService: SolanaFMApiService,
    private readonly pumpFunApiService: PumpFunApiService,
    private readonly solscanApiService: SolscanApiService,
    private readonly userService: UserService,
    private readonly cronService: CronService,
  ) {}

  async createOrUpdateEmptyConveration(
    walletAddress: string,
    title: string,
  ): Promise<ConversationResponseDto> {
    const user = await this.userService.getUserByWalletAddress(walletAddress);
    const conversation =
      await this.getOrCreateLatestConversation(walletAddress);
    if (conversation.messages.length === 0) {
      // update the title of the conversation
      const conversationId = (conversation.conversation as any)._id.toString();
      await this.conversationModel.findByIdAndUpdate(
        conversationId,
        { title },
        { new: true },
      );
      const updatedConversation =
        await this.conversationModel.findById(conversationId);
      if (!updatedConversation) {
        throw new NotFoundException('Conversation not found after update');
      }
      const leanConversation = updatedConversation.toObject();
      return {
        _id: leanConversation._id,
        title: leanConversation.title,
        user_id: leanConversation.user_id,
        createdAt: leanConversation.createdAt,
        updatedAt: leanConversation.updatedAt,
      };
    } else {
      // create a new conversation
      const newConversation = await this.conversationModel.create({
        user_id: user.id,
        title,
      });
      const leanConversation = newConversation.toObject();
      return {
        _id: leanConversation._id,
        title: leanConversation.title,
        user_id: leanConversation.user_id,
        createdAt: leanConversation.createdAt,
        updatedAt: leanConversation.updatedAt,
      };
    }
  }

  async getConversations(walletAddress: string): Promise<IConversation[]> {
    const user = await this.userService.getUserByWalletAddress(walletAddress);
    return this.conversationModel
      .find({ user_id: user.id })
      .sort({ createdAt: -1 })
      .lean();
  }

  async getConversation(
    conversationId: string,
    walletAddress: string,
  ): Promise<{ conversation: IConversation; messages: IMessage[] }> {
    // Fetch conversation, user, and messages in parallel
    const [conversation, user, messages] = await Promise.all([
      this.conversationModel.findById(conversationId),
      this.userService.getUserByWalletAddress(walletAddress),
      this.messageModel.find({ conversationId }).sort({ createdAt: 1 }).exec(),
    ]);

    if (!conversation) {
      throw new NotFoundException(
        `Conversation with ID ${conversationId} not found`,
      );
    }

    if (conversation.user_id.toString() !== user.id) {
      throw new UnauthorizedException(
        'You do not have access to this conversation',
      );
    }

    return { conversation: conversation.toObject(), messages };
  }

  async getOrCreateLatestConversation(
    walletAddress: string,
  ): Promise<{ conversation: IConversation; messages: IMessage[] }> {
    const user = await this.userService.getUserByWalletAddress(walletAddress);
    const conversations = await this.conversationModel
      .find({ user_id: user.id })
      .sort({ createdAt: -1 })
      .lean();

    if (conversations.length > 0) {
      const latestConversation = conversations[0];
      if (latestConversation.user_id.toString() !== user.id) {
        throw new UnauthorizedException(
          'You do not have access to this conversation',
        );
      }

      // Fetch messages in parallel with the conversation check
      const messages = await this.messageModel
        .find({ conversationId: latestConversation._id })
        .sort({ createdAt: 1 })
        .exec();
      return { conversation: latestConversation, messages };
    } else {
      // Create a new conversation if none exists
      const newConversation = await this.conversationModel.create({
        user_id: user.id,
        title: 'New Conversation',
      });
      return {
        conversation: newConversation.toObject(),
        messages: [],
      };
    }
  }

  async sendMessage(
    conversationId: string,
    content: string,
    walletAddress: string,
    tokenAddresses: string[] = [],
  ): Promise<IMessage> {
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const user = await this.userService.getUserByWalletAddress(walletAddress);
    if (conversation.user_id.toString() !== user.id) {
      throw new UnauthorizedException(
        'Not authorized to access this conversation',
      );
    }

    // Create user message
    await this.messageModel.create({
      conversationId,
      content,
      role: 'user',
      walletAddress,
    });

    // Get conversation history
    const messages = await this.messageModel
      .find({ conversationId })
      .sort({ createdAt: 1 })
      .lean();

    const marketStatusText = await this.cronService.extractMarketStatusText();
    let systemPrompt =
      'You are a helpful assistant that can answer questions and help with tasks related to web3, crypto, and blockchain. Keep answers brief and to the point.';
    systemPrompt += `\n\n${marketStatusText}`;

    // If token addresses are found, analyze only the first one
    if (tokenAddresses.length > 0) {
      const address = tokenAddresses[0];

      // Check if we already have analysis data for this token
      const existingAnalysis = conversation.tokenAnalysisData?.find(
        (data) => data.address === address,
      );

      let tokenData;
      if (existingAnalysis) {
        tokenData = existingAnalysis.data;
      } else {
        // Get token analysis data
        try {
          tokenData = await this.requestTokenAnalysis(
            { address, conversationId, network: AlchemyNetwork.SOLANA_MAINNET },
            walletAddress,
          );
        } catch (error) {
          // return error message
          //create new assistant message and store it
          const assistantMessage = await this.messageModel.create({
            _id: new Types.ObjectId(),
            conversationId: new Types.ObjectId(conversationId),
            content:
              'Invalid request, Check your contract address or try again later',
            role: 'assistant',
          });
          return assistantMessage;
        }

        // Store the analysis data in the conversation
        await this.conversationModel.findByIdAndUpdate(conversationId, {
          $push: {
            tokenAnalysisData: {
              address,
              data: tokenData,
              timestamp: new Date(),
            },
          },
        });
      }

      // Add token analysis to system prompt
      systemPrompt = `${TOKEN_ANALYST_PROMPT}
        ${marketStatusText}

      Token Analysis Data:
      Token Address: ${address}
      ${JSON.stringify(tokenData, null, 2)}`;
    }
    console.log(systemPrompt);
    // throw new Error('test');

    // Generate AI response
    const aiResponse = await this.openaiService.generateChatCompletion(
      messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      systemPrompt,
    );

    // Create AI message
    const aiMessage = await this.messageModel.create({
      conversationId: new Types.ObjectId(conversationId),
      content: aiResponse.content,
      role: 'assistant',
      walletAddress,
    });

    return aiMessage;
  }

  /**
   * Send a message with streaming response
   */
  async sendMessageStream(
    conversationId: string,
    content: string,
    walletAddress: string,
    tokenAddresses: string[] = [],
  ): Promise<Readable> {
    const timer = new PerformanceTimer();
    console.log(
      `🚀 Starting streaming message for conversation ${conversationId}`,
    );

    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const user = await this.userService.getUserByWalletAddress(walletAddress);
    if (conversation.user_id.toString() !== user.id) {
      throw new UnauthorizedException(
        'Not authorized to access this conversation',
      );
    }

    // Create a readable stream for progress updates
    const progressStream = new Readable({
      objectMode: true,
      read() {},
    });

    try {
      await this.messageModel.create({
        conversationId,
        content,
        role: 'user',
        walletAddress,
      });

      timer.checkpoint('User message saved');
      console.log(
        `✅ User message saved in ${timer.getCheckpoints().get('User message saved')}ms`,
      );

      const messages = await this.messageModel
        .find({ conversationId })
        .sort({ createdAt: 1 })
        .lean();

      const marketStatusText = await this.cronService.extractMarketStatusText();
      let systemPrompt =
        'You are a helpful assistant that can answer questions and help with tasks related to web3, crypto, and blockchain. Keep answers brief and to the point.';
      systemPrompt += `\n\n${marketStatusText}`;

      // If token addresses are found, analyze only the first one
      if (tokenAddresses.length > 0) {
        const address = tokenAddresses[0];

        // Check if we already have analysis data for this token
        const existingAnalysis = conversation.tokenAnalysisData?.find(
          (data) => data.address === address,
        );

        let tokenData;
        if (existingAnalysis) {
          tokenData = existingAnalysis.data;
        } else {
          // Get token analysis data
          try {
            tokenData = await this.requestTokenAnalysis(
              {
                address,
                conversationId,
                network: AlchemyNetwork.SOLANA_MAINNET,
              },
              walletAddress,
            );
          } catch (error) {
            progressStream.push({
              type: 'error',
              error:
                'Invalid request, Check your contract address or try again later',
              timestamp: new Date().toISOString(),
            });
            progressStream.push(null);
            return progressStream;
          }

          // Store the analysis data in the conversation
          await this.conversationModel.findByIdAndUpdate(conversationId, {
            $push: {
              tokenAnalysisData: {
                address,
                data: tokenData,
                timestamp: new Date(),
              },
            },
          });
        }

        // Add token analysis to system prompt
        systemPrompt = `${TOKEN_ANALYST_PROMPT}
        ${marketStatusText}

      Token Analysis Data:
      Token Address: ${address}
      ${JSON.stringify(tokenData, null, 2)}`;
      }

      timer.checkpoint('History fetched');
      console.log(
        `✅ History fetched in ${timer.getCheckpoints().get('History fetched')}ms`,
      );

      // Get the AI streaming response
      const aiStream = await this.openaiService.generateChatCompletionStream(
        messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        systemPrompt,
      );

      // Collect full response content
      let fullResponseContent = '';

      // Pipe AI stream chunks to progress stream
      aiStream.on('data', (chunk) => {
        progressStream.push(chunk);

        // Collect content chunks
        if (chunk.type === 'content' && chunk.content) {
          fullResponseContent += chunk.content;
        }
      });

      aiStream.on('end', async () => {
        try {
          // Create assistant message with full content
          await this.messageModel.create({
            conversationId: new Types.ObjectId(conversationId),
            content: fullResponseContent || 'No response generated',
            role: 'assistant',
            walletAddress,
          });

          timer.checkpoint('Response saved');
          console.log(
            `✅ Response saved in ${timer.getCheckpoints().get('Response saved')}ms`,
          );

          timer.logSummary('Streaming message');
          progressStream.push(null); // End the stream
        } catch (error) {
          console.error('Error saving response:', error);
          progressStream.push({
            type: 'error',
            error: `Failed to save response: ${error.message}`,
            timestamp: new Date().toISOString(),
          });
          progressStream.push(null);
        }
      });

      aiStream.on('error', (error) => {
        console.error('AI stream error:', error);
        progressStream.push({
          type: 'error',
          error: `AI generation failed: ${error.message}`,
          timestamp: new Date().toISOString(),
        });
        progressStream.push(null);
      });

      return progressStream;
    } catch (error) {
      console.log(
        `❌ Streaming message failed after ${timer.getDuration()}ms: ${error.message}`,
      );
      progressStream.push({
        type: 'error',
        error: `Failed to process message: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
      progressStream.push(null);
      return progressStream;
    }
  }

  async deleteConversation(
    conversationId: string,
    walletAddress: string,
  ): Promise<{ success: boolean; message: string }> {
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) {
      throw new NotFoundException(
        `Conversation with ID ${conversationId} not found`,
      );
    }

    const user = await this.userService.getUserByWalletAddress(walletAddress);
    if (conversation.user_id.toString() !== user.id) {
      throw new UnauthorizedException(
        'You do not have access to this conversation',
      );
    }

    const session = await this.conversationModel.startSession();
    try {
      await session.withTransaction(async () => {
        await this.messageModel.deleteMany({ conversationId }).session(session);
        await this.conversationModel
          .findByIdAndDelete(conversationId)
          .session(session);
      });
      return {
        success: true,
        message:
          'Conversation and all associated messages deleted successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to delete conversation',
      };
    } finally {
      session.endSession();
    }
  }

  /**
   * Analyzes token market data and provides insights
   * @param tokenAnalysisDto - Token address, network, and optional conversation ID
   * @returns Analysis results and insights
   * @throws Error if the token is not on Solana network
   */
  async requestTokenAnalysis(
    tokenAnalysisDto: TokenAnalysisDto,
    walletAddress: string,
  ) {
    const timer = new PerformanceTimer();
    console.log(`🚀 Starting token analysis for ${tokenAnalysisDto.address}`);

    const { address, network, conversationId } = tokenAnalysisDto;

    if (!conversationId) {
      throw new BadRequestException('Conversation ID is required');
    }

    if (!walletAddress) {
      throw new BadRequestException('Wallet address is required');
    }

    // Check if network is supported
    if (network !== AlchemyNetwork.SOLANA_MAINNET) {
      throw new Error('Only Solana mainnet is supported for token analysis');
    }

    try {
      // Fetch token data from various sources in parallel
      console.log('📡 Fetching token data from APIs...');

      const [
        solanaFmTokenInfo,
        solscanTokenInfo,
        moralisTokenMetadata,
        tokenHolders,
        tokenAnalytics,
        bondingStatus,
        tokenPairStats,
      ] = await Promise.all([
        this.solanaFMApiService.getTokenInfo(address).catch((err) => {
          console.log('❌ SolanaFM API failed:', err.message);
          return null;
        }),
        this.solscanApiService.getTokenInfo(address).catch((err) => {
          console.log('❌ Solscan API failed:', err.message);
          return null;
        }),
        this.moralisApiService.getTokenMetadata(address).catch((err) => {
          console.log('❌ Moralis Metadata API failed:', err.message);
          return null;
        }),
        this.moralisApiService.getTokenHolders(address).catch((err) => {
          console.log('❌ Moralis Holders API failed:', err.message);
          return null;
        }),
        this.moralisApiService.getTokenAnalytics(address).catch((err) => {
          console.log('❌ Moralis Analytics API failed:', err.message);
          return null;
        }),
        this.pumpFunApiService.getTokenBondingStatus(address).catch((err) => {
          console.log('❌ PumpFun API failed:', err.message);
          return undefined;
        }),
        this.moralisApiService.getTokenPairStats(address).catch((err) => {
          console.log('❌ Moralis Pair Stats API failed:', err.message);
          return null;
        }),
      ]);

      timer.checkpoint('API calls');
      console.log(
        `✅ API calls completed in ${timer.getCheckpoints().get('API calls')}ms`,
      );

      // Transform raw API data into the format expected by the prompt
      console.log('🔄 Transforming token data...');

      const rawData: TokenAnalysisRawData = {
        solanaFmTokenInfo: solanaFmTokenInfo,
        solscanTokenInfo: solscanTokenInfo,
        moralisTokenMetadata: moralisTokenMetadata,
        tokenHolders: tokenHolders || {
          totalHolders: 0,
          holdersByAcquisition: { swap: 0, transfer: 0, airdrop: 0 },
          holderChange: {},
          holderDistribution: {
            whales: 0,
            sharks: 0,
            dolphins: 0,
            fish: 0,
            octopus: 0,
            crabs: 0,
            shrimps: 0,
          },
          holderSupply: {},
        },
        tokenAnalytics: tokenAnalytics || {
          tokenAddress: address,
          totalBuyVolume: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
          totalSellVolume: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
          totalBuyers: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
          totalSellers: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
          totalBuys: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
          totalSells: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
          totalLiquidityUsd: '0',
          totalFullyDilutedValuation: '0',
        },
        bondingStatus,
        tokenPairStats: tokenPairStats || {
          totalLiquidityUsd: 0,
          totalActivePairs: 0,
          totalActiveDexes: 0,
          totalBuyers: { '5min': 0, '1h': 0, '4h': 0, '24h': 0 },
          totalBuyVolume: { '5min': 0, '1h': 0, '4h': 0, '24h': 0 },
          totalSellers: { '5min': 0, '1h': 0, '4h': 0, '24h': 0 },
          totalSellVolume: { '5min': 0, '1h': 0, '4h': 0, '24h': 0 },
          totalSwaps: { '5min': 0, '1h': 0, '4h': 0, '24h': 0 },
          totalVolume: { '5min': 0, '1h': 0, '4h': 0, '24h': 0 },
        },
      };

      if (!solanaFmTokenInfo && !solscanTokenInfo && !moralisTokenMetadata) {
        throw new Error('Invalid token address');
      }

      const tokenData = transformTokenData(rawData);
      timer.checkpoint('Data transformation');
      console.log(
        `✅ Token data transformation completed in ${timer.getCheckpoints().get('Data transformation')}ms`,
      );

      // Fetch chat history and generate AI response in parallel
      console.log('🤖 Generating AI response...');

      const [chatHistory, systemPrompt] = await Promise.all([
        // Get chat history if conversationId is provided
        conversationId
          ? this.messageModel
              .find({ conversationId: new Types.ObjectId(conversationId) })
              .sort({ createdAt: 1 })
              .exec()
          : Promise.resolve([]),
        // Generate system prompt for token analysis with news articles
        Promise.resolve(
          generateTokenAnalysisPrompt(tokenData, solanaArticles.articles),
        ),
      ]);

      timer.checkpoint('Prompt generation');
      console.log(
        `✅ Prompt generation completed in ${timer.getCheckpoints().get('Prompt generation')}ms`,
      );

      // Generate AI response
      const messages = [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...chatHistory.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      ];

      const response =
        await this.openaiService.generateTokenAnalystChatCompletion(messages);

      timer.checkpoint('AI response generation');
      console.log(
        `✅ AI response generated in ${timer.getCheckpoints().get('AI response generation')}ms`,
      );

      // Save messages to database in parallel
      console.log('💾 Saving messages to database...');

      const newConversationId =
        conversationId ?? new Types.ObjectId().toString();

      const [userMessage, responseMessage] = await Promise.all([
        // Add new message in user style requesting token analysis
        this.messageModel.create({
          conversationId: new Types.ObjectId(conversationId),
          role: 'user',
          content: `Analyze the token ${address} on the ${network} network`,
          walletAddress,
        }),
        // Create response message
        this.messageModel.create({
          conversationId: new Types.ObjectId(newConversationId),
          role: 'assistant',
          content: response.content ?? 'No response generated',
          walletAddress,
        }),
      ]);

      timer.checkpoint('Database operations');
      console.log(
        `✅ Database operations completed in ${timer.getCheckpoints().get('Database operations')}ms`,
      );

      timer.logSummary('Token analysis');

      return responseMessage;
    } catch (error) {
      console.log(
        `❌ Token analysis failed after ${timer.getDuration()}ms: ${error.message}`,
      );
      throw new Error(`Failed to analyze token: ${error.message}`);
    }
  }

  /**
   * Analyzes token market data and provides insights via streaming
   * @param tokenAnalysisDto - Token address, network, and optional conversation ID
   * @param walletAddress - User's wallet address
   * @returns Streaming response with progress updates and analysis
   * @throws Error if the token is not on Solana network
   */
  async requestTokenAnalysisStream(
    tokenAnalysisDto: TokenAnalysisDto,
    walletAddress: string,
  ): Promise<Readable> {
    const timer = new PerformanceTimer();
    console.log(
      `🚀 Starting streaming token analysis for ${tokenAnalysisDto.address}`,
    );

    const { address, network, conversationId } = tokenAnalysisDto;

    if (!conversationId) {
      throw new BadRequestException('Conversation ID is required');
    }

    if (!walletAddress) {
      throw new BadRequestException('Wallet address is required');
    }

    // Check if network is supported
    if (network !== AlchemyNetwork.SOLANA_MAINNET) {
      throw new Error('Only Solana mainnet is supported for token analysis');
    }

    // Create a readable stream for progress updates
    const progressStream = new Readable({
      objectMode: true,
      read() {},
    });

    try {
      const [
        solanaFmTokenInfo,
        solscanTokenInfo,
        moralisTokenMetadata,
        tokenHolders,
        tokenAnalytics,
        bondingStatus,
        tokenPairStats,
      ] = await Promise.all([
        this.solanaFMApiService.getTokenInfo(address).catch((err) => {
          console.log('❌ SolanaFM API failed:', err.message);
          return null;
        }),
        this.solscanApiService.getTokenInfo(address).catch((err) => {
          console.log('❌ Solscan API failed:', err.message);
          return null;
        }),
        this.moralisApiService.getTokenMetadata(address).catch((err) => {
          console.log('❌ Moralis Metadata API failed:', err.message);
          return null;
        }),
        this.moralisApiService.getTokenHolders(address).catch((err) => {
          console.log('❌ Moralis Holders API failed:', err.message);
          return null;
        }),
        this.moralisApiService.getTokenAnalytics(address).catch((err) => {
          console.log('❌ Moralis Analytics API failed:', err.message);
          return null;
        }),
        this.pumpFunApiService.getTokenBondingStatus(address).catch((err) => {
          console.log('❌ PumpFun API failed:', err.message);
          return undefined;
        }),
        this.moralisApiService.getTokenPairStats(address).catch((err) => {
          console.log('❌ Moralis Pair Stats API failed:', err.message);
          return null;
        }),
      ]);

      timer.checkpoint('API calls');
      console.log(
        `✅ API calls completed in ${timer.getCheckpoints().get('API calls')}ms`,
      );

      // Transform raw API data into the format expected by the prompt
      const rawData: TokenAnalysisRawData = {
        solanaFmTokenInfo: solanaFmTokenInfo,
        solscanTokenInfo: solscanTokenInfo,
        moralisTokenMetadata: moralisTokenMetadata,
        tokenHolders: tokenHolders || {
          totalHolders: 0,
          holdersByAcquisition: { swap: 0, transfer: 0, airdrop: 0 },
          holderChange: {},
          holderDistribution: {
            whales: 0,
            sharks: 0,
            dolphins: 0,
            fish: 0,
            octopus: 0,
            crabs: 0,
            shrimps: 0,
          },
          holderSupply: {},
        },
        tokenAnalytics: tokenAnalytics || {
          tokenAddress: address,
          totalBuyVolume: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
          totalSellVolume: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
          totalBuyers: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
          totalSellers: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
          totalBuys: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
          totalSells: { '5m': 0, '1h': 0, '6h': 0, '24h': 0 },
          totalLiquidityUsd: '0',
          totalFullyDilutedValuation: '0',
        },
        bondingStatus,
        tokenPairStats: tokenPairStats || {
          totalLiquidityUsd: 0,
          totalActivePairs: 0,
          totalActiveDexes: 0,
          totalBuyers: { '5min': 0, '1h': 0, '4h': 0, '24h': 0 },
          totalBuyVolume: { '5min': 0, '1h': 0, '4h': 0, '24h': 0 },
          totalSellers: { '5min': 0, '1h': 0, '4h': 0, '24h': 0 },
          totalSellVolume: { '5min': 0, '1h': 0, '4h': 0, '24h': 0 },
          totalSwaps: { '5min': 0, '1h': 0, '4h': 0, '24h': 0 },
          totalVolume: { '5min': 0, '1h': 0, '4h': 0, '24h': 0 },
        },
      };

      if (!solanaFmTokenInfo && !solscanTokenInfo && !moralisTokenMetadata) {
        throw new Error('Invalid token address');
      }

      const tokenData = transformTokenData(rawData);
      timer.checkpoint('Data transformation');
      console.log(
        `✅ Token data transformation completed in ${timer.getCheckpoints().get('Data transformation')}ms`,
      );

      // Fetch chat history and generate AI response in parallel
      const [chatHistory, systemPrompt] = await Promise.all([
        // Get chat history if conversationId is provided
        conversationId
          ? this.messageModel
              .find({ conversationId: new Types.ObjectId(conversationId) })
              .sort({ createdAt: 1 })
              .exec()
          : Promise.resolve([]),
        // Generate system prompt for token analysis with news articles
        Promise.resolve(
          generateTokenAnalysisPrompt(tokenData, solanaArticles.articles),
        ),
      ]);

      timer.checkpoint('Prompt generation');
      console.log(
        `✅ Prompt generation completed in ${timer.getCheckpoints().get('Prompt generation')}ms`,
      );

      // Generate AI response
      const messages = [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...chatHistory.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      ];

      // Get the AI streaming response
      const aiStream =
        await this.openaiService.generateTokenAnalystChatCompletionStream(
          messages,
        );

      // Collect full response content
      let fullResponseContent = '';

      // Pipe AI stream chunks to progress stream
      aiStream.on('data', (chunk) => {
        progressStream.push(chunk);

        // Collect content chunks
        if (chunk.type === 'content' && chunk.content) {
          fullResponseContent += chunk.content;
        }
      });

      aiStream.on('end', async () => {
        try {
          // Save messages to database in parallel
          const newConversationId =
            conversationId ?? new Types.ObjectId().toString();

          const [userMessage, responseMessage] = await Promise.all([
            // Add new message in user style requesting token analysis
            this.messageModel.create({
              conversationId: new Types.ObjectId(conversationId),
              role: 'user',
              content: `Analyze the token ${address} on the ${network} network`,
              walletAddress,
            }),
            // Create response message with full content
            this.messageModel.create({
              conversationId: new Types.ObjectId(newConversationId),
              role: 'assistant',
              content: fullResponseContent || 'No analysis generated',
              walletAddress,
            }),
          ]);

          timer.checkpoint('Database operations');
          console.log(
            `✅ Database operations completed in ${timer.getCheckpoints().get('Database operations')}ms`,
          );

          timer.logSummary('Streaming token analysis');
          progressStream.push(null); // End the stream
        } catch (error) {
          console.error('Error saving to database:', error);
          progressStream.push({
            type: 'error',
            error: `Failed to save analysis: ${error.message}`,
            timestamp: new Date().toISOString(),
          });
          progressStream.push(null);
        }
      });

      aiStream.on('error', (error) => {
        console.error('AI stream error:', error);
        progressStream.push({
          type: 'error',
          error: `AI generation failed: ${error.message}`,
          timestamp: new Date().toISOString(),
        });
        progressStream.push(null);
      });

      return progressStream;
    } catch (error) {
      console.log(
        `❌ Streaming token analysis failed after ${timer.getDuration()}ms: ${error.message}`,
      );
      progressStream.push({
        type: 'error',
        error: `Failed to analyze token: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
      progressStream.push(null);
      return progressStream;
    }
  }
}
