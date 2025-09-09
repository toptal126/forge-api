import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  Delete,
  Query,
  Headers,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ChatService } from './chat.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiProperty,
} from '@nestjs/swagger';
import { WalletAuthGuard } from '../auth/guards/wallet-auth.guard';
import { Network as AlchemyNetwork } from 'alchemy-sdk';
import { ConversationResponseDto } from './dto/conversation.dto';
import { PublicKey } from '@solana/web3.js';
import { CronService } from '../cron/cron.service';

class TokenAnalysisDto {
  @ApiProperty({ description: 'Token address to analyze' })
  address: string;

  @ApiProperty({
    description: 'Alchemy network to use',
    enum: AlchemyNetwork,
    default: AlchemyNetwork.SOLANA_MAINNET,
    required: false,
  })
  network?: AlchemyNetwork;

  @ApiProperty({
    description: 'Conversation ID for the analysis',
    required: true,
  })
  conversationId: string;
}

@ApiTags('Chat')
@Controller('chat')
@UseGuards(WalletAuthGuard)
export class ChatController {
  constructor(
    private chatService: ChatService,
    private cronService: CronService,
  ) {}

  @Post('conversations')
  @ApiOperation({ summary: 'Create a new conversation' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The title of the conversation',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Conversation created successfully',
    type: ConversationResponseDto,
  })
  async createOrUpdateEmptyConveration(
    @Headers('x-wallet-address') walletAddress: string,
    @Body() body: { title: string },
  ): Promise<ConversationResponseDto> {
    return this.chatService.createOrUpdateEmptyConveration(
      walletAddress,
      body.title,
    );
  }

  @Get('conversation')
  @ApiOperation({
    summary: 'Get the latest conversation for the authenticated user',
  })
  @ApiResponse({ status: 200, description: 'Returns the latest conversation' })
  async getLatestConversation(
    @Headers('x-wallet-address') walletAddress: string,
  ) {
    return this.chatService.getOrCreateLatestConversation(walletAddress);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Get all conversations for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Returns list of conversations' })
  async getConversations(@Headers('x-wallet-address') walletAddress: string) {
    return this.chatService.getConversations(walletAddress);
  }

  @Get('conversation/:id')
  @ApiOperation({ summary: 'Get a specific conversation by ID' })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'The ID of the conversation',
  })
  @ApiResponse({ status: 200, description: 'Returns the conversation details' })
  async getConversation(
    @Headers('x-wallet-address') walletAddress: string,
    @Param('id') id: string,
  ) {
    return this.chatService.getConversation(id, walletAddress);
  }

  @Post('message')
  @ApiOperation({ summary: 'Send a message in a conversation' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        conversationId: {
          type: 'string',
          description: 'The ID of the conversation',
        },
        content: {
          type: 'string',
          description: 'The message content',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Message sent successfully' })
  async sendMessage(
    @Headers('x-wallet-address') walletAddress: string,
    @Body() body: { conversationId: string; content: string },
  ) {
    // Parse potential Solana addresses from the message
    const potentialAddresses =
      body.content.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) || [];
    const validAddresses = potentialAddresses.filter((address) => {
      try {
        new PublicKey(address);
        return true;
      } catch (error) {
        return false;
      }
    });

    return this.chatService.sendMessage(
      body.conversationId,
      body.content,
      walletAddress,
      validAddresses,
    );
  }

  @Post('message/stream')
  @ApiOperation({ summary: 'Send a message with streaming response' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        conversationId: {
          type: 'string',
          description: 'The ID of the conversation',
        },
        content: {
          type: 'string',
          description: 'The message content',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Message streaming response' })
  async sendMessageStream(
    @Headers('x-wallet-address') walletAddress: string,
    @Body() body: { conversationId: string; content: string },
    @Res() res: Response,
  ) {
    try {
      // Set headers for streaming
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, x-wallet-address',
      );

      // Parse potential Solana addresses from the message
      const potentialAddresses =
        body.content.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) || [];
      const validAddresses = potentialAddresses.filter((address) => {
        try {
          new PublicKey(address);
          return true;
        } catch (error) {
          return false;
        }
      });

      // Get the streaming response
      const stream = await this.chatService.sendMessageStream(
        body.conversationId,
        body.content,
        walletAddress,
        validAddresses,
      );

      // Handle stream data
      stream.on('data', (chunk) => {
        const data = JSON.stringify(chunk) + '\n';
        res.write(data);
      });

      stream.on('end', () => {
        res.end();
      });

      stream.on('error', (error) => {
        console.error('Stream error:', error);
        res.status(500).json({ error: 'Streaming failed' });
      });
    } catch (error) {
      console.error('Controller error:', error);
      res.status(500).json({ error: 'Failed to start streaming message' });
    }
  }

  @Delete('conversation/:id')
  @ApiOperation({ summary: 'Delete a conversation' })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'The ID of the conversation to delete',
  })
  @ApiResponse({
    status: 200,
    description: 'Conversation deleted successfully',
  })
  async deleteConversation(
    @Headers('x-wallet-address') walletAddress: string,
    @Param('id') id: string,
  ) {
    return this.chatService.deleteConversation(id, walletAddress);
  }

  @Post('analyze-token')
  @ApiOperation({ summary: 'Analyze token market data and provide insights' })
  @ApiResponse({
    status: 200,
    description: 'Token analysis completed successfully',
  })
  async requestTokenAnalysis(
    @Headers('x-wallet-address') walletAddress: string,
    @Body() tokenAnalysisDto: TokenAnalysisDto,
  ) {
    return this.chatService.requestTokenAnalysis(
      tokenAnalysisDto,
      walletAddress,
    );
  }

  @Post('analyze-token/stream')
  @ApiOperation({
    summary: 'Analyze token market data with streaming response',
  })
  @ApiResponse({
    status: 200,
    description: 'Token analysis streaming response',
  })
  async requestTokenAnalysisStream(
    @Headers('x-wallet-address') walletAddress: string,
    @Body() tokenAnalysisDto: TokenAnalysisDto,
    @Res() res: Response,
  ) {
    try {
      // Set headers for streaming
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, x-wallet-address',
      );

      // Get the streaming response
      const stream = await this.chatService.requestTokenAnalysisStream(
        tokenAnalysisDto,
        walletAddress,
      );

      // Handle stream data
      stream.on('data', (chunk) => {
        const data = JSON.stringify(chunk) + '\n';
        res.write(data);
      });

      stream.on('end', () => {
        res.end();
      });

      stream.on('error', (error) => {
        console.error('Stream error:', error);
        res.status(500).json({ error: 'Streaming failed' });
      });
    } catch (error) {
      console.error('Controller error:', error);
      res.status(500).json({ error: 'Failed to start streaming analysis' });
    }
  }

  @Get('test-market-status')
  @ApiOperation({ summary: 'Test route for market status extraction' })
  @ApiResponse({
    status: 200,
    description: 'Returns the current market status text',
  })
  async testMarketStatus() {
    try {
      // Always fetch fresh data for the test endpoint
      // await this.cronService.fetchTopTierSymbols();
      const statusText = await this.cronService.extractMarketStatusText();

      // Log the response for debugging
      console.log('Market Status Response:', statusText);

      return {
        status: 'success',
        data: statusText,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error fetching market status:', error);
      throw error;
    }
  }
}
