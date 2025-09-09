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

    const messages = await this.messageModel
      .find({ conversationId })
      .sort({ createdAt: 1 })
      .exec();

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
      systemPrompt = `You are an expert Web3 financial analyst specializing in blockchain token analysis. Provide detailed, data-driven insights using market metrics, on-chain analytics, and security assessments. Format responses in professional markdown with clear sections, bullet points for key metrics, and citations for data sources. Include risk disclaimers and maintain objectivity in analysis.
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
      // Fetch token data from various sources
      const [
        solanaFmTokenInfo,
        solscanTokenInfo,
        moralisTokenMetadata,
        tokenHolders,
        tokenAnalytics,
        bondingStatus,
        tokenPairStats,
      ] = await Promise.all([
        this.solanaFMApiService.getTokenInfo(address),
        this.solscanApiService.getTokenInfo(address),
        this.moralisApiService.getTokenMetadata(address),
        this.moralisApiService.getTokenHolders(address),
        this.moralisApiService.getTokenAnalytics(address),
        this.pumpFunApiService
          .getTokenBondingStatus(address)
          .catch(() => undefined),
        this.moralisApiService.getTokenPairStats(address),
      ]);

      // Transform raw API data into the format expected by the prompt
      const rawData: TokenAnalysisRawData = {
        solanaFmTokenInfo: solanaFmTokenInfo,
        solscanTokenInfo: solscanTokenInfo,
        moralisTokenMetadata: moralisTokenMetadata,
        tokenHolders,
        tokenAnalytics,
        bondingStatus,
        tokenPairStats,
      };

      if (!solanaFmTokenInfo && !solscanTokenInfo && !moralisTokenMetadata) {
        throw new Error('Invalid token address');
      }

      const tokenData = transformTokenData(rawData);

      // Get chat history if conversationId is provided
      let chatHistory: IMessage[] = [];
      if (conversationId) {
        chatHistory = await this.messageModel
          .find({ conversationId: new Types.ObjectId(conversationId) })
          .sort({ createdAt: 1 })
          .exec();
      }

      // Generate system prompt for token analysis with news articles
      const systemPrompt = generateTokenAnalysisPrompt(
        tokenData,
        solanaArticles.articles,
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

      // Create and save the response message
      const newConversationId =
        conversationId ?? new Types.ObjectId().toString();

      // add new message in user style requesting token analysis
      await this.messageModel.create({
        conversationId: new Types.ObjectId(conversationId),
        role: 'user',
        content: `Analyze the token ${address} on the ${network} network`,
        walletAddress,
      });

      const responseMessage = await this.messageModel.create({
        conversationId: new Types.ObjectId(newConversationId),
        role: 'assistant',
        content: response.content ?? 'No response generated',
        walletAddress,
      });

      return responseMessage;
    } catch (error) {
      throw new Error(`Failed to analyze token: ${error.message}`);
    }
  }
}
